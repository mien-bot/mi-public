import type { SVGProps } from "react";

export type AppIconName =
  | "analysis"
  | "budget"
  | "calendar"
  | "checklist"
  | "codes"
  | "contract"
  | "decision"
  | "details"
  | "drawings"
  | "files"
  | "history"
  | "inbox"
  | "info"
  | "inspiration"
  | "interview"
  | "journal"
  | "leads"
  | "library"
  | "meeting"
  | "overview"
  | "personal"
  | "plan"
  | "projects"
  | "qaqc"
  | "questions"
  | "search"
  | "settings"
  | "site"
  | "studio"
  | "submissions"
  | "task"
  | "thought"
  | "tools";

const paths: Record<AppIconName, React.ReactNode> = {
  studio: <><path d="M4 5h16v11H4z" /><path d="M8 20h8M12 16v4M7 9l2 2-2 2M12 13h4" /></>,
  personal: <><circle cx="12" cy="8" r="3" /><path d="M5.5 20c.7-4 2.8-6 6.5-6s5.8 2 6.5 6" /></>,
  projects: <><path d="M4 7h6l2 2h8v10H4z" /><path d="M4 7V5h6l2 2" /></>,
  leads: <><path d="M5 19V9l7-4 7 4v10" /><path d="M9 19v-5h6v5M8 10h.01M12 10h.01M16 10h.01" /></>,
  qaqc: <><path d="M12 3 5 6v5c0 4.5 2.7 8 7 10 4.3-2 7-5.5 7-10V6z" /><path d="m9 12 2 2 4-5" /></>,
  analysis: <><path d="M5 19V9M12 19V5M19 19v-7" /><path d="M3 19h18" /></>,
  budget: <><circle cx="12" cy="12" r="9" /><path d="M15 8.5c-.7-.5-1.6-.8-2.7-.8-1.6 0-2.8.8-2.8 2s1.1 1.8 2.8 2.2 2.8.8 2.8 2.3-1.2 2.2-3 2.2c-1.2 0-2.3-.4-3.1-1M12 6v12" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M8 14h.01M12 14h.01M16 14h.01" /></>,
  checklist: <><path d="M9 5h10M9 12h10M9 19h10" /><path d="m4 5 1 1 2-2m-3 8 1 1 2-2m-3 8 1 1 2-2" /></>,
  codes: <><path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z" /><path d="M7 4v16M10 8h6M10 12h6" /></>,
  contract: <><path d="M6 3h9l3 3v15H6z" /><path d="M15 3v4h4M9 11h6M9 15h6" /></>,
  decision: <><path d="M12 4v16M12 7H7l-3 3 3 3h5M12 11h5l3 3-3 3h-5" /></>,
  details: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
  drawings: <><path d="m4 17 10-10 3 3L7 20H4zM13 8l3 3" /><path d="M14 4h6v6" /></>,
  files: <><path d="M4 7h6l2 2h8v10H4z" /><path d="M14 13h3M14 16h3" /></>,
  history: <><path d="M4 12a8 8 0 1 0 2-5.3L4 9" /><path d="M4 4v5h5M12 7v5l3 2" /></>,
  inbox: <><path d="M4 13h4l2 3h4l2-3h4" /><path d="M6 4h12l3 9v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
  inspiration: <><path d="M9 18h6M10 21h4" /><path d="M8.5 15.5A6 6 0 1 1 15.5 15.5c-.8.6-1.2 1.3-1.3 2.5h-4.4c-.1-1.2-.5-1.9-1.3-2.5Z" /></>,
  interview: <><path d="M4 5h16v11H9l-5 4z" /><path d="M8 9h8M8 12h5" /></>,
  journal: <><path d="M5 4h13a1 1 0 0 1 1 1v15H7a2 2 0 0 1-2-2z" /><path d="M8 4v16M11 8h5" /></>,
  library: <><path d="M4 5h5v14H4zM10 5h5v14h-5zM16 7h4v12h-4z" /></>,
  meeting: <><circle cx="8" cy="9" r="2.5" /><circle cx="16" cy="9" r="2.5" /><path d="M3 19c.4-3.3 2-5 5-5s4.6 1.7 5 5M12 15c.9-.7 2.2-1 4-1 3 0 4.6 1.7 5 5" /></>,
  overview: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
  plan: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M8 14h4M8 17h7" /></>,
  questions: <><circle cx="12" cy="12" r="9" /><path d="M9.7 9a2.5 2.5 0 1 1 3.2 2.4c-.9.4-.9 1-.9 1.8M12 17h.01" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4 4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19 13.5v-3l-2-.7-.7-1.7.9-1.9-2.1-2.1-1.9.9-1.7-.7L10.5 2h-3l-.7 2-1.7.7-1.9-.9-2.1 2.1.9 1.9-.7 1.7L0 10.5v3l2 .7.7 1.7-.9 1.9 2.1 2.1 1.9-.9 1.7.7.7 2h3l.7-2 1.7-.7 1.9.9 2.1-2.1-.9-1.9.7-1.7z" transform="translate(2 -0.5) scale(.83)" /></>,
  site: <><path d="M4 20h16M6 20V9l6-5 6 5v11M9 20v-5h6v5" /><path d="M9 10h.01M15 10h.01" /></>,
  submissions: <><path d="M12 16V4M8 8l4-4 4 4" /><path d="M5 14v6h14v-6" /></>,
  task: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="m8 12 2.5 2.5L16 9" /></>,
  thought: <><path d="M7 17h9a4 4 0 0 0 .4-8A6 6 0 0 0 5 11a3 3 0 0 0 2 6Z" /><path d="M8 20h.01M12 20h.01" /></>,
  tools: <><path d="m14 6 4-3 3 3-3 4-3-1-7 7-2 5-3-3 5-2 7-7z" /></>,
};

/**
 * `pixel-icon` is what gives every icon in the app its 8-bit blit-in at the Cinematic
 * motion level (see the "8-bit icon motion" block in app/globals.css). It is added here
 * rather than at each of the ~40 call sites so the behavior is uniform and there is one
 * place to change it. At every other motion level the class matches nothing and the icon
 * renders exactly as it always has.
 */
export function AppIcon({ name, className = "h-5 w-5", ...props }: { name: AppIconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`pixel-icon ${className}`}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
