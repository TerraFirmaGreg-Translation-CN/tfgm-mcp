import { load } from 'cheerio';
import { z } from 'zod';
import { CachedHttp, HttpError, type Reader } from './cache.js';
import { locale, questData, resourcePath, roots, type Source } from './config.js';
import { buildSchema, chapterSchema, chaptersSchema, guideIndexSchema, itemRecipesSchema, labelsSchema, questIndexSchema, recipeSchema, type Quest } from './schema.js';

type Hit = { id: string; title: string; content: string; source: Source; source_url: string; source_version: string; language: string; chapter?: string };
type Snapshot = { version: string; revision: string; bundle?: string; base: string };
const translationsSchema = z.record(z.string(), z.string());
const bundleListSchema = z.object({ default: z.string(), bundles: z.array(z.string()) });
const bundleSchema = z.object({ schema: z.number(), recipeCount: z.number(), languages: z.array(z.string()), recipeImageFormat: z.enum(['png', 'webp']).default('png') }).passthrough();

export function localize(value: unknown, translations: Record<string, string>): unknown {
  if (typeof value === 'string') return value.replace(/\{([^{}]+)\}/g, (all, key: string) => translations[key] ?? all).replace(/[&§][0-9a-fklmnor]/gi, '');
  if (Array.isArray(value)) return value.map(v => localize(v, translations));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, localize(v, translations)]));
  return value;
}

function compactQuest(quest: Quest): Record<string, unknown> {
  // Retain all gameplay fields, including dependency semantics and raw item filters.
  const omitted = new Set(['x', 'y', 'size', 'shape', 'iconDisplay', 'iconItems', 'hideDependencyLines']);
  function clean(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !omitted.has(k)).map(([k, v]) => [k, clean(v)]));
    return value;
  }
  return clean(quest) as Record<string, unknown>;
}

/** Upstream JSON is untrusted and validated at each adapter boundary. */
export class Knowledge {
  private memo = new Map<string, { expires: number; value: Promise<unknown> }>();
  constructor(private http: Reader = new CachedHttp()) {}
  private remember<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.memo.get(key);
    if (prior && prior.expires > Date.now()) return prior.value as Promise<T>;
    const value = fn().catch(error => { this.memo.delete(key); throw error; });
    this.memo.set(key, { expires: Date.now() + 3_600_000, value });
    if (this.memo.size > 64) this.memo.delete(this.memo.keys().next().value!);
    return value;
  }
  private async snapshot(source: Source): Promise<Snapshot> {
    const build = buildSchema.parse(await this.http.json(`${roots[source]}build.json`));
    if (source !== 'recipes') return { version: build.modpack, revision: build.contentHash ?? build.modpack, base: source === 'quests' ? questData : roots.guide };
    const manifest = bundleListSchema.parse(await this.http.json(`${roots.recipes}bundles.json`));
    if (!/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(manifest.default) || !manifest.bundles.includes(manifest.default)) throw new Error('Invalid default recipe bundle');
    if (manifest.default !== `tfg-${build.modpack}`) throw new Error('Upstream recipe build and bundle versions differ; retry after deployment completes');
    return { version: build.modpack, revision: build.contentHash ?? build.modpack, bundle: manifest.default, base: `${roots.recipes}bundles/${manifest.default}/` };
  }
  private provenance(source: Source, snapshot: Snapshot, url: string) {
    return { source, source_version: snapshot.version, source_revision: snapshot.revision, source_url: url };
  }
  private async languageData<T>(base: string, language: string, schema: z.ZodType<T>, suffix = '.json'): Promise<{ data: T; language: string }> {
    locale(language);
    try { return { data: schema.parse(await this.http.json(`${base}${language}${suffix}`)), language }; }
    catch (error) {
      if (!(error instanceof HttpError && error.status === 404) || language === 'en_us') throw error;
      return { data: schema.parse(await this.http.json(`${base}en_us${suffix}`)), language: 'en_us' };
    }
  }
  private async labels(snapshot: Snapshot, language: string) {
    return this.remember(`labels:${snapshot.revision}:${language}`, async () => {
      const english = await this.languageData(`${snapshot.base}items-lang/`, 'en_us', labelsSchema);
      const requested = language === 'en_us' ? english : await this.languageData(`${snapshot.base}items-lang/`, language, labelsSchema);
      const byId = new Map(english.data.items.map(item => [item.id, { ...item, language: 'en_us' }]));
      for (const item of requested.data.items) {
        const fallback = byId.get(item.id);
        byId.set(item.id, { ...item, language: requested.language, haystack: `${item.haystack ?? item.label} ${fallback?.haystack ?? fallback?.label ?? ''}` });
      }
      return [...byId.values()];
    });
  }
  private async questsIndex(language: string, snapshot: Snapshot) {
    return this.remember(`quests:${snapshot.revision}:${language}`, () => this.languageData(`${questData}search-index/`, language, questIndexSchema));
  }
  private async translations(language: string, snapshot: Snapshot) {
    return this.remember(`translations:${snapshot.revision}:${language}`, async () => {
      const english = await this.languageData(`${questData}lang/`, 'en_us', translationsSchema);
      const requested = language === 'en_us' ? english : await this.languageData(`${questData}lang/`, language, translationsSchema);
      return { data: { ...english.data, ...requested.data }, language: requested.language };
    });
  }
  async status() {
    const results = await Promise.all((Object.keys(roots) as Source[]).map(async source => {
      try {
        const snapshot = await this.snapshot(source);
        const bundle = source === 'recipes' ? bundleSchema.parse(await this.http.json(`${snapshot.base}bundle.json`)) : undefined;
        return { ...this.provenance(source, snapshot, `${roots[source]}build.json`), available: true, bundle: snapshot.bundle, recipe_count: bundle?.recipeCount };
      } catch (error) { return { source, available: false, error: String(error) }; }
    }));
    const versions = new Set(results.flatMap(r => 'source_version' in r ? [r.source_version] : []));
    return { datasets: results, version_mismatch: versions.size > 1, cache_ttl_seconds: 3600, warning: versions.size > 1 ? 'Sources describe different modpack versions; do not assume cross-source compatibility.' : null };
  }
  async search(query: string, scope: 'all' | Source = 'all', language = 'zh_cn', limit = 10) {
    locale(language);
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) throw new Error('Search query cannot be empty');
    const sources = scope === 'all' ? Object.keys(roots) as Source[] : [scope];
    const groups = await Promise.all(sources.map(async source => {
      try {
        const snapshot = await this.snapshot(source);
        let hits: Hit[];
        if (source === 'recipes') {
          hits = (await this.labels(snapshot, language)).map(item => ({ id: item.id, title: item.label, content: item.haystack ?? item.label, source, source_url: `${roots.recipes}?${new URLSearchParams({ lang: language, item: item.id })}`, source_version: snapshot.version, language: item.language }));
        } else if (source === 'quests') {
          const index = await this.questsIndex(language, snapshot);
          hits = index.data.quests.map(q => ({ id: q.id, title: q.title, content: `${q.chapterTitle ?? ''} ${q.content}`, chapter: q.chapter, source, source_url: `${roots.quests}?${new URLSearchParams({ lang: index.language, chapter: q.chapter, quest: q.id })}`, source_version: snapshot.version, language: index.language }));
        } else {
          const index = await this.guideIndex(language, snapshot);
          const pages = new Map<string, Hit>();
          for (const row of index.data) {
            const url = this.guideUrl(row.url, index.language);
            const previous = pages.get(url);
            if (previous) previous.content += `\n${row.content}`;
            else pages.set(url, { id: url.slice(`${roots.guide}${index.language}/`.length), title: row.entry, content: row.content, source, source_url: url, source_version: snapshot.version, language: index.language });
          }
          hits = [...pages.values()];
        }
        const ranked = hits.flatMap(hit => {
          const haystack = `${hit.id} ${hit.title} ${hit.content}`.toLowerCase();
          if (!terms.every(term => haystack.includes(term))) return [];
          const score = (hit.id.toLowerCase() === query.toLowerCase() ? 100 : 0) + (hit.title.toLowerCase() === query.toLowerCase() ? 80 : 0) + terms.filter(term => hit.title.toLowerCase().includes(term)).length * 10;
          const at = Math.max(0, hit.content.toLowerCase().indexOf(terms[0]!) - 60);
          return [{ ...hit, content: hit.content.slice(at, at + 450), score }];
        }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
        return { source, total: ranked.length, hits: ranked.slice(0, limit) };
      } catch (error) { return { source, total: 0, hits: [], error: String(error) }; }
    }));
    return { query, results: groups.flatMap(g => g.hits).sort((a, b) => b.score - a.score).slice(0, limit), source_counts: Object.fromEntries(groups.map(g => [g.source, g.total])), errors: groups.filter(g => g.error).map(g => ({ source: g.source, error: g.error })), note: 'Language indicates the upstream locale, not a guarantee every sentence is translated. Recipe results are item IDs; use find_recipes next.' };
  }
  async item(id: string, language = 'zh_cn') {
    const parsed = resourcePath(id);
    const snapshot = await this.snapshot('recipes');
    const url = `${snapshot.base}items/${parsed.namespace}/${parsed.path}.json`;
    const [data, labels] = await Promise.all([this.http.json(url).then(d => itemRecipesSchema.parse(d)), this.labels(snapshot, locale(language))]);
    const label = labels.find(item => item.id === id);
    return { ...this.provenance('recipes', snapshot, url), id, name: label?.label ?? id, language: label?.language ?? language, recipes: Object.values(data.outputs).flat().length, uses: Object.values(data.inputs).flat().length, production_categories: Object.keys(data.outputs), usage_categories: Object.keys(data.inputs) };
  }
  async recipes(id: string, direction: 'produces' | 'uses', category?: string, offset = 0, limit = 20) {
    const parsed = resourcePath(id);
    const snapshot = await this.snapshot('recipes');
    const url = `${snapshot.base}items/${parsed.namespace}/${parsed.path}.json`;
    const data = itemRecipesSchema.parse(await this.http.json(url));
    const recipes = Object.entries(direction === 'produces' ? data.outputs : data.inputs).filter(([key]) => !category || key === category).flatMap(([category, ids]) => ids.map(id => ({ id, category })));
    return { ...this.provenance('recipes', snapshot, url), item_id: id, direction, total: recipes.length, results: recipes.slice(offset, offset + limit), next_offset: offset + limit < recipes.length ? offset + limit : null };
  }
  async recipe(id: string) {
    const parsed = resourcePath(id);
    const snapshot = await this.snapshot('recipes');
    const meta = bundleSchema.parse(await this.http.json(`${snapshot.base}bundle.json`));
    const stem = `${snapshot.base}recipes/${parsed.namespace}/${parsed.path.replaceAll('/', '_')}`;
    const url = `${stem}.json`;
    const data = recipeSchema.parse(await this.http.json(url));
    if (data.id !== id) throw new Error('Recipe ID does not match upstream file (possible filename collision)');
    return { ...this.provenance('recipes', snapshot, url), id, category: data.category, image_url: `${stem}.${meta.recipeImageFormat}`, slots: data.widgets.filter(w => w.role || w.interaction).map(w => ({ role: w.role ?? 'unknown', interaction: w.interaction ?? null, amount: w.amount ?? w.count ?? null, tooltip: w.tooltip ?? null })), raw: data, limitations: ['This is an exported EMI display layout. Null quantities are unknown, not 1.', 'Amounts, circuit settings, energy, time and other conditions may only appear in the image. Do not infer missing values.', 'Recipe existence does not establish availability at the player’s progression stage.'] };
  }
  async chapters(language = 'zh_cn') {
    const snapshot = await this.snapshot('quests');
    const [data, translations] = await Promise.all([this.http.json(`${questData}quests/index.json`).then(d => chaptersSchema.parse(d)), this.translations(locale(language), snapshot)]);
    return { ...this.provenance('quests', snapshot, `${questData}quests/index.json`), language: translations.language, chapters: localize(data.chapters.map(({ id, filename, title }) => ({ id, filename, title })), translations.data) };
  }
  private async findQuest(id: string, language: string, snapshot: Snapshot) {
    const index = await this.questsIndex(language, snapshot);
    const record = index.data.quests.find(q => q.id === id);
    if (!record) throw new Error(`Quest not found: ${id}`);
    if (!/^[a-zA-Z0-9_-]+$/.test(record.chapter)) throw new Error('Invalid chapter filename');
    const url = `${questData}quests/chapters/${record.chapter}.json`;
    const chapter = await this.remember(`chapter:${snapshot.revision}:${record.chapter}`, () => this.http.json(url).then(d => chapterSchema.parse(d)));
    const quest = chapter.quests.find(q => q.id === id);
    if (!quest) throw new Error(`Quest index and chapter disagree: ${id}`);
    return { quest, chapter: record.chapter, url };
  }
  async quest(id: string, language = 'zh_cn') {
    const snapshot = await this.snapshot('quests');
    const [found, translations] = await Promise.all([this.findQuest(id, locale(language), snapshot), this.translations(language, snapshot)]);
    return { ...this.provenance('quests', snapshot, found.url), chapter: found.chapter, language: translations.language, quest: localize(compactQuest(found.quest), translations.data), note: 'Unresolved {...} values are upstream markup or missing translations; player completion state is not available.' };
  }
  async dependencies(id: string, direction: 'prerequisites' | 'dependents', depth = 1, language = 'zh_cn') {
    const snapshot = await this.snapshot('quests');
    const index = await this.questsIndex(locale(language), snapshot);
    await this.findQuest(id, language, snapshot);
    const byId = new Map(index.data.quests.map(q => [q.id, q]));
    const all = new Map<string, Quest>();
    if (direction === 'dependents') {
      // Small chapter set; sequential loading avoids flooding the upstream site.
      for (const chapter of new Set(index.data.quests.map(q => q.chapter))) {
        const first = index.data.quests.find(q => q.chapter === chapter)!;
        await this.findQuest(first.id, language, snapshot);
        const data = await this.remember(`chapter:${snapshot.revision}:${chapter}`, () => this.http.json(`${questData}quests/chapters/${chapter}.json`).then(d => chapterSchema.parse(d)));
        for (const q of data.quests) all.set(q.id, q);
      }
    }
    const visited = new Set([id]);
    let frontier = [id];
    const nodes: { id: string; title?: string; chapter?: string; depth: number }[] = [];
    const edges: { prerequisite: string; dependent: string }[] = [];
    const missing: string[] = [];
    let truncated = false;
    for (let level = 1; level <= depth && frontier.length; level++) {
      const next: string[] = [];
      for (const current of frontier) {
        const neighbors = direction === 'prerequisites' ? (await this.findQuest(current, language, snapshot)).quest.dependencies ?? [] : [...all.values()].filter(q => q.dependencies?.includes(current)).map(q => q.id);
        for (const neighbor of neighbors) {
          if (edges.length >= 1000 || nodes.length >= 200) { truncated = true; break; }
          edges.push(direction === 'prerequisites' ? { prerequisite: neighbor, dependent: current } : { prerequisite: current, dependent: neighbor });
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          const record = byId.get(neighbor);
          nodes.push({ id: neighbor, title: record?.title, chapter: record?.chapter, depth: level });
          if (record) next.push(neighbor); else missing.push(neighbor);
        }
        if (truncated) break;
      }
      if (truncated) break;
      frontier = next;
    }
    return { ...this.provenance('quests', snapshot, `${questData}quests/index.json`), quest_id: id, direction, max_depth: depth, nodes, edges, missing_ids: missing, truncated, note: 'Edges describe declared dependencies, not guaranteed unlocks. Check task/dependency settings with get_quest; player state is unknown.' };
  }
  private guideIndex(language: string, snapshot: Snapshot) {
    return this.remember(`guide:${snapshot.revision}:${language}`, () => this.languageData(roots.guide, language, guideIndexSchema, '/search_index.json'));
  }
  private guideUrl(id: string, language: string) {
    const base = `${roots.guide}${locale(language)}/`;
    const url = new URL(id, base);
    if (!url.href.startsWith(base) || !url.pathname.endsWith('.html') || url.search) throw new Error('Guide entry must be an HTML page within the selected language directory');
    url.hash = '';
    return url.href;
  }
  async guide(id: string, language = 'zh_cn', offset = 0, limit = 12000) {
    const snapshot = await this.snapshot('guide');
    const index = await this.guideIndex(locale(language), snapshot);
    const url = this.guideUrl(id, index.language);
    if (!index.data.some(row => this.guideUrl(row.url, index.language) === url)) throw new Error('Guide entry not found in the upstream search index; use search first');
    const $ = load(await this.http.text(url));
    $('script, style, nav, footer').remove();
    const body = $('.col-md-9').first();
    if (!body.length) throw new Error('Upstream guide HTML structure changed');
    const links = body.find('a[href]').toArray().flatMap(el => {
      const href = $(el).attr('href')!;
      try { const target = new URL(href, url); return ['https:', 'http:'].includes(target.protocol) ? [{ text: $(el).text().trim(), url: target.href }] : []; } catch { return []; }
    });
    const images = body.find('img[src]').toArray().map(el => ({ alt: $(el).attr('alt') ?? '', url: new URL($(el).attr('src')!, url).href })).filter(img => img.url.startsWith('https://'));
    body.find('br').replaceWith('\n');
    body.find('p, h1, h2, h3, h4, li, tr, section').append('\n');
    const text = body.text().replace(/[\t ]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();
    return { ...this.provenance('guide', snapshot, url), language: index.language, title: $('title').text(), content: text.slice(offset, offset + limit), total_characters: text.length, next_offset: offset + limit < text.length ? offset + limit : null, links: links.slice(0, 100), images: images.slice(0, 40), note: 'The upstream locale can contain untranslated English. Images may hold additional recipe or multiblock information.' };
  }
  async tag(id: string, kind: 'items' | 'blocks' | 'fluids' = 'items', offset = 0, limit = 50) {
    const parsed = resourcePath(id.replace(/^#/, ''));
    const snapshot = await this.snapshot('recipes');
    const url = `${snapshot.base}tags/${parsed.namespace}/${kind}/${parsed.path}.json`;
    const raw = await this.http.json(url);
    const data = z.union([z.array(z.unknown()), z.object({ values: z.array(z.unknown()) }).passthrough()]).parse(raw);
    const values = Array.isArray(data) ? data : data.values;
    return { ...this.provenance('recipes', snapshot, url), id, kind, values: values.slice(offset, offset + limit), total: values.length, next_offset: offset + limit < values.length ? offset + limit : null };
  }
}
