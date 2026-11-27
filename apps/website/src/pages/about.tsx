import * as React from "react";
import { BookOpen, GitBranch, HeartHandshake, Info, Scale } from "lucide-react";
import { Badge, Card, SectionTitle } from "@/components/ui/primitives";
import type { Route } from "@/lib/router";
import { useI18n } from "@diffs/i18n";

export function AboutPage({ go }: { go: (r: Route) => void }): React.ReactElement {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6">
      <SectionTitle
        kicker={t("about.kicker")}
        title={t("about.title")}
        desc={t("about.desc")}
      />

      <Card className="mt-10 p-7">
        <p className="text-[14px] leading-7 text-slate-300">
          {t("about.p1")}
        </p>
        <p className="mt-4 text-[14px] leading-7 text-slate-300">
          {t("about.p2")}
        </p>
      </Card>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card className="p-6">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-white">
            <GitBranch className="h-4.5 w-4.5 text-brand" /> {t("about.boundary.title")}
          </div>
          <ul className="mt-3 space-y-2 text-[13px] leading-6 text-slate-400">
            <li>· {t("download.openClose.openBody")}</li>
            <li>· {t("download.openClose.closedBody")}</li>
            <li>· {t("download.openClose.why")}</li>
          </ul>
        </Card>
        <Card className="p-6">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-white">
            <Scale className="h-4.5 w-4.5 text-sky-400" /> {t("about.licenses.title")}
          </div>
          <ul className="mt-3 space-y-2 text-[13px] leading-6 text-slate-400">
            <li>· {t("about.licenses.1")}</li>
            <li>· {t("about.licenses.2", { file: "ENGINE-LICENSE.md" })}</li>
            <li>· {t("about.licenses.3")}</li>
          </ul>
        </Card>
      </div>

      <Card className="mt-6 p-6">
        <div className="flex items-center gap-2 text-[15px] font-semibold text-white">
          <Info className="h-4.5 w-4.5 text-amber-300" /> {t("about.version.title")}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone="brand">{t("about.version.site")}</Badge>
          <Badge>{t("about.version.text")}</Badge>
          <Badge tone="muted">{t("about.version.binary")}</Badge>
        </div>
        <p className="mt-3 text-[12.5px] leading-6 text-slate-500">
          {t("about.version.note")}
        </p>
      </Card>

      <div className="mt-6 flex flex-wrap gap-3">
        <button onClick={() => go("compare")} className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel-2 px-4 py-2.5 text-[13px] text-slate-300 hover:border-slate-500">
          <HeartHandshake className="h-4 w-4" /> {t("cta.start")}
        </button>
      </div>
    </div>
  );
}