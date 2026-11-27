# 开源 / 闭源边界

## 原则

> 别人能**接**，不容易**抄**。

## 开源（本仓库，MIT，待 owner 最终确认）

| 目录 | 内容 |
|---|---|
| `website/` | 官网、对比器 UI、路由、样式（独立部署） |
| `apps/diff-core` | 差异模型、hunk 构建、unified 输出（Rust 版对拍基线） |
| `apps/core-text` | 文本族驱动 |
| `apps/core-code` | 代码族驱动（语言识别、符号摘要） |
| `apps/engine-bundle` | `ENGINE_REGISTRY`、懒加载 SDK、PortableDiff 类型 |
| `apps/dom-utils` | 文件族识别、下载、剪贴板 |
| `apps/extension`（规划） | 浏览器扩展 MV3 |
| `apps/dsh-plugin`（规划） | DeepSeek Harness 插件 |
| `scripts/`, `docs/` | 构建/发布脚本与文档 |

## 闭源（只发编译产物）

| 产物 | 说明 |
|---|---|
| `apps/engine-core/`（Rust crate → wasm32，**已 .gitignore，只在本地/私有仓库**） | 行/词/块级 diff、子序列对齐、结构比对内核 |
| `wasm/lsp-core.wasm` | 文件浏览器 / 目录对比 / LSP 语义（符号表、引用图、跳转） |
| `wasm/cell-diff.wasm` | 表格格级比对内核 |
| `wasm/pdf-overlay.wasm` | PDF 差异框计算 |

发布方式：只上传 `*.wasm`（当前 `public/engine/rules-core/diffs-engine.wasm`），不提供源码仓库。
源码目录照样留在本机便于继续开发，`.gitignore` 保证开源推送时不被带出去。

## 第三方（不属于我们）

| 组件 | 许可证 | 使用方式 |
|---|---|---|
| Docxodus / DocumentFormat.OpenXml（.NET→wasm） | 见上游 | 直接分发上游构建产物 |
| pdf.js | Apache-2.0 | 直接分发 |
| tesseract.js + tessdata | Apache-2.0 | 直接分发 |
| ExcelJS | MIT | 直接分发 |
| office-x2t（ONLYOFFICE x2t wasm） | **AGPL-3.0** | **当前未分发**：幻灯片由内核直接读 OOXML，这个转换器没有进入构建产物。留在此表是为了将来接入时不必重新评估 |

> ⚠️ AGPL 组件意味着：如果把它与我们的闭源引擎静态合并，整包会被 AGPL 传染。
> 因此约定：**AGPL 组件一律走 iframe / 独立 worker 隔离，不做静态合并**。这条是许可证红线，合并前必须过一遍 `LICENSE-NOTICE.md`。

## 商标与域名

- 品牌：diffs.work
- 引擎版本号与站点版本号独立演进；`manifest.json` 里记录 `engineVersion`。