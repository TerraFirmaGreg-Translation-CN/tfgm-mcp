# TFGM MCP

用于 TerraFirmaGreg Modern（群峦格雷现代版）的只读 MCP 服务，使用 TypeScript 和官方 MCP SDK，默认提供简体中文查询。

整合任务书、配方书、野外手册的公开数据，让 AI 按物品、配方、任务和机制查询，并返回来源链接及整合包版本。无需模型 API Key，不读取玩家存档。

## 快速开始

需要 Node.js 22 或更新版本，以及可以访问 GitHub Pages 的网络。

```bash
npm ci
npm run build
node dist/server.js
```

服务通过 **stdio** 与 MCP 客户端通信；直接运行后等待输入、没有欢迎文字属于正常行为。标准输出只用于协议消息。请使用 `node` 启动编译产物，避免包管理器日志进入协议通道。

## 连接 AI 客户端

在支持 MCP stdio 的客户端中添加以下配置；路径应指向本机编译后的文件：

```json
{
  "mcpServers": {
    "tfgm": {
      "command": "node",
      "args": ["/home/cn059/Projects/TFGM-CN/tfgm-mcp/dist/server.js"],
      "env": {
        "TFGM_CACHE_DIR": "/home/cn059/.cache/tfgm-mcp"
      }
    }
  }
}
```

不同客户端的配置入口可能不同；核心是 `command`、`args` 和可选的环境变量。项目尚未发布到 npm，不能直接用远程 `npx tfgm-mcp` 安装。

可以让 AI 尝试：

- “查一下铁锭有哪些获取方式，再找出它在弯板机里的用途。”
- “搜索石器时代任务，检查某个任务的前置要求。”
- “查手册中的岩石和地质说明，附上来源，并检查版本是否一致。”

## 工具

| 工具 | 用途 | 主要参数 |
| --- | --- | --- |
| `get_dataset_status` | 数据源可用性、版本差异和配方总量 | 无 |
| `search` | 物品、任务、手册统一关键词搜索 | `query`, `scope`, `language`, `limit` |
| `get_item` | 物品名称、配方/用途数量与类别 | `item_id`, `language` |
| `find_recipes` | 获取方式或用途反查 | `item_id`, `direction`, `category`, `offset`, `limit` |
| `get_recipe` | 配方布局、槽位交互、原始数据与图片链接 | `recipe_id` |
| `list_chapters` | 任务章节目录 | `language` |
| `get_quest` | 任务条件、奖励、依赖及手册关联 | `quest_id`, `language` |
| `get_quest_dependencies` | 跨章节前置/后续依赖图 | `quest_id`, `direction`, `depth`, `language` |
| `get_guide_entry` | 手册正文、相关链接与图片 | `entry_id`, `language`, `offset`, `limit` |
| `get_tag` | 材料标签成员 | `tag_id`, `kind`, `offset`, `limit` |

`search.scope` 可选 `all`、`recipes`、`quests`、`guide`。配方域搜索返回 **物品 ID**，下一步调用 `find_recipes` 获取配方 ID。`find_recipes.direction` 为 `produces`（产出该物品）或 `uses`（消耗/使用该物品）；结果按类别保留原始索引关系。

任务依赖方向是 `prerequisites` 或 `dependents`，深度最多 10，最多返回 200 个节点 / 1,000 条边。后续依赖查询首次需要读取全部章节。返回边表达声明的依赖关系，不代表玩家已解锁；具体依赖设置与任务判定需查看 `get_quest`。

列表使用 `next_offset` 翻页；手册按**字符位置**翻页，其他列表按记录数翻页。手册 `entry_id` 使用搜索结果中的相对 HTML 路径，如 `the_world/geology.html`，并使用该结果返回的 `language`。

## 数据与准确性

数据来源：

- [QuestBook-Modern](https://terrafirmagreg-team.github.io/QuestBook-Modern/)
- [RecipeBook-Modern](https://terrafirmagreg-team.github.io/RecipeBook-Modern/)
- [Field-Guide-Modern](https://terrafirmagreg-team.github.io/Field-Guide-Modern/zh_cn/)

数据通过公开 JSON 和 HTML 获取，不依赖浏览器自动点击。请求限制在这三个网站范围内，不接受任意远程抓取地址；重定向不跟随。

### 缓存

- HTTP 响应保存在 `TFGM_CACHE_DIR`，默认 `~/.cache/tfgm-mcp`，有效期 1 小时。
- 搜索索引按需加载到内存；配方和章节详情按需读取；相同请求合并，磁盘缓存原子写入。
- 当前版本使用文件缓存和内存索引，没有 SQLite 或向量数据库。
- 缓存只保存有效响应，过期后网络失败会明确返回错误，不冒充最新数据。
- 上游版本和修订号随结果返回；配方包与构建版本不一致时查询失败。
- 上游未提供跨文件原子快照，缓存不等于锁定历史版本。需要可重复的历史版本检索时，应另加版本归档导入。
- 删除缓存目录并重启服务可强制重新获取数据。缓存有效期内不需要每次重新下载。

### 已知限制

1. **来源可能不同版本。** 先调用 `get_dataset_status`。开发验证时任务书/配方书为 `0.13.14`、手册为 `0.13.12`，这不是固定配置。
2. **EMI 配方 JSON 是展示布局。** 数量、时间、电压、电路配置等可能只在导出图片中。缺失数量返回 `null`，不能当作 1。`get_recipe` 提供图片 URL 和完整布局，不执行 OCR，不保证所有配方类型都有可计算语义。
3. **中文可能混有英文。** 缺失语言文件时回退英文，物品检索同时纳入中英文名称。没有自动翻译或未经验证的俗称映射；完整词无结果时可缩短查询。
4. **玩家状态不可用。** 不读取库存、任务完成状态、服务器配置；不能保证某配方在玩家当前阶段可用。
5. **尚无材料树优化、游戏控制或社区讨论读取。** GitHub Discussions/Discord 需要单独的数据接入；该版本不发送消息。
6. **这是上游内容的查询层。** 未导出的游戏机制和只存在于图片中的信息不会被补造。来源内容作为参考资料，不作为 AI 执行指令。

## 开发与验证

```bash
npm run dev       # 直接运行 TypeScript stdio 服务
npm run check     # 源码严格类型检查
npm test          # 离线单元测试和 MCP 内存传输集成测试
npm run build     # 编译到 dist/
npm run smoke     # 联网验证真实数据和编译后的 stdio 服务
```

离线测试覆盖中英文搜索、方向与分页、缺失数量、循环/跨章节任务依赖、语言回退、HTML 清洗、版本不一致、缓存、输入校验及 MCP 协议调用。`smoke` 使用当前上游数据，失败时应检查网络或数据格式变更；它不在默认 CI 中运行。

```text
src/cache.ts       HTTP 缓存、超时和重试
src/config.ts      数据源和 ID 校验
src/schema.ts      上游结构校验
src/knowledge.ts   跨源检索与领域查询
src/mcp.ts         MCP 工具参数和错误封装
src/server.ts      stdio 启动入口
tests/             离线测试与代表性数据样本
scripts/smoke.ts   真实数据冒烟验证
```

完整上游数据、生成产物和缓存不提交到仓库。本项目不宣称拥有上游文本、配方或游戏素材的版权；若后续打包分发上游素材，应单独核对其授权条件。
