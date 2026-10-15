import { MiMark } from "./MiMark";

/** Decorative geometry only: no invented progress percentages or implied sync stages. */
export function ArchitecturalDrawing() {
  return <svg viewBox="0 0 320 180" fill="none" stroke="currentColor" className="mi-plan-drawing w-full" aria-hidden="true">
    <g opacity="0.2" strokeWidth="0.7">
      <path d="M24 28H296M24 152H296M48 12V168M272 12V168M24 90H296" strokeDasharray="3 5" />
      <path d="M48 20H272M48 16V24M272 16V24M286 40V140M282 40H290M282 140H290" />
    </g>
    <g className="mi-plan-outline" strokeWidth="2" strokeLinecap="square">
      <path pathLength="1" d="M142 140H48V40H272V140H178M54 134V46H266V134H178M142 134H54" />
      <path pathLength="1" d="M150 46V88M150 114V134M54 96H108M134 96H150M210 46V78M210 104V134" />
    </g>
    <g className="mi-plan-detail" strokeWidth="0.9" opacity="0.65">
      <path pathLength="1" d="M142 140V104A36 36 0 0 1 178 140M150 114H124A26 26 0 0 1 150 88M210 104H184A26 26 0 0 1 210 78" />
      <path pathLength="1" d="M70 59H127V80H70ZM224 57H252V76H224ZM224 114H252M224 119H252M224 124H252" />
      <path d="M75 40H125M75 43H125M227 140H251M227 137H251" strokeWidth="3" />
    </g>
    <g opacity="0.45" strokeWidth="0.8"><path d="M27 130V148M23 136L27 130L31 136M48 162H96M48 159V165M72 159V165M96 159V165" /></g>
  </svg>;
}

export function ArchitecturalLoader() {
  return <div className="flex min-h-[62vh] items-center justify-center" role="status" aria-live="polite">
    <div className="w-full max-w-sm overflow-hidden rounded-xl border border-border bg-card text-accent shadow-[var(--shadow-sm)]">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3"><MiMark className="h-6 w-6" /><span className="font-mono text-[10px] uppercase tracking-[0.2em]">Mi · Drawing workspace</span></div>
      <div className="px-5 pt-4"><ArchitecturalDrawing /></div>
      <div className="px-5 pb-6 text-center"><p className="font-display text-lg text-foreground">Opening your workspace</p><p className="mt-1 text-xs text-muted-foreground">Gathering the details…</p></div>
    </div>
  </div>;
}
