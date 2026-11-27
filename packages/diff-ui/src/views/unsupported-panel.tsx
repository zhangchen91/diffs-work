import * as React from "react";
import { Download, ExternalLink, ServerOff, Terminal } from "lucide-react";
import { Badge, Button, Card } from "../lib/primitives";
import type { FormatMeta } from "../lib/formats";
import { useI18n } from "@diffs/i18n";

const LOCAL = "http://127.0.0.1:5279";

/**
 * Word/Excel/PPT/PDF are rendered by a real engine, not by the in-page text diff.
 * Rather than pretending, hand the two files to the local viewer — and say how to
 * start it when it is not running.
 */
export function UnsupportedPanel({
  meta,
  oldFile,
  newFile,
}: {
  meta: FormatMeta;
  oldFile: File | null;
  newFile: File | null;
}): React.ReactElement {
  const { t } = useI18n();
  const [alive, setAlive] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    let live = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1200);
    fetch(`${LOCAL}/api/health`, { signal: ctrl.signal, mode: "cors" })
      .then((r) => live && setAlive(r.ok))
      .catch(() => live && setAlive(false))
      .finally(() => clearTimeout(timer));
    return () => {
      live = false;
      ctrl.abort();
    };
  }, []);

  const handoff = () => {
    const oldName = oldFile?.name ?? "old";
    const nextName = newFile?.name ?? "new";
    const q = new URLSearchParams({ old: oldName, new: nextName });
    window.open(`${LOCAL}/#/compare?${q}`, "_blank", "noopener");
  };

  return (
    <Card className="border-sky-500/30 bg-sky-500/[0.05] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="default">{t(meta.label)}</Badge>
        <span className="text-[13px] text-slate-200">
          {t("unsupported.prefix", { engine: t(meta.engine), size: t(meta.engineSize) })}
        </span>
        <span className="ml-auto" />
        {alive === true ? (
          <Button size="sm" onClick={handoff}>
            <ExternalLink className="h-3.5 w-3.5" /> {t("unsupported.openLocal")}
          </Button>
        ) : null}
      </div>

      {alive === false ? (
        <div className="mt-3 rounded-lg border border-line bg-panel-2/60 p-3 text-[12.5px] leading-6 text-slate-400">
          <div className="flex items-center gap-2 text-slate-300">
            <ServerOff className="h-4 w-4 text-amber-400" /> {t("unsupported.notRunning")}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[12px] text-slate-200">node apps/cli/lib/bin.js local</code>
            <span>{t("unsupported.startHint")}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-slate-500">
            <Terminal className="h-3.5 w-3.5" /> {t("unsupported.localOnly", { url: "127.0.0.1:5279" })}
          </div>
        </div>
      ) : null}

      {alive === null ? (
        <div className="mt-3 text-[12px] text-slate-600">{t("unsupported.probing")}</div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
        <Download className="h-3.5 w-3.5" />
        {t("unsupported.textNote")}
      </div>
    </Card>
  );
}