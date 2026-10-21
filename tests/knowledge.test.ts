import assert from 'node:assert/strict';
import test from 'node:test';
import { Knowledge, localize } from '../src/knowledge.js';
import { FixtureReader } from './fixtures.js';
import { questData, resourcePath, roots } from '../src/config.js';

const A = '0000000000000001', B = '0000000000000002', C = '0000000000000003';
const recipeBase = `${roots.recipes}bundles/tfg-1.0/`;

test('search resolves English and Chinese names to the same ID', async () => {
  const knowledge = new Knowledge(new FixtureReader());
  for (const term of ['铁锭', 'Iron Ingot', 'minecraft:iron_ingot']) {
    const data = await knowledge.search(term, 'recipes');
    assert.equal(data.results[0]?.id, 'minecraft:iron_ingot');
  }
});

test('recipe direction, category and pagination preserve semantics', async () => {
  const knowledge = new Knowledge(new FixtureReader());
  const first = await knowledge.recipes('minecraft:iron_ingot', 'produces', undefined, 0, 1);
  assert.deepEqual(first.results, [{ id: 'test:smelt', category: 'furnace' }]);
  assert.equal(first.next_offset, 1);
  const second = await knowledge.recipes('minecraft:iron_ingot', 'produces', undefined, first.next_offset!, 1);
  assert.equal(second.results[0]?.id, 'test:cast');
  assert.equal(second.next_offset, null);
  assert.equal((await knowledge.recipes('minecraft:iron_ingot', 'uses', 'bender')).results[0]?.id, 'test:bend');
});

test('recipe does not invent missing quantities and detects filename collisions', async () => {
  const reader = new FixtureReader();
  const knowledge = new Knowledge(reader);
  const data = await knowledge.recipe('test:bend');
  assert.equal(data.slots[0]?.amount, null);
  assert.equal(data.image_url, `${recipeBase}recipes/test/bend.png`);
  reader.data.set(`${recipeBase}recipes/test/bend.json`, { id: 'test:other', widgets: [] });
  await assert.rejects(() => knowledge.recipe('test:bend'), /does not match/);
});

test('quest localization preserves gameplay filters and removes rendering metadata', async () => {
  const knowledge = new Knowledge(new FixtureReader());
  const data = await knowledge.quest(A);
  const quest = data.quest as { title: string; iconDisplay?: unknown; tasks: { filterRaw: string }[] };
  assert.equal(quest.title, '开始');
  assert.equal(quest.iconDisplay, undefined);
  assert.equal(quest.tasks[0]?.filterRaw, 'or(item_tag(test:rock)item(minecraft:flint))');
  assert.equal(localize('{unknown.key}', {}), '{unknown.key}');
});

test('dependency traversal crosses chapters, terminates cycles and reverses edges', async () => {
  const knowledge = new Knowledge(new FixtureReader());
  const prerequisites = await knowledge.dependencies(C, 'prerequisites', 10);
  assert.deepEqual(prerequisites.nodes.map(n => n.id), [B, A]);
  assert.equal(prerequisites.edges.length, 3);
  const dependents = await knowledge.dependencies(A, 'dependents', 2);
  assert.deepEqual(dependents.nodes.map(n => n.id), [B, C]);
});

test('guide fallback is explicit, results deduplicate pages and body excludes scripts/nav', async () => {
  const knowledge = new Knowledge(new FixtureReader());
  const search = await knowledge.search('Iron', 'guide');
  assert.equal(search.results.length, 1);
  assert.equal(search.results[0]?.language, 'en_us');
  const guide = await knowledge.guide('world/iron.html');
  assert.equal(guide.language, 'en_us');
  assert.match(guide.content, /Heat iron/);
  assert.doesNotMatch(guide.content, /Ignore/);
  assert.equal(guide.images[0]?.url, `${roots.guide}img/iron.png`);
  const page = await knowledge.guide('world/iron.html', 'zh_cn', 0, 5);
  assert.equal(page.next_offset, 5);
});

test('version mismatch and partially unavailable sources remain visible', async () => {
  const reader = new FixtureReader();
  const knowledge = new Knowledge(reader);
  assert.equal((await knowledge.status()).version_mismatch, true);
  reader.data.delete(`${roots.guide}build.json`);
  const result = await knowledge.search('iron');
  assert.ok(result.results.length > 0);
  assert.equal(result.errors[0]?.source, 'guide');
});

test('rejects traversal and arbitrary guide requests before fetching them', async () => {
  for (const input of ['minecraft:../../secret', 'minecraft:a/../b', '..:x', 'https://evil.test']) assert.throws(() => resourcePath(input));
  const reader = new FixtureReader();
  const knowledge = new Knowledge(reader);
  await assert.rejects(() => knowledge.guide('https://evil.test/a.html'));
  await assert.rejects(() => knowledge.guide('../en_us/unknown.html'));
  assert.ok(reader.calls.every(url => url.startsWith('https://terrafirmagreg-team.github.io/')));
});

test('upstream malformed schema and inconsistent deployment fail explicitly', async () => {
  const reader = new FixtureReader();
  const knowledge = new Knowledge(reader);
  reader.data.set(`${recipeBase}items/minecraft/iron_ingot.json`, { inputs: 'broken' });
  await assert.rejects(() => knowledge.item('minecraft:iron_ingot'));
  reader.data.set(`${roots.recipes}build.json`, { modpack: '2.0' });
  await assert.rejects(() => knowledge.recipes('minecraft:iron_ingot', 'uses'), /versions differ/);
});

test('tag members paginate without flattening nested references', async () => {
  const knowledge = new Knowledge(new FixtureReader());
  const result = await knowledge.tag('#forge:ingots/iron', 'items', 0, 1);
  assert.deepEqual(result.values, ['minecraft:iron_ingot']);
  assert.equal(result.next_offset, 1);
});
