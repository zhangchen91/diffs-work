# @diffs/dsh-plugin

diffs.work for DeepSeek Harness —— 一次比对，三种看法。

| 位置 | 看到什么 |
|---|---|
| 对话里的工具卡片 | agent 调 `diff_compare` 后，直接给出文件对、+/− 计数、**改/移**、AST 列级命中、符号类型 |
| 侧边栏底部「对比」 | 本会话所有比对汇成待处理列表，可展开单条、可跳到本地视图 |
| 输入框下方 | 一行状态：本地视图是否在线、最近比对了什么 |

主机半身（`lib/index.js`）注册 `diff_compare` 工具与 `/diff-*` 命令；浏览器半身（`lib/client.js`）只负责展示。
内核（`engine/diffs-engine.wasm`）随包发布，安装后无需再编译。

## 安装

### 方式 A：DeepSeek Harness 插件管理器（推荐）

```bash
dsh plugin --profile <你的 profile> add link:/path/to/diffs.work/apps/dsh-plugin
```

然后在 profile 的 `cordis.patch.yml` 里挂上这一行（**这一步必须做**，否则插件只是依赖，不会运行）：

```yaml
- insert:
    - id: diffs
      name: '@diffs/dsh-plugin'
      config:
        localUrl: http://127.0.0.1:5279
        tool: true
        commands: true
```

### 方式 B：DeepSeek Harness 桌面端

**设置 → 插件 → 添加插件**，选择 `apps/dsh-plugin` 目录。

## 验证装好了

新开一个会话，让 agent 比对两个文件，或直接在输入框输入 `/diff-open`。
工具列表里应出现 `diff_compare`。

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `localUrl` | `http://127.0.0.1:5279` | 本地视图地址（`diffs local`） |
| `tool` | `true` | 是否注册 `diff_compare` 工具 |
| `commands` | `true` | 是否注册 `/diff-*` 命令 |
