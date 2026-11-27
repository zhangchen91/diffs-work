# 新克隆能不能直接跑

`docs/open-source-ready.md` 的判断标准是「别人 clone 之后 `pnpm install && pnpm dev:website` 要能直接看到全部效果」。
这条标准此前从没被执行过。

复现：`node scripts/check-clean-clone.mjs`（克隆、安装、构建、五个族逐个比对；不进 `pnpm test`，
因为它要几分钟）。发版前跑 `pnpm check:release`。

## 实测（2026-11-27）

```bash
git clone --depth 1 https://github.com/zhangchen91/diffs-work.git /tmp/clonecheck
cd /tmp/clonecheck
pnpm install --frozen-lockfile     # 5.4s，无报错
pnpm build:website                 # ✓ built in 940ms
pnpm build:cli && node apps/cli/lib/bin.js diff \
  test-cases/all-ops/word.before.docx test-cases/all-ops/word.after.docx
# 2 insertion(s) / 2 deletion(s) across 1 part(s)
```

仓库 17 MB，六族样例与 wasm 都在里面，clone 后无需额外下载。

## 顺带更正

这张清单里有两行说的是不存在的东西，已删：

| 原条目 | 实际 |
|---|---|
| `vendored/engine/**` ✅ | 目录不存在 |
| `apps/legacy-brv-diff/` ✅ | 目录不存在 |
