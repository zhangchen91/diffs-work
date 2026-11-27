# 部署（Cloudflare Pages）

官网是 monorepo 里的**独立部署单元**：`website/`。其它子目录（`apps/chrome-extension`、`apps/dsh-plugin`）各自独立发布，互不影响。

## 产物

```
pnpm build                # 或 cd website && pnpm build
# → apps/website/out/
#   ├─ index.html
#   ├─ assets/*.js|css          (vite, 带 hash, 可长缓存)
#   ├─ engine/{rules-core,pdfjs}/   (引擎, 按文件族分片)
#   └─ examples/                (内置样例)
```

## 首次部署

```bash
npx wrangler login                 # 或用 CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
cd website && pnpm deploy          # = wrangler pages deploy app/out --project-name diffs-work
```

`scripts/deploy-cloudflare.mjs`（由 `website/package.json` 的 `deploy` 调用，cwd 在 `website/`）会：

1. 检查 `apps/website/out/index.html` 是否存在（不存在则提示先 `pnpm build`）；
2. 读取 `CLOUDFLARE_*` 环境变量（没有则用 `wrangler login` 的本地凭据）；
3. 调用 `wrangler pages deploy`，打印线上 URL；
4. 把 URL 写到 `.deploy/last-deploy.json`。

## 缓存策略

`_headers` 已随产物下发：

- `assets/*`：`cache-control: public, max-age=31536000, immutable`（hash 文件名）
- `engine/*.wasm`：`public, max-age=604800`（一周）
- `index.html`、`examples/*`：`no-cache`

## 独立部署边界

| 目录 | 部署目标 |
|---|---|
| `website/` | Cloudflare Pages（本项目） |
| `apps/chrome-extension/` | Chrome Web Store（规划） |
| `apps/dsh-plugin/` | npm / DSH 插件市场（规划） |
| `apps/engine-core/` | 引擎产物发布（R2 / COS，不发布源码） |

## 换 CDN（后续）

引擎体积大，流量起来后建议：

| 资源 | 建议承载 | 理由 |
|---|---|---|
| 站点 HTML/JS/CSS | Cloudflare Pages | 全球边缘、免费 |
| `engine/rules-core/diffs-engine.wasm`（~600 KB） | 腾讯云 COS + CDN（国内）/ R2 + Cloudflare（海外） | 国内回源稳、按量便宜 |
| `engine/tessdata/*` | **已移除**：OCR 未实现，没有任何代码加载它，不再进入产物 | — |

切换只需改 `apps/engine-bundle/src/registry.ts` 里各引擎的 `base`，或注入 `window.__DIFFS_ENGINE_ORIGIN__`（后续支持）。

## 回滚

Cloudflare Pages 保留每次部署；控制台 → Deployments → Rollback，或：

```bash
npx wrangler pages deployment list --project-name diffs-work
npx wrangler pages deployment rollback <deployment-id> --project-name diffs-work
```
## 部署记录

| 时间 | 说明 |
|---|---|
| 2026-11-24 | 首次上线：`wrangler pages project create diffs-work --production-branch=main`，随后 `cd website && pnpm deploy`。生产地址 **https://diffs-work.pages.dev** ；本次部署 URL `https://c845d31a.diffs-work.pages.dev` |
| — | 账号：344267604@qq.com's Account（`f305546ecadc0351972d94e5590e2dca`），认证走本机 `wrangler login` |

部署后已在浏览器验证：首页渲染、`#/compare` 代码样例（+17/−4、symbols 4+/0−）、`#/legacy` docx 修订视图（11 处修订）全部正常。

## 2026-11-24 扩展为多站点

| 站点 | Pages 项目 | 地址 |
|---|---|---|
| 官网 | `diffs-work` | https://diffs-work.pages.dev （本次部署 38eb8202） |
| 文档 | `diffs-docs` | https://diffs-docs.pages.dev （本次部署 56c9b504） |

本地站 `apps/local` 与 CLI `apps/cli` **不部署**：只在本机 `127.0.0.1:5279` 运行。
插件与扩展的发布路径、版本号纪律见根 README。

## 2026-11-24 · i18n 上线

- 官网 https://diffs-work.pages.dev （本次部署 1aa14f67）：默认 zh-CN，右上角切 English；消息分 chunk 懒加载。
- 文档 https://diffs-docs.pages.dev （本次部署 9e6c1a76）：`/` 中文、`/en/` English，页面右上角互跳。
- 本地站 `diffs local` 同步支持，切换记在 `localStorage["diffs.locale"]`。
