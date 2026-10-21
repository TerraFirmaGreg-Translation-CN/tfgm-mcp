import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cacheDirectory, roots } from './config.js';

export class HttpError extends Error {
  constructor(public status: number, public url: string) { super(`Upstream returned HTTP ${status}: ${url}`); }
}
interface Entry { url: string; savedAt: number; text: string }
export interface Reader {
  json(url: string): Promise<unknown>;
  text(url: string): Promise<string>;
}

/** Persistent response cache; errors are never cached and concurrent requests are coalesced. */
export class CachedHttp implements Reader {
  private pending = new Map<string, Promise<string>>();
  constructor(private directory = cacheDirectory, private ttl = 3_600_000, private request: typeof fetch = fetch) {}

  async json(url: string): Promise<unknown> { return JSON.parse(await this.text(url)); }
  text(url: string): Promise<string> {
    if (!Object.values(roots).some(root => url.startsWith(root)) || !Object.values(roots).some(root => new URL(url).href.startsWith(root))) {
      return Promise.reject(new Error('Only configured upstream websites may be fetched'));
    }
    const existing = this.pending.get(url);
    if (existing) return existing;
    const work = this.read(url).finally(() => this.pending.delete(url));
    this.pending.set(url, work);
    return work;
  }
  private async read(url: string): Promise<string> {
    const file = join(this.directory, `${createHash('sha256').update(url).digest('hex')}.json`);
    try {
      const cached = JSON.parse(await readFile(file, 'utf8')) as Entry;
      if (cached.url === url && typeof cached.text === 'string' && Date.now() - cached.savedAt < this.ttl) return cached.text;
    } catch { /* Missing or damaged cache is recoverable. */ }
    let response: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await this.request(url, { signal: AbortSignal.timeout(30_000), redirect: 'error', headers: { 'User-Agent': 'tfgm-mcp/0.1.0' } });
      if (response.ok || ![429, 502, 503, 504].includes(response.status) || attempt === 2) break;
      await response.body?.cancel();
      await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
    }
    if (!response!.ok) throw new HttpError(response!.status, url);
    const text = await response!.text();
    if (text.length > 25_000_000) throw new Error(`Upstream file exceeds 25 MB limit: ${url}`);
    if (url.endsWith('.json')) JSON.parse(text);
    await mkdir(this.directory, { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify({ url, savedAt: Date.now(), text } satisfies Entry));
    await rename(temp, file);
    return text;
  }
}
