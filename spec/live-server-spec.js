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
    edge = main.consumeIdeClient({
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
    for (const key of ["serverPath", "powershellPath", "acceptRenameDisclaimer"])
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
});
