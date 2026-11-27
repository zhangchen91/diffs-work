import * as React from "react";
import { Activity, ArrowRight, FileDiff, Inbox, RefreshCw, ServerOff, ShieldCheck } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { useHealth, useInbox, type InboxItem } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useI18n } from "@diffs/i18n";

export function InboxPage({ goCompare }: { goCompare: (old?: string, next?: string) => void }): React.ReactElement {
  const { t } = useI18n();
  const health = useHealth();
  const { items, error, reload } = useInbox();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Inbox className="h-5 w-5 text-brand" /> {t("local.inbox.title")}
          </h1>
          <p className="mt-1 max-w-2xl text-[13.5px] leading-6 text-slate-400">
            {t("local.inbox.desc")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={health.ok ? "brand" : "warn"}>
            {health.ok ? <Activity className="h-3.5 w-3.5" /> : <ServerOff className="h-3.5 w-3.5" />}
            {health.ok ? t("local.inbox.online") : t("local.inbox.offline")}
          </Badge>
          <Button size="sm" variant="outline" onClick={reload}>
            <RefreshCw className="h-3.5 w-3.5" /> {t("local.inbox.refresh")}
          </Button>
        </div>
      </div>

      {health.cwd ? (
        <div className="mt-3 font-mono text-[11.5px] text-slate-600">cwd: {health.cwd}</div>
      ) : null}

      {error ? (
        <Card className="mt-6 border-amber-500/30 bg-amber-500/[0.06] p-4 text-[13px] text-amber-200">
          {t("local.inbox.error", { error })}
        </Card>
      ) : null}

      <div className="mt-6 grid gap-2">
        {items.length === 0 && !error ? (
          <Card className="flex flex-col items-center gap-2 p-10 text-center text-slate-500">
            <Inbox className="h-6 w-6 opacity-60" />
            <div className="text-[13.5px]">{t("local.inbox.empty")}</div>
            <div className="text-[12px] text-slate-600">{t("local.inbox.emptyHint")}</div>
          </Card>
        ) : null}
        {items.map((it) => (
          <InboxRow key={it.id} item={it} onOpen={() => goCompare(it.old?.path, it.new?.path)} />
        ))}
      </div>
    </div>
  );
}

function InboxRow({ item, onOpen }: { item: InboxItem; onOpen: () => void }): React.ReactElement {
  const { t, locale } = useI18n();
  const when = new Date(item.createdAt);
  return (
    <Card className="flex flex-wrap items-center gap-3 p-4 transition-colors hover:border-slate-600">
      <FileDiff className="h-4.5 w-4.5 shrink-0 text-brand" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] text-slate-100">{item.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11.5px] text-slate-500">
          <span className="truncate">{item.old?.label ?? "—"}</span>
          <ArrowRight className="h-3 w-3" />
          <span className="truncate">{item.new?.label ?? "—"}</span>
        </div>
      </div>
      <Badge tone="muted">{item.source}</Badge>
      <span className="text-[11.5px] text-slate-600">{when.toLocaleString(locale)}</span>
      <Button size="sm" variant="outline" onClick={onOpen}>
        {t("local.inbox.open")}
      </Button>
    </Card>
  );
}

export function LocalHome({ goCompare, goInbox }: { goCompare: () => void; goInbox: () => void }): React.ReactElement {
  const { t } = useI18n();
  const health = useHealth();
  // An entry page, not a second comparison screen. This used to render the whole CompareStudio
  // under a different heading, so `/` and `#/compare` were the same product twice — the reported
  // "why are these two pages the same". The comparing itself happens on `/compare`, where the URL
  // can carry the pair.
  const doors = [
    { id: "compare", title: t("local.home.door.compare"), desc: t("local.home.door.compare.desc"), go: goCompare, key: "C" },
    { id: "inbox", title: t("local.home.door.inbox"), desc: t("local.home.door.inbox.desc"), go: goInbox, key: "I" },
  ];
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("local.home.title")}</h1>
          <p className="mt-1.5 max-w-2xl text-[13.5px] leading-6 text-slate-400">{t("local.home.desc")}</p>
        </div>
        <Badge tone={health.ok ? "brand" : "warn"}>
          <ShieldCheck className="h-3.5 w-3.5" /> {health.ok ? t("local.home.online") : t("local.home.static")}
        </Badge>
      </div>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {doors.map((d) => (
          <button
            key={d.id}
            onClick={d.go}
            className="group rounded-lg border border-line bg-panel-2/60 p-4 text-left transition-colors hover:border-brand/50 hover:bg-panel-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-medium text-slate-100">{d.title}</span>
              <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-slate-500">{d.key}</span>
            </div>
            <p className="mt-1.5 text-[12.5px] leading-5 text-slate-400">{d.desc}</p>
          </button>
        ))}
      </div>
      <div className="mt-8 text-[12px] text-slate-500">
        <div className="mb-2">{t("local.home.from")}</div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-md border border-line bg-panel-2 px-2 py-1 font-mono">diffs diff a.md b.md</span>
          <span className="rounded-md border border-line bg-panel-2 px-2 py-1 font-mono">git difftool</span>
          <span className="rounded-md border border-line bg-panel-2 px-2 py-1 font-mono">diff_compare (DSH)</span>
        </div>
      </div>
    </div>
  );
}