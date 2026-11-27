import * as React from "react";
import { ArrowRight, Github, LayoutGrid, Menu, ShieldCheck, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, Button, Logo } from "@/components/ui/primitives";
import type { Route } from "@/lib/router";
import { useI18n } from "@diffs/i18n";
import { LocaleSwitch } from "./locale-switch";

export const NAV: Array<{ id: Route; key: string }> = [
  { id: "home", key: "local.nav.home" },
  { id: "compare", key: "local.nav.compare" },
  { id: "inbox", key: "local.nav.inbox" },
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
        <button onClick={() => go("home")} className="shrink-0" aria-label="diffs.work 首页">
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
            <ShieldCheck className="h-3.5 w-3.5" /> {t("shell.localBadge")}
          </Badge>
          <LocaleSwitch compact />
          <a
            href="https://diffs.work"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg px-2 py-2 text-slate-400 transition-colors hover:text-white"
            aria-label="diffs.work"
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
          aria-label="菜单"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open ? (
        <div className="border-t border-line bg-panel px-4 py-3 md:hidden">
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


export function Footer(): React.ReactElement {
  const { t } = useI18n();
  return (
    <footer className="border-t border-line/70 px-4 py-6 text-center text-[11.5px] text-slate-600">
      {t("local.footer")}
    </footer>
  );
}
