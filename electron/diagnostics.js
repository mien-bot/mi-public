function buildDiagnostics({ version, config, cliStatus, notionHealth, platform = process.platform, arch = process.arch }) {
  return {
    generatedAt: new Date().toISOString(),
    application: { name: "Mi", version, platform, arch },
    setup: {
      completed: config.setupCompleted === true,
      hasNotionToken: config.hasNotionToken === true,
      dropboxRootConfigured: Boolean(config.dropboxRoot),
      codeLibraryRootConfigured: Boolean(config.codeLibraryRoot),
      timezone: config.timezone,
      projectsSourceConfigured: Boolean(config.notionProjectsDataSourceId),
      scheduleSourceConfigured: Boolean(config.notionScheduleDataSourceId),
    },
    optionalTools: {
      codex: { available: cliStatus?.codex?.available === true },
      claude: { available: cliStatus?.claude?.available === true },
    },
    notion: notionHealth
      ? {
          projectsRead: notionHealth.projects?.read || "not-tested",
          projectsSchema: notionHealth.projects?.schema?.status || "not-tested",
          scheduleRead: notionHealth.schedule?.read || "not-tested",
          scheduleSchema: notionHealth.schedule?.schema?.status || "not-tested",
          update: notionHealth.capabilities?.update || "not-tested",
          insert: notionHealth.capabilities?.insert || "not-tested",
        }
      : {
          projectsRead: "not-tested",
          projectsSchema: "not-tested",
          scheduleRead: "not-tested",
          scheduleSchema: "not-tested",
          update: "not-tested",
          insert: "not-tested",
        },
  };
}

module.exports = { buildDiagnostics };
