import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Mi â€” Studio Project Helper",
    short_name: "Mi",
    description: "Studio project, lead, schedule, meeting, and knowledge workspace.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#316081",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/icons/mi-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/mi-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
