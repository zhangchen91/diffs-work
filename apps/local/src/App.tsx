import * as React from "react";
import { Footer, TopBar } from "@/components/shell/chrome";
import { CompareStudio } from "@/components/compare/studio";
import { InboxPage, LocalHome } from "@/pages/inbox";
import { useHashRoute, type Route } from "@/lib/router";

const TITLES: Record<Route, string> = {
  home: "diffs.work local",
  compare: "对比 — diffs.work local",
  inbox: "Inbox — diffs.work local",
};

export default function App(): React.ReactElement {
  const [route, go] = useHashRoute();

  React.useEffect(() => {
    document.title = TITLES[route];
  }, [route]);

  const goCompare = React.useCallback(
    (oldPath?: string, newPath?: string) => {
      if (oldPath && newPath) {
        go("compare");
        window.location.hash = `#/compare?old=${encodeURIComponent(oldPath)}&new=${encodeURIComponent(newPath)}`;
      } else {
        go("compare");
      }
    },
    [go],
  );

  return (
    <div className="flex min-h-full flex-col">
      <TopBar route={route} go={go} />
      <main className="flex-1">
        {route === "home" ? <LocalHome goCompare={() => go("compare")} goInbox={() => go("inbox")} /> : null}
        {route === "compare" ? (
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
            <CompareStudio />
          </div>
        ) : null}
        {route === "inbox" ? <InboxPage goCompare={goCompare} /> : null}
      </main>
      <Footer />
    </div>
  );
}
