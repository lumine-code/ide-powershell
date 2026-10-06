const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { LiveLspClient } = require("./helpers/live-lsp-client");
const { createProject, removeProject } = require("./helpers/project");
const { exerciseServer } = require("./helpers/exercise-server");
const { serverPath, powershellPath, liveSuite } = require("./helpers/environment");
liveSuite("ide-powershell real Editor Services", () => {
  let directory, client, edge, timeout;
  beforeAll(() => {
    timeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 120000;
  });
  afterAll(() => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = timeout;
  });
  beforeEach(async () => {
    jasmine.useRealClock();
    directory = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "ide-powershell-live-"),
    );
    lumine.config.set("ide-powershell.serverPath", serverPath);
    lumine.config.set("ide-powershell.powershellPath", powershellPath);
    lumine.config.set("ide-powershell.acceptRenameDisclaimer", true);
    const main = (await lumine.packages.activatePackage("ide-powershell")).mainModule;
    edge = main.consumeIde({
      registerAdapter(adapter) {
        client = new LiveLspClient(adapter, directory);
        return { dispose() {} };
      },
      reportMissingServer() {},
    });
  });
  afterEach(async () => {
    await client?.stop();
    edge?.dispose();
    await lumine.packages.deactivatePackage("ide-powershell");
    for (const key of [
      "serverPath",
      "powershellPath",
      "acceptRenameDisclaimer",
      "analyzerSettingsPath",
    ])
      lumine.config.unset(`ide-powershell.${key}`);
    await removeProject(directory);
  });
  it("serves actual analyzer fixes, cmdlet intelligence, navigation, local Unicode edits and formatting", async () => {
    const fixture = createProject(directory);
    await client.start();
    const covered = await exerciseServer(client, fixture);
    expect(covered.length).toBe(20);
    expect(covered).toContain("closed helper definition");
    expect(covered).toContain("UTF-16 rename after emoji");
  });
  it("preserves the project analyzer rule configuration", async () => {
    lumine.config.set("ide-powershell.analyzerSettingsPath", "PSScriptAnalyzerSettings.psd1");
    const fixture = createProject(directory);
    fs.writeFileSync(
      path.join(directory, "PSScriptAnalyzerSettings.psd1"),
      "@{ IncludeRules = @('PSAvoidUsingCmdletAliases') }\n",
    );
    await client.start();
    client.open(fixture.uri, "powershell", fixture.text);
    const diagnostics = await client.waitFor(() => {
      const latest = client.messages("textDocument/publishDiagnostics").at(-1)?.params.diagnostics;
      return latest?.some(({ code }) => code === "PSAvoidUsingCmdletAliases") && latest;
    }, "project analyzer rules");
    expect(diagnostics.some(({ code }) => code === "PSUseDeclaredVarsMoreThanAssignments")).toBe(
      false,
    );
  });
  it("preserves the upstream rename acknowledgement and asks only once per session", async () => {
    lumine.config.set("ide-powershell.acceptRenameDisclaimer", false);
    const fixture = createProject(directory);
    let prompts = 0;
    client.onShowMessageRequest = (params) => {
      prompts++;
      expect(params.message).toContain("rename");
      return params.actions.find(({ title }) => title === "I Accept");
    };
    await client.start();
    client.open(fixture.uri, "powershell", fixture.text);
    const { position } = require("./helpers/project");
    const params = {
      textDocument: { uri: fixture.uri },
      position: position(fixture.text, "$greeting", 0, 2),
    };
    expect(await client.request("textDocument/prepareRename", params)).not.toBeNull();
    expect(
      (await client.request("textDocument/rename", { ...params, newName: "salutation" })).changes,
    ).toBeDefined();
    expect(prompts).toBe(1);
  });
});
