# 与 the reference suite 的代码比对能力对标

[the reference suite](https://github.com/plannotator/the reference suite)（`plannotator/the reference suite`，MIT OR Apache-2.0）是目前公开的、
最接近「语义级代码 diff」的参考实现。它发布了 56 个手写用例，每个用例都写明作者期望引擎识别出的改动类型。

这份文档记录**本机实测**的对标结果，数据来自 `apps/cli/scripts/case-parity.mjs`。

## 用例来源

`test-cases/reference-cases/cases.json` 从 the reference suite 仓库原样拷贝（未修改），许可证见同目录 `LICENSE-src`。
用例结构：`{id, language, file, title, old, new}`。

## 改动类型的覆盖

the reference suite 定义 10 种类型（`src/pierre-types.ts`），`portable@1` 原本只有 6 种。当前状态：

| the reference suite 类型 | 状态 | 实现 |
|---|---|---|
| `added` / `deleted` / `edited` | ✅ | 内核原有 |
| `moved` | ✅ | 内核原有 + 位移去噪 |
| `reformatted` | ✅ | `packages/diff-tool/src/reformatted.ts` |
| `renamed` | ✅ | `packages/diff-tool/src/renamed.ts`（含「重命名 + 一处编辑」） |
| `extractedFunction` | ✅ 12 命中、零误报 | `packages/diff-tool/src/extracted.ts` |
| `inlinedFunction` | ⚠️ 6/8 | `detectInlined`，零误报；剩下两个是局部内联，见文末 |
| `movedWithEdit` | ❌ 未实现 | 移动 + 内容修改 |
| `reordered` | ⚠️ 语义重叠 | 归入 `moved` |

## 实测数字

口径是**改动类型集合**，不是行号范围——这是审阅者真正问的问题（「这是重命名吗」），
也是两家引擎在没有共用 span 模型时能对齐的部分。

全量（the reference suite 发布 444 个用例，其中 **229 个**以操作类型列表声明期望）：

```
精确匹配（类型集合完全相同）       105 / 229
覆盖（包含 the reference suite 报出的全部类型） 168 / 229
```

只在 symbols 那 56 个用例上：精确 38 / 56，覆盖 51 / 56。

**另外 215 个没有收进仓库**：它们用一句话或一个状态词声明期望，没有引擎能对着它判分。
留着它们只会让分母变大、让数字好看，所以删掉了——**一个不可能失败的用例不是证据**。

精确匹配从 21 提升到 38，靠的是四步位移去噪（见 `ec61c63`）。

**覆盖从 55 降到 51 是刻意的**：掉下去的 5 个是 Ruby/Swift 的方法换序，the reference suite 报 `added + deleted`，
因为它的容器识别没把 Swift 的 `extension`、Ruby 的重开声明当作同一块。实测其中一个：

```
前后都是 20 行，真正消失的行: []
真正新出现的行: []
```

**我们报 `moved` 是对的。** 为了把数字凑回去而复制这个误判，是错误的交换。

## 实现方式

按照约定的分工：

| 环节 | 技术 |
|---|---|
| 解析 | Rust → wasm（`diffs-engine.wasm`） |
| Diff 计算 | Rust → wasm；三个新类型在 TS 层后处理 |
| 渲染 | TS → OpenUI Lang（`toOpenUI`） |

三个新类型之所以在 TS 层而不是 wasm 里做，是因为它们判断的是**整份文件的结构**
（哪个函数被抽出了、哪个名字被替换了），需要全文视图；内核是按块返回的。

### 模型增强的口子

the reference suite 的 `classifier.ts` 有 `secondOpinion` 钩子，让模型对规则判定存疑的候选做二次判断。
我们留了同构的位置：`compareFiles` 的三个检测函数都是纯函数 `(oldText, newText) => result | null`，
外接一个模型只需在返回 null 时再问一次。

## 如何复现

```bash
cd apps/cli && node --experimental-strip-types scripts/case-parity.mjs
```

依赖 the reference suite 的源码（`~/WorkBuddy/WorkSpace/the reference suite`）用于生成对照基准；我们的用例数据本身不依赖它。

## `movedWithEdit`：试过，没做成

17 个用例要求同时报 `movedWithEdit`。实现思路是「内核报了 move，且同时有增删」，试了两个版本：

| 判据 | 命中 |
|---|---|
| 有 move + 有增删 + 增删占比 ≤ 60% | 1 / 17 |
| 有 move + 有增删（去掉比例限制） | 1 / 17 |

**为什么只能命中 1 个**：其余 16 个里，12 个内核只报了 `moved`（改动发生在移动块内部，
内核没有把它拆成增删），3 个报 `edited + moved`，1 个报 `edited`。也就是说**内核的输出里没有
区分「纯移动」和「移动并修改」的信息**，在 TS 层从已有输出反推不出来。

要做成，需要在 wasm 内核里让 `opc_diff`/`sem_diff` 对移动块记录新旧内容的差异，而不是只在
TS 层做后处理。改动已回滚（`git status` 干净），结论记在这里，免得下次重复这半天。

## `inlinedFunction`：6/8，剩下的是局部内联

| 用例 | 现状 |
|---|---|
| 6 个 | ✅ 命中（`detectInlined`，零误报） |
| `two-components-inline-A`、`kt-inline-expr-helper` | ❌ 声明在新文件里仍然存在 |

那两个的形态是 `const handleSubmit = (e) => …` 被内联进 JSX 属性。**声明没有消失**，所以
「helper 走了」这个前提不成立——要识别必须按作用域统计调用次数，而不是看声明还在不在。

三个解析盲区是逐个用例挖出来的，不是靠放宽阈值：

- Ruby `def discount` 没有括号 → 整个 Ruby 代码对检测器不可见
- PHP `private function x(): void` 与 `{` 分行 → 按缩进算函数体，`{` 同缩进直接截断成空
- `base - discount` 是无括号调用 → 只认 `name(`

一个判断放宽了：内联常常改写最后一句（`base * pct` → `base - base * pct`、`return X` → `X`），
要求语句逐字存活会漏掉最典型的情况。
