/**
 * diffs.work i18n — MessageFormat 2 messages, two locales shipped, room for more.
 *
 * Adding a locale (the community path):
 *   1. copy `messages/en.ts` to `messages/<tag>.ts` and translate the values;
 *   2. add one line to `LOCALES` below;
 *   3. `pnpm test:i18n` fails until every key is present.
 *
 * Message strings are MF2 source: `{$count :number}` placeholders and
 * `.input … .match` plural selection are supported (see @diffs/mf2).
 */
import * as React from "react";
import { formatMessage, type Mf2Options } from "@diffs/mf2";

export interface LocaleMeta {
  /** BCP 47 tag, also the storage key and the html lang attribute */
  tag: string;
  /** endonym shown in the switcher */
  label: string;
  /** flag emoji or short marker shown in compact UI */
  short: string;
  dir?: "ltr" | "rtl";
}

export const LOCALES: LocaleMeta[] = [
  { tag: "zh-CN", label: "简体中文", short: "中" },
  { tag: "en", label: "English", short: "EN" },
];

export const DEFAULT_LOCALE = "zh-CN";
const STORAGE_KEY = "diffs.locale";

export type Messages = Record<string, string>;
export type MessageLoader = () => Promise<Messages>;

/** One entry per shipped locale; the loader keeps messages out of the main chunk. */
export const MESSAGE_LOADERS: Record<string, MessageLoader> = {
  "zh-CN": () => import("./messages/zh-CN").then((m) => m.default),
  en: () => import("./messages/en").then((m) => m.default),
};

/** Pick the best supported locale for a set of browser preferences. */
export function negotiate(preferred: readonly string[]): string {
  for (const raw of preferred) {
    const tag = raw.toLowerCase();
    const exact = LOCALES.find((l) => l.tag.toLowerCase() === tag);
    if (exact) return exact.tag;
    const base = tag.split("-")[0];
    const loose = LOCALES.find((l) => l.tag.toLowerCase().split("-")[0] === base);
    if (loose) return loose.tag;
  }
  return DEFAULT_LOCALE;
}

export function detectLocale(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LOCALES.some((l) => l.tag === saved)) return saved;
  } catch {
    /* private mode */
  }
  const nav = typeof navigator === "undefined" ? [] : (navigator.languages ?? [navigator.language]);
  return negotiate(nav.filter(Boolean));
}

export function rememberLocale(tag: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, tag);
  } catch {
    /* ignore */
  }
}

/** Values interpolated into a message. */
export type TParams = Record<string, string | number | Date | boolean | null | undefined>;

export interface I18n {
  locale: string;
  /** translate a key; falls back to the key itself so a gap is visible, never silent */
  t: (key: string, params?: TParams) => string;
  /** plural / select aware translate (MF2 `.match`) */
  p: (key: string, params: TParams) => string;
  setLocale: (tag: string) => Promise<void>;
  ready: boolean;
  missing: string[];
}

function clean(params?: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params ?? {})) out[k] = v as unknown;
  return out;
}

const I18nContext = React.createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [locale, setLocaleState] = React.useState<string>(() => detectLocale());
  const [messages, setMessages] = React.useState<Messages | null>(null);
  const [missing, setMissing] = React.useState<string[]>([]);

  React.useEffect(() => {
    let alive = true;
    setMessages(null);
    const load = MESSAGE_LOADERS[locale] ?? MESSAGE_LOADERS[DEFAULT_LOCALE];
    load()
      .then((m) => {
        if (!alive) return;
        setMessages(m);
        document.documentElement.lang = locale;
        document.documentElement.dir = LOCALES.find((l) => l.tag === locale)?.dir ?? "ltr";
      })
      .catch((e) => {
        console.error("[i18n] failed to load messages", e);
        if (alive) setMessages({});
      });
    return () => {
      alive = false;
    };
  }, [locale]);

  const format = React.useCallback(
    (key: string, params?: TParams): string => {
      if (!messages) return key;
      const src = messages[key];
      if (!src) {
        setMissing((prev: string[]) => (prev.includes(key) ? prev : [...prev, key]));
        return key;
      }
      const opts: Mf2Options = { locale, bidi: false };
      return formatMessage(src, clean(params), opts);
    },
    [messages, locale],
  );

  const value = React.useMemo<I18n>(
    () => ({
      locale,
      t: format,
      p: (key: string, params: TParams) => format(key, params),
      setLocale: async (tag: string) => {
        if (!LOCALES.some((l) => l.tag === tag)) return;
        rememberLocale(tag);
        setLocaleState(tag);
      },
      ready: messages !== null,
      missing,
    }),
    [locale, format, messages, missing],
  );

  // A missing key silently renders as the key itself, and that is how `compare.rustFailed` ended up
  // on screen. The list was collected and never read; in development it is now impossible to miss.
  if (missing.length && typeof console !== "undefined") {
    const seen = (globalThis as { __diffsMissingKeys?: Set<string> }).__diffsMissingKeys ?? new Set<string>();
    for (const k of missing) seen.add(k);
    (globalThis as { __diffsMissingKeys?: Set<string> }).__diffsMissingKeys = seen;
    if (!(globalThis as { __diffsMissingWarned?: boolean }).__diffsMissingWarned) {
      (globalThis as { __diffsMissingWarned?: boolean }).__diffsMissingWarned = true;
      console.warn(`[i18n] ${seen.size} message key(s) have no translation:`, [...seen].join(", "));
    }
  }

  const child = React.createElement(I18nContext.Provider, { value }, children);
  return child;
}

export function useI18n(): I18n {
  const ctx = React.useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}

/** Convenience: `const t = useT()`. */
export function useT(): I18n["t"] {
  return useI18n().t;
}