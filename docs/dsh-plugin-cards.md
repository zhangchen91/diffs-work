# DSH 插件：让 agent 的每一次编辑都渲染成 diff 卡片

装了插件之后，**不需要调用任何命令**。agent 改文件时，对话里就是 diffs.work 的差异卡片。

## 它是怎么做到的（以及为什么没有别的做法）

对话里一张工具卡片的内容来自 `tool/result` 事件的 `meta` 字段，而唯一能写这个字段的钩子
是工具定义上的 `presentationMeta` —— 它在注册表构造这个事件的过程中被调用。所以**外部插件无法
往别人工具的卡片里追加内容**。

插件能拿的是**名字**：在 agent 作用域里 `tools.register()` 注册同名工具，会覆盖该 agent 看到的
全局定义，其他 agent 不受影响。

因此本插件为每个 agent 注册自己的 `edit` / `write` / `bash`；函数体调用原工具，所以写入、权限、
沙箱、持久化仍然全部走原实现 —— 变的只是写在结果旁边的那份元数据。

## 两个关键细节（都踩过坑）

**1. `get(name, scope)` 的 scope 是 agent 对象本身。**
分发器调用的是 `chainLayers(exec.agent)`。不带 scope 的 `get(name)` 读的是**调用者自己那一层**，
而插件那一层没有任何工具 —— 所以它永远回答“0 tools”。

**2. 覆盖时机在 `agent/pre-step`。**
`agent/created` 触发时工具包还没注册（实测 `registry has 0 tool(s)`）；第一次模型调用之前才是
该 agent 工具集齐全的最早时刻。

## 拿“改动前”内容的两种方式

| 工具 | 怎么拿 |
|---|---|
| `edit` / `write` | 参数里有路径，直接读 |
| `bash` | 参数里只有命令。索引命令中**点名的路径**（只取 stat，不读内容），把其中的文档字节留一份，命令结束后比对 |

`bash` 有两个必须处理的行为：后台执行会先返回 job id（必须等 job 结束再比对），以及同一毫秒内的
重写会让 mtime 看起来没变。

## 实测结果（本机，2026-11-27）

| 文件族 | 卡片内容 |
|---|---|
| 代码 | `+1/-0`，含符号统计 |
| Markdown | `+1/-1 行` |
| Word | `+1/-1 · 1 insertion(s) / 1 deletion(s) across 1 part(s)` |
| Excel | `2 sheet(s), 1 changed cells` |
| PowerPoint | `+1/-1 across 5 part(s)` |
| PDF | `+1 -1 ~1 >1`（文本层，含移动），与归一路径的 CLI / MCP 同值 |

`dsh web` 里的界面截图：`docs/evidence/dsh-web-word-card.png`（agent 用 `bash` + python 改了一份
`.docx`，卡片并排显示旧版「45 日」与新版「30 日」）。

复现检查：

```bash
node scripts/inspect-session-cards.mjs <session 目录>
```

会把每条工具结果是否带卡片、卡片指向哪个文件打出来。

## 卡片在哪儿：一个绕不过去的界面限制

装好插件后，卡片**渲染在「N 次工具调用」的折叠区里**。主界面上那一行
「已编辑 N 个文件 · +1 -1」是 **DSH 宿主的组件**（`ui-deliverables` 的 `ChangedFiles`），
不是我们的，而且插件无法替换它：

| 能不能换 | 结论 |
|---|---|
| `conversation.chat.turnTail` | 是 `list` slot，只能**追加**，不能替换宿主的 `ChangedFiles` |
| 从 turnTail 拿到本轮的差异 | **拿不到**。该 seat 只给 `{ turn, seq, openFile }`；`useChat().locations.getTurn(n)` 返回的是系统提示、用户消息、`turn-process` 折叠容器与 context 行——工具结果在容器内部，不在其中 |
| 宿主那张卡的数据 | 宿主自己按 turn 开始/结束抓文件算的（`workspace-changes/capture.ts`），与我们的 `meta` 无关 |

所以现状是：**卡片内容是对的，位置在折叠区**。要让它出现在主界面，只有一条路——DSH 上游
把「工具行」或「变更行」的渲染做成可替换的 keyed slot。插件侧没有别的办法。

## 已知边界（不打算含糊）

- **PDF 只比文本层**：扫描件（没有文字层）报「某页没有文本层」，不会假装比过。
- **`bash` 只能看见命令文本里点名的文件**。用 `find … -exec` 或编译脚本里写死路径去改的文件
  不会有卡片 —— 这是取舍：本机工作区有 82 000 个文件的目录，每次 `ls` 都全量 stat 不可接受。
- **工作区过大时降级**：在超过 20 000 个候选文件的目录里，插件不产出卡片，保留原卡片。
- **登录态截图**：Web 版由 `dsh web` 打印带 token 的 URL，用的是一次性 cookie。
