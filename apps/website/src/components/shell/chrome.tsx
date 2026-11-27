import * as React from "react";
import { ArrowRight, Github, LayoutGrid, Menu, ShieldCheck, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, Button, Logo } from "@/components/ui/primitives";
import type { Route } from "@/lib/router";
import { useI18n } from "@diffs/i18n";
import { LocaleSwitch } from "./locale-switch";
import { ThemeSwitch } from "./theme-switch";

/** Nav items carry a message key; labels come from @diffs/i18n. */
export const NAV: Array<{ id: Route; key: string }> = [
  { id: "home", key: "nav.home" },
  { id: "compare", key: "nav.compare" },
  { id: "verify", key: "nav.verify" },
  { id: "formats", key: "nav.formats" },
  { id: "how", key: "nav.how" },
  { id: "config", key: "nav.config" },
  { id: "download", key: "nav.download" },
  { id: "about", key: "nav.about" },
];

export function TopBar({
  route,
  go,
}: {
  route: Route;
  go: (r: Route) => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const { t } = useI18n();
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-ink/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <button onClick={() => go("home")} className="shrink-0" aria-label="diffs.work">
          <Logo />
        </button>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => go(n.id)}
              className={cn(
                "rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors",
                route === n.id ? "bg-white/[0.06] text-white" : "text-slate-400 hover:text-white",
              )}
            >
              {t(n.key)}
            </button>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Badge tone="brand" className="mr-1">
            <ShieldCheck className="h-3.5 w-3.5" /> {t("shell.noUploadBadge")}
          </Badge>
          <ThemeSwitch />
          <LocaleSwitch compact />
          <a
            href="https://github.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg px-2 py-2 text-slate-400 transition-colors hover:text-white"
            aria-label="GitHub"
          >
            <Github className="h-4.5 w-4.5" />
          </a>
          <Button size="sm" onClick={() => go("compare")}>
            {t("nav.openCompare")} <ArrowRight className="h-4 w-4" />
          </Button>
        </div>

        <button
          className="ml-auto rounded-lg p-2 text-slate-300 md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label={t("nav.menu")}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open ? (
        <div className="border-t border-line bg-panel px-4 py-3 md:hidden">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-slate-500">{t("locale.switch")}</span>
            <LocaleSwitch />
          </div>
          <div className="grid gap-1">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  go(n.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex items-center justify-between rounded-lg px-3 py-2.5 text-sm",
                  route === n.id ? "bg-white/[0.06] text-white" : "text-slate-300",
                )}
              >
                {t(n.key)}
                <ArrowRight className="h-4 w-4 opacity-50" />
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </header>
  );
}

export function Footer({ go }: { go: (r: Route) => void }): React.ReactElement {
  const { t } = useI18n();
  const cols: Array<{ title: string; items: Array<{ key: string; route?: Route; href?: string }> }> = [
    {
      title: "shell.footer.col.product",
      items: [
        { key: "nav.compare", route: "compare" },
        { key: "nav.formats", route: "formats" },
        { key: "nav.how", route: "how" },
      ],
    },
    {
      title: "shell.footer.col.integrate",
      items: [
        { key: "shell.footer.extension", route: "download" },
        { key: "shell.footer.dsh", route: "download" },
        { key: "shell.footer.cli", route: "download" },
      ],
    },
    {
      title: "shell.footer.col.learn",
      items: [
        { key: "shell.footer.about", route: "about" },
        { key: "shell.footer.docs", href: "https://docs.diffs.work" },
        { key: "shell.footer.github", href: "https://github.com/zhangchen91/diffs-work" },
      ],
    },
  ];
  return (
    <footer className="border-t border-line/70 bg-ink">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-[13.5px] leading-6 text-slate-500">{t("shell.tagline")}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge tone="muted">
                <Sparkles className="h-3 w-3" /> {t("shell.version")}
              </Badge>
              <Badge tone="muted">
                <LayoutGrid className="h-3 w-3" /> {t("shell.count")}
              </Badge>
            </div>
          </div>
          {cols.map((c) => (
            <div key={c.title}>
              <div className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-slate-500">{t(c.title)}</div>
              <ul className="space-y-2">
                {c.items.map((it) => (
                  <li key={it.key}>
                    {it.href ? (
                      <a href={it.href} className="text-[13.5px] text-slate-400 hover:text-white">
                        {t(it.key)}
                      </a>
                    ) : (
                      <button
                        onClick={() => it.route && go(it.route)}
                        className="text-left text-[13.5px] text-slate-400 hover:text-white"
                      >
                        {t(it.key)}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-line/70 pt-6 text-[12.5px] text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <span>{t("shell.footer.rights", { year: new Date().getFullYear() })}</span>
          <span>{t("shell.footer.tagline")}</span>
        </div>
      </div>
    </footer>
  );
}
