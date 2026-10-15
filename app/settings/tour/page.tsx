import type { Metadata } from "next";
import Link from "next/link";
import { FeatureTour } from "@/components/FeatureTour";

export const metadata: Metadata = {
  title: "Product tour",
  description: "An interactive walkthrough of every Mi feature area.",
};

export default function SettingsTourPage() {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <Link href="/settings" className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground">
          ← Settings
        </Link>
        <h1 className="mt-3 font-display text-3xl font-light tracking-wide">Product tour</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          A step-by-step walkthrough of Mi&apos;s main work areas. Replay it any time from here.
        </p>
      </header>

      <FeatureTour />
    </div>
  );
}
