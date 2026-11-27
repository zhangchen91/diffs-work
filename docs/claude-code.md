# Claude Code：编辑后直接看到差异

Claude Code 是一个终端，没有可以画卡片的插槽。所以这里的“同一套渲染”指的是**同一段描述**：
hook 读出工具调用，走同一个 `compareFiles`，把结果打印在你正在看的地方 —— 不用再叫 agent 去跑一次 diff。

实测（本机，2026-11-27）：改一段 TS 打印 `+1/-1`；改一份 `.docx` 打印
`1 insertion(s) / 1 deletion(s) across 1 part(s)` 加上改动的那一段文字。

## 配置

在 `~/.claude/settings.json` 里加两个 hook —— 现成的片段在同目录 `claude-code-hooks.json`，
把其中的两段 `PreToolUse` / `PostToolUse` 合并进你自己的 `hooks` 即可（**不要**整份覆盖，
很多人那里 `hooks` 已被别的工具占用）。`PreToolUse` 在改动前存一份原文件，`PostToolUse` 在改动后
比对 —— 只有一个 hook 是拿不到“改之前”的。

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|MultiEdit|Write|NotebookEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/diffs.work/apps/cli/lib/bin.js hook:claude-pre"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|MultiEdit|Write|NotebookEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/diffs.work/apps/cli/lib/bin.js hook:claude-post"
          }
        ]
      }
    ]
  }
}
```

把 `/path/to/diffs.work` 换成仓库所在位置。CLI 还没发到 npm，所以这里用仓库内路径 ——
和 DSH 插件、MCP 配置是同一个理由。

## 它怎么工作

1. `hook:claude-pre` 读 stdin 的 hook payload，把 `tool_input.file_path` 指的文件复制到
   `$TMPDIR/diffs-claude/`，**保留扩展名**。
2. `hook:claude-post` 拿这份快照和文件现在的内容比对，打印 summary 与改动行。
3. 失败一律静默退出 0：hook 不能因为自身出错就挡住一次工具调用。

## 两个会让人误判的地方

**扩展名是身份的一部分。** 快照和临时副本都必须带原来的扩展名，因为 `compareFiles` 靠扩展名
挑文档引擎。早期版本统一存成 `.txt`，结果每一次 `.docx` 编辑都打印出一堆 zip 字节。

**文档的行不是字节。** `.docx` / `.xlsx` / `.pptx` / `.pdf` 的 hunk 单位是部件与段落，
打印时不再套 `+`/`-` 行号栏 —— 那样只会把 `[Content_Types].xml` 画进终端。

## 没做的

- 没有 Claude Code 的“插件/mods”形态：Claude Code 目前只有 hook 这个扩展点，没有可注册 UI 的
  API。所以这里能做到的是“终端里直接看到差异”，不是“对话里出现卡片”。
- `.xls` / `.doc` / `.ppt` 这些 2007 前的格式不比对（和 CLI 的边界一致）。