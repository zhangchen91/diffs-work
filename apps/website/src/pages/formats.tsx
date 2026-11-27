import * as React from "react";
import { Badge, Card, SectionTitle } from "@/components/ui/primitives";
import { FORMATS } from "@/lib/formats";
import { ENGINE_PLAN } from "@/lib/engine-plan";
import { CompareStudio } from "@/components/compare/studio";
import { useI18n } from "@diffs/i18n";

export function FormatsPage(): React.ReactElement {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <SectionTitle
        kicker={t("formatsPage.kicker")}
        title={t("formatsPage.title")}
        desc={t("formatsPage.desc")}
      />

      <div className="mt-10 grid gap-3 md:grid-cols-2">
        {FORMATS.map((f) => (
          <Card key={f.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[15px] font-semibold text-white">{t(f.label)}</div>
                {/* same one-line rule as the home cards: 36 extensions used to wrap to five rows
                    here too, and the badge beside it wrapped with them */}
                <div className="mt-1 truncate font-mono text-[11.5px] text-slate-500" title={f.exts.join("  ")}>
                  {f.exts.join("  ")}
                </div>
              </div>
              <span className="shrink-0 whitespace-nowrap">
                {f.live ? <Badge tone="brand">{t("formatsPage.ready")}</Badge> : <Badge tone="muted">{t("formats.lazy")}</Badge>}
              </span>
            </div>
            <p className="mt-3 text-[13px] leading-6 text-slate-400">{t(f.blurb)}</p>
            <div className="mt-3 space-y-1.5 rounded-lg border border-line/70 bg-panel-2/60 p-3">
              <Row k={t("formats.engine")} v={t(f.engine)} />
              <Row k={t("formats.size")} v={t(f.engineSize)} />
              <Row k={t("formats.view")} v={t(viewOf(f.id))} />
            </div>
          </Card>
        ))}
      </div>

      <h3 className="mt-14 text-[15px] font-semibold text-white">{t("formatsPage.shards")}</h3>
      <div className="mt-4 grid gap-2">
        {ENGINE_PLAN.map((e) => (
          <Card key={e.id} className="flex flex-wrap items-center gap-3 p-4">
            <span className="font-mono text-[13px] text-slate-100">{e.id}</span>
            <Badge tone={e.status === "ready" ? "brand" : "muted"}>{e.status === "ready" ? t("formats.status.ready") : t("formats.status.lazy")}</Badge>
            <span className="text-[12px] text-slate-500">{t(e.size)}</span>
            <span className="w-full text-[12.5px] leading-6 text-slate-400 sm:ml-2 sm:w-auto sm:flex-1">{t(e.note)}</span>
          </Card>
        ))}
      </div>

      <div className="mt-14">
        <h3 className="mb-4 text-[15px] font-semibold text-white">{t("formatsPage.try")}</h3>
        <CompareStudio showHeroCopy={false} />
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-3 text-[12px]">
      <span className="text-slate-500">{k}</span>
      <span className="truncate font-mono text-slate-300">{v}</span>
    </div>
  );
}

/** message key per family view */
function viewOf(id: string): string {
  switch (id) {
    case "docx":
      return "formats.view.docx";
    case "xlsx":
      return "formats.view.xlsx";
    case "pptx":
      return "formats.view.pptx";
    case "pdf":
      return "formats.view.pdf";
    case "code":
      return "formats.view.code";
    default:
      return "formats.view.text";
  }
}