/**
 * "Mi" lockup — "M" set in Outfit, "i" hand-drawn with a miniature MiMark
 * standing in for the dot. Chosen 2026-07-25 as the nav/wordmark treatment,
 * replacing plain text "Mi". Uses the `font-display` utility (mapped to the
 * Outfit variable in app/globals.css) rather than hardcoding a font name.
 */
export function MiWordmark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 5.5 64 24" fill="currentColor" className={className} aria-hidden="true">
      <text x="4" y="29" className="font-display" fontSize="26" fontWeight="500">
        M
      </text>
      <path d="M 32.6 15.5 Q 33.6 21 34.6 28.5 L 35.6 28.4 Q 35.4 21.5 35.2 15.4 Z" />
      <path d="M 31.32 9.85 Q 33.58 9.65 36.70 9.58 Q 36.54 9.39 36.68 9.10 Q 33.56 9.25 31.30 9.20 Q 30.99 9.54 31.32 9.85 Z" />
      <path d="M 33.54 6.68 Q 33.76 8.98 34.05 12.43 L 34.16 12.42 Q 34.18 8.96 34.21 6.66 Q 33.86 6.33 33.54 6.68 Z" />
      <path d="M 35.26 8.68 A 0.26 0.26 0 1 1 34.92 8.29 Q 35.67 7.77 36.48 7.32 Q 35.90 8.04 35.26 8.68 Z" />
      <path d="M 33.07 8.30 A 0.24 0.24 0 1 1 32.76 8.67 Q 32.14 7.94 31.46 7.27 Q 32.24 7.82 33.07 8.30 Z" />
      <path d="M 34.75 10.64 A 0.27 0.27 0 1 1 35.15 10.27 Q 35.79 11.12 36.36 12.02 Q 35.52 11.36 34.75 10.64 Z" />
      <path d="M 32.87 10.29 A 0.25 0.25 0 1 1 33.24 10.62 Q 32.43 11.26 31.70 11.96 Q 32.32 11.16 32.87 10.29 Z" />
    </svg>
  );
}
