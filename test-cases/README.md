# 差异用例

每一类文件一个目录，每个用例一对输入加一份期望。

```
test-cases/
  ts/     01-add.ts.json        输入 + 期望
  rust/   ...
  excel/  ...
  word/   ...
  ppt/    ...
  pdf/    ...
```

用例文件（`*.case.json`）说明输入从哪来、期望看到哪些动作：

```json
{
  "name": "改一个常量并删掉一个函数",
  "kind": "ts",
  "before": "before.ts",
  "after": "after.ts",
  "expect": { "ops": ["add", "del", "mod", "move"] }
}
```

`expect.ops` 列的是**必须出现**的动作，不要求穷举。
`expect.notOps` 列的是**不该出现**的动作。

用 `node scripts/run-cases.mjs` 跑全部，`--only word` 只跑一类。
