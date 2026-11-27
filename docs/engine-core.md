# Rust 内核（`apps/engine-core`）

## 位置与发布策略

- 源码：`apps/engine-core/`（**.gitignore 掉，不进 GitHub**，留在 owner 的私有仓库/本地）。
- 产物：`apps/website/public/engine/rules-core/diffs-engine.wasm`（以及 `apps/local/public/engine/rules-core/`），随站点发布。
- 构建：`pnpm build:rules` → `node scripts/build-rules-core.mjs`（cargo build + 复制到两个 app）。
- 工具链注意：本机 stable toolchain 的 `rust-lld` 加载不到 `libLLVM.dylib`，脚本用
  `CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_LINKER=/opt/homebrew/opt/lld@22/bin/wasm-ld`。

## ABI（与 TS SDK 的唯一接口）

```ts
memory           : WebAssembly.Memory
diffs_alloc(n)   : number          // 请求缓冲区
diffs_handle(p,n): number          // 返回 [len LE u32][utf8 json]
diffs_box_len(p) : number
diffs_free(p,n)  : void
```

请求一律是 JSON：

| cmd | 输入 | 输出要点 |
|---|---|---|
| `version` | — | `{engine, version, arch}` |
| `ls_diff` | `a,b`（源码文本）、`filename` | 行级 op（equal/ins/del/mod/style/comment）+ 符号表（定义行、体范围、引用行）+ 符号增删改（区分 signature / body）+ import 增删 |
| `sheet_diff` | `a,b`（base64 xlsx） | 工作表配对（按名，其次按位置的改名）、格级增删改、**样式指纹变化**、**条件格式**、合并单元格、定义名称、图表/图片 |
| `opc_diff` | `a,b`（base64 docx/pptx）、`kind` | 段/页级 revisions（part、path、kind、old/new） |

## TS 侧

`packages/engine-bundle/src/rules-core.ts`：`loadRustEngine()` 首次调用时才 fetch，
加载失败返回 `null`，调用方回退到 TS 引擎（不让页面报错）。

用法：

```ts
const engine = await loadRustEngine();
if (engine) {
  const r = engine.call<CodeFromRust>({ cmd: "ls_diff", a, b, filename: "x.ts" });
}
```

## 能力边界（诚实说明）

| 能力 | 现在的状态 |
|---|---|
| 代码符号 / 引用 / 定义行 | ✅ 单文件级；跨文件引用图未做 |
| 类型推断 / 真 LSP | ❌ 需要编译器级前端，未做 |
| xlsx 样式（字体/填充/边框/数字格式/对齐） | ✅ 指纹级比较，报“哪个格子的样式变了” |
| 条件格式 / 合并 / 定义名称 / 图表 | ✅ 规则文本级比较 |
| docx 段落 / pptx 幻灯片文本 | ✅ 按段对齐；批注、脚注部分覆盖 |
| PDF | ❌ 仍走 pdf.js + 本地渲染器（PDF 结构化解析需要另一套内核） |

## 测试

- Rust 单测：`cargo test`（`apps/engine-core` 内 8 例：词法、符号、签名vs体、真实 fixture、边界输入）。
- wasm 端到端：`pnpm test:rules` → `apps/engine-core/tests/wasm.test.mjs`（8 例，加载真实二进制跑真实样例）。
- 双端一致性：`pnpm test:local` → 站点与本地站的内核字节必须一致。

## 按需加载（ego 实测，不是口头承诺）

| 场景 | 结果 | 怎么测 |
|---|---|---|
| 首屏（打开 /#/compare，什么都不点） | **0 个 `/engine/` 请求** | `test-ui` 的 `on-demand-initial` 断言 |
| 连点两次 Excel 样例 | `rules-core.wasm` **1 次** | 同上 `on-demand-after` |
| 代码 → Excel → 代码 | 仍是 1 次（同一个内核，缓存复用） | 实测脚本 |
| 打开 docx | 不追加额外引擎：内核直接读 OOXML | 实测脚本 |
| 第二次打开 docx | 文件数不变（41 → 41），不再下载 | 同上 |
| 再回访 Excel | 文件数不变（1 → 1） | `on-demand-again` 断言 |

为此修掉一处真实违规：样例按钮上的 `+a -d ~u →m` 统计原本在挂载时就拉内核，现在改为
**开始比对后才请求**（`statsWanted`）。同一份文件重复处理的问题不存在：一次「旧/新」槽位只有一份
`ArrayBuffer`，比对结果只保留最后一次，`run()` 会先清空全部结果槽。

### 单份文件上限

| 类型 | 上限 | 超限行为 |
|---|---|---|
| 文本 / Markdown / 代码 / JSON | 40 MB | 拒绝放入并提示「先裁剪或拆分」 |
| Office / PDF（zip、PDF） | 200 MB | 同上，提示这么大文件会卡死标签页 |

`oversizeOf()` 在读取之前判断，`pnpm test:website` 有 3 例覆盖。

## 统一输出契约 `diffs.work/portable@1`

早期文档里说"所有引擎都产出同一个 PortableDiff"，实际各视图各渲各的。现在契约有真正的生产者：

| 命令 | 输入 | 输出 |
|---|---|---|
| `portable_code` | 两段源码 + filename | `schema` / `kind:"code"` / `summary{added,removed,changed,ratio}` / `hunks[]`（语义）/ `revisions[]`（AST，带行列）/ `counts{inserts,deletes,updates,moves}` |
| `portable_opc` | 两份 base64 docx/pptx + kind | 同 schema，`revisions[]` 是段落级改动，pptx 另有 `slides[]` |

`ratio` 是**改动行占比**（0..1），不是编辑距离——字段含义写在这里，避免以后被误读。
TypeScript 侧同名契约见 `packages/engine-bundle/src/portable.ts`。

验证：`pnpm test:rules` 里 3 例（code 带 hunks/revisions、docx 段落修订、相同输入 ratio=0）。
