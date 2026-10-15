import type { Metadata } from "next";
import Link from "next/link";
import { FeatureGuide } from "@/components/FeatureGuide";

export const metadata: Metadata = {
  title: "Start Here",
  description: "A practical tour of Mi's project, firm, knowledge, and AI workspaces.",
};

const FIRST_STEPS = [
  {
    number: "1",
    title: "Find the work",
    description: "Open Projects for the portfolio view, or use Search when you already know what you need.",
    href: "/projects",
    action: "Browse projects",
  },
  {
    number: "2",
    title: "Open one project",
    description: "Start with Overview, then use Plan & Timeline, Meetings, Decisions, Site Reports, Architect Tools, Files, or QA/QC as the work requires.",
    href: "/projects",
    action: "Choose a project",
  },
  {
    number: "3",
    title: "Ask Mi with context",
    description: "Use the main assistant for broad work or project chat when the answer must stay inside one project.",
    href: "/",
    action: "Open Mi",
  },
] as const;

export default function GettingStartedPage() {
  return (
    <main className="space-y-12 pb-12">
      <section className="relative overflow-hidden rounded-2xl border border-border bg-card px-6 py-10 sm:px-10 sm:py-14">
        <div
          aria-hidden="true"
          className="absolute -right-20 -top-24 h-64 w-64 rounded-full border border-accent/20 bg-accent/5"
        />
        <div className="relative max-w-3xl">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-accent">Start here</p>
          <h1 className="mt-4 font-display text-4xl font-light tracking-tight sm:text-5xl">
            Mi keeps the work connected.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            Plan projects, capture decisions, find firm knowledge, and ask AI for help—while
            keeping every Dropbox and Notion write under human control.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/projects"
              className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground"
            >
              Browse projects
            </Link>
            <Link
              href="/"
              className="rounded-md border border-border-strong px-4 py-2.5 text-sm font-medium"
            >
              Ask Mi
            </Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="first-ten-minutes-heading">
        <div className="max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
            Your first 10 minutes
          </p>
          <h2 id="first-ten-minutes-heading" className="mt-2 font-display text-2xl font-light">
            Learn Mi by following the work
          </h2>
        </div>
        <ol className="mt-6 grid gap-3 md:grid-cols-3">
          {FIRST_STEPS.map((step) => (
            <li key={step.number} className="rounded-xl border border-border p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-sm font-medium text-accent">
                {step.number}
              </span>
              <h3 className="mt-4 font-display text-lg font-medium">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.description}</p>
              <Link href={step.href} className="mt-4 inline-flex text-sm font-medium text-link">
                {step.action} →
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="feature-directory-heading">
        <div className="max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
            Feature directory
          </p>
          <h2 id="feature-directory-heading" className="mt-2 font-display text-2xl font-light">
            Everything Mi can help with
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Start with the area that matches today&apos;s task. You can return to this guide from
            <strong className="font-medium text-foreground"> More → Start Here</strong>.
          </p>
        </div>
        <div className="mt-6">
          <FeatureGuide />
        </div>
      </section>

      <section className="grid gap-4 rounded-xl border border-border bg-muted/20 p-6 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <h2 className="font-display text-xl font-medium">Need to connect something later?</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Dropbox, Notion, Claude, appearance, and background sync can all be reviewed without
            rerunning first-install setup.
          </p>
        </div>
        <Link
          href="/settings"
          className="justify-self-start rounded-md border border-border-strong px-4 py-2.5 text-sm font-medium"
        >
          Open settings
        </Link>
      </section>
    </main>
  );
}
