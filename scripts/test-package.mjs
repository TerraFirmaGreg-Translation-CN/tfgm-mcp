import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

assert.ok(process.argv[2], 'Usage: node scripts/test-package.mjs path/to/package.tgz');
const tarball = resolve(process.argv[2]);
const directory = await mkdtemp(join(tmpdir(), 'tfgm-package-'));
let client;
try {
  execFileSync('npm', ['install', '--prefix', directory, '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--package-lock=false', tarball], { stdio: 'inherit' });
  const root = join(directory, 'node_modules', '@powercess', 'tfgm-mcp');
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, '@powercess/tfgm-mcp');
  assert.equal(pkg.bin['tfgm-mcp'], 'dist/server.js');
  const binary = join(directory, 'node_modules', '.bin', 'tfgm-mcp');
  const transport = new StdioClientTransport({ command: binary, args: [] });
  client = new Client({ name: 'packed-artifact-test', version: '1.0.0' });
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 10);
  const invalid = await client.callTool({ name: 'get_recipe', arguments: { recipe_id: '../invalid' } });
  assert.equal(invalid.isError, true);
  console.log('PASS: isolated production-only install, executable bin, MCP handshake and tools');
} finally {
  await client?.close();
  await rm(directory, { recursive: true, force: true });
}
