import * as React from "react";
import {
  CheckCircle2,
  Chrome,
  Copy,
  Package,
  Puzzle,
  Server,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import { Badge, Button, Card, SectionTitle } from "@/components/ui/primitives";
import { copyText } from "@diffs/dom-utils/download";
import { useI18n } from "@diffs/i18n";

const TREE = `diffs.work/
├─ apps/website/          the site — deployed on its own to Cloudflare Pages
│  ├─ wrangler.jsonc      project = diffs-work
│  └─ src/ + public/engine/   UI + per-family engine shards
├─ apps/docs/             documentation site
├─ apps/local/            local viewer + inbox (diffs local, never deployed)
├─ apps/cli/              the diffs command
├─ apps/dsh-plugin/       DeepSeek Harness plugin (open source)
├─ apps/chrome-extension/ browser extension, MV3 (open source)
├─ packages/              diff engines + SDK (open source)
│  ├─ mf2/ i18n/          MessageFormat 2 runtime + message catalogues
│  └─ core-xlsx, core-markdown, core-code-ast, core-xml, core-text, diff-core
└─ apps/engine-core/      Rust to wasm32 kernels (closed source, binaries only)`;

export function DownloadPage(): React.ReactElement {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <SectionTitle kicker={t("download.kicker")} title={t("download.title")} desc={t("download.desc")} />

      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col p-6">
          <Chrome className="mb-4 h-6 w-6 text-brand" />
          <div className="flex items-center gap-2">
            <h3 className="text-[16px] font-semibold text-white">{t("download.ext.title")}</h3>
            <Badge tone="muted">{t("download.fromSource")}</Badge>
          </div>
          <p className="mt-2 flex-1 text-[13px] leading-6 text-slate-400">
            {t("download.ext.body", { path: "apps/chrome-extension" })}
          </p>
          <CliLine text={t("download.card.extension")} />
        </Card>

        <Card className="flex flex-col p-6">
          <Puzzle className="mb-4 h-6 w-6 text-sky-400" />
          <div className="flex items-center gap-2">
            <h3 className="text-[16px] font-semibold text-white">{t("download.dsh.title")}</h3>
            <Badge tone="brand">{t("download.available")}</Badge>
          </div>
          <p className="mt-2 flex-1 text-[13px] leading-6 text-slate-400">
            {t("download.dsh.body", { tool: "diff_compare", path: "apps/dsh-plugin" })}
          </p>
          <CliLine text={t("download.card.dsh")} />
        </Card>

        <Card className="flex flex-col p-6">
          <Server className="mb-4 h-6 w-6 text-violet-400" />
          <div className="flex items-center gap-2">
            <h3 className="text-[16px] font-semibold text-white">{t("download.selfhost.title")}</h3>
            <Badge tone="brand">{t("download.available")}</Badge>
          </div>
          <p className="mt-2 flex-1 text-[13px] leading-6 text-slate-400">{t("download.selfhost.body")}</p>
          {/* `pnpm deploy` uses the maintainer's Cloudflare token — nobody else can run it. */}
          <CliLine text="pnpm build && npx serve apps/website/out" />
        </Card>
      </div>

      <div className="mt-12">
        <h3 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-white">
          <TerminalSquare className="h-4.5 w-4.5 text-slate-400" /> {t("download.build")}
        </h3>
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-2 text-[11.5px] text-slate-500">
            <span>bash</span>
            <CopyBtn text={"pnpm install\npnpm build\npnpm --filter @diffs/website preview"} />
          </div>
          <pre className="scroll-thin overflow-auto px-4 py-3 font-mono text-[12.5px] leading-6 text-slate-300">
{`git clone <repo> diffs.work && cd diffs.work
${t("download.cmd.install")}
${t("download.cmd.build")}
${t("download.cmd.deploy")}`}
          </pre>
        </Card>
      </div>

      <div className="mt-12 grid gap-4">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold text-white">
          <Wrench className="h-4.5 w-4.5 text-slate-400" /> {t("download.tree")}
        </h3>
        <Card className="overflow-hidden">
          <pre className="scroll-thin overflow-auto px-4 py-3 font-mono text-[12px] leading-6 text-slate-400">{TREE}</pre>
        </Card>
      </div>

      <div className="mt-12 grid gap-4 md:grid-cols-2">
        <Card className="p-6">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-white">
            <CheckCircle2 className="h-4.5 w-4.5 text-brand" /> {t("download.openClose.title")}
          </h3>
          <ul className="mt-3 space-y-2 text-[13px] leading-6 text-slate-400">
            <li>
              <strong className="text-slate-200">{t("download.openClose.open")}</strong>：{t("download.openClose.openBody")}
            </li>
            <li>
              <strong className="text-slate-200">{t("download.openClose.closed")}</strong>：{t("download.openClose.closedBody")}
            </li>
            <li>{t("download.openClose.why")}</li>
          </ul>
        </Card>
        <Card className="p-6">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-white">
            <Package className="h-4.5 w-4.5 text-sky-400" /> {t("download.cdn.title")}
          </h3>
          <ul className="mt-3 space-y-2 text-[13px] leading-6 text-slate-400">
            <li>{t("download.cdn.site")}</li>
            <li>{t("download.cdn.wasm")}</li>
            <li>{t("download.cdn.registry", { field: "ENGINE_REGISTRY.base" })}</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function CliLine({ text }: { text: string }): React.ReactElement {
  return (
    <div className="mt-4 flex items-center justify-between gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-[11.5px] text-slate-500">
      <span className="truncate">{text}</span>
      <CopyBtn text={text} />
    </div>
  );
}

function CopyBtn({ text }: { text: string }): React.ReactElement {
  const { t } = useI18n();
  const [ok, setOk] = React.useState(false);
  return (
    <button
      onClick={async () => {
        const done = await copyText(text);
        setOk(done);
        setTimeout(() => setOk(false), 1400);
      }}
      className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-slate-400 hover:text-white"
    >
      <Copy className="h-3 w-3" /> {ok ? t("download.copied") : t("download.copy")}
    </button>
  );
}