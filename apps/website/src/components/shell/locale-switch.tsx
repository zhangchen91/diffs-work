import * as React from "react";
import { Languages, Check } from "lucide-react";
import { LOCALES, useI18n } from "@diffs/i18n";
import { cn } from "@/lib/utils";

/**
 * Language switcher: a compact button that lists `LOCALES`. Adding a locale to
 * @diffs/i18n makes it appear here with no change to this component.
 */
export function LocaleSwitch({ compact = false }: { compact?: boolean }): React.ReactElement {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const current = LOCALES.find((l) => l.tag === locale) ?? LOCALES[0];

  React.useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-[12.5px] text-slate-300 transition-colors hover:border-slate-500 hover:text-white",
          compact && "px-2",
        )}
        aria-label={t("locale.switch")}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Languages className="h-3.5 w-3.5" />
        <span>{compact ? current.short : current.label}</span>
      </button>
      {open ? (
        <ul
          role="listbox"
          className="absolute right-0 top-full z-50 mt-1 w-36 overflow-hidden rounded-lg border border-line bg-panel shadow-xl"
        >
          {LOCALES.map((l) => (
            <li key={l.tag}>
              <button
                role="option"
                aria-selected={l.tag === locale}
                onClick={() => {
                  void setLocale(l.tag);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-2 text-left text-[13px]",
                  l.tag === locale ? "bg-white/[0.06] text-white" : "text-slate-300 hover:bg-white/[0.04]",
                )}
              >
                {l.label}
                {l.tag === locale ? <Check className="h-3.5 w-3.5 text-brand" /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}