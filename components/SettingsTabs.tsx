"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppearanceSettings } from "@/components/AppearanceSettings";
import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { NotionSyncSettings } from "@/components/NotionSyncSettings";
import { PartnerSetup } from "@/components/PartnerSetup";
import { ProfileSettings } from "@/components/ProfileSettings";

const SETTINGS_TABS = [
  { id: "appearance", label: "Appearance", description: "Theme and contrast", icon: "settings" },
  { id: "profile", label: "Profile", description: "Avatar and display name", icon: "personal" },
  { id: "connections", label: "Connections", description: "Dropbox, Notion, and AI", icon: "projects" },
  { id: "automation", label: "Automation", description: "Background Notion sync", icon: "tools" },
  { id: "about", label: "About", description: "Version and build", icon: "settings" },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  description: string;
  icon: AppIconName;
}>;

type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

function isSettingsTabId(value: string): value is SettingsTabId {
  return SETTINGS_TABS.some((tab) => tab.id === value);
}

export function SettingsTabs({ version }: { version: string }) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>("appearance");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    function selectHashTab() {
      const value = window.location.hash.slice(1);
      if (isSettingsTabId(value)) setActiveTab(value);
    }
    selectHashTab();
    window.addEventListener("hashchange", selectHashTab);
    return () => window.removeEventListener("hashchange", selectHashTab);
  }, []);

  function selectTab(id: SettingsTabId) {
    setActiveTab(id);
    window.history.replaceState(null, "", `#${id}`);
  }

  function moveFocus(currentIndex: number, direction: -1 | 1) {
    const nextIndex = (currentIndex + direction + SETTINGS_TABS.length) % SETTINGS_TABS.length;
    const next = SETTINGS_TABS[nextIndex];
    selectTab(next.id);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border">
        <div
          role="tablist"
          aria-label="Settings sections"
          className="flex min-w-0 flex-1 gap-1 overflow-x-auto"
        >
          {SETTINGS_TABS.map((tab, index) => (
            <button
              key={tab.id}
              ref={(node) => { tabRefs.current[index] = node; }}
              id={`settings-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`settings-panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => selectTab(tab.id)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  moveFocus(index, 1);
                } else if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  moveFocus(index, -1);
                } else if (event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  const nextIndex = event.key === "Home" ? 0 : SETTINGS_TABS.length - 1;
                  selectTab(SETTINGS_TABS[nextIndex].id);
                  tabRefs.current[nextIndex]?.focus();
                }
              }}
              className={`min-w-fit border-b-2 px-4 py-3 text-left transition-colors ${
                activeTab === tab.id
                  ? "border-accent text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <AppIcon name={tab.icon} className="h-4 w-4" />
                {tab.label}
              </span>
              <span className="mt-0.5 hidden text-[11px] sm:block">{tab.description}</span>
            </button>
          ))}
        </div>
        <Link href="/settings/tour" className="mb-2 rounded-md border border-border px-3 py-2 text-xs hover:border-accent">
          Start here tour
        </Link>
      </div>

      <div className="mt-6">
        <div
          id="settings-panel-appearance"
          role="tabpanel"
          aria-labelledby="settings-tab-appearance"
          hidden={activeTab !== "appearance"}
        >
          <AppearanceSettings />
        </div>
        <div
          id="settings-panel-profile"
          role="tabpanel"
          aria-labelledby="settings-tab-profile"
          hidden={activeTab !== "profile"}
        >
          <ProfileSettings />
        </div>
        <div
          id="settings-panel-connections"
          role="tabpanel"
          aria-labelledby="settings-tab-connections"
          hidden={activeTab !== "connections"}
        >
          <PartnerSetup />
        </div>
        <div
          id="settings-panel-automation"
          role="tabpanel"
          aria-labelledby="settings-tab-automation"
          hidden={activeTab !== "automation"}
          className="rounded-xl border border-border bg-card p-5"
        >
          <h2 className="font-display text-xl font-light">Background automation</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Optional read-only Notion snapshot refresh. Reviewed project writes remain separate
            and confirmation-gated.
          </p>
          <div className="mt-4"><NotionSyncSettings /></div>
        </div>
        <div
          id="settings-panel-about"
          role="tabpanel"
          aria-labelledby="settings-tab-about"
          hidden={activeTab !== "about"}
          className="rounded-xl border border-border bg-card p-5"
        >
          <h2 className="font-display text-xl font-light">About Mi</h2>
          <dl className="mt-4 grid max-w-lg gap-3 text-sm">
            <div className="flex items-center justify-between gap-4 border-b border-border pb-3">
              <dt className="text-muted-foreground">Installed version</dt>
              <dd className="font-mono text-foreground">{version}</dd>
            </div>
          </dl>
          <p className="mt-4 max-w-xl text-xs leading-5 text-muted-foreground">
            Use this number when checking whether a newer Mi installer has been applied to this computer.
          </p>
        </div>
      </div>
    </div>
  );
}
