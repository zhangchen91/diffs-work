import * as React from "react";

export type Route = "home" | "compare" | "inbox" ;

export function parseRoute(hash: string): Route {
  const r = hash.replace(/^#\/?/, "").split("?")[0] || "home";
  const known: Route[] = ["home", "compare", "inbox"];
  return (known.includes(r as Route) ? r : "home") as Route;
}

export function useHashRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = React.useState<Route>(() => parseRoute(window.location.hash));
  React.useEffect(() => {
    const onHash = (): void => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const go = React.useCallback((r: Route) => {
    window.location.hash = r === "home" ? "/" : `/${r}`;
    window.scrollTo({ top: 0 });
  }, []);
  return [route, go];
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}