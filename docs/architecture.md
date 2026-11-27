# 架构（diffs.work）

## 一句话

浏览器只下载「当前文件族」的引擎，文件内容永不离开设备；引擎以 WASM 二进制闭源分发，周边以 TypeScript 开源。

## 分层

```
┌──────────────────────────────────────────────────────────┐
│ website/app              官网/对比器（React 19 + Vite）    │  开源 · 独立 deploy
├──────────────────────────────────────────────────────────┤
│ apps/core-text / core-code / diff-core                    │  开源
│   —— 行/词/块级 diff 的 TS 参考实现，也是 wasm 的对拍基线    │
├──────────────────────────────────────────────────────────┤
│ apps/engine-bundle       ENGINE_REGISTRY + 懒加载 SDK      │  开源（薄）
│   —— 只认 base 路径，不认识引擎内部                         │
├──────────────────────────────────────────────────────────┤
│ target: wasm32          text-core / code-core / docx-core │  闭源二进制
│                         pdf-overlay / cell-diff / lsp-core│
└──────────────────────────────────────────────────────────┘
```

## 引擎加载策略（重点）

1. **首屏**：只有 `index.html` + 3 个 JS chunk（react/icons/app，gzip 后合计 ~104 KB）。
2. **进入对比器**：不加载任何引擎，只注册 `ENGINE_REGISTRY`。
3. **拖入文件**：
   - 文本族 / 代码 / Markdown → `diffs-engine.wasm`（~600 KB，所有文本族共用一个内核）
   - docx / pptx / xlsx → 同一个 `diffs-engine.wasm`（直接读 OOXML，不再有第二个渲染引擎）
   - pdf → `pdfjs`（`pdf.mjs` 0.4 MB + worker 1.4 MB）
   - 老格式 `.doc/.xls/.ppt` → 不读，直接提示另存为 OOXML 格式
4. **切换文件族**：已加载的引擎留在内存复用；未加载的永远不下发。
5. **hint**：hover 文件族卡片时最多做 `preconnect`，不做下载。

> 任何地方都不允许「预加载全部引擎」。这条规则写在 `apps/engine-bundle/src/registry.ts` 顶部注释里，并在代码评审里作为硬约束。

## 数据契约：PortableDiff

引擎的输出只有一种形状（见 `apps/engine-bundle/src/portable.ts`）：

```ts
{
  schema: "diffs.work/portable@1",
  kind: "text" | "code" | "docx" | "pdf" | "xlsx" | "pptx",
  engine: string,
  summary: { added, removed, changed, ratio },
  hunks?: Hunk[],
  revisions?: ...,  // docx
  pages?: ...,      // pdf
  sheets?: ...,     // xlsx
  slides?: ...,     // pptx
}
```

好处：视图层与引擎解耦；引擎换实现（TS → Rust wasm）不影响 UI；第三方也能产这个 JSON 接到本站渲染。

## Worker 模型

- 每个引擎在自己的 Worker 里初始化，主线程只发 `{type: "diff", a: ArrayBuffer, b: ArrayBuffer, opts}`。
- 转移（Transferable）方式传 ArrayBuffer，零拷贝。
- 取消：`AbortSignal` → `postMessage({type:"cancel"})` → Worker 内部检查点。

## 文件浏览器 / LSP（规划）

按用户要求，文件浏览器、目录对比、符号跳转与 LSP 语义都放进 `lsp-core.wasm`：

- 输入：虚拟文件系统（由主线程用 FileSystem Access API 读到的目录树，二进制直接传）；
- 输出：`PortableDiff` + 符号表 + 引用图；
- 主线程只负责渲染树与高亮。这样核心检索/比对逻辑不在 JS 里，逆向成本高。

## 性能红线

| 指标 | 红线 |
|---|---|
| 首页 JS（gzip） | < 150 KB |
| 文本族首次 diff | < 300 ms（10k 行） |
| docx 首次 diff | < 6 s（30 MB 引擎首次加载 + 100 页文档） |
| 内存 | 100 页 docx 峰值 < 400 MB |