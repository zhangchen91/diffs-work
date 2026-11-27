import * as React from "react";
import {
  ArrowRight,
  CheckCheck,
  Eye,
  FileSearch,
  GitCompareArrows,
  Handshake,
  ShieldCheck,
  Terminal,
  XCircle,
} from "lucide-react";
import { Badge, Button, Card, SectionTitle } from "@/components/ui/primitives";
import type { Route } from "@/lib/router";
import { useI18n } from "@diffs/i18n";

/**
 * Why this exists: verification in the age of agents.
 *
 * Two things stopped being true in the last two years.
 *
 *  1. Nobody reads every change any more. Writing code, modifying a contract or editing a deck
 *     is now cheap; the expensive step moved to "is this what was asked for, and nothing else?".
 *  2. The diff stopped being enough on its own. When a machine produces the change, "here is a
 *     patch" is an assertion, not evidence: the reviewer needs the *same pair of files*, seen
 *     the same way, in a place that does not require trusting the agent's own tooling.
 *
 * So verification needs one artifact — a diff that says what actually changed, computed from
 * the two files themselves — and one habit: check the artifact, not the summary of it.
 *
 * This section is written as a short argument, not as feature copy: the argument is what the
 * product has to satisfy.
 */
export function Verification({ go }: { go: (r: Route) => void }): React.ReactElement {
  const { t } = useI18n();
  const failures = [
    { icon: XCircle, k: "verificationFail.1.title", b: "verificationFail.1.body" },
    { icon: XCircle, k: "verificationFail.2.title", b: "verificationFail.2.body" },
    { icon: XCircle, k: "verificationFail.3.title", b: "verificationFail.3.body" },
  ];
  const answers = [
    { icon: GitCompareArrows, k: "verificationAnswer.1.title", b: "verificationAnswer.1.body" },
    { icon: Eye, k: "verificationAnswer.2.title", b: "verificationAnswer.2.body" },
    { icon: Terminal, k: "verificationAnswer.3.title", b: "verificationAnswer.3.body" },
    { icon: Handshake, k: "verificationAnswer.4.title", b: "verificationAnswer.4.body" },
  ];
  return (
    <section className="border-y border-line/60 bg-panel/30">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <SectionTitle
          kicker={t("verification.kicker")}
          title={t("verification.title")}
          desc={t("verification.desc")}
        />

        <div className="mt-10 grid gap-3 md:grid-cols-3">
          {failures.map((f) => (
            <Card key={f.k} className="p-5">
              <f.icon className="mb-3 h-5 w-5 text-red-400/80" />
              <div className="text-[14px] font-semibold text-white">{t(f.k)}</div>
              <p className="mt-1.5 text-[12.5px] leading-6 text-slate-400">{t(f.b)}</p>
            </Card>
          ))}
        </div>

        <div className="mt-10 grid gap-3 sm:grid-cols-2">
          {answers.map((a) => (
            <Card key={a.k} className="flex gap-4 p-5">
              <div className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-panel-2">
                <a.icon className="h-4.5 w-4.5 text-brand" />
              </div>
              <div>
                <div className="text-[14px] font-semibold text-white">{t(a.k)}</div>
                <p className="mt-1.5 text-[12.5px] leading-6 text-slate-400">{t(a.b)}</p>
              </div>
            </Card>
          ))}
        </div>

        <Card className="mt-10 p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-2">
            <FileSearch className="h-4.5 w-4.5 text-brand" />
            <span className="text-[15px] font-semibold text-white">{t("verificationRecipe.title")}</span>
            <Badge tone="brand">
              <CheckCheck className="h-3 w-3" /> {t("verificationRecipe.badge")}
            </Badge>
          </div>
          <p className="mt-2 max-w-3xl text-[13px] leading-6 text-slate-400">{t("verificationRecipe.desc")}</p>
          <ol className="mt-5 grid gap-3 sm:grid-cols-2">
            {["1", "2", "3", "4"].map((n) => (
              <li key={n} className="rounded-lg border border-line/70 bg-panel-2/60 p-4">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand/15 text-[11px] font-semibold text-brand">{n}</span>
                  <span className="text-[13px] font-medium text-slate-200">{t("verificationRecipe." + n + ".title")}</span>
                </div>
                <p className="mt-1.5 text-[12.5px] leading-6 text-slate-400">{t("verificationRecipe." + n + ".body")}</p>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={() => go("compare")}>
              <ShieldCheck className="h-4 w-4" /> {t("verificationRecipe.cta")}
            </Button>
            <Button variant="outline" onClick={() => go("how")}>
              {t("verificationRecipe.cta2")} <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      </div>
    </section>
  );
}