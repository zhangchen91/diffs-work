import * as React from "react";
import {
  ArrowRight,
  Ban,
  Boxes,
  Cpu,
  FileDiff,
  Gauge,
  GitCompareArrows,
  Layers,
  Lock,
  MousePointerClick,
  Package,
  Rocket,
  ShieldCheck,
  Split,
  Sparkles,
  WifiOff,
  Zap,
} from "lucide-react";
import { Badge, Button, Card, SectionTitle } from "@/components/ui/primitives";
import { FORMATS, formatMeta } from "@/lib/formats";
import { ENGINE_REGISTRY } from "@diffs/engine-bundle";
import { CompareStudio } from "@/components/compare/studio";
import type { Route } from "@/lib/router";
import { useI18n } from "@diffs/i18n";
import { cn } from "@/lib/utils";

export function HomeHero({ go }: { go: (r: Route) => void }): React.ReactElement {
  const { t } = useI18n();
  return (
    <section className="relative overflow-hidden border-b border-line/60">
      <div className="glow pointer-events-none absolute inset-0" />
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent_78%)]" />
      <div className="relative mx-auto max-w-7xl px-4 pb-14 pt-16 sm:px-6 sm:pt-24 text-center">
        <div className="mx-auto mb-6 flex w-fit items-center gap-2 rounded-full border border-line bg-panel/80 px-3 py-1 text-[12px] text-slate-300">
          <span className="h-1.5 w-1.5 rounded-full bg-brand pulse-dot" />
          {t("hero.badge")}
        </div>
        <h1 className="animate-fade-up text-balance text-[34px] font-semibold leading-[1.15] tracking-tight sm:text-[52px]">
          <span className="bg-gradient-to-br from-white via-white to-slate-500 bg-clip-text text-transparent">
            {t("hero.title1")}
          </span>
          <br />
          <span className="bg-gradient-to-r from-brand via-teal-300 to-sky-400 bg-clip-text text-transparent">
            {t("hero.title2")}
          </span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-pretty text-[15.5px] leading-7 text-slate-400">
          {t("hero.desc")}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" onClick={() => go("compare")}>
            <GitCompareArrows className="h-4.5 w-4.5" /> {t("hero.cta.compare")}
          </Button>
          <Button size="lg" variant="outline" onClick={() => go("how")}>
            <Cpu className="h-4.5 w-4.5" /> {t("hero.cta.how")}
          </Button>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[12.5px] text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-400/80" /> {t("hero.trust.noupload")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <WifiOff className="h-4 w-4 text-sky-400/80" /> {t("hero.trust.offline")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Zap className="h-4 w-4 text-amber-400/80" /> {t("hero.trust.lazy")}
          </span>
          {/* The OCR badge was here. There is no OCR implementation: a scanned PDF reports that
              it has no text layer, and nothing recognises the pixels. The badge is removed rather
              than the feature faked. */}
        </div>

        <div className="mx-auto mt-12 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            // Counted from `lib/formats.ts`: seven families that compare today (the eighth
            // entry is the legacy-office notice, which has no engine) and one module per family.
            { k: "7", v: "hero.stat.families" },
            { k: "7", v: "hero.stat.engines" },
            { k: "0", v: "hero.stat.uploads" },
            { k: "100%", v: "hero.stat.local" },
          ].map((s) => (
            <Card key={s.v} className="px-4 py-3">
              <div className="text-xl font-semibold tracking-tight text-white">{s.k}</div>
              <div className="mt-0.5 text-[11.5px] text-slate-500">{t(s.v)}</div>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FormatsGrid({ go }: { go: (r: Route) => void }): React.ReactElement {
  const { t } = useI18n();
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
      <SectionTitle
        kicker={t("formats.kicker")}
        title={t("formats.title")}
        desc={t("formats.desc")}
      />
      <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FORMATS.map((f) => (
          <Card key={f.id} className="group relative overflow-hidden p-5 transition-colors hover:border-slate-600">
            <div
              className="absolute inset-x-0 top-0 h-px opacity-70"
              style={{ background: `linear-gradient(90deg, transparent, ${f.accent}, transparent)` }}
            />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[15px] font-semibold text-white">{t(f.label)}</div>
                {/* One line, always: a family with 36 extensions wrapped to five rows and made
                    its card twice as tall as the others, and the badge beside it wrapped too. The
                    full list is on the formats page; here it is a hint. */}
                <div className="mt-1 truncate font-mono text-[11.5px] text-slate-500" title={f.exts.join("  ")}>
                  {f.exts.join("  ")}
                </div>
              </div>
              <span className="shrink-0 whitespace-nowrap">
                {f.live ? (
                  <Badge tone="brand">{t("formats.live")}</Badge>
                ) : (
                  <Badge tone="muted">{t("formats.lazy")}</Badge>
                )}
              </span>
            </div>
            <p className="mt-3 text-[13px] leading-6 text-slate-400">{t(`formats.${f.id}.blurb`)}</p>
            <div className="mt-4 flex items-center justify-between border-t border-line/70 pt-3 text-[11.5px]">
              <span className="font-mono text-slate-500">{t(f.engine)}</span>
              <span className="text-slate-600">{t(f.engineSize)}</span>
            </div>
          </Card>
        ))}
        <Card className="flex flex-col justify-between border-dashed p-5">
          <div>
            <div className="text-[15px] font-semibold text-white">{t("formats.more.title")}</div>
            <p className="mt-2 text-[13px] leading-6 text-slate-400">
              {t("formats.more.body")}
            </p>
          </div>
          <Button variant="ghost" size="sm" className="mt-4 w-fit px-0" onClick={() => go("about")}>
            {t("formats.more.cta")} <ArrowRight className="h-4 w-4" />
          </Button>
        </Card>
      </div>
    </section>
  );
}

export function WhyLocal(): React.ReactElement {
  const { t } = useI18n();
  const items = [
    {
      icon: Ban,
      title: t("why.upload.title"),
      body: t("why.upload.body"),
    },
    {
      icon: Lock,
      title: t("why.secret.title"),
      body: t("why.secret.body"),
    },
    {
      icon: Cpu,
      title: t("why.wasm.title"),
      body: t("why.wasm.body"),
    },
  ];
  return (
    <section className="border-y border-line/60 bg-panel/30">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <SectionTitle
          kicker={t("why.kicker")}
          title={t("why.title")}
          desc={t("why.desc")}
        />
        <div className="mt-10 grid gap-3 md:grid-cols-3">
          {items.map((it) => (
            <Card key={it.title} className="p-6">
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-panel-2">
                <it.icon className="h-5 w-5 text-brand" />
              </div>
              <div className="text-[15px] font-semibold text-white">{it.title}</div>
              <p className="mt-2 text-[13px] leading-6 text-slate-400">{it.body}</p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

export function EnginePlan(): React.ReactElement {
  const { t } = useI18n();
  const rows = Object.values(ENGINE_REGISTRY);
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
      <SectionTitle
        kicker={t("engines.kicker")}
        title={t("engines.title")}
        desc={t("engines.desc")}
      />
      <Card className="mt-10 overflow-hidden">
        <div className="grid grid-cols-[1.1fr_1.4fr_1fr_0.8fr] gap-3 border-b border-line px-5 py-3 text-[11.5px] font-semibold uppercase tracking-wider text-slate-500">
          <span>{t("engines.col.engine")}</span>
          <span>{t("engines.col.families")}</span>
          <span>{t("engines.col.path")}</span>
          <span>{t("engines.col.size")}</span>
        </div>
        {rows.map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-[1.1fr_1.4fr_1fr_0.8fr] items-center gap-3 border-b border-line/60 px-5 py-3 text-[12.5px] last:border-0 hover:bg-white/[0.02]"
          >
            <span className="font-mono text-slate-200">{r.id}</span>
            <span className="text-slate-400">{r.families.join(" · ")}</span>
            <span className="truncate font-mono text-[11.5px] text-slate-500">{r.base}</span>
            <span className="text-slate-500">{t(r.size)}</span>
          </div>
        ))}
      </Card>
      <p className="mt-3 text-center text-[12px] text-slate-600">
        {t("engines.footnote")}
      </p>
    </section>
  );
}

export function HowItWorks(): React.ReactElement {
  const { t } = useI18n();
  const steps = [
    {
      icon: Package,
      title: t("how.step1.title"),
      body: t("how.step1.body"),
    },
    {
      icon: Layers,
      title: t("how.step2.title"),
      body: t("how.step2.body"),
    },
    {
      icon: Split,
      title: t("how.step3.title"),
      body: t("how.step3.body"),
    },
    {
      icon: FileDiff,
      title: t("how.step4.title"),
      body: t("how.step4.body"),
    },
  ];
  return (
    <section className="border-t border-line/60 bg-panel/30">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <SectionTitle kicker={t("how.kicker")} title={t("how.title")} />
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <Card key={s.title} className="relative p-5">
              <s.icon className="mb-3 h-5 w-5 text-brand" />
              <div className="text-[14px] font-semibold text-white">{s.title}</div>
              <p className="mt-1.5 text-[12.5px] leading-6 text-slate-400">{s.body}</p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Roadmap(): React.ReactElement {
  const { t } = useI18n();
  const items = [
    {
      icon: Sparkles,
      tag: t("roadmap.shipped"),
      title: t("roadmap.compare.title"),
      body: t("roadmap.compare.body"),
      tone: "brand" as const,
    },
    {
      // shipped, and the only two rows that are not: the extension, the Harness plugin and the
      // CLI are all usable today; MCP is the one being built, and an Office add-in is planned.
      icon: Boxes,
      tag: t("roadmap.shipped"),
      title: t("roadmap.dsh.title"),
      body: t("roadmap.dsh.body"),
      tone: "brand" as const,
    },
    {
      icon: MousePointerClick,
      tag: t("roadmap.shipped"),
      title: t("roadmap.ext.title"),
      body: t("roadmap.ext.body"),
      tone: "brand" as const,
    },
    {
      icon: Gauge,
      tag: t("roadmap.shipped"),
      title: t("roadmap.selfhost.title"),
      body: t("roadmap.selfhost.body"),
      tone: "brand" as const,
    },
    {
      icon: Boxes,
      tag: t("roadmap.shipped"),
      title: t("roadmap.mcp.title"),
      body: t("roadmap.mcp.body"),
      tone: "brand" as const,
    },
    {
      icon: Boxes,
      tag: t("roadmap.planned"),
      title: t("roadmap.addin.title"),
      body: t("roadmap.addin.body"),
      tone: "muted" as const,
    },
  ];
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
      <SectionTitle kicker={t("roadmap.kicker")} title={t("roadmap.title")} desc={t("roadmap.desc")} />
      <div className="mt-10 grid gap-3 sm:grid-cols-2">
        {items.map((it) => (
          <Card key={it.title} className="flex gap-4 p-5">
            <div className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-panel-2">
              <it.icon className="h-4.5 w-4.5 text-brand" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold text-white">{it.title}</span>
                <Badge tone={it.tone}>{it.tag}</Badge>
              </div>
              <p className="mt-1.5 text-[12.5px] leading-6 text-slate-400">{it.body}</p>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

export function TryNow(): React.ReactElement {
  const { t } = useI18n();
  return (
    <section className="border-t border-line/60 bg-panel/30">
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <SectionTitle kicker={t("try.kicker")} title={t("try.title")} desc={t("try.desc")} />
        <div className="mt-8">
          <CompareStudio showHeroCopy={false} />
        </div>
      </div>
    </section>
  );
}

export function CTA({ go }: { go: (r: Route) => void }): React.ReactElement {
  const { t } = useI18n();
  return (
    <section className="relative overflow-hidden border-t border-line/60">
      <div className="glow pointer-events-none absolute inset-0 opacity-70" />
      <div className="relative mx-auto flex max-w-4xl flex-col items-center px-4 py-20 text-center sm:px-6">
        <Rocket className="mb-4 h-7 w-7 text-brand" />
        <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("cta.title")}
        </h2>
        <p className="mt-3 max-w-xl text-[14.5px] leading-7 text-slate-400">
          {t("cta.body")}
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Button size="lg" onClick={() => go("compare")}>
            {t("cta.start")} <ArrowRight className="h-4 w-4" />
          </Button>
          <Button size="lg" variant="outline" onClick={() => go("download")}>
            {t("cta.download")}
          </Button>
        </div>
      </div>
    </section>
  );
}

export function FamilyBadge({ family }: { family: string }): React.ReactElement {
  const m = formatMeta(family as never);
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]")} style={{ color: m.accent }}>
      {m.label}
    </span>
  );
}