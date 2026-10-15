export interface MiHelperSuggestion {
  title: string;
  detail: string;
  href: string;
}

/** Page guidance, not an assessment of records or a claim that a task is outstanding. */
export function miHelperSuggestions(pathname: string): { context: string; items: MiHelperSuggestion[]; chatHref?: string; chatLabel?: string } {
  const match = /^\/(projects|leads|permit-qaqc)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/([^/]+))?\/?$/.exec(pathname);
  if (match && !["analysis", "new"].includes(match[2])) {
    const [, kind, slug, section] = match;
    const base = `/${kind}/${slug}`;
    const reviewKind = kind === "projects" ? "project" : kind === "leads" ? "lead" : "permit-qaqc";
    const review = { title: "Review proposed changes", detail: "Check drafts and their destinations before accepting them.", href: `/review?workspace=${encodeURIComponent(`${reviewKind}/${slug}`)}` };
    if (kind === "leads") return { context: "This lead", chatHref: `${base}/chat`, items: [
      { title: "Capture the next conversation", detail: "Keep the brief and decisions with the lead.", href: `${base}/meetings` },
      { title: "Check the proposal", detail: "Review contract status before moving ahead.", href: `${base}/contracts` },
      review,
    ] };
    if (kind === "permit-qaqc") return { context: "This permit review", chatHref: base, chatLabel: "Open review workspace", items: [review,
      { title: "Check the source documents", detail: "Open the confirmed folder for this review.", href: `${base}/dropbox` },
      { title: "Return to the review", detail: "Keep the findings with their engagement.", href: base },
    ] };
    if (section === "terminal") return { context: "Project terminal", items: [review,
      { title: "Keep useful conclusions", detail: "Record accepted facts in project knowledge.", href: `${base}/knowledge` },
      { title: "Find project documents", detail: "The PDF button adds the Mi mark to an existing PDF; it does not export this conversation.", href: `${base}/files` },
    ] };
    return { context: "This project", items: [
      { title: "Plan the next step", detail: "Review milestones and decide what to tackle next.", href: `${base}/schedule` },
      review,
      { title: "Keep decisions easy to find", detail: "Capture the reasoning before details get lost in chat.", href: `${base}/decisions` },
    ] };
  }
  if (pathname.startsWith("/personal")) return { context: "Your private workspace", chatHref: "/personal", chatLabel: "Open private workspace", items: [
    { title: "Make space to plan", detail: "Choose a task or capture a private note.", href: "/personal" },
    { title: "Explore the workflow", detail: "See how private notes and shared project work stay separate.", href: "/getting-started" },
  ] };
  if (pathname.startsWith("/settings")) return { context: "Your workspace", items: [
    { title: "Choose one clear style", detail: "Studio, Sketchbook, or Terminal. Display and legibility stay adjustable.", href: "/settings#appearance" },
    { title: "Check connections", detail: "Confirm your local folders and services in Settings.", href: "/settings#connections" },
    { title: "Take a quick tour", detail: "See how projects, drafts, and confirmations fit together.", href: "/getting-started" },
  ] };
  return { context: "Your studio", items: [
    { title: "Choose a project to move forward", detail: "Open its plan and pick a useful next step.", href: "/projects" },
    { title: "Review the inbox", detail: "Check proposed changes before they become project records.", href: "/review" },
    { title: "Follow up on a lead", detail: "Keep the next conversation and proposal together.", href: "/leads" },
  ] };
}
