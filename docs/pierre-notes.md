# Pierre `packages/diffs` 观察

[Pierre](https://github.com/pierrecomputer/pierre)（Apache-2.0），`packages/diffs`，本机 `~/WorkBuddy/WorkSpace/pierre`。
这是渲染侧可借鉴的参考实现，the reference suite 的操作类型也从它的 `src/types.ts` 来。

规模：184 个测试文件，7.7 MB。

## 它的测试是什么

**几乎全是渲染与交互测试**，不是改动分类用例：

```
test/CodeView.*.test.ts        折叠、高亮缓存、搜索、滚动锚定、元素池、指针事件…
test/FileDiff.*.test.ts        编辑会话归属、部分渲染、统一视图分隔符、worker 渲染
test/DiffHunksRenderer*.test.ts hunk 渲染、多语言、虚拟化
```

**对我们的意义**：它验证的是「同一份 diff 数据，渲染得对不对」，正是我们反复出问题的层面
（单栏宽度为 0、卡片不渲染、两站不一致）。这些用例可以照着写，但**不是代码 diff 的判定用例**——
真正的判定用例在 the reference suite（229 个可机械评分），两家是互补的，不是重复的。

## 它的数据模型

`src/model/DiffModel.ts` 是块级的，不是行级的：

```ts
block.type === 'context'                    // 未变的行
block.deletions + block.additions           // 变动的行，成对存放
```

`editLineFor()` 做的是「旧行号 → 新行号」的映射，`blockAt('deletions', lineIndex)` 按侧查块。

**可以借鉴的两点**：

1. **块而非行**。我们的 `semantic.hunks` 是 hunk = 一组行，里面再自己配对。Pierre 把「一段删除 +
   一段新增」显式建成一个 `change` 块，渲染时天然并排，不需要每处再推一次配对。
2. **行号映射是模型的方法**，不是渲染时算的。我们现在的 `moveIndex()` / 就地配对散在视图层，
   每个视图各写一次——这正是「一件事要在多处改」。

## 还没做的

- 没有把它的用例搬进来：它们是渲染测试，依赖它自己的组件树，搬过来要重写成我们的 API。
- `block` 模型的重构没有做：那是 `portable@1` 契约层的改动，影响四端，不该在收尾阶段动。

## 建议

如果要借，优先级是：**先借它的测试分类**（照 `CodeView.*` 的维度给我们自己的视图补测试），
再考虑 `block` 模型。前者是补证据，后者是重构契约。
