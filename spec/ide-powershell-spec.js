const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { removeProject } = require("./helpers/project");
describe("ide-powershell adapter and distribution integrity", () => {
  let main, server, adapter, edge, directory, changed;
  const configure = (key, value) => {
    changed.add(key);
    lumine.config.set(`ide-powershell.${key}`, value);
  };
  const register = () => {
    edge = main.consumeIdeClient({
      registerAdapter(value) {
        adapter = value;
        return { dispose: jasmine.createSpy("dispose") };
      },
      reportMissingServer() {},
    });
  };
  const payload = () => {
    const module = path.join(directory, "PowerShellEditorServices");
    fs.mkdirSync(module, { recursive: true });
    const script = path.join(module, "Start-EditorServices.ps1");
    fs.writeFileSync(script, "# fixture script\n");
    fs.writeFileSync(
      path.join(module, "PowerShellEditorServices.psd1"),
      "ModuleVersion = '4.7.0'\n",
    );
    fs.mkdirSync(path.join(directory, "PSScriptAnalyzer"), { recursive: true });
    for (const name of ["LICENSE", "NOTICE.txt"])
      fs.writeFileSync(path.join(directory, name), "fixture notice\n");
    return script;
  };
  const release = () => ({
    version: "4.7.0",
    tag: "v4.7.0",
    assets: [
      {
        name: "PowerShellEditorServices.zip",
        url: "https://github.com/PowerShell/PowerShellEditorServices/releases/download/v4.7.0/PowerShellEditorServices.zip",
        digest: "sha256:" + "a".repeat(64),
      },
    ],
  });
  beforeEach(async () => {
    jasmine.useRealClock();
    main = (await lumine.packages.activatePackage("ide-powershell")).mainModule;
    server = require("../lib/server");
    directory = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "ide-powershell-unit-"),
    );
    changed = new Set();
    register();
  });
  afterEach(async () => {
    edge?.dispose();
    for (const key of changed) lumine.config.unset(`ide-powershell.${key}`);
    await lumine.packages.deactivatePackage("ide-powershell");
    await removeProject(directory);
  });
  it("owns one provider edge and restricts the server to PowerShell scripts", () => {
    expect(adapter.id).toBe("ide-powershell");
    expect(adapter.grammarScopes).toEqual(["source.powershell"]);
    expect(adapter.documentSelector[0].pattern).toBe("**/!(*.ps1xml)");
    expect(adapter.documentSelector[1].scheme).toBe("untitled");
    expect(edge.dispose).not.toHaveBeenCalled();
  });
  it("returns independent edge disposables and a useful background tip", () => {
    const first = { dispose: jasmine.createSpy("first") },
      second = { dispose: jasmine.createSpy("second") };
    expect(main.consumeIdeClient({ registerAdapter: () => first })).toBe(first);
    expect(main.consumeIdeClient({ registerAdapter: () => second })).toBe(second);
    first.dispose();
    expect(second.dispose).not.toHaveBeenCalled();
    expect(main.provideBackgroundTips().packageName).toBe("ide-powershell");
    expect(main.provideBackgroundTips().tips.length).toBe(1);
  });
  it("maps supported analyzer settings without loading profiles or acknowledging rename implicitly", () => {
    expect(adapter.getSettings().powershell.enableProfileLoading).toBe(false);
    expect(adapter.getSettings().powershell.rename.acceptDisclaimer).toBe(false);
    expect(adapter.getSettings().powershell.scriptAnalysis.settingsPath).toBeUndefined();
    configure("scriptAnalysis", false);
    configure("analyzerSettingsPath", "project.psd1");
    configure("acceptRenameDisclaimer", true);
    expect(adapter.getSettings().powershell.scriptAnalysis).toEqual({
      enable: false,
      settingsPath: "project.psd1",
    });
    expect(adapter.getSettings().powershell.rename.acceptDisclaimer).toBe(true);
    expect(adapter.getSettings().powershell.rename).toEqual({
      acceptDisclaimer: true,
    });
  });
  it("does not advertise unsupported client lenses, hints or hierarchies", () => {
    for (const feature of ["codeLens", "inlayHints", "callHierarchy", "typeHierarchy"])
      expect(adapter.isFeatureAvailable(feature)).toBe(false);
    expect(adapter.isFeatureAvailable("semanticTokens")).toBe(true);
    expect(require("../package.json").configSchema.features.properties.codeLens).toBeUndefined();
  });
  it("reacquires the package generation after awaited unload and reload", async () => {
    const previous = main;
    edge.dispose();
    await lumine.packages.deactivatePackage("ide-powershell");
    await lumine.packages.unloadPackage("ide-powershell");
    lumine.packages.loadPackage("ide-powershell");
    main = (await lumine.packages.activatePackage("ide-powershell")).mainModule;
    server = require("../lib/server");
    register();
    expect(main).not.toBe(previous);
    expect(adapter.installServer).toBe(server.installServer);
  });
  it("reports an absent runtime or server through the hub", async () => {
    const missing = jasmine.createSpy("missing");
    main.consumeIdeClient({
      registerAdapter(value) {
        adapter = value;
        return edge;
      },
      reportMissingServer: missing,
    });
    spyOn(server, "resolveServer").and.resolveTo(null);
    expect(await adapter.resolveServer({ rootPath: directory })).toBeNull();
    expect(missing.calls.argsFor(0)[0]).toBe("ide-powershell");
  });
  it("validates a native supported runtime without changing the process environment", async () => {
    const original = process.env.PSModulePath;
    spyOn(server, "run").and.resolveTo('{"Version":"7.6.6","Edition":"Core"}');
    const runtime = await server.resolveRuntime(process.execPath);
    expect(runtime.command).toBe(process.execPath);
    expect(runtime.version).toBe("7.6.6");
    expect(server.run.calls.argsFor(0)[1]).toContain("-NoProfile");
    expect(process.env.PSModulePath).toBe(original);
  });
  it("rejects Windows PowerShell and preview or unrelated runtime output", async () => {
    spyOn(server, "run").and.resolveTo('{"Version":"5.1.0","Edition":"Desktop"}');
    await expectAsync(server.resolveRuntime(process.execPath)).toBeRejectedWithError(
      /PowerShell 7/,
    );
    server.run.and.resolveTo('{"Version":"7.7.0-preview.1","Edition":"Core"}');
    await expectAsync(server.resolveRuntime(process.execPath)).toBeRejectedWithError(
      /PowerShell 7/,
    );
    server.run.and.resolveTo("Not PowerShell");
    await expectAsync(server.resolveRuntime(process.execPath)).toBeRejected();
  });
  it("returns null when pwsh is absent and never silently replaces an explicit invalid runtime", async () => {
    spyOn(server, "findOnPath").and.returnValue(null);
    expect(await server.resolveRuntime()).toBeNull();
    await expectAsync(server.resolveRuntime(path.join(directory, "absent"))).toBeRejected();
  });
  it("prefers an explicit complete server distribution over managed modules", async () => {
    const script = payload();
    spyOn(server, "resolveRuntime").and.resolveTo({ command: process.execPath });
    spyOn(server, "run");
    const launch = await server.resolveServer({
      serverPath: script,
      managedServer: { modulePath: "/wrong" },
      rootPath: directory,
    });
    expect(launch.args).toContain(script);
    expect(launch.cwd).toBe(directory);
    expect(launch.transport).toBe("stdio");
    expect(launch.args).toContain("-LanguageServiceOnly");
    expect(launch.args).not.toContain("-EnableConsoleRepl");
    expect(server.run).not.toHaveBeenCalled();
  });
  it("prefers the managed complete payload over installed module discovery", async () => {
    const script = payload();
    spyOn(server, "resolveRuntime").and.resolveTo({ command: process.execPath });
    spyOn(server, "run");
    const launch = await server.resolveServer({
      managedServer: { modulePath: script, version: "4.7.0" },
    });
    expect(launch.version).toBe("4.7.0");
    expect(launch.args).toContain(path.dirname(path.dirname(script)));
    expect(server.run).not.toHaveBeenCalled();
  });
  it("discovers installed modules without importing or installing global modules", async () => {
    const script = payload();
    spyOn(server, "resolveRuntime").and.resolveTo({ command: process.execPath });
    spyOn(server, "run").and.resolveTo(script);
    expect((await server.resolveServer()).args).toContain(script);
    const command = server.run.calls.argsFor(0)[1].at(-1);
    expect(command).toContain("Get-Module -ListAvailable");
    expect(command).not.toContain("Install-Module");
  });
  it("refuses copied or incomplete startup scripts and preserves explicit selection errors", async () => {
    const script = payload();
    spyOn(server, "resolveRuntime").and.resolveTo({ command: process.execPath });
    fs.unlinkSync(path.join(path.dirname(script), "PowerShellEditorServices.psd1"));
    await expectAsync(server.resolveServer({ serverPath: script })).toBeRejected();
    const wrong = path.join(directory, "wrong.ps1");
    fs.writeFileSync(wrong, "# wrong\n");
    await expectAsync(server.resolveServer({ serverPath: wrong })).toBeRejectedWithError(
      /Start-EditorServices/,
    );
  });
  it("reads stable release metadata and rejects prerelease version strings", async () => {
    const api = { latestGithubRelease: jasmine.createSpy("latest").and.resolveTo(release()) };
    expect(await server.latestServerVersion(api)).toBe("4.7.0");
    api.latestGithubRelease.and.resolveTo({ version: "4.8.0-preview.1" });
    await expectAsync(server.latestServerVersion(api)).toBeRejectedWithError(/stable/);
  });
  it("installs the full official ZIP with its published checksum and validates module identity", async () => {
    payload();
    const data = release();
    const api = {
      githubReleaseByTag: jasmine.createSpy("release").and.resolveTo(data),
      downloadFile: jasmine.createSpy("download").and.resolveTo(),
      setServerInstallationStatus() {},
    };
    const installed = await server.installServer({ storagePath: directory, version: "4.7.0", api });
    expect(api.githubReleaseByTag).toHaveBeenCalledWith(
      "PowerShell/PowerShellEditorServices",
      "v4.7.0",
    );
    expect(api.downloadFile).toHaveBeenCalledWith(data.assets[0].url, directory, {
      type: "zip",
      digest: data.assets[0].digest,
    });
    expect(installed.module).toBe(
      path.join("PowerShellEditorServices", "Start-EditorServices.ps1"),
    );
    expect(installed.checksum).toBe(data.assets[0].digest);
  });
  it("rejects missing integrity, foreign release URLs and mismatched module versions", async () => {
    payload();
    const data = release();
    const api = {
      githubReleaseByTag: jasmine.createSpy("release").and.resolveTo(data),
      downloadFile: jasmine.createSpy("download").and.resolveTo(),
      setServerInstallationStatus() {},
    };
    data.assets[0].digest = undefined;
    await expectAsync(
      server.installServer({ storagePath: directory, version: "4.7.0", api }),
    ).toBeRejectedWithError(/SHA256/);
    data.assets[0] = release().assets[0];
    data.assets[0].url = "https://example.org/PowerShellEditorServices.zip";
    await expectAsync(
      server.installServer({ storagePath: directory, version: "4.7.0", api }),
    ).toBeRejectedWithError(/official ZIP/);
    data.assets[0] = release().assets[0];
    fs.writeFileSync(
      path.join(directory, "PowerShellEditorServices", "PowerShellEditorServices.psd1"),
      "ModuleVersion = '1.0.0'\n",
    );
    await expectAsync(
      server.installServer({ storagePath: directory, version: "4.7.0", api }),
    ).toBeRejectedWithError(/module version/);
  });
  it("refuses malformed versions and unsafe fixture deletion before filesystem writes", async () => {
    await expectAsync(
      server.installServer({ storagePath: directory, version: "../escape", api: {} }),
    ).toBeRejectedWithError(/stable/);
    expect(() => removeProject(os.tmpdir())).toThrowError(/unsafe/);
  });
});
