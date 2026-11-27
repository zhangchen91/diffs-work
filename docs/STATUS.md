# 本机实测状态

每一项都写**实测过什么**，以及**什么时候测的**。

日期：2026-11-27。本轮重点是把 DSH 插件的「装了就有差异卡片」真正打通。

## 本轮新增：DSH 插件在 Web 版里渲染差异卡片 ✅

**结论**：装好插件后，agent 改文件时对话里直接出现 diffs.work 的差异卡片，不需要调用任何命令。
证据：`docs/evidence/dsh-web-word-card.png` —— agent 用 `bash` + python 改了一份 `.docx`，
卡片并排显示旧版「45 日」→ 新版「30 日」，底部 `1 insertion(s) / 1 deletion(s) across 1 part(s)`。

实现与踩过的坑写在 `docs/dsh-plugin-cards.md`，要点：

| 发现 | 说明 |
|---|---|
| 卡片内容只能来自 `presentationMeta` | 它在注册表构造 `tool/result` 时被调用，外部插件无法事后追加 |
| `get(name, scope)` 的 scope 是 **agent 对象本身** | 不带 scope 的 `get()` 读调用者自己那一层，插件层没有工具 → 永远「0 tools」 |
| 覆盖时机在 `agent/pre-step` | `agent/created` 时工具包还没注册 |
| `presentationMeta` 不能返回 `undefined` | 会让整次工具调用 `INVALID_TOOL_OUTPUT` |
| 文档不走 `edit` | 实测改一句 `.docx` 用了 11 次 `bash`、0 次 `edit`，所以 `bash` 也必须覆盖 |

## 本轮重新跑过

| 能力 | 怎么跑 | 结果 |
|---|---|---|
| DSH 插件类型检查 | `tsc --noEmit -p apps/dsh-plugin` | 无错误（本轮修掉 40+ 处隐式 any、`DiffRow`/`DiffPayload` 与实现不一致） |
| DSH 插件单测 | `node --test apps/dsh-plugin/test/*.test.mjs` | 20 例全绿 |
| 六族卡片载荷 | `node scripts/inspect-session-cards.mjs <session>` | code / markdown / docx / xlsx / pptx 均产出 `diffs.work/portable@1`；pdf 为降级提示 |

## 本轮逐条核过的对外宣称

| 条目 | 实测结果 |
|---|---|
| git difftool | ✅ 真的拉起：`git difftool --tool=diffs` 输出 pair URL，浏览器打开后显示 `+1/−1`，见 `docs/evidence/A5-git-difftool.png` |
| MCP 往返 | ✅ `initialize → tools/list → tools/call` 全通，返回 portable@1 |
| Claude Code hook | ✅ 实测：改 TS 打印 `+1/-1`；改 `.docx` 打印 `1 insertion(s)/1 deletion(s)` 与改动段落。此前把 `.docx` 当文本比，打印出一堆 zip 字节，已修（快照与临时副本必须保留扩展名） |
| VS Code 扩展 | ❌ 仓库里没有、市场里也没有；config 页已标 `planned` |
| 浏览器扩展 | ✅ 存在且能用（选中两段文字右键比对）；文案只承诺这一点，没有夸大成「GitHub commit 页内自动渲染」 |
| config 页 MCP 重复 | ✅ 只剩 MCP 专区一条 |
| 「diff_summary」 | ❌ **不存在这个工具**，`tools/list` 只返回 `diff_compare`；中英文文案已删 |
| 「可分享的对比视图」 | ❌ 官网 compare 页不读 `pair` 参数、也不做持久化；文案改成「结果留在本机标签页」 |

## 未完成（代码里没有，或没验证通过）

| 项 | 为什么 |
|---|---|
| PDF 文本层比对 | `@diffs/core-pdf` 依赖 pdf.js（浏览器库），Node 侧没有等价实现 |
| `bash` 改 `find -exec` 等未点名路径的文件 | 索引只看命令文本里点名的路径；全量 stat 在 82 000 文件的工作区不可接受 |
| 浏览器扩展的 GitHub commit 页内渲染 | 扩展目前只支持「选中两段文字右键比对」，没有 commit 页自动渲染 |
| Claude Code mods | 本轮未做 |
| `movedWithEdit` | 内核 `MoveBlock` 只带一侧 `text` |
| VS Code 扩展 | 不存在，也没在市场里；`config` 页标 `planned` |
| npm 发布 | `diffs` 属于别人（`synder`），无权限；文案已标注 |

## 容易误会的三点

**1. 相对路径**

`diffs diff a.ts b.ts` 的路径按**进程的 cwd** 解析。在 DSH 里 cwd 是会话的工作目录。

**2. Excel 没有并排开关**

一张工作表本来就是一个网格同时承载新旧两侧，没有「第二个文档」可并排。

**3. 文档站说的「未发布到 npm」是真的**

`npm i @diffs/diff-tool` 会 404；`npx diffs` 装到的是别人的包。