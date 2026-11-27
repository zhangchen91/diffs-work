# diffs.work

**Diff everything in your browser.** 文件不上传：对比在你的标签页里、或你自己机器上完成。

> 每项能力实测到什么程度，见 [docs/STATUS.md](docs/STATUS.md)。那里写着哪些能用、哪些没做，
> 以及为什么。对外描述以此为准。

一次对比，三种看法：

| 文件族 | 视图 | 引擎 |
|---|---|---|
| 代码 / Markdown | 语义视图（增 / 删 / **改** / 移）+ **AST 列级**视图 + 符号类型与定义位置 | rules-core.wasm |
| Excel | 格级网格 + 变更清单（点一条跳到格子） | rules-core.wasm |
| Word | 段落按序对齐 + 改动字标记 + 移动标注 | rules-core.wasm |
| PowerPoint | 逐页清单 + 段落明细 | rules-core.wasm |
| PDF | 页面渲染 + 字符坐标高亮框 + 变更清单 | pdf.js |
| 任意族 | 三套主题（曜石 / 纸张 / 森林）、中英双语 | — |

官网 https://diffs-work.pages.dev ｜文档 https://diffs-docs.pages.dev

## 仓库内容

```
apps/website          官网 + 浏览器内对比器
apps/docs             文档站（Astro，中文 /、英文 /en/）
apps/local            本地站 + Inbox（只监听 127.0.0.1）
apps/cli              diffs 命令
apps/dsh-plugin       DeepSeek Harness 插件：diff_compare 工具 + 对话内差异卡片 + 待处理列表
apps/chrome-extension 浏览器扩展 MV3：右键两个链接或两段选中文字 → 对比
apps/engine-core      Rust 内核源码（仅本机开发，不随开源仓库分发）
packages/mf2          Unicode MessageFormat 2 子集运行时
packages/i18n         zh-CN / en 文案与切换器
packages/diff-core   行级 LCS、hunk 构造、词级 diff 的底层算法
packages/core-*       text / code / markdown / xlsx / xml / pdf 各自的解析与比对
packages/dom-utils  扩展名 → 文件族的共享判断、下载与剪贴板
packages/shared     跨端共用的小工具
packages/diff-tool    diff.compare 契约（Node）：所有集成面的唯一入口
packages/engine-bundle 引擎登记表 + 懒加载 SDK + PortableDiff 契约
examples/             真实样例（合同 / checklist / 代码 / PDF）
docs/                 架构、引擎、主题、语义 diff、接入指南
```

## 快速开始

```bash
pnpm install
pnpm dev:website     # http://127.0.0.1:5180
pnpm local           # 本地站 + Inbox → http://127.0.0.1:5279
```

`pnpm build` 产出三个站点与插件。引擎（rules-core.wasm、pdf.js）随仓库提供；`pnpm build:rules`
与 `pnpm sync:engine` 只在改内核或更新引擎时才会用到。

## 给别人接入

- **第三方 Agent / 工具**：看 [docs/integrations.md](docs/integrations.md)，一个 HTTP 接口 + 一个 JSON 契约。
- **DeepSeek Harness**：看 [apps/dsh-plugin/README.md](apps/dsh-plugin/README.md)，装完就有 `diff_compare`。
- **本地站 API**：`/api/health` `/api/diff` `/api/open` `/api/inbox`，见 docs。

## 提交

这个仓库只保留一条 `main`。改动请开 Issue 说明场景，再用 MR 提；CI 会在 MR 上跑单元测试与浏览器验收。