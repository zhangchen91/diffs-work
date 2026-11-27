# 证据图

每一张都是真实界面，不是示意图。下面写清楚拍的是什么、怎么复现。

## A6 浏览器扩展：GitHub commit 页上直接出 diff

两张是一对，**同一个页面**：

| 图 | 内容 |
|---|---|
| `A6-1-github-commit-plain.png` | 装了扩展、**还没触发**。真实 commit `c0e6329`（560 files changed），GitHub 自己的绿色/红色 diff 行 |
| `A6-2-github-commit-inline-panel.png` | **触发后**。右下角出现我们的面板：标题 `github.com/zhangchen91/diffs-work — .dockerignore`，`+3 −2`，行号 1-4 / 1-5，`+ .git` `+ .wrangler` `+ *.tsbuildinfo` 绿色、`− out` `− .next` 红色，底部「文件不出这台机器」 |

**关键点**：页面没有跳转到本地站，也没有新开标签页。diff 就画在你正在看的这一页上。

复现：装扩展 → 打开任意 GitHub commit → 选中两段文字 → 右键「对比两段选中文字」。

## B1 你最初报告的那个链接

`B1-reported-pair-now.png` 是 `http://127.0.0.1:5279/#/compare?pair=21887cf3-…` 现在的样子——
就是你最早说「页面有重复、渲染和官网不同步」的那一条。

现在它是：`+11 / −7`、1 处差异、[并排] 开关起作用、左右行号对齐、绿增红删黄改三种颜色。

同一份 `packages/diff-ui` 渲染，官网和本地站出的是一模一样的视图。

## 其余

| 图 | 证明什么 |
|---|---|
| `A2-word-card.png` | DSH 对话里，改完一个 `.docx` 后渲染出差异卡片：`比较结果: wa.docx → wb.docx`，四行表格（交付 修改 / 验收 新增 / 保密 删除 / 争议 位置移动） |
| `A4-live-config.png` | 线上 www.diffs.work/#/config，SDK 行写着「还没发布到 npm」 |
| `B3-excel-style.png` | Excel 头部 `✎3`（3 个纯样式改动的格子）与「只看内容变化」开关 |

## A2 只拍到了 Word，代码编辑那张没有

A2 要的是「改一个文件，对话里直接出现差异卡片」。**Word 这张满足**：`.docx` 改完，卡片里是四行
表格（修改 / 新增 / 删除 / 位置移动）。

**代码编辑那张拍不出来**：DSH 的 web 界面要认证 URL（`?token=…`），我能查到的日志是前一天启动的，
token 已失效，`http://127.0.0.1:3080/` 直接 401。要重拍，需要在**当前这个 DSH 会话**里让它改一个
`.ts` 文件，然后截图。

这条没做到，所以这里没有图。

## 之前这里有两张错的图

`A2-dsh-card.png` 其实是空会话页（写着「当前模型不可用」），`A6-extension-inline.png` 是测试脚本往
官网首页叠的面板。两张都已删除——留错的证据比没有证据更糟。
