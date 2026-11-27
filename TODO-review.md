# diffs.work · 待办 & 决策清单（明早 review 用）

> 生成于本轮自驱工作（2026-11-24 凌晨）。按「已修 / 待你决策 / 未做」分组，
> 每条附验收方式，方便逐条核对。

## A. 你提的 4 个官网问题 —— 处理结果

| # | 问题 | 状态 | 证据 |
|---|---|---|---|
| 1 | 文案里有用户看不懂的东西 | ✅ 已改 | 引擎名从 `text-core.wasm` 之类改成 `md-ast（结构解析）`/`xlsx-core（zip + 流式 XML）`/`code-ast（词法 + 符号）`；「差异结果」区不再出现“该族需要 xx.wasm”这类内部话术 |
| 2 | 例子不惊艳（不是行内级） | ✅ 已改 | Markdown 改成块级 + 行内：`1.1 投资方拟以人民币 8,00**0**→8,50**0** 万元`，只高亮变掉的数字；列表项/表格行/路线图勾选逐项对齐（见 `packages/core-markdown`） |
| 3 | 没看到多格式例子 | ✅ 已加 | 5 个样例：Excel（两份真表）、Markdown（协议 redline）、Markdown（README 中英混排）、代码（PR 改动）、+ 旧版 docx 修订视图 |
| 4 | Excel 压根不能比 / 选 1 个文件中文乱码 | ✅ 已修 | 见 B 节 |

## B. 两个 bug 的根因与修复

**B1 · Excel 不能比**
- 根因：`xlsx` 之前被归到 “需要引擎” 的族，代码里直接弹了一段占位提示，没有实现。
- 修复：新写 `@diffs/core-xlsx`（fflate 解压 + 流式读 sheet XML + 共享字符串 + number format 日期 + 公式 + 合并单元格），
  单元格级对齐；sheet 先按名配对、再按位置配成**改名**（B3/B4 表名一变，不会把 1500 格全标成新增/删除）。
- 验收：`pnpm test:xlsx`（10 例），其中一例就是你那对 checklist：结果 `4 个工作表 · +60 格`，新增集中在 B4 的 F/G 列。

**B2 · 选 1 个文件中文乱码**
- 根因：`File.text()` 恒按 UTF-8 解码，GBK/GB18030 的中文全变 ``；而且二进制文件（xlsx/docx）被当文本读了。
- 修复：`decodeText()` 按 BOM → 严格 UTF-8 → GB18030 回退；二进制族直接不解码；解不出来时明确提示编码不可识别。
- 验收：`pnpm test:website`（8 例，含 GBK 字节、BOM、UTF-16、`looksGarbled`）。

## C. 每个文件族都有测试用例

| 文件族 | 用例 | 数量 | 命令 |
|---|---|---|---|
| 文本 / diff 基础 | hunk、CRLF、inline 词级、unified 头 | 7 | `pnpm test:diff` |
| Excel（xlsx） | 真实 checklist 对拍、改名配对、格级增删改、公式、多表 | 10 | `pnpm test:xlsx` |
| Markdown | 块解析、行内高亮、表格行、移动块、仅格式变化 | 7 | `pnpm test:core` |
| 代码 | 词法/字符串/注释、符号增删改、多语言声明 | 8 | `pnpm test:core` |
| XML（OOXML/配置） | 路径级、属性、CDATA、残缺 XML、真实 sheet1.xml | 8 | `pnpm test:core` |
| 合计（core 三组） | | 23 | `pnpm test:core` |
| 编码 | UTF-8 / GBK / UTF-16 / 二进制识别 | 8 | `pnpm test:website` |
| DSH 插件 | 工具注册、结构化 diff、符号、二进制提示、命令 | 7 | `pnpm test` |

总计 **48 例**（7 + 10 + 23 + 8 + 7 中的 diff/核心/编码/插件；`pnpm test` 全绿）。测试用例文件本身就是要 review 的产物，路径见上表对应 `packages/*/test/`、`apps/*/test/`。

## D. 需要你决策（我按默认做了，可随时改）

1. **Rust 引擎源码放哪** —— 你说“不放在 diffs.work 里”。我还没建 `apps/engine-core`，等你的外部仓库地址 / 目录名。
   当前 TS 引擎（`packages/core-*`）是**开源参考实现**，Rust 版应当与它逐例对拍（同一批 fixtures）。
2. **React / Vite+ 迁移** —— React 已是 `19.3.1`（latest）。**Vite+ 我没有强制迁移**：
   `vp migrate` 要求先升到 Vite 7+/Vitest 4+ 且会重写 workspace 与 lockfile，风险大且今晚无法完整回归。
   建议单独一轮做，我可以先把 `vite.config.ts` 合并成 `defineConfig({ build, test, lint })` 的 Vite+ 形式再跑 `vp migrate`。
3. **示例文件里的客户信息** —— 你那对 checklist 里有客户项目名和投资方名单。目前样例用它（本地视图 + 官网样例），
   线上是公开站点。**要不要把样例换成脱敏版**（改公司名/金额，保留结构）？
4. **`.xls` / `.doc` / `.ppt` 老格式** —— 需要 x2t 转换器（~9MB），当前没接。要么接，要么明确提示“另存为 xx”。
5. **`skill` 来源** —— 你说的 “装对应最佳 skills”。当前环境可用的是 `ponytail`（已启用）；没找到 React/Vite+/Rust 专用 skill 的目录。
   如果你有指定的 skill 源（比如某个 repo/URL），告诉我，我接进来。
6. **Plannotator 的借鉴深度** —— 目前只借鉴了「输入侧规范化」的思路并写进 docs，代码层面没有复用（它是 bun + 自己的 UI 包）。
   若要真正打通（批注回传 → agent 读回），这是下一轮的大工程。

## E. 还没做 / 已知限制

- **Word / PPT / PDF 的结构化引擎**：目前 docx 走本地视图里的 docxodus 修订视图（真实渲染），
  PPT/PDF 在本页会提示“交给本地视图”。没有把它们做成 `PortableDiff` 同构的结构输出。
- **Excel 仅比对值**：样式、条件格式、图表变化不会报（表格里已注明“格式不参与比对”）。
- **代码 LSP**：符号级摘要有了（声明解析），但没有真正的 LSP（类型、跳转、引用图）。这是 Rust 引擎的活。
- **文件名映射**：`packages/diff-tool/src/index.ts:21` 等路径引用请以代码为准。
- **官网首页文案**：仍有 “7 类文件 / 6 个按需引擎” 这类数字，若要严格“不出现用户看不懂的东西”，可以再收一轮。

## E15. 第 12 轮（配 GitHub 仓库 + CI 真跑）

- 初始化 git、加 remote、推 `main` 到 zhangchen91/diffs-work。
- 第一次推送后**CI 真的是红的**，逐个修了 5 个只有干净环境才暴露的问题（详见 docs/open-source-ready.md）。
  现在 CI 两个 job 全绿（unit 41s / browser 1m52s）。
- Deploy workflow 构建全绿，只差 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 两个 secret。
- 按你的要求收掉了 5299 端口的临时 dsh 实例，后续测试只用单个 ego tab。

## E14. 第 11 轮（在全新 DSH 实例里装了一遍）

- 用 `dsh --from-default-profile web --profile diffs-clean` 建了个干净 profile，模拟外部用户首次安装。
  **发现真问题**：`dsh plugin add` 之后插件只是普通依赖，`--dump-config` 里没有它——外部用户装完什么都不发生。
  已在插件 README 里把"必须再加一行 patch"写清楚，并在干净 profile 里验证这一行能让插件真正加载。
- 实机截图（存 `docs/design-refs/`）：
  - `dsh-plugin-dock.png`：会话里输入框下方出现「本地视图在线 · 对比记录」，侧边栏底部出现「对比 0」
  - `dsh-plugin-pending.png`：点开「对比记录」，待处理面板正常显示
- 之前两轮"截不到图"的原因找到了：我打不开的是 Desktop 那个实例（HMAC cookie），
  但自己起的 `dsh web` 会打印带 token 的 URL——这条路一直可行，我上一轮没试。

## E13. 第 10 轮（契约对齐 + 找了一次 DSH 真实入口）

- 修掉"名不副实"：到处宣称统一的 PortableDiff 契约，但视图各渲各的。现在内核真产出该契约
  （`portable_code` / `portable_opc`，`schema: diffs.work/portable@1`），并有 3 例测试。
- 符号栏徽章文案修正（原来显示的是符号数，容易被读成"重复"）：改为「符号图 · 改 N 个文件里的符号 · import 边 M」。
- 为了截到 DSH 卡片，找到了 Desktop 的访问凭证（`~/.dsh/remote-web-ui-registry/desktop.json`），
  但 `dsh web` 用的是 HMAC 签名的 `dsh-auth-<hash>` cookie，不是 query token，无法据此进入。
  不再尝试绕过；卡片外观仍需你在已登录窗口确认。

## E12. 第 9 轮（类型/跳转进界面）

- 符号栏现在**在所有文本视图旁边**（语义/AST/unified 都显示），每行给出类型与定义位置：
  `splitClauses  function  : Clause[]`、`diffClauses  function  : number`、`Clause  interface  : interface`。
- 修两处：①符号栏原来只在行视图里出现（切到语义视图就没了）→ 移到结果区外层；
  ②同一符号出现两次（pair 含新旧两版）→ 按名字去重。
- 点击类型行会把 `文件:行:列` 显示在栏头，作为"跳转"的最小可用形态。
- `test-ui` 新增 `types-rail` 断言（面板在、有类型列、无重复符号），线上 exit=0。
- `pnpm test` 118 例全绿。

## E11. 第 8 轮（类型/跳转 + CI）

- 新内核命令 `symbols` / `goto`（`apps/engine-core/src/types.rs`）：类型只认源码证据
  （注解 / 字面量 / `new X()` / interface 自身），没有证据返回 `null` 不猜；跳转给出文件+行+列。
  实测：`goto(total.ts:4:46)` → `add(a: number, b: number): number` @ `src/money.ts:6:17`。
- `diff_compare` 增加 `types` 段，卡片可显示类型与定义位置。
- 测试：types 5 例（wasm）+ 4 例（Rust），`pnpm test` 118 例全绿。
- 新增 `.github/workflows/ci.yml`：unit（含"没有私有 crate 时自动跳过内核"）+ browser（xvfb 跑 ego）。
- 仍是明确的边界：不做类型检查/泛型/重载/跨包解析（见 docs/semantic-diff.md）。

## E10. 第 7 轮（用卡片自测，抓到两个引擎缺陷）

- 又在会话里跑了一次 `diff_compare`（改 `ast-view.tsx` 的 `context = 2 → 3`），卡片当场暴露两个问题：
  1. **AST 把值改动报成「移」**：`const context = 2` → `3` 被当成移动（同一位置、文本变了）。已修：
     移动只能配到**不同位置**的节点，同位置改文本一律归「改」。
  2. **行级 hunk 带了一段无关的前文**：只有一行改动，hunk 却以 5 行 ctx 开头，把改动埋在后面。
     已修：末尾/行首的上下文按 `context` 精确裁剪，改动现在是第一行。
- 回归测试：astdiff 8 例（+3）、semdiff 6 例（+1），`pnpm test` 113 例全绿。
- 线上重新部署并跑 `test-ui`：exit=0。

## E9. 第 6 轮（开源就绪 + 实机验证插件）

- 在本会话里真实调用了一次 `diff_compare`（把 `xlsx-view.tsx` 的 `short()` 改名 `shorten()`）：
  工具返回 3 个 hunk + `semantic 6 updates` + `ast` 六处**列级**范围
  （如 `290:82–290:87 "short"` → `290:82–290:89 "shorten"`），并且这段输出就在对话里。
- 开源前检查全部通过，清单见 `docs/open-source-ready.md`：Rust 源码 / 50MB 引擎二进制 / 生成物
  都已被 `.gitignore` 排除（用临时 git 仓库实测）；新增 `CONTRIBUTING.md`、`SECURITY.md`、`LICENSE`、
  `engine.lock.json` + `pnpm fetch:engine`。
- 修掉一个真实健壮性缺陷：缺少 wasm 时 Vite 预览返回 SPA 的 HTML（状态 200），前端会误以为内核已就绪。
  现在校验 `content-type` 与 wasm 魔数，缺引擎时自动降级到 `code-ast` 行视图。
- 验证：`pnpm test` 109 例全绿；`pnpm test:ui` 本地与线上均通过；无引擎产物实测降级正常。

## E8. 第 5 轮（第 6 条：按需加载实测）

- 发现并修掉违规：样例按钮的 `+a -d ~u →m` 统计在挂载时就会拉 339KB 内核 → 改为开始比对后才加载。
  首屏 `/engine/` 请求从 1 变成 **0**。
- 实测：Excel 连点两次内核只拉 1 次；代码/Excel 来回切仍 1 次；docx 首次追加 docxodus 41 个文件，
  第二次打开文件数不变；再回访 Excel 也不涨。
- `test-ui` 新增 3 条断言（initial 为 0、after 与 again 的每引擎文件数一致）。
- 结论：同一族的引擎不会重复下载；没有"重复上传/重复处理同一份文件"的问题（每个槽位只保留一份
  ArrayBuffer，新一次 run 先清空旧结果）。剩余可做：超大文件的内存上限（现在没有显式限制，
  100MB 的 xlsx 会整份读进内存）。

## E7. 第 4 轮（实机验收）

- 在会话里真实跑了一次 `diff_compare`（改 `xlsx-view.tsx` 的 `OP_CLASS→OP_STYLES`），工具返回：
  `3 处差异` + `semantic 3 updates` + `ast [{"update",8,0,1},{"update",236,38,47,"OP_STYLES"},{"update",287,70,79,"OP_STYLES"}]`
  —— 这就是你要的列级效果（第 236 行第 38–47 列）。
- 线上 https://diffs-work.pages.dev 打开「代码 · PR-style edit」→「AST」：`改 2 | 移 6 | 增 29 | 删 0`，
  40 个列级高亮，截图 `/tmp/prod-ast.png`。
- 修掉一个线上问题：上一轮部署的产物里没有 AST 分支，重新构建部署后打通。
- `test-ui` 新增 ast-mode 断言，并将 AST 步骤放在独立 task space 的首个页面（脚本本身在第二个页面里
  该面板会消失且无报错，已在 harness 里注释说明）。
- 仍缺：按需加载实测（第 6 条）；卡片在 Desktop 会话里的外观仍需你那边看一眼（我这边端口要 token）。

## E6. 第 3 轮（针对"看不到 LSP 效果 / 插件没验证"）

| 项 | 结果 | 证据 |
|---|---|---|
| AST 级 diff（列级命中） | ✅ `apps/engine-core/src/astdiff.rs`：节点带 行+列 范围，`amount: 8000→8500` 报 `0:8–0:12`；`OP_CLASS→OP_STYLES` 报 `235:38–235:47` | `cargo test` 3 例、`pnpm test:rules` 5 例 |
| 站点能看 | ✅ 代码/Markdown 结果区加「AST 结构」模式（双侧 + 列级高亮 + 移动列表） | `pnpm test:ui` 断言 `[data-testid=ast-diff]` 与命中数 |
| `diff_compare` 卡片能看 | ✅ 工具结果新增 `semantic`（改/移）与 `ast`（列级）两段，卡片显示 `+a -d ~u >m` | dsh 插件 13 例（含 semantic/AST 载荷 2 例） |
| 插件真的激活并验证 | ✅ 根因：bundle 包必须提供 Config schema，否则 loader 静默跳过；改成 client-only 包 + profile 显式 row + 包内 Config 后 `status: schema`，`diff_compare` 出现在工具列表 | `cordis_inspect_query` listConfigs / listTools |
| 仍缺 | ⚠️ 页面里卡片的外观仍需在 Desktop 已登录窗口确认（本会话端口要 token）；第 6 条按需加载实测未做 | — |

## E5. 第 2 轮

| 项 | 结果 | 证据 |
|---|---|---|
| 第 7 条 · 三套主题 | 曜石 / 纸张 / 森林，token 化，顶栏切换，首帧前应用 | `pnpm test:ui` 断言三套主题都挂到 `<html>` 且纸张主题背景确实变了 |
| 第 8 条 · 样例能看出增删改移 | Rust `sem_diff`（reference 语义，自己重写）+ 语义视图：改动行上下配对、行内词高亮、移动带 `→` 位置；样例按钮直接显示 `+a -d ~u →m` | `cargo test` 16 例、`pnpm test:rules` 18 例（semdiff 5 例） |
| 第 8 条 · LSP 可从 reference 搬 | 语义 diff 已搬（`semdiff.rs`）。**AST 级别**（tree-sitter 节点范围）还没搬：需要把 tree-sitter 的 C 解析器交叉编译进 wasm，属于下一步，不是本轮完成项 | — |
| 第 6 条 · 按需加载实测 | 未做 | — |

## E4. DSH 插件（上一轮）

- 借鉴来源：clone `dsh-diff-approval` / `dsh-edit-diff`，装进 DSH Desktop 实测并截图，样例存在 `docs/design-refs/`
  （审批面板 = 列表 + 整文件 diff + 逐个保留/回退；行内评论卡；卡片默认收起 + 行内字符高亮）。
- 之后两个参考插件已 `remove_bundle` 卸载，profile 里只剩我们自己的 `@diffs/dsh-plugin`。
- 我们的插件（同一 monorepo：`apps/dsh-plugin`）：
  - 主机半身：`diff_compare` 工具 + `/diff-*` 命令（已有），本轮补 `inject = ['tools','commands']`。
  - 浏览器半身 `lib/client.js`：`tool.call.toolview` key=`diff_compare` 的差异卡片（文件对、+/−、逐行增删改）、
    侧边栏「对比」按钮 + `shell.overlay` 待处理列表、输入框下方 `conversation.composer.dock` 状态条。
  - 元数据：`locale/zh.json` + `locale/en.json`、`icon.svg`、`./client` 导出、`dsh.client` 声明。
- 验证：`plugin_manager install_bundle` → `application: applied`；`pnpm test` 中 dsh 插件 11 例（含浏览器半身 4 例）。
- 未验证：客户端半身在页面里的实际渲染——本会话连的是需要 token 的 `dsh web` 端口（页面只显示
  “dsh web authentication required”），无法用 ego 打开已登录的 Desktop 窗口截图。需要在 Desktop 里新开会话确认。

## E3. 本轮修复（用户报的三个 bug + 两个「大工程」）

| 问题 | 根因 | 修复 | 验证 |
|---|---|---|---|
| 切 tab 时 UI 节点反复出现 | 每次 `run()` 只清部分结果槽，异步引擎回来自作主张写状态 | 引入代次号 `gen`，一次 run 一个结果槽；进页面前先全清 | `pnpm test:ui`：每个 tab 点两次，`#root` 恒为 1 |
| 切样例同类问题 | 同上 + `meta` 被 `run()` 闭包读到旧值 | family 改存 ref；结果徽章按当前 run 判定 | 乱序切样例 5 次，pane 恒 ≤ 3、无残留 `docxodus redline` 徽章 |
| Excel 不如 PageIndex | 只有表格，没有格级网格与清单定位 | 重写 `xlsx-view`：稀疏格网 + 变更清单 + 跳转/闪烁 + 搜索 + `j/k` | 截图 + `pnpm test:ui` 断言 `data-ref` 网格与 `.ring-2` 定位 |
| Word 只有文本 diff | docxodus 的 wasm 框架没被同步进站点 | `sync-engine` 补 `docxodus/wasm`，实现 `compareDocuments` + 修订渲染 + DOM 锚点清单 | 站点 Word 样例：13 条清单、可下载 redline |
| PDF 没做 | — | `@diffs/core-pdf`：文本层 + 字符坐标对象级比对，页面画高亮框；CJK 子集字体夹具 | `pnpm test:pdf` 4 例 + 线上 9 个高亮框 |
| LSP 只到单文件 | — | Rust 新增 `ls_graph`：跨文件符号表、引用计数、import 边、注解类型、定义索引；UI 侧符号图面板 | `pnpm test:rules` 13 例（含图 5 例） |

仍未做（明说）：类型推断/类型检查（Rust 侧只有注解级 hint）、PDF 扫描件 OCR、Excel 图表内容级对比。

## E2. Rust 内核接入（上轮完成）

| 要做的 | 结果 | 证据 |
|---|---|---|
| Word/PPT 结构化输出（不再只提示“交给本地视图”） | ✅ `opc_diff`：按段落/幻灯片对齐，给出 part + old/new；与渲染器并存 | 站点「Word · 增资协议 B3 → B4」样例显示 `rules-core.wasm · 6 insertion(s) / 6 deletion(s)` |
| Excel 不只比值 | ✅ `sheet_diff`：样式指纹（字体/填充/边框/数字格式/对齐）、条件格式、合并单元格、定义名称、图表/图 | 测试 fixture `checklist-B4-styled.xlsx` → `1 style changes` + `cfAdded` |
| 代码 LSP 级 | ✅ `ls_diff`：词法（注释/字符串/数字）、符号表（定义行/体范围/引用行）、signature vs body、import 增删 | 站代码样例 `rules-core.wasm · 1+ / 2~ sym · Rust 3.4 ms` |
| 源码位置 + 不进 GitHub | ✅ `apps/engine-core/`，`.gitignore` 已包含；只发布 wasm | `grep apps/engine-core .gitignore` |
| 编译到 .work 并打通 | ✅ `pnpm build:rules` → `public/engine/rules-core/diffs-engine.wasm`（249 KB） | 线上 https://diffs-work.pages.dev/engine/rules-core/diffs-engine.wasm 200 |
| 测试用例 | ✅ Rust 单测 8 + wasm 端到端 8 + 双端字节一致性 2 | `pnpm test` 81 例全绿 |

没能做到（诚实）：Rust 侧没有类型推断/跨文件引用图（真 LSP 需要编译器前端）；PDF 仍走 pdf.js + 本地渲染。

## F. 全球化（i18n，MF2）

- 运行时：`packages/mf2`（Unicode MessageFormat 2 子集）—— `.input` / `.match` / `:number` `:integer` `:percent` `:currency` `:date` `:time` `:datetime`、精确键、`.local`、bidi 隔离、错误回退；16 例测试。
- 语言层：`packages/i18n` —— zh-CN（默认）+ en，各自 lazy chunk；`LOCALES` 注册即可加语言；`localStorage` 记忆 + 浏览器协商。
- 覆盖：官网全部页面/组件、本地站（含 Inbox）、文档站（`/` 中文、`/en/` English，互跳）。
- 测试：`pnpm test:mf2`（16）+ `pnpm test:website`（15，含键一致 / 无中文残留 / 全部消息可格式化）。
- 文档：`docs/i18n.md`（规范、已实现子集、社区语言接入三步）。
- 已知取舍：英文文案是人工翻译，未做母语审校；数字/日期走 `Intl`，占位符隔离（bidi）默认关闭。

## F2. 今晚跑过的验证（可复现）

```bash
pnpm build     # website / docs / local / plugin 全部构建通过
pnpm test      # 71 例全绿（diff 7 + xlsx 10 + core 23 + mf2 16 + website 15 + dsh 7）
pnpm local     # 构建并启动 127.0.0.1:5279
```

线上：
- 官网 https://diffs-work.pages.dev （`#/compare` 四个样例手点通过）
- 文档 https://diffs-docs.pages.dev
- 本地站 http://127.0.0.1:5279 （Inbox 列表 + `/api/diff` + `/api/pair` 手测通过）