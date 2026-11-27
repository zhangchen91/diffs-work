import * as React from "react";
import { Bot, CheckCircle2, FileCode2, FileText, GitBranch, Layers, MonitorSmartphone, Plug, Server, Wrench } from "lucide-react";
import { Badge, Card, SectionTitle } from "@/components/ui/primitives";
import { FORMATS } from "@/lib/formats";
import type { Route } from "@/lib/router";
import { useI18n } from "@diffs/i18n";

/**
 * Configuration, in the sense the docs site uses the word: every place diffs.work can be
 * embedded, and what is needed to make it work there.
 *
 * The page is one table per surface (file type / agent / IDE / git / MCP / Office), with an
 * honest status on every row: shipped, in development (at most one row may say that), planned.
 * Nothing here is a config file format yet — there is no such thing; each surface has its own
 * way in, and the contract behind it is the same.
 */
type Status = "shipped" | "dev" | "planned";

interface Row {
  id: string;
  name: string;
  /** message key: what it is */
  what: string;
  /** message key: how to turn it on */
  how: string;
  status: Status;
  /**
   * Extra detail for the shipped rows: the exact snippet, in monospace, so the page can be
   * copied from rather than transcribed from prose.
   */
  snippet?: string;
}

interface Group {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  rows: Row[];
}

export function ConfigPage({ go }: { go: (r: Route) => void }): React.ReactElement {
  const { t } = useI18n();

  const groups: Group[] = [
    {
      id: "files",
      icon: Layers,
      title: t("config.files.title"),
      desc: t("config.files.desc"),
      rows: [
        {
          id: "family",
          name: t("config.files.family.name"),
          what: t("config.files.family.what"),
          how: t("config.files.family.how"),
          status: "shipped",
        },
        {
          id: "ext",
          name: t("config.files.ext.name"),
          what: t("config.files.ext.what"),
          how: t("config.files.ext.how"),
          status: "shipped",
        },
        {
          id: "plain",
          name: t("config.files.plain.name"),
          what: t("config.files.plain.what"),
          how: t("config.files.plain.how"),
          status: "shipped",
        },
        {
          id: "new-family",
          name: t("config.files.new.name"),
          what: t("config.files.new.what"),
          how: t("config.files.new.how"),
          status: "planned",
        },
      ],
    },
    {
      id: "agents",
      icon: Bot,
      title: t("config.agents.title"),
      desc: t("config.agents.desc"),
      rows: [
        {
          id: "dsh",
          name: t("config.agents.dsh.name"),
          what: t("config.agents.dsh.what"),
          how: t("config.agents.dsh.how"),
          // Verified end to end: the tool runs, the inbox record lands, and the OpenUI card draws
          // in the transcript (`oui: true`, one row per change, including for a .docx).
          status: "shipped",
          snippet: "pnpm build:plugin && dsh plugin --profile <name> add \"$PWD/apps/dsh-plugin\"",
        },
        {
          id: "http",
          name: t("config.agents.http.name"),
          what: t("config.agents.http.what"),
          how: t("config.agents.http.how"),
          status: "shipped",
          snippet: `POST /api/diff  { "old": "a.ts", "new": "b.ts" }  →  the canonical result`
        },
        {
          id: "sdk",
          name: t("config.agents.sdk.name"),
          what: t("config.agents.sdk.what"),
          how: t("config.agents.sdk.how"),
          // Not on npm: `npm i @diffs/diff-tool` fails, which is what A3 found for the CLI too.
          status: "dev",
          snippet: `import { compareFiles } from "<repo>/packages/diff-tool/src/index.ts"`,
        },
      ],
    },
    {
      id: "ide",
      icon: MonitorSmartphone,
      title: t("config.ide.title"),
      desc: t("config.ide.desc"),
      rows: [
        {
          id: "vscode",
          name: t("config.ide.vscode.name"),
          what: t("config.ide.vscode.what"),
          how: t("config.ide.vscode.how"),
          // There is no VS Code extension in this repository and none in the marketplace; the
          // page said "shipped" and the copy told the reader to search the palette for it.
          status: "planned",
        },
        {
          id: "jetbrains",
          name: t("config.ide.jetbrains.name"),
          what: t("config.ide.jetbrains.what"),
          how: t("config.ide.jetbrains.how"),
          status: "planned",
        },
        {
          id: "neovim",
          name: t("config.ide.neovim.name"),
          what: t("config.ide.neovim.what"),
          how: t("config.ide.neovim.how"),
          status: "planned",
        },
      ],
    },
    {
      id: "vcs",
      icon: GitBranch,
      title: t("config.vcs.title"),
      desc: t("config.vcs.desc"),
      rows: [
        {
          id: "git-difftool",
          name: t("config.vcs.git.name"),
          what: t("config.vcs.git.what"),
          how: t("config.vcs.git.how"),
          status: "shipped",
          // The CLI is not on npm, so `diffs` is not on PATH either: the tool has to be pointed at
          // the built entry point, or git reports "cannot run diffs".
          snippet:
            'git config --global diff.tool diffs\n' +
            'git config --global difftool.diffs.cmd \'node apps/cli/lib/bin.js diff --open "$LOCAL" "$REMOTE"\'\n' +
            "git difftool",
        },
        {
          id: "pr-comment",
          name: t("config.vcs.pr.name"),
          what: t("config.vcs.pr.what"),
          how: t("config.vcs.pr.how"),
          status: "shipped",
        },
        {
          id: "jj",
          name: t("config.vcs.jj.name"),
          what: t("config.vcs.jj.what"),
          how: t("config.vcs.jj.how"),
          status: "planned",
          snippet: "jj config set --user ui.diff-formatter diffs",
        },
      ],
    },
    {
      id: "mcp",
      icon: Plug,
      title: t("config.mcp.title"),
      desc: t("config.mcp.desc"),
      rows: [
        {
          id: "tools",
          name: t("config.mcp.tools.name"),
          what: t("config.mcp.tools.what"),
          how: t("config.mcp.tools.how"),
          status: "shipped",
          snippet: "# 同一套工具，stdio + JSON-RPC 2.0\nnode apps/cli/lib/bin.js mcp",
        },
        {
          id: "resources",
          name: t("config.mcp.resources.name"),
          what: t("config.mcp.resources.what"),
          how: t("config.mcp.resources.how"),
          status: "planned",
        },
      ],
    },
    {
      id: "office",
      icon: FileText,
      title: t("config.office.title"),
      desc: t("config.office.desc"),
      rows: [
        {
          id: "word",
          name: t("config.office.word.name"),
          what: t("config.office.word.what"),
          how: t("config.office.word.how"),
          status: "shipped",
        },
        {
          id: "excel",
          name: t("config.office.excel.name"),
          what: t("config.office.excel.what"),
          how: t("config.office.excel.how"),
          status: "shipped",
        },
        {
          id: "ppt",
          name: t("config.office.ppt.name"),
          what: t("config.office.ppt.what"),
          how: t("config.office.ppt.how"),
          status: "shipped",
        },
        {
          id: "addin",
          name: t("config.office.addin.name"),
          what: t("config.office.addin.what"),
          how: t("config.office.addin.how"),
          status: "planned",
        },
      ],
    },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <SectionTitle kicker={t("config.kicker")} title={t("config.title")} desc={t("config.desc")} />

      <div className="mt-8 flex flex-wrap items-center gap-2">
        <Badge tone="brand">
          <CheckCircle2 className="h-3 w-3" /> {t("config.status.shipped")}
        </Badge>
        <Badge tone="warn">
          <Wrench className="h-3 w-3" /> {t("config.status.dev")}
        </Badge>
        <Badge tone="muted">{t("config.status.planned")}</Badge>
        <span className="text-[12px] text-slate-500">{t("config.status.desc")}</span>
      </div>

      <div className="mt-8 grid gap-4">
        {groups.map((g) => (
          <Card key={g.id} className="p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-panel-2">
                <g.icon className="h-4.5 w-4.5 text-brand" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-white">{g.title}</h3>
                <p className="mt-1 text-[12.5px] leading-6 text-slate-400">{g.desc}</p>
              </div>
            </div>
            <div className="mt-4 grid min-w-0 gap-2">
              {g.rows.map((r) => (
                <div key={r.id} className="min-w-0 rounded-lg border border-line/70 bg-panel-2/40 p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13.5px] font-medium text-slate-100">{r.name}</span>
                    <StatusBadge status={r.status} label={t(`config.status.${r.status === "shipped" ? "shipped" : r.status}`)} />
                  </div>
                  <p className="mt-1 break-words text-[12.5px] leading-6 text-slate-400">{r.what}</p>
                  <p className="mt-1 break-words text-[12px] leading-6 text-slate-500">{r.how}</p>
                  {r.snippet ? (
                    <pre className="scroll-thin mt-2 overflow-auto rounded border border-line bg-ink px-3 py-2 font-mono text-[11.5px] leading-5 text-emerald-200/80">
{r.snippet}
                    </pre>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <Card className="mt-4 p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <FileCode2 className="h-4.5 w-4.5 text-brand" />
          <h3 className="text-[15px] font-semibold text-white">{t("config.families.title")}</h3>
        </div>
        <p className="mt-1 text-[12.5px] leading-6 text-slate-400">{t("config.families.desc")}</p>
        <div className="mt-4 overflow-hidden rounded-lg border border-line/70">
          <div className="grid grid-cols-[1.1fr_1.6fr_1fr] gap-3 border-b border-line bg-panel-2/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <span>{t("config.families.col.family")}</span>
            <span>{t("config.families.col.ext")}</span>
            <span>{t("config.families.col.engine")}</span>
          </div>
          {FORMATS.map((f) => (
            <div key={f.id} className="grid grid-cols-[1.1fr_1.6fr_1fr] items-baseline gap-3 border-b border-line/50 px-3 py-2 text-[12px] last:border-0">
              <span className="text-slate-200">{t(f.label)}</span>
              <span className="font-mono text-[11px] text-slate-500">{f.exts.join("  ")}</span>
              <span className="font-mono text-[11px] text-slate-500">{t(f.engine).slice(0, 34)}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
          <Server className="h-4 w-4 text-brand" />
          <span>{t("config.families.foot")}</span>
          <button onClick={() => go("download")} className="text-brand hover:underline">
            {t("config.families.cta")}
          </button>
        </div>
      </Card>

      <p className="mt-8 text-center text-[12px] text-slate-600">{t("config.footnote")}</p>
    </div>
  );
}

function StatusBadge({ status, label }: { status: Status; label: string }): React.ReactElement {
  return (
    <Badge tone={status === "shipped" ? "brand" : status === "dev" ? "warn" : "muted"}>
      {label}
    </Badge>
  );
}
