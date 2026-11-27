# 本机实测状态

每一项都写**实测过什么**，以及**什么时候测的**。

日期：2026-11-27（本轮全部重测）。`pnpm test` exit 0，CI 绿，官网与文档站已部署并浏览器抽查。

## 本轮重新跑过每一项

| 能力 | 怎么跑 | 结果 |
|---|---|---|
| 七族 acceptance | `pnpm test:acceptance` | `7` 个 PASS |
| MCP 往返 | `node scripts/verify-mcp.mjs` | initialize / tools/list / tools/call 全通 |
| 本地站六族渲染 | `node scripts/check-local-families.mjs` | 六族全渲染，页面上无二进制泄漏 |
| 文档站 52 页 | `node scripts/check-docs.mjs` | 无死链、无未翻译 key |
| 网站上的命令 | `node scripts/check-docs-commands.mjs` | `POST /api/diff` 与 `compareFiles` 都跑通 |
| 文档与事实一致 | `node scripts/check-docs-truth.mjs` | 路径都存在、扩展权限与 manifest 相符、样例无漂移、测试无硬编码家目录 |
| 移动端 390px | `node scripts/check-mobile.mjs` | `all 8 views fit a 390px screen` |
| 用例对标 | `node apps/cli/scripts/case-parity.mjs` | 覆盖 `168/229`、精确 `105/229` |
| 新克隆能跑 | `node scripts/check-clean-clone.mjs` | 克隆 → 安装 → 构建 → 五族逐个比对，全通过 |
| git difftool | 真实仓库 `git difftool` | `1 处差异 · +2/-1 行`，自动拉起 |
| Claude Code hook | 编辑后终端打印差异；MCP 侧 `claude mcp list` 显示 Connected | `node apps/cli/lib/bin.js hook:claude-post` |
| 浏览器扩展页内渲染 | 真实 GitHub commit `c0e6329` | 面板画在页面右下角，未跳转，见 `docs/evidence/` |

## 有截图但对不上全部场景的

| 项 | 现状 |
|---|---|
| DSH 卡片（Word） | ✅ 截图 `docs/evidence/A2-word-card.png`：四行表格 |
| DSH 卡片（代码编辑） | ⏳ **未确认**。在 `desktop` profile 里连做 3 次 `edit`，`~/.diffs/inbox` 无新记录；agent 看不到自己界面的渲染结果，需人确认 |

## 未完成（代码里没有，或没验证通过）

| 项 | 为什么 |
|---|---|
| `movedWithEdit` | 内核 `MoveBlock` 只带一侧 `text`。加了 `moved_with_edit` 后命中 1/17 且破坏 `summary`/`counts` 一致性，已回退。要做对得让 `sem_diff` 记录移动块两侧内容 |
| `inlinedFunction` 6/8 中的 2 个 | 局部内联（`const f = (e) => …`），声明在新文件里仍在，要按作用域数调用次数才认得出 |
| VS Code 扩展 | 不存在，也没在市场里；`config` 页标 `planned` |
| npm 发布 | `diffs` 属于别人（`synder`，对象比较库），无权限；`@diffs/diff-tool` 未发布。文案已标注 |

## 容易误会的三点

**1. 相对路径**

`diffs diff a.ts b.ts` 的路径按**进程的 cwd** 解析。在 DSH 里 cwd 是 `WorkSpace`，所以要写
`diffs.work/test-cases/...`；不是 bug。

**2. Excel 没有并排开关**

一张工作表本来就是一个网格同时承载新旧两侧，没有「第二个文档」可并排。六族里只有 Excel 是这样。

**3. 文档站说的「未发布到 npm」是真的**

`npm i @diffs/diff-tool` 会 404；`npx diffs` 装到的是别人的包。用仓库内路径。
