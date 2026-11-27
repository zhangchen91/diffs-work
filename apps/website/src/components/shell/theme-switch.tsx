import * as React from "react";
import { Check, Palette } from "lucide-react";
import { THEMES, applyTheme, loadTheme, rememberTheme, type ThemeId } from "@/lib/theme";
import { useI18n } from "@diffs/i18n";
import { cn } from "@/lib/utils";

/**
 * Theme switch: three swatches in a popover. The choice is remembered and applied
 * to <html> so every token-driven utility follows it without a re-render.
 */
export function ThemeSwitch(): React.ReactElement {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const [theme, setTheme] = React.useState<ThemeId>(() => (typeof window === "undefined" ? "obsidian" : loadTheme()));
  const boxRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    applyTheme(theme);
    rememberTheme(theme);
  }, [theme]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = THEMES.find((x) => x.id === theme) ?? THEMES[0];

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("theme.label")}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg border border-line bg-panel-2/70 px-2 py-1.5 text-[12px] text-slate-400 transition-colors hover:text-slate-200"
      >
        <Palette className="h-3.5 w-3.5" />
        <span className="flex gap-0.5">
          {current.swatch.map((c) => (
            <span key={c} className="h-2.5 w-2.5 rounded-sm border border-black/20" style={{ background: c }} />
          ))}
        </span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
        >
          <div className="border-b border-line px-3 py-2 text-[11px] uppercase tracking-[0.14em] text-slate-500">
            {t("theme.label")}
          </div>
          {THEMES.map((th) => (
            <button
              key={th.id}
              role="menuitemradio"
              aria-checked={th.id === theme}
              onClick={() => {
                setTheme(th.id);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors",
                th.id === theme ? "bg-white/[0.06] text-slate-200" : "text-slate-400 hover:bg-white/[0.03] hover:text-slate-200",
              )}
            >
              <span className="flex shrink-0 gap-0.5">
                {th.swatch.map((c) => (
                  <span key={c} className="h-4 w-2 rounded-sm border border-black/20" style={{ background: c }} />
                ))}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{t(th.label)}</span>
                <span className="block truncate text-[11px] text-slate-600">{t(th.hint)}</span>
              </span>
              {th.id === theme ? <Check className="h-3.5 w-3.5 shrink-0 text-brand" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}