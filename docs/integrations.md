# 接入指南（第三方 Agent / 工具）

三条接入路径，按你手上的东西选一条：

| 你是 | 用这个 | 需要 |
|---|---|---|
| 能跑命令行的 agent | `diffs diff` CLI | Node 22+ |
| 能发 HTTP 的 agent | 本地站 `/api/diff` | Node 22+，`diffs local` 起着 |
| DeepSeek Harness | `@diffs/dsh-plugin` | DSH 0.1+ |

三者的**比对结果形状完全一致**（`diffs.work/portable@1`），所以换接入方式不用改解析代码。

---

## 1. 结果契约 `diffs.work/portable@1`

```jsonc
{
  "schema": "diffs.work/portable@1",
  "kind": "code" | "text" | "docx" | "xlsx" | "pptx" | "pdf",
  "engine": "rules-core.wasm/semdiff+astdiff",
  "summary": { "added": 17, "removed": 4, "changed": 4, "ratio": 0.625 },
  "hunks": [                      // 代码 / 文本
    { "operation": "update", "lines": [{ "kind": "upd-del", "oldNo": 7, "newNo": null, "text": "amount: 8000", "segments": [{ "op": "del", "text": "0" }] }] }
  ],
  "revisions": [                  // AST 列级，或 docx 段落级
    { "kind": "update", "startRow": 235, "startColumn": 38, "endRow": 235, "endColumn": 47, "text": "OP_STYLES" }
  ],
  "counts": { "inserts": 13, "deletes": 0, "updates": 4, "moves": 2 }
}
```

约定，读之前先知道：

- `ratio` 是**改动行占比**（0..1），不是编辑距离。
- `segments` 里只有真正变化的片段，`op` 是 `same` / `ins` / `del`。
- `revisions[].startColumn` 是 **0 基**，`startRow` 也是 0 基；展示给人时记得 +1。
- 引擎缺失时（有人只 clone 了仓库没编译内核），`kind` 仍为 `code`，但由 TypeScript 引擎产出：
  没有 `counts`，类型与列级信息为空。**用 `engine` 字段判断，不要假设字段一定存在。**

---

## 2. CLI

```bash
diffs diff old.ts new.ts --json          # 结构化结果
diffs diff old.ts new.ts                 # 人类可读的 unified
diffs diff old.ts --revision HEAD~1      # 和 git 里的旧版本比
```

退出码：`0` 无差异，`1` 有差异，`2` 出错。适合放进 agent 的“改完自查”步骤。

---

## 3. 本地站 HTTP API

```bash
diffs local --port 5279      # 常驻；只监听 127.0.0.1
```

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | `{ ok, version, engine }` |
| POST | `/api/diff` | 比对两个本地路径，返回上面的契约 |
| POST | `/api/open` | 让浏览器打开某个路径的对比页 |
| GET | `/api/inbox` | agent 提交过的待处理项 |

```bash
curl -s localhost:5279/api/diff \
  -H 'content-type: application/json' \
  -d '{"old":"/w/a.ts","new":"/w/b.ts"}' | jq '.summary'
```

`/api/diff` 只读你给的路径，不落盘、不上传；返回里不含文件全文，只有差异片段。

---

## 4. DeepSeek Harness 插件

```bash
dsh plugin --profile <profile> add link:<repo>/apps/dsh-plugin
```

然后在该 profile 的 `cordis.patch.yml` 里挂上这一行（不挂就只是依赖，不会运行）：

```yaml
- insert:
    - id: diffs
      name: '@diffs/dsh-plugin'
      config:
        localUrl: http://127.0.0.1:5279
        tool: true
        commands: true
```

装好后 agent 有了 `diff_compare` 工具，会话里出现三样东西：对话中的差异卡片、输入框下方的
状态条（本地站是否在线 / 最近比了什么）、侧边栏的待处理列表。

---

## 5. 自己写一个集成

不想用上面任何一条？只依赖 `@diffs/diff-tool`：

```ts
import { compareFiles } from "@diffs/diff-tool";

const r = await compareFiles({ old: "a.ts", new: "b.ts" });
r.summary;      // { added, removed, changed, ratio }
r.hunks;        // 行级，带统一的行号
r.semantic;     // 改 / 移（可能为 undefined，取决于引擎是否可用）
r.types;        // 符号类型与定义位置
```

包是纯 ESM、无网络调用。`compareFiles` 是唯一建议调用的导出；其余导出是给视图层用的。

---

## 6. 与 Cloudflare 部署的关系

站点由谁部署不影响接入：本地站和 CLI 完全离线可用，插件只连 `127.0.0.1`。
线上的 https://www.diffs.work 只是同一份前端代码的托管版本，**不会**收到你的文件。