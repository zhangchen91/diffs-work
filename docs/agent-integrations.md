# 接入到不同平台的 Agent

一个工具（`diff_compare`）、一份契约（`portable@1`）、一个实现。这份文档记录**实测过**的三种接法。

## 它们共享什么

```
packages/diff-tool/src/index.ts        compareFiles() —— 四端唯一入口
packages/diff-tool/src/tool-schema.ts  工具名 + 描述 + 输入 schema
apps/cli/src/mcp.ts                     MCP server（stdio, JSON-RPC 2.0）
apps/dsh-plugin/src/index.ts            DSH 插件（工具 + 卡片 + 侧栏）
```

`tool-schema.ts` 是**唯一**的描述来源。2024 年 11 月之前它有三份副本，其中两份对「支持哪些格式」
的说法互相矛盾：MCP 说支持 Word/Excel/PPT/PDF，DSH 插件说这些「不内联比对」。实测下来两边都
不准——内核会对 .docx 返回结构化的修订（`2 insertion(s) / 2 deletion(s) across 1 part(s)`）。

## 1. MCP（任何 MCP 客户端）

```bash
node apps/cli/lib/bin.js mcp        # stdio
```

**实测**（`node scripts/verify-mcp.mjs`，在 `pnpm test` 里）：

```
initialize  → diffs.work 0.2.0, protocol 2024-11-05
tools/list  → ["diff_compare"]
tools/call  → 14125 字节，schema: diffs.work/portable@1
```

> CLI 还没发布到 npm。npm 上的 `diffs` 是另一个人的包，`npx diffs mcp` 会失败。

## 2. Claude Code

```bash
claude mcp add diffs --scope user -- node "$PWD/apps/cli/lib/bin.js" mcp
claude mcp list                     # diffs: ... ✔ Connected
```

Claude 里工具名带前缀：`mcp__diffs__diff_compare`。首次调用要授权：

```bash
claude -p --allowedTools "mcp__diffs__diff_compare" "比较 a.rs 和 b.rs"
```

**实测**：对 `rust.before.rs` / `rust.after.rs` 问「changed 了几个 symbol」，Claude 答
`changed: 1`、`added/removed 都是 0`，与引擎输出逐项一致。

Claude Desktop 用同一段 JSON（见 `.mcp.json.example`）。

## 3. DeepSeek Harness

见 [docs 站的插件页](https://diffs-docs.pages.dev/integrate/deepseek-harness/)。要点：

- 必须 `--profile <name>`，且用**绝对路径**（相对路径会被当成包名解析）
- `package.json` 必须有 `dsh.bundle.patch`，否则装进去只是个普通依赖、不会加载

## 4. 再加一个平台，要做什么

**只需要把这份 schema 翻译成该平台的格式**：

| 平台 | 字段名 | 备注 |
|---|---|---|
| MCP | `inputSchema` | 直接用 |
| DSH | `parameters` | 一次 `as` 转换 |
| Anthropic API | `input_schema` | 同样直接 |
| OpenAI function calling | `parameters` | 同上 |

不变的是 `compareFiles()` 和 `portable@1`。**格式特有的只有名字和渲染卡片**。

### 这份设计好在哪里、差在哪里

- **好**：工具契约一份、比对实现一份、输出契约一份。加平台不用碰比对逻辑。
- **差**：每个平台的「展示层」（DSH 的卡片、Claude 的纯文本）仍要各写。现在有两个，第三个之前
  值得先把它们抽到一个 `formatForSurface(result, surface)`。
