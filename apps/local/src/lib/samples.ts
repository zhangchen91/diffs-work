/**
 * Built-in samples — the same list the hosted site uses.
 *
 * `local` used to carry its own definitions pointing at `/examples/contract-v1.md` and
 * friends. Those files were reorganised into `examples/{code,sheets,docx,pptx,pdf}/`, so
 * every local sample 404'd while the hosted site was fine. One source of truth now:
 * the website's SAMPLES, resolved through the same `/examples/...` URLs (sync-examples
 * mirrors that tree into apps/local/public).
 */
import { SAMPLES as SITE_SAMPLES, loadSample, loadSampleFiles, type Sample } from "../../../website/src/lib/samples";

export type { Sample };
export { loadSample, loadSampleFiles };

/** The website labels are message keys; this app has no i18n, so resolve them here. */
const LABELS: Record<string, { label: string; desc: string }> = {
  "sample.code": { label: "代码 · PR 风格改动", desc: "删一个旧函数、改一个常量、增一个辅助函数、移一段注释块" },
  "sample.readme": { label: "Markdown · 中英混排", desc: "段落改写、表格行增删、整节移动" },
  "sample.checklist": { label: "Excel · 投资条款 checklist 两轮", desc: "单元格增删改、整表样式变化" },
  "sample.docx": { label: "Word · 增资协议 B3 → B4", desc: "docxodus 渲染的修订视图" },
  "sample.pptx": { label: "PPT · 投资条款要点两版", desc: "一页未改、一页改了并新增、一页整页新增" },
  "sample.pdf": { label: "PDF · 投资意向书四页两版", desc: "跨四页的增删改，坐标框标出位置" },
};

export const SAMPLES: Sample[] = SITE_SAMPLES.map((s) => ({
  ...s,
  label: LABELS[s.label]?.label ?? s.label,
  desc: LABELS[s.desc]?.desc ?? LABELS[s.label]?.desc ?? s.desc,
}));
