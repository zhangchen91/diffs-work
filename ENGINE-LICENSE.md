# 引擎许可（engine license）

本仓库的**周边代码**（网站、文档、插件、SDK、脚本）采用 [MIT](LICENSE)。

**例外**：`apps/engine-core/`（比较内核，Rust → wasm32）**不包含在本仓库的源码中**，
其源码保存在私有仓库 `zhangchen91/diffs-work-engine`（仅维护者可见，非 MIT）；
也不在 MIT 授权范围内。它以编译产物形式分发：

| 文件 | 用途 |
|---|---|
| `apps/website/public/engine/rules-core/diffs-engine.wasm` | 网站与本地站 |
| `apps/dsh-plugin/engine/diffs-engine.wasm` | DSH 插件 |
| `apps/local/public/engine/rules-core/diffs-engine.wasm` | 本地预览 |

使用这些 wasm 产物**不需要**内核源码，也不需要额外授权：它们随 MIT 的周边代码一起分发，
你可以自由运行、自托管、再分发。

**不授予**：反编译、提取算法后重写为自己的产品。

---

## Engine license (English)

The surrounding code in this repository is [MIT](LICENSE).

The comparison kernel (`apps/engine-core/`, Rust → wasm32) is **not part of this
repository's source**; it lives in the private repository `zhangchen91/diffs-work-engine`
(maintainers only, not MIT) and is not covered by that MIT grant. It ships as prebuilt
WebAssembly:

- `apps/website/public/engine/rules-core/diffs-engine.wasm`
- `apps/dsh-plugin/engine/diffs-engine.wasm`

Running, self-hosting and redistributing those binaries is permitted together with the
MIT-licensed application. Decompiling the kernel to rebuild it as a competing product is
not.

See [docs/open-source-boundary.md](docs/open-source-boundary.md) for the reasoning.
