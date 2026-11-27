/** Version shown in every surface; kept in one place for the docs/website/plugin. */
export const DIFFS_VERSION = "0.2.0";

export const DIFFS_DOMAIN = "diffs.work";
export const LOCAL_DEFAULT_PORT = 5279;

/** Folder every surface may read/write (inbox spool, last diffs, settings). */
export function diffsHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.DIFFS_HOME || `${env.HOME || env.USERPROFILE || "."}/.diffs`;
}

export type { FileFamily } from "../../dom-utils/src/files";
