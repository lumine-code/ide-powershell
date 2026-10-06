const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { LiveLspClient } = require("./helpers/live-lsp-client");
const { createProject, removeProject } = require("./helpers/project");
const { exerciseServer } = require("./helpers/exercise-server");
const { powershellPath, liveSuite } = require("./helpers/environment");
liveSuite("ide-powershell verified managed distribution", () => {
  let directory, client, edge, managed, timeout;
  beforeAll(() => {
    timeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 180000;
  });
  afterAll(() => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = timeout;
  });
  beforeEach(async () => {
    jasmine.useRealClock();
    directory = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "ide-powershell-managed-"),
    );
    for (const key of ["serverPath", "powershellPath"])
      lumine.config.set(`ide-powershell.${key}`, key === "powershellPath" ? powershellPath : "");
    lumine.config.set("ide-powershell.acceptRenameDisclaimer", true);
    for (const name of ["ide", "ide-powershell"]) await lumine.packages.activatePackage(name);
    const main = lumine.packages.getActivePackage("ide-powershell").mainModule;
    edge = main.consumeIde({
      registerAdapter(adapter) {
        client = new LiveLspClient(adapter, path.join(directory, "project"));
        return { dispose() {} };
      },
      reportMissingServer() {},
    });
  });
  afterEach(async () => {
    await client?.stop();
    edge?.dispose();
    managed?.emitter.dispose();
    for (const name of ["ide-powershell", "ide"]) await lumine.packages.deactivatePackage(name);
    for (const key of ["serverPath", "powershellPath", "acceptRenameDisclaimer"])
      lumine.config.unset(`ide-powershell.${key}`);
    await removeProject(directory);
  });
  it("verifies and preserves the complete official bundle then launches and exercises the managed server", async () => {
    const clientPath = lumine.packages.getActivePackage("ide").path;
    const Managed = require(path.join(clientPath, "lib", "managed-servers"));
    const Api = require(path.join(clientPath, "lib", "install-api"));
    const storagePath = path.join(directory, "managed");
    managed = new Managed({}, { storageRoot: storagePath });
    const server = require("../lib/server");
    const installed = await server.installServer({
      storagePath,
      version: process.env.PSES_VERSION || "4.7.0",
      api: new Api(managed, { id: "ide-powershell" }),
    });
    expect(installed.checksum).toMatch(/^sha256:/);
    expect(installed.version).toBe(process.env.PSES_VERSION || "4.7.0");
    for (const file of [
      "LICENSE",
      "NOTICE.txt",
      "PowerShellEditorServices",
      "PSScriptAnalyzer",
      "PSReadLine",
    ])
      expect(fs.existsSync(path.join(storagePath, file))).toBe(true);
    const fixture = createProject(path.join(directory, "project"));
    await client.start({
      modulePath: path.join(storagePath, installed.module),
      version: installed.version,
    });
    expect((await exerciseServer(client, fixture)).length).toBe(20);
  });
});
