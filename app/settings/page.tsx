import { SettingsTabs } from "@/components/SettingsTabs";
import packageJson from "@/package.json";

export default function SettingsPage() {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-light tracking-wide">Settings</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          The essentials are up front. Machine paths, source IDs, automation, migration, and
          recovery stay available only when you open advanced settings.
        </p>
      </header>

      <SettingsTabs version={packageJson.version} />
    </div>
  );
}
