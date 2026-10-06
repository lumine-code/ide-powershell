const server = require("./server");
const setting = (key) => lumine.config.get(`ide-powershell.${key}`);
const unavailable = new Set(["callHierarchy", "typeHierarchy", "inlayHints", "codeLens"]);

module.exports = {
  consumeIdeClient(client) {
    return client.registerAdapter({
      id: "ide-powershell",
      displayName: "PowerShell Editor Services",
      grammarScopes: ["source.powershell"],
      languageId: "powershell",
      documentSelector: [
        { language: "powershell", scheme: "file", pattern: "**/!(*.ps1xml)" },
        { language: "powershell", scheme: "untitled" },
      ],
      sessionScope: "project-root",
      restartKeyPaths: ["ide-powershell.serverPath", "ide-powershell.powershellPath"],
      settingsKeyPaths: [
        "ide-powershell.scriptAnalysis",
        "ide-powershell.analyzerSettingsPath",
        "ide-powershell.acceptRenameDisclaimer",
      ],
      isFeatureAvailable: (feature) => !unavailable.has(feature),
      managedServerDisplayName: "PowerShell Editor Services",
      installServer: server.installServer,
      latestServerVersion: server.latestServerVersion,
      async resolveServer(context) {
        const launch = await server.resolveServer({
          ...context,
          serverPath: setting("serverPath"),
          powershellPath: setting("powershellPath"),
        });
        if (!launch)
          client.reportMissingServer("ide-powershell", {
            description:
              "Install PowerShell 7+ or select PowerShell Path, then install Editor Services through Manage Servers or select its Start-EditorServices.ps1 script.",
          });
        return launch;
      },
      getSettings() {
        return {
          powershell: {
            enableProfileLoading: false,
            rename: { acceptDisclaimer: setting("acceptRenameDisclaimer") },
            scriptAnalysis: {
              enable: setting("scriptAnalysis"),
              ...(setting("analyzerSettingsPath")
                ? { settingsPath: setting("analyzerSettingsPath") }
                : {}),
            },
          },
        };
      },
    });
  },
  provideBackgroundTips() {
    return {
      packageName: "ide-powershell",
      tips: [
        "PowerShell Editor Services supplies cmdlet completion and ScriptAnalyzer fixes. Select PowerShell 7+ and install Editor Services through Manage Servers to enable them.",
      ],
    };
  },
};
