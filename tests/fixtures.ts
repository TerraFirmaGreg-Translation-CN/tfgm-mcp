import { HttpError, type Reader } from '../src/cache.js';
import { questData, roots } from '../src/config.js';
const A = '0000000000000001', B = '0000000000000002', C = '0000000000000003';
const recipeBase = `${roots.recipes}bundles/tfg-1.0/`;
export class FixtureReader implements Reader {
  calls: string[] = [];
  data = new Map<string, unknown>([
    [`${roots.quests}build.json`, { modpack: '1.0', contentHash: 'q1' }],
    [`${roots.recipes}build.json`, { modpack: '1.0', contentHash: 'r1' }],
    [`${roots.guide}build.json`, { modpack: '0.9', contentHash: 'g1' }],
    [`${roots.recipes}bundles.json`, { default: 'tfg-1.0', bundles: ['tfg-1.0'] }],
    [`${recipeBase}bundle.json`, { schema: 2, recipeCount: 2, languages: ['en_us', 'zh_cn'], recipeImageFormat: 'png' }],
    [`${recipeBase}items-lang/en_us.json`, { items: [{ id: 'minecraft:iron_ingot', label: 'Iron Ingot' }] }],
    [`${recipeBase}items-lang/zh_cn.json`, { items: [{ id: 'minecraft:iron_ingot', label: '铁锭' }] }],
    [`${recipeBase}items/minecraft/iron_ingot.json`, { outputs: { furnace: ['test:smelt', 'test:cast'] }, inputs: { bender: ['test:bend'] } }],
    [`${recipeBase}recipes/test/bend.json`, { id: 'test:bend', category: 'bender', widgets: [{ role: 'input', interaction: { kind: 'item', id: 'minecraft:iron_ingot' } }] }],
    [`${recipeBase}tags/forge/items/ingots/iron.json`, { values: ['minecraft:iron_ingot', 'test:iron'] }],
    [`${questData}search-index/en_us.json`, { quests: [
      { id: A, chapter: 'stone', title: 'Start', content: 'stone' },
      { id: B, chapter: 'metal', title: 'Metal', content: 'iron' },
      { id: C, chapter: 'metal', title: 'Machine', content: 'machine' },
    ] }],
    [`${questData}lang/en_us.json`, { 'quest.start': 'Start' }],
    [`${questData}lang/zh_cn.json`, { 'quest.start': '开始' }],
    [`${questData}quests/chapters/stone.json`, { quests: [{ id: A, title: '{quest.start}', dependencies: [B], iconDisplay: { frames: [1, 2] }, tasks: [{ filterRaw: 'or(item_tag(test:rock)item(minecraft:flint))' }] }] }],
    [`${questData}quests/chapters/metal.json`, { quests: [{ id: B, title: 'Metal', dependencies: [A] }, { id: C, title: 'Machine', dependencies: [B] }] }],
    [`${roots.guide}en_us/search_index.json`, [
      { entry: 'Iron', content: 'Iron heat', url: './world/iron.html' },
      { entry: 'Iron', content: 'Iron rock', url: './world/iron.html' },
    ]],
    [`${roots.guide}en_us/world/iron.html`, '<html><title>Iron</title><nav>Ignore navigation</nav><div class="col-md-9"><h1>Iron</h1><p>Heat iron.</p><p>More information.</p><a href="other.html">Other</a><img src="../../img/iron.png" alt="Iron"><script>Ignore script</script></div></html>'],
  ]);
  async json(url: string): Promise<unknown> {
    this.calls.push(url);
    if (!this.data.has(url)) throw new HttpError(404, url);
    return this.data.get(url);
  }
  async text(url: string): Promise<string> { return String(await this.json(url)); }
}

