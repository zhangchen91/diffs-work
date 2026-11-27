/**
 * Non-React locale surface: negotiation + the message catalogue list.
 * Kept separate so CLI/tests/plugins can use it without pulling React in.
 */
export { LOCALES, DEFAULT_LOCALE, MESSAGE_LOADERS, negotiate, detectLocale, rememberLocale } from "./index.tsx";
