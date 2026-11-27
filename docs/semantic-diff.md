# 语义 diff（每行都能看出 增 / 删 / 改 / 移）

样例和代码/Markdown 视图现在走 Rust 内核里的 `sem_diff`（`apps/engine-core/src/semdiff.rs`），
算法与 `brv-pageindex/nuxt/app/utils/diff/lib/reference.ts`（reference 的干净改写）逐条对齐，**自己用 Rust 重写并编译成 wasm**：

| 状态 | 判定 | 视图 |
|---|---|---|
| 增 | LCS 里只有 new 侧 | 绿底 `+` |
| 删 | LCS 里只有 old 侧 | 红底、删除线 `-` |
| 改 | replace 且两侧逐行配对 | 一行里上下两半（旧/新），**行内词级高亮**只标真正变化的字符 |
| 移 | 内容级出现 ≥2 行相同、位置改变 | 紫标 `→`，并在底部列出「从第 X 行 → 第 Y 行」 |

接口：`{"cmd":"sem_diff","a":…,"b":…,"filename":"x.ts","context":3}` → `{hunks[], moveBlocks[], added, removed, inserts, deletes, updates, moves}`。

视图在 `apps/website/src/components/compare/semantic-view.tsx`，结果区右上可切「语义视图 / 行级 unified」。
每个样例按钮上直接显示该样例的 `+a -d ~u →m`，点之前就知道它会展示哪几种状态。

测试：
```bash
cargo test            # apps/engine-core：16 例（含 semdiff 5 例）
pnpm test:rules       # wasm 端到端：18 例（含 semdiff 5 例）
pnpm test:ui          # 真浏览器：主题 ×3 + 语义视图 + 四种格式视图
```

## AST 视图（列级命中）

第二个模式「AST 结构」来自 `apps/engine-core/src/astdiff.rs`：每个节点保留**行 + 列**范围，
所以改一个数字只亮那几个字符：

```
ast_diff("amount: 8000", "amount: 8500")  →  update  range 0:8–0:12
```

三类匹配，按可信度递进：同路径同文本 → 同位置；文本唯一且位置变了 → **移**（带 from/to）；
同路径不同文本 → **改**（只报最深那层，不重复涂父节点）。标点与单字符不参与匹配，
避免把 `,` `{` 当成"移动"。

`diff_compare` 工具返回 `semantic`（改/移）与 `ast`（列级）两段；DSH 卡片据此显示 `+a -d ~u >m`。

测试：`cargo test` 21 例（含 astdiff 3）、`pnpm test:rules` 23 例（含 astdiff 5）。

## 类型与跳转（能确定判定的那部分 LSP）

`symbols` / `goto` 两个命令回答代码审查里真正会问的问题，且**只在源码有证据时才回答**：

| 问题 | 命令 | 返回 |
|---|---|---|
| 这个符号是什么类型？ | `symbols` | `annotation`（写明的注解）/ `literal`（字面量）/ `constructor`（`new X()`）/ `declared`（interface、class、type 自身）/ `null`（源码没说） |
| 它在哪儿定义？ | `symbols` / `goto` | 文件 + 行 + **列** |
| 光标下这个标识符是什么？ | `goto` | `hover`（签名 + 类型）、定义位置、其余引用位置 |

实测（`examples/graph`）：

```
add        function   add(a: number, b: number): number      src/money.ts:6:17
totalOf    function   totalOf(items: Money[]): Money        src/total.ts:3:17
Money      interface  Money                                 src/money.ts:1:18
goto(use.ts:4:46) → word "add" · hover "add(a: number, b: number): number" · def src/money.ts:6:17
```

**明确不做**：类型检查、泛型实例化、重载解析、控制流收窄、跨包解析。源码没写类型时返回 `null`，
不猜——在代码审查工具里，一个错误的类型比"未知"更糟。

`diff_compare` 工具在代码族里会额外返回 `types` 段，卡片据此在每行旁标出类型与定义位置。
