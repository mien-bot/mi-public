/**
 * Standalone full Mi glyph, matching the packaged application icon.
 *
 * `gradient` gives the mark a lit, dimensional fill for the chat surfaces. Its three stops
 * are drawn entirely from the live appearance tokens — a light rim mixed off `--accent`,
 * `--accent` itself, then the preset's documented `--accent-hover` step — so the mark
 * recolors with whichever preset is chosen instead of staying blue while the rest of the
 * window turns cyan, violet or jade. Nothing here is a hardcoded hue.
 *
 * The gradient id has to be unique per document, not per element: several marks can be on
 * screen at once (chat header, launcher, workspace nav) and they all reference the same
 * def, which is fine precisely because the stops are now token-driven and therefore
 * identical for every instance under one theme.
 */
export function MiMark({ className, gradient = false, size }: { className?: string; gradient?: boolean; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={gradient ? "url(#mi-mark-accent-gradient)" : "currentColor"}
      className={className}
      aria-hidden="true"
    >
      {gradient && (
        <defs>
          <linearGradient id="mi-mark-accent-gradient" x1="5" y1="5" x2="19" y2="19" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="color-mix(in srgb, var(--accent) 55%, #ffffff)" />
            <stop offset="0.5" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--accent-hover)" />
          </linearGradient>
        </defs>
      )}
      <path d="M 6.6 11.85 Q 12 11.6 17.4 11.75 L 17.35 12.55 Q 12 12.35 6.65 12.65 Z" />
      <path d="M 11.55 6.6 L 12.45 6.55 Q 12.25 12.5 12.05 17.6 Q 11.95 17.85 11.85 17.6 Q 11.7 12.5 11.55 6.6 Z" />
      <g>
        <path d="M 14.99 10.29 A 0.62 0.62 0 1 1 14.20 9.35 Q 15.97 8.11 17.90 7.05 Q 16.52 8.76 14.99 10.29 Z" />
        <path d="M 9.79 9.39 A 0.58 0.58 0 1 1 9.05 10.27 Q 7.56 8.52 5.95 6.92 Q 7.80 8.23 9.79 9.39 Z" />
        <path d="M 13.78 14.95 A 0.65 0.65 0 1 1 14.74 14.08 Q 16.26 16.10 17.62 18.24 Q 15.63 16.66 13.78 14.95 Z" />
        <path d="M 9.30 14.11 A 0.60 0.60 0 1 1 10.19 14.91 Q 8.26 16.42 6.51 18.09 Q 8.00 16.18 9.30 14.11 Z" />
      </g>
    </svg>
  );
}
