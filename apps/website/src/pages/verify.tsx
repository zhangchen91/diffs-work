import * as React from "react";
import { ArrowRight, CheckCheck, CircleDashed, FileDiff, Hammer, Quote } from "lucide-react";
import { Badge, Button, Card, SectionTitle } from "@/components/ui/primitives";
import { CompareStudio } from "@/components/compare/studio";
import type { Route } from "@/lib/router";
import { useI18n } from "@diffs/i18n";

/**
 * Where verification stands — the long form.
 *
 * The section on the home page is the argument; this page answers "so what exactly is verified,
 * what is not yet, and what can I plug in today". It is deliberately honest about the gap
 * between "a diff exists" and "a change is proven correct": a diff proves what changed, it does
 * not prove the change is right.
 */
export function VerifyPage({ go }: { go: (r: Route) => void }): React.ReactElement {
  const { t } = useI18n();
  const today = ["1", "2", "3", "4"];
  const gaps = ["1", "2", "3"];
  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <SectionTitle kicker={t("verifyPage.kicker")} title={t("verifyPage.title")} desc={t("verifyPage.desc")} />

      <Card className="mt-10 border-brand/30 bg-brand/[0.04] p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <Quote className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
          <div>
            <p className="text-[15px] leading-7 text-slate-200">{t("verifyPage.quote")}</p>
            <p className="mt-3 text-[13px] leading-6 text-slate-400">{t("verifyPage.quoteBody")}</p>
          </div>
        </div>
      </Card>

      <div className="mt-12 grid gap-4 lg:grid-cols-2">
        <Card className="p-6">
          <div className="flex items-center gap-2">
            <CheckCheck className="h-4.5 w-4.5 text-emerald-400" />
            <span className="text-[15px] font-semibold text-white">{t("verifyPage.today.title")}</span>
            <Badge tone="brand">{t("verifyPage.today.badge")}</Badge>
          </div>
          <ul className="mt-4 space-y-3">
            {today.map((n) => (
              <li key={n} className="flex gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/80" />
                <div>
                  <div className="text-[13.5px] font-medium text-slate-200">{t("verifyPage.today." + n + ".title")}</div>
                  <p className="mt-0.5 text-[12.5px] leading-6 text-slate-400">{t("verifyPage.today." + n + ".body")}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-6">
          <div className="flex items-center gap-2">
            <CircleDashed className="h-4.5 w-4.5 text-amber-400" />
            <span className="text-[15px] font-semibold text-white">{t("verifyPage.gap.title")}</span>
            <Badge tone="muted">{t("verifyPage.gap.badge")}</Badge>
          </div>
          <ul className="mt-4 space-y-3">
            {gaps.map((n) => (
              <li key={n} className="flex gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/70" />
                <div>
                  <div className="text-[13.5px] font-medium text-slate-200">{t("verifyPage.gap." + n + ".title")}</div>
                  <p className="mt-0.5 text-[12.5px] leading-6 text-slate-400">{t("verifyPage.gap." + n + ".body")}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-4 p-6">
        <div className="flex items-center gap-2">
          <FileDiff className="h-4.5 w-4.5 text-brand" />
          <span className="text-[15px] font-semibold text-white">{t("verifyPage.contract.title")}</span>
        </div>
        <p className="mt-1.5 max-w-3xl text-[13px] leading-6 text-slate-400">{t("verifyPage.contract.desc")}</p>
        <pre className="scroll-thin mt-4 overflow-auto rounded-lg border border-line bg-ink p-4 text-[12px] leading-6 text-slate-300">
{`POST /api/diff
{
  "kind": "code",                    // or docx | xlsx | pptx | pdf | markdown | text
  "before": { "name": "a.ts", "text": "…" },
  "after":  { "name": "b.ts", "text": "…" }
}

→ { "schema": "diffs.work/portable@1", "summary": {…}, "hunks": [ … ] }`}
        </pre>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button variant="outline" size="sm" onClick={() => go("download")}>
            {t("verifyPage.contract.cta")} <ArrowRight className="h-4 w-4" />
          </Button>
          <a
            href="https://docs.diffs.work/reference/tool-contract/"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-slate-300 hover:border-slate-500"
          >
            {t("verifyPage.contract.docs")}
          </a>
        </div>
      </Card>

      
      <Card className="mt-12 flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
        <Hammer className="h-5 w-5 text-brand" />
        <p className="flex-1 text-[13px] leading-6 text-slate-400">{t("verifyPage.build")}</p>
        <Button size="sm" onClick={() => go("compare")}>
          {t("verifyPage.buildCta")} <ArrowRight className="h-4 w-4" />
        </Button>
      </Card>

      <div className="mt-12 border-t border-line/60 pt-8 text-center text-[12px] text-slate-600">
        {t("verifyPage.footer")}
      </div>
    </div>
  );
}