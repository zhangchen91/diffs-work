/**
 * The slice of the WebExtension API this extension actually calls.
 *
 * Written by hand instead of pulling `@types/chrome` (a ~40 MB dependency for eight
 * members): the surface is small and typed strictly here, which also keeps the
 * extension honest about what it is allowed to touch.
 */

export interface ContextMenuCreateProps {
  id?: string;
  title: string;
  contexts: Array<"link" | "selection" | "page" | "action">;
  parentId?: string;
  targetUrlPatterns?: string[];
  documentUrlPatterns?: string[];
  visible?: boolean;
  enabled?: boolean;
}

export interface ContextMenuClickInfo {
  menuItemId: string | number;
  linkUrl?: string;
  selectionText?: string;
  pageUrl?: string;
  frameId?: number;
}

export interface StorageArea {
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, any>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface OnMessageListener {
  (message: any, sender: { tab?: { id?: number }; url?: string }, sendResponse: (response?: any) => void): boolean | void;
}

export interface OnClickListener<T> {
  addListener(cb: (info: T, tab?: { id?: number; url?: string }) => void): void;
}

export interface ChromeApi {
  runtime: {
    onInstalled: { addListener(cb: (details: { reason: string }) => void): void };
    onMessage: { addListener(cb: OnMessageListener): void };
    sendMessage(message: unknown): Promise<any>;
    getURL(path: string): string;
    lastError?: { message?: string };
  };
  contextMenus: {
    create(props: ContextMenuCreateProps, cb?: () => void): string | number;
    removeAll(cb?: () => void): void;
    onClicked: OnClickListener<ContextMenuClickInfo>;
  };
  tabs: {
    create(props: { url: string; active?: boolean }): Promise<{ id?: number }>;
  };
  storage: {
    local: StorageArea;
    session: StorageArea;
    sync: StorageArea;
  };
  action: {
    setBadgeText(details: { text: string; tabId?: number }): Promise<void>;
    setBadgeBackgroundColor(details: { color: string; tabId?: number }): Promise<void>;
  };
  notifications: {
    create(options: { type: "basic"; iconUrl: string; title: string; message: string }): void;
  };
}

declare global {
  const chrome: ChromeApi;
}