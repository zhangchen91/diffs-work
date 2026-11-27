import * as React from "react";
import { Cpu, ExternalLink, FileCheck2, Github, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge, Card, SectionTitle } from "@/components/ui/primitives";
import { ENGINE_PLAN } from "@/lib/engine-plan";
import { cn } from "@/lib/utils";
import { useI18n } from "@diffs/i18n";

export function HowPage(): React.ReactElement {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <SectionTitle
        kicker={t("howPage.kicker")}
        title={t("howPage.title")}
        desc={t("howPage.desc")}
      />

      <Card className="mt-10 overflow-hidden">
        <div className="grid gap-1 p-5 sm:p-8">
          <FlowRow n="01" title={t("howPage.step1")} body={t("howPage.step1.body")} icon={FileCheck2} />
          <FlowRow n="02" title={t("howPage.step2")} body={t("howPage.step2.body")} icon={RefreshCw} />
          <FlowRow n="03" title={t("howPage.step3")} body={t("howPage.step3.body")} icon={Cpu} />
          <FlowRow n="04" title={t("howPage.step4")} body={t("howPage.step4.body")} icon={ShieldCheck} last />
        </div>
      </Card>

      <div className="mt-14">
        <h3 className="text-[15px] font-semibold text-white">{t("howPage.plan.title")}</h3>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-6 text-slate-400">{t("howPage.plan.desc")}</p>
        <div className="mt-5 grid gap-3">
          {ENGINE_PLAN.map((g) => (
            <Card key={g.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[13px] text-slate-100">{g.id}</span>
                <Badge tone={g.status === "ready" ? "brand" : g.status === "lazy" ? "default" : "muted"}>
                  {g.status === "ready" ? t("formatsPage.ready") : g.status === "lazy" ? t("formats.status.lazy") : t("formats.status.planned")}
                </Badge>
                <span className="ml-auto font-mono text-[11.5px] text-slate-500">{t(g.size)}</span>
              </div>
              <p className="mt-1.5 text-[12.5px] leading-6 text-slate-400">{t(g.note)}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {g.files.map((f) => (
                  <code
                    key={f.path}
                    className={cn(
                      "rounded border border-line bg-panel-2 px-1.5 py-0.5 text-[11px]",
                      g.status === "ready" ? "text-emerald-300/80" : "text-slate-500",
                    )}
                  >
                    {f.path} <span className="text-slate-600">{t(f.size)}</span>
                  </code>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>

      <div className="mt-14 grid gap-4 md:grid-cols-2">
        <Card className="p-6">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-white">
            <ShieldCheck className="h-4.5 w-4.5 text-brand" /> {t("howPage.verify.title")}
          </div>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-[13px] leading-6 text-slate-400">
            <li>{t("howPage.verify.1")}</li>
            <li>{t("howPage.verify.2")}</li>
            <li>{t("howPage.verify.3")}</li>
          </ol>
        </Card>
        <Card className="p-6">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-white">
            <Github className="h-4.5 w-4.5 text-slate-300" /> {t("howPage.open.title")}
          </div>
          <p className="mt-3 text-[13px] leading-6 text-slate-400">
            {t("howPage.open.body")}
          </p>
          <a
            href="/docs"
            className="mt-3 inline-flex items-center gap-1 text-[12.5px] text-brand hover:underline"
          >
            {t("howPage.open.link")} <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </Card>
      </div>
    </div>
  );
}

function FlowRow({
  n,
  title,
  body,
  icon: Icon,
  last,
}: {
  n: string;
  title: string;
  body: string;
  icon: typeof Cpu;
  last?: boolean;
}): React.ReactElement {
  return (
    <div className={cn("flex gap-4 py-4", !last && "border-b border-line/60")}>
      <div className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-panel-2">
        <Icon className="h-4.5 w-4.5 text-brand" />
      </div>
      <div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-slate-600">{n}</span>
          <span className="text-[14px] font-semibold text-white">{title}</span>
        </div>
        <p className="mt-1 text-[12.5px] leading-6 text-slate-400">{body}</p>
      </div>
    </div>
  );
}