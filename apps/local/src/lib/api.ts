import * as React from "react";

export interface InboxItem {
  id: string;
  createdAt: string;
  title: string;
  old: { label: string; path: string } | null;
  new: { label: string; path: string } | null;
  source: string;
}

export async function fetchInbox(): Promise<InboxItem[]> {
  const res = await fetch("/api/inbox");
  if (!res.ok) throw new Error(`inbox: ${res.status}`);
  const data = (await res.json()) as { items: InboxItem[] };
  return data.items ?? [];
}

export function useInbox(): { items: InboxItem[]; error: string | null; reload: () => void } {
  const [items, setItems] = React.useState<InboxItem[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    fetchInbox()
      .then((x) => alive && (setItems(x), setError(null)))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [tick]);
  return { items, error, reload: () => setTick((t) => t + 1) };
}

export function useHealth(): { ok: boolean; cwd: string | null } {
  const [state, setState] = React.useState<{ ok: boolean; cwd: string | null }>({ ok: false, cwd: null });
  React.useEffect(() => {
    let alive = true;
    fetch("/api/health")
      .then((r) => r.json())
      .then((j: { ok?: boolean; cwd?: string }) => alive && setState({ ok: !!j.ok, cwd: j.cwd ?? null }))
      .catch(() => alive && setState({ ok: false, cwd: null }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}