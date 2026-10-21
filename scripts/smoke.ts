import assert from 'node:assert/strict';
import { Knowledge } from '../src/knowledge.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const knowledge = new Knowledge();
const status = await knowledge.status();
assert.ok(status.datasets.every(source => source.available), JSON.stringify(status));
console.log('Versions:', status.datasets);
const search = await knowledge.search('铁', 'recipes', 'zh_cn', 5);
assert.ok(search.results.length);
assert.equal(search.errors.length, 0);
const item = await knowledge.item('minecraft:iron_ingot');
assert.ok(item.recipes > 0 && item.uses > 0);
const recipes = await knowledge.recipes('minecraft:iron_ingot', 'uses', 'gtceu:bender');
assert.ok(recipes.results.length);
const recipe = await knowledge.recipe(recipes.results[0]!.id);
assert.ok(recipe.slots.length);
const chapters = await knowledge.chapters();
assert.ok(Array.isArray(chapters.chapters));
const quests = await knowledge.search('石', 'quests', 'zh_cn', 3);
assert.ok(quests.results.length, JSON.stringify(quests));
const quest = await knowledge.quest(quests.results[0]!.id);
assert.ok(quest.quest);
await knowledge.dependencies(quests.results[0]!.id, 'prerequisites', 2);
const guideSearch = await knowledge.search('Rock', 'guide', 'zh_cn', 2);
assert.ok(guideSearch.results.length, JSON.stringify(guideSearch));
const guide = await knowledge.guide(guideSearch.results[0]!.id, guideSearch.results[0]!.language);
assert.ok(guide.content.length > 100);
const tag = await knowledge.tag('forge:ingots/iron');
assert.ok(tag.total > 0);
console.log('PASS: live status, localized search, item, recipes, recipe detail, chapters, quest, dependencies, guide and tag');

const client = new Client({ name: 'tfgm-smoke', version: '1.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../dist/server.js', import.meta.url))] });
await client.connect(transport);
try {
  assert.equal((await client.listTools()).tools.length, 10);
  const result = await client.callTool({ name: 'get_item', arguments: { item_id: 'minecraft:iron_ingot' } });
  assert.ok(!result.isError, JSON.stringify(result));
  const content = result.content as { type: string; text: string }[];
  assert.equal(JSON.parse(content[0]!.text).id, 'minecraft:iron_ingot');
  console.log('PASS: compiled server stdio handshake, tools/list and tools/call');
} finally { await client.close(); }
