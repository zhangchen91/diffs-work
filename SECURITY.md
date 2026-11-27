# Security

## 数据流向

- 官网、本地站、浏览器扩展、DSH 插件**都不上传文件内容**。比对在浏览器 WASM 或本机进程内完成。
- 本地站只监听 `127.0.0.1`，无鉴权（设计如此：只在本机可用）；状态写在 `~/.diffs/`。
- 唯一的外部依赖是构建期下载第三方引擎（`pnpm fetch:engine`），下载会核对 `engine.lock.json` 的 sha256。

## 报告问题

请用私密渠道（邮件或 GitHub Security Advisory）描述复现步骤、影响面与版本。不要在公开 issue 里贴真实客户文件。

## 已知边界

- 单份文件上限：文本 40 MB、Office/PDF 200 MB（见 `docs/engine-core.md`）。
- 页面不设置 CSP 之外的沙箱；不要用它打开来路不明的可执行文件内容（本工具只解析文档格式）。
