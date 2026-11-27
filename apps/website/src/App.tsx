import * as React from "react";
import { TopBar, Footer } from "@/components/shell/chrome";
import { CTA, FormatsGrid, HomeHero, HowItWorks, Roadmap, TryNow, WhyLocal, EnginePlan } from "@/components/home/home";
import { Verification } from "@/components/home/verification";
import { VerifyPage } from "@/pages/verify";
import { ConfigPage } from "@/pages/config";
import { CompareStudio } from "@/components/compare/studio";
import { DownloadPage } from "@/pages/download";
import { HowPage } from "@/pages/how";
import { AboutPage } from "@/pages/about";
import { FormatsPage } from "@/pages/formats";
import { useHashRoute, type Route } from "@/lib/router";
import { useI18n } from "@diffs/i18n";

/** Keeps one broken viewer from taking the whole page down; shows the error instead. */
class Boundary extends React.Component<
  { children: React.ReactNode; name: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: unknown) {
    console.error("[diffs] viewer crashed", this.props.name, error, info);
    // keep the failure addressable from a test harness (screenshots alone hide it)
    (globalThis as { __diffsViewerError?: string }).__diffsViewerError = `${this.props.name}: ${error.message}`;
  }
  render() {
    if (this.state.error) {
      return (
        <div className="m-4 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4 text-[13px] text-red-200">
          {this.props.name}: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

const TITLE_KEYS: Record<Route, string> = {
  home: "title.home",
  compare: "title.compare",
  formats: "title.formats",
  how: "title.how",
  download: "title.download",
  about: "title.about",
  verify: "title.verify",
  config: "title.config",
};

export default function App(): React.ReactElement {
  const [route, go] = useHashRoute();
  const { t, locale, ready } = useI18n();

  React.useEffect(() => {
    document.title = ready ? t(TITLE_KEYS[route]) : "diffs.work";
  }, [route, t, ready, locale]);

  return (
    <div className="flex min-h-full flex-col">
      <TopBar route={route} go={go} />
      <main className="flex-1">
        {route === "home" ? (
          <>
            <HomeHero go={go} />
            <Verification go={go} />
            <FormatsGrid go={go} />
            <WhyLocal />
            <EnginePlan />
            <HowItWorks />
            <TryNow />
            <Roadmap />
            <CTA go={go} />
          </>
        ) : null}
        {route === "compare" ? (
          <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
            <Boundary name="compare">
              <CompareStudio />
            </Boundary>
            <div className="mt-10">
              <WhyLocal />
            </div>
          </div>
        ) : null}
        {route === "formats" ? <FormatsPage /> : null}
        {route === "how" ? <HowPage /> : null}
        {route === "download" ? <DownloadPage /> : null}
        {route === "about" ? <AboutPage go={go} /> : null}
        {route === "verify" ? <VerifyPage go={go} /> : null}
        {route === "config" ? <ConfigPage go={go} /> : null}
      </main>
      <Footer go={go} />
    </div>
  );
}
