# 新增一种文件格式

这份文档是**照着做过一遍**写的：本文的每一步都以现有的六族为样本倒推，末尾记录了它对
「API 是否便于快速适配」这个问题的诚实评估。

## 三步

### 1. 内核（或一个 TS 解析器）

内核在 `apps/engine-core`（私有仓库）。给新格式加一个 `cmd`：

```rust
// cmd: "foo_diff", a: base64, b: base64
// 返回 { schema, kind, summary, hunks: [...] }
```

如果这一族不适合塞进内核（比如要额外 30 MB 的第三方解析器），就走 TS 路线：在
`packages/core-<name>/src/index.ts` 导出一个返回 `Hunk[]` 的函数，参照 `core-xlsx`。

### 2. `packages/dom-utils/src/files.ts` 里登记扩展名

```ts
foo: "foo",
```

**必须同时**在 `apps/website/src/lib/formats.ts` 的 `EXT_TO_FAMILY` 里登记——
`formats-parity.test.mjs` 会比较两张表，不一致就失败。

### 3. `apps/website/src/components/compare/studio.tsx` 里加一个分支和一个视图

分支形状固定（可参照 pdf 那段）：

```tsx
if (fm.id === "foo" && a.bytes && b.bytes) {
  const t0 = performance.now();
  (async () => {
    const engine = await loadRustEngine();
    const r = engine.call({ cmd: "foo_diff", a: toBase64(a.bytes!), b: toBase64(b.bytes!) });
    if (!fresh()) return;
    setFoo(r);                    // 一个 React state
    setMs(Math.round((performance.now() - t0) * 10) / 10);
  })();
  return;
}
```

视图组件放在 `components/compare/foo-view.tsx`，用 `@/lib/revision-tone` 里的
`REGION_TONE` / `MARK_TONE`，**不要自己写颜色**——三族曾经各写一套，然后漂移了。

## 契约

`hunks[].lines[]` 的 `kind` 只有六个值：`ctx` `del` `ins` `upd-del` `upd-ins` `move`。
行号 1-based，列是字节偏移。`upd-del` 后面紧跟 `upd-ins` 表示同一处改动的前后。

## 诚实评估：这个 API 好不好适配

**做得到，但不算好。** 具体是：

- **好的一面**：六族的输出形状确实一致（都是 hunks + lines + segments），CLI / HTTP /
  MCP / 插件四个面共用同一个 `compareFiles`。加一族不需要动这四个面中的任何一个。
- **不好的一面**：`studio.tsx` 里每种格式是一个 `if` 分支 + 一个专用视图组件，约 30–50
  行，各族的 state 各自声明（`xlsx` / `opc` / `pdf` / `rich`）。加第四种二进制格式时，
  这些分支会长到需要拆成 registry。
- **一处不一致**：`sem_diff`（应用实际调用的）返回的对象**没有 `schema` 字段**，
  而 `portable_code` 有。契约标识是在 `packages/diff-tool` 包装层补上的，所以直接调内核
  的人拿不到。这是应该修的。

要让适配变快，正确的下一步是：把「一族 = 一个分支 + 一个组件」换成「一族 = 一个
registry 条目 { 扩展名、内核命令、视图组件、摘要格式 }」。现在是六族，还撑得住；
到第八族就该换了。
