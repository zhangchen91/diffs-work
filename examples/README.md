# 内置样例

每个文件类型只有一个样例，且每个样例都**刻意**包含四种差异状态各一处：

| 状态 | 在样例里长什么样 |
|---|---|
| 增 | 新增的行/段/单元格，周围没有配对删除 |
| 删 | 删除的行/段/单元格，周围没有配对新增 |
| 改 | 一增一删能对上（同一位置、内容相近） |
| 移 | 同样的内容出现在别的位置（判定优先级最高） |

| 文件 | 族 | 四态分布 |
|---|---|---|
| `code/pricebook-v1.ts` → `code/pricebook-v2.ts` | code | 删 `legacyTax` · 增 `taxIncluded` · 改 `0.05→0.08` · 移 `quoteTotal` 到 `subtotal` 之前 |
| `code/hours-v1.md` → `code/hours-v2.md` | markdown | 改标题 `Known gaps→Open questions` · 增第 8 条规则 · 移 `Rules of thumb` 整节 · 删末尾一段 |
| `sheets/checklist-B3.xlsx` → `sheets/checklist-B4.xlsx` | xlsx | 新增列 · 改单元格 · 删行 · 换工作表顺序 |
| `docx/contract-v1.docx` → `docx/contract-v2.docx` | docx | 段落增 / 删 / 改 / 移（docxodus 原生修订） |
| `pdf/nda-v1.pdf` → `pdf/nda-v2.pdf` | pdf | 条款增删改 + 段落换位（按字符坐标高亮） |

样例内容全部是合成的，不含任何真实合同、客户或交易信息。

## 改样例时的约定

- 一个族只留一对文件；不要为了“多一个场景”再加样例，宁可把四种状态塞进同一对。
- 改完跑 `pnpm test:samples`：它会断言每种样例确实同时出现 增/删/改/移 四种状态。
- 文件按族放子目录，`apps/website/public/examples/` 由 `pnpm sync:examples` 同步。