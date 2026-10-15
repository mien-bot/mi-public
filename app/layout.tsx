import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Nav } from "@/components/Nav";
import { RouteTransition } from "@/components/RouteTransition";
import { ChatWidget } from "@/components/ChatWidget";
import { ZoomGesture } from "@/components/ZoomGesture";
import { ThemeProvider } from "@/components/ThemeProvider";
import { OnboardingGuard } from "@/components/OnboardingGuard";
import { buildThemeBootstrapScript } from "@/lib/theme/preferences";
import "./globals.css";

// Generated once per module load (pure/deterministic — see
// lib/theme/preferences.ts), not per request; inlined below as a blocking
// <script> so the stored appearance preference (or the OS default, or the
// documented Blueprint + System fallback) applies before React hydration —
// this is what prevents a flash of the wrong theme on load.
const THEME_BOOTSTRAP_SCRIPT = buildThemeBootstrapScript();

export const metadata: Metadata = {
  title: {
    default: "Mi — Studio Project Helper",
    template: "%s · Mi",
  },
  description: "Internal project helper for Studio — projects, code compliance, schedule, and budget.",
  applicationName: "Mi",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Mi",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icons/mi-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/mi-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/mi-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

// Installed Mi reads a per-user cache that can change without rebuilding the
// application. Do not freeze project data into release-time prerender output.
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/* Must run synchronously, before paint, to avoid a flash of the
            wrong theme; content is a deterministic build-time string with
            no user input (see buildThemeBootstrapScript in
            lib/theme/preferences.ts). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider />
        <OnboardingGuard />
        <ZoomGesture />
        <Nav />
        <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-5 sm:px-6 sm:py-8">
          <RouteTransition>{children}</RouteTransition>
        </div>
        <Suspense fallback={null}>
          <ChatWidget />
        </Suspense>
      </body>
    </html>
  );
}
