# 开源就绪清单

## 仓库里保留什么

| 内容 | 入库 | 原因 |
|---|---|---|
| `apps/engine-core/`（Rust 内核源码） | ❌ | 只发布编译后的 wasm，避免被直接复刻 |
| `apps/website/public/engine/**`（rules-core、pdf.js、tesseract 资源） | ✅ | **clone 下来直接能跑** |
| `apps/website/public/examples/**` | ✅ | 页面内置样例文件 |
| `website/`、`.deploy/`、`.codegraph/*` | ❌ | 旧构建残留 / 本机部署记录 / 本地索引 |
| `node_modules/`、`out/`、`dist/`、`.wrangler/` | ❌ | 标准构建产物 |

判断标准：**别人 clone 之后 `pnpm install && pnpm dev:website` 要能直接看到全部效果**；
这条标准现在由 `node scripts/check-clean-clone.mjs` 执行（实测记录见 `docs/clean-clone.md`）；
只有“能让别人照着复刻内核”的东西才不进仓库。

## 已配好

| 项 | 位置 |
|---|---|
| `.gitignore` | 全仓；规则见上表 |
| `LICENSE` | 根目录 MIT（内核只以 wasm 形态分发） |
| `CONTRIBUTING.md` / `SECURITY.md` | 根目录 |
| 接入指南 | `docs/integrations.md`（CLI / 本地站 HTTP / DSH 插件 / 直接调包） |
| CI | `.github/workflows/ci.yml`：unit + browser（Playwright），已绿 |
| 部署 | `.github/workflows/deploy.yml`：构建后发布两个 Pages 项目，需要两个 secret |

## 部署到 Cloudflare

Push 到 `main`（或手动触发的 `workflow_dispatch`）会跑 `.github/workflows/deploy.yml`，
构建 `apps/website` 与 `apps/docs` 后各自发布到 Pages：

| Pages 项目 | 目录 | 线上地址 |
|---|---|---|
| `diffs-work` | `apps/website/out` | https://diffs-work.pages.dev |
| `diffs-docs` | `apps/docs/dist` | https://diffs-docs.pages.dev |

后续新增插件站点时，在同一个 workflow 里加一段 `cloudflare/wrangler-action` 即可，
每个 app 自己带 `wrangler.jsonc`（项目名写在里面）。

## 仍待补

- 公开仓库的一条 `main` + Issue/MR 流程（当前直接推 main，正式可用后切换）。
- 自定义域名 `diffs.work` / `docs.diffs.work` 的 Pages Custom domain。