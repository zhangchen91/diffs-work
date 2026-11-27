# Contributing

## 5 分钟跑起来

```bash
pnpm install
pnpm build:rules      # 编译 Rust 内核（需要 rustup + wasm32-unknown-unknown）
pnpm sync:engine      # 或 pnpm fetch:engine：准备 docxodus / pdf.js 等第三方引擎
pnpm dev:website      # http://127.0.0.1:5180
```

只想改界面的话，`pnpm dev:website` 就够了：没有引擎二进制时，代码/Markdown/Excel 仍走内置 TS 实现，
只缺 docx 的修订渲染。

## 目录

| 路径 | 是什么 |
|---|---|
| `apps/website` | 官网 + 浏览器内对比器 |
| `apps/local` | 本地站（`diffs local`，含 Inbox） |
| `apps/docs` | 文档站（Astro，中文 `/`、英文 `/en/`） |
| `apps/cli` | `diffs` 命令行 |
| `apps/dsh-plugin` | DeepSeek Harness 插件（工具 + 卡片 + 待处理列表） |
| `apps/engine-core` | Rust 内核（**不进公开仓库**，见下） |
| `packages/*` | 引擎与 SDK：`diff-core` `core-text` `core-code` `core-markdown` `core-xlsx` `core-xml` `core-pdf` `engine-bundle` `mf2` `i18n` |
| `examples/` | 真实样例（合同、checklist、代码、PDF），测试与演示共用 |

## 硬规则

1. **首屏不许下载引擎**：`apps/website/public/engine/` 里的文件体积大，只在真正比对某族文件时才拉。
   `pnpm test:ui` 会断言首屏 `/engine/` 请求为 0、且每个引擎在回访时文件数不增长。
2. **文件不出浏览器**：任何新增能力都不得上传文件内容；本地站也只监听 `127.0.0.1`。
3. **每个引擎/视图都要有用例**：新格式要带 `examples/` 样例 + 测试（见各 `packages/*/test`）。
4. **文案走 i18n**：界面字符串写在 `packages/i18n/src/messages/{zh-CN,en}.ts`，用 MF2 语法；
   `pnpm test:website` 会在缺键、空串、英文残留中文时报错。
5. **主题用 token**：颜色只写 `bg-panel` / `text-slate-400` / `border-line` 这类语义类，
   不要写 `text-white`（三套主题会各错一半）。

## Rust 内核

`apps/engine-core/` 的源码不公开发布，仓库里只有编译产物。贡献内核需要单独授权（见 `docs/open-source-boundary.md`）。
其他部分（视图层、引擎调度、i18n、插件）全部开放。

## 测试

```bash
pnpm test       # 109 例：diff / core / xlsx / mf2 / website / pdf / rules / local / dsh
pnpm test:ui    # 真浏览器：6 个 tab 各点两遍、样例乱序切换、语义/AST/主题/PDF/Word、按需加载
pnpm build      # 三个站点 + 插件
```
