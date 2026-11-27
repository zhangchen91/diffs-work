# 部署：GitHub → Cloudflare Pages

两个站点都接在 Cloudflare 的 Git 集成上：**push 到 `main` 就自动构建并发布**。

| Pages 项目 | 构建命令 | 构建输出目录 | 根目录 |
|---|---|---|---|
| `diffs-work` | `pnpm install --frozen-lockfile && pnpm build:website` | `apps/website/out` | 仓库根 |
| `diffs-docs` | `pnpm install --frozen-lockfile && pnpm build:docs` | `apps/docs/dist` | 仓库根 |

## ⚠️ 这两个字段在项目创建时可能是空的

**这是上线时最难查的一个故障。** 两个 Pages 项目建好后，`build_command` 和
`destination_dir` 都是空字符串：

```
build_command: ""
destination_dir: ""
```

Cloudflare 收到 push 后**不构建**，直接把仓库内容当作产物发布。而
`apps/website/out/`（以及 `apps/docs/dist/`）在 `.gitignore` 里，所以**部署出去的是空包**：

- 部署状态显示 **success**
- 访问生产 URL 是 **404**
- 手动 `wrangler pages deploy apps/website/out` 立刻正常
- 修好的问题会“时好时坏”——取决于命中的是手工部署还是自动空包

确认与修复（需要账号级 API token）：

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$ACC/pages/projects/diffs-work" \
  -H "Authorization: Bearer $TOKEN" | jq '.result.build_config'
```

```bash
curl -X PATCH "https://api.cloudflare.com/client/v4/accounts/$ACC/pages/projects/diffs-work" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"build_config":{"build_command":"pnpm install --frozen-lockfile && pnpm build:website","destination_dir":"apps/website/out","root_dir":""}}'
```

修好后**验证方式**：push 一个提交，等 Git 集成构建完成，然后访问**这次部署的独立 URL**
（`https://<hash>.<project>.pages.dev`）——不是生产别名。独立 URL 返回 404 就说明构建没跑。

## 新增一个站点（比如以后的插件页）

1. Cloudflare 控制台 → Workers & Pages → Create → Pages → Connect to Git
2. 构建命令写 `rm -rf <app>/out && pnpm install --frozen-lockfile && pnpm build:<app>`
3. 输出目录写 `<app>/out`
4. 根目录留空，监视路径 `*`

## 为什么 Actions 里不再发布

`.github/workflows/deploy.yml` 只是一次手动触发的“干净检出能不能构建”检查。发布只有一条路径
（Cloudflare），避免两份配置互相覆盖。

## 自定义域名

Pages 项目 → Custom domains → 添加 `diffs.work` / `docs.diffs.work`，按提示改 DNS。

## 引擎文件

wasm 与第三方引擎（rules-core 内核、pdf.js）随仓库提供，构建时不需要额外下载；
只有更新引擎时才需要 `pnpm sync:engine`。

## 部署后自检（必须做）

```bash
pnpm verify:deploy                      # 检查线上是否每个构建产物都能取到
pnpm verify:deploy https://diffs-docs.pages.dev   # 换站点
```

**为什么需要**：出过三次“部署状态成功、内容不全”的事故——英文语言包 404、图标 chunk 404，
还有一次整个 `out/` 是空的。部署 API 报成功并不代表文件都在，唯一可靠的检查是把构建产物
逐个取一遍。
