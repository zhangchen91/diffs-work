# 三套主题

`apps/website/src/styles/globals.css` 用 `@theme inline` 把每个工具类绑到 CSS 变量，
`html.theme-*` 切换变量，组件里**不再出现**写死的 `text-white` / `bg-slate-800` 这类只对一套配色成立的类。

| 主题 | 类名 | 场景 | 关键色 |
|---|---|---|---|
| 曜石 Obsidian | `theme-obsidian`（默认） | 日常、对比度最高 | 背景 `#05060a`，品牌 `#6ee7b7` |
| 纸张 Paper | `theme-paper` | 打印、长文阅读、白天强光 | 背景 `#fbfaf7`，品牌 `#0f766e` |
| 森林 Forest | `theme-forest` | 夜间读合同，低眩光 | 背景 `#06120e`，品牌 `#7ee2a8` |

切换器在顶栏（语言键右边），选择存 `localStorage["diffs.theme"]`，`main.tsx` 在首帧前应用，不会闪。
`applyTheme()` 同时设置 `color-scheme`，让原生控件（滚动条、输入框）跟随。

已知细节：Tailwind 的透明度工具默认在 oklab 里混色，深色主题的 `bg-panel/50` 会发灰，
所以拖拽区那一档改成 `color-mix(in srgb, …)` 的 sRGB 混色（见 globals.css 末尾）。
