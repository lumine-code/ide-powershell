const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createProject, removeProject, position } = require("./helpers/project");
const { serverPath, powershellPath, liveSuite } = require("./helpers/environment");
const until = async (check, label) => {
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`${label} timed out`);
};
liveSuite("ide-powershell actual editor routing and lifecycle", () => {
  let directory, editor, service, clientMain, previousPaths, diagnostics, edge, timeout;
  beforeAll(() => {
    timeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 120000;
  });
  afterAll(() => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = timeout;
  });
  beforeEach(async () => {
    jasmine.useRealClock();
    previousPaths = lumine.project.getPaths();
    directory = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "ide-powershell-editor-"),
    );
    lumine.config.set("ide-powershell.serverPath", serverPath);
    lumine.config.set("ide-powershell.powershellPath", powershellPath);
    lumine.config.set("ide-powershell.acceptRenameDisclaimer", true);
    for (const name of ["language-powershell", "ide-client", "ide-powershell"])
      await lumine.packages.activatePackage(name);
    clientMain = lumine.packages.getActivePackage("ide-client").mainModule;
    service = clientMain.provideIdeClient();
    diagnostics = [];
    edge = service.onDidPublishDiagnostics((event) => diagnostics.push(event));
  });
  afterEach(async () => {
    edge?.dispose();
    editor?.destroy();
    for (const name of ["ide-powershell", "ide-client", "language-powershell"])
      await lumine.packages.deactivatePackage(name);
    for (const key of ["serverPath", "powershellPath", "acceptRenameDisclaimer", "features"])
      lumine.config.unset(`ide-powershell.${key}`);
    lumine.project.setPaths(previousPaths);
    await lumine.fileWatchClient.settlePendingTeardown();
    await removeProject(directory);
    editor = null;
  });
  const open = async (fixture) => {
    lumine.project.setPaths([directory]);
    editor = await lumine.workspace.open(fixture.file);
    editor.setGrammar(lumine.grammars.grammarForScopeName("source.powershell"));
    return until(
      async () =>
        (await service.activeSessionsForEditor(editor)).find(
          ({ adapter }) => adapter.id === "ide-powershell",
        ),
      "PowerShell session",
    );
  };
  it("routes actual providers, filters client commands and applies local UTF-16 renames and analyzer fixes", async () => {
    const fixture = createProject(directory);
    const session = await open(fixture);
    await until(
      () =>
        diagnostics.some(({ diagnostics: items }) =>
          items.some(({ code }) => code === "PSAvoidUsingCmdletAliases"),
        ),
      "analyzer diagnostics",
    );
    const Point = require("lumine").Point;
    const at = (token, occurrence = 0, offset = 1) => {
      const p = position(editor.getText(), token, occurrence, offset);
      return new Point(p.line, p.character);
    };
    expect(
      JSON.stringify(await clientMain.provideContextHelp().getHelp(editor, at("Get-ChildItem"))),
    ).toContain("Get-ChildItem");
    expect(
      (
        await clientMain
          .provideHoverSignature()
          .getSignature(editor, at("Get-ChildItem -Path", 0, "Get-ChildItem -Path ".length))
      ).signatures[0].label,
    ).toContain("-Path");
    const documentProvider = clientMain.provideDocumentSymbolProvider();
    const source = documentProvider
      .getDocumentSymbolSources(editor)
      .find(({ id }) => id === "ide-client:ide-powershell");
    expect(source.state).toBe("ready");
    const symbols = await documentProvider.getDocumentSymbols(editor, { sourceId: source.id });
    expect(symbols.some(({ name }) => name.includes("Get-Greeting"))).toBe(true);
    expect(
      (await clientMain.provideWorkspaceSymbolProvider().searchWorkspaceSymbols("Get-")).some(
        ({ name }) => name.includes("Get-Greeting"),
      ),
    ).toBe(true);
    editor.setCursorBufferPosition(at("Get-Utility"));
    expect(
      (await clientMain.provideDefinitionProvider().getDefinitions(editor)).some(
        ({ path: target }) => target?.toLowerCase() === fixture.helper.toLowerCase(),
      ),
    ).toBe(true);
    expect(
      (await clientMain.provideFindReferences().findReferences(editor, at("Get-Greeting", 1)))
        .references.length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      (await clientMain.provideSemanticTokens().semanticTokens(editor)).length,
    ).toBeGreaterThan(0);
    expect(
      (await clientMain.provideCodeFormatFile().formatEntireFile(editor)).length,
    ).toBeGreaterThan(0);
    for (const method of [
      "textDocument/codeLens",
      "textDocument/inlayHint",
      "textDocument/prepareCallHierarchy",
      "textDocument/prepareTypeHierarchy",
    ])
      expect(session.supports(method, editor)).toBe(false);
    const renamed = await clientMain
      .provideRefactor()
      .rename(editor, at("$greeting", 0, 2), "salutation", { dryRun: true });
    expect(renamed.outcome).toBe("edits");
    expect(renamed.edits.size).toBe(1);
    const edits = [...renamed.edits.values()].flat();
    expect(
      await service.applyWorkspaceEdit(
        {
          changes: {
            [fixture.uri]: edits.map(({ oldRange, newText }) => ({
              range: {
                start: { line: oldRange[0][0], character: oldRange[0][1] },
                end: { line: oldRange[1][0], character: oldRange[1][1] },
              },
              newText,
            })),
          },
        },
        "Rename PowerShell variable",
        session,
      ),
    ).toBe(true);
    expect(editor.getText()).toContain('$emoji = "😀"; $salutation = Get-Greeting');
    expect(fs.readFileSync(fixture.helper, "utf8")).toContain("$greeting");
    const actions = await clientMain
      .provideIntentionsList()
      .getIntentions({ textEditor: editor, bufferPosition: at("gci") });
    expect(actions.some(({ title }) => title.startsWith("Show documentation"))).toBe(false);
    const fix = actions.find(({ title }) => title.includes("Replace gci with Get-ChildItem"));
    expect(fix).toBeDefined();
    await fix.selected();
    expect(editor.getText()).not.toContain("\ngci .");
    await until(() => {
      const latest = diagnostics.filter(({ session: owner }) => owner === session).at(-1);
      return latest && !latest.diagnostics.some(({ code }) => code === "PSAvoidUsingCmdletAliases");
    }, "alias fix diagnostic clearing");
    const valid = editor.getText();
    const beforeCompletion = diagnostics.length;
    editor.setText(valid + "Get-ChildItem -P");
    await until(() => diagnostics.length > beforeCompletion, "completion text synchronized");
    const suggestions = await clientMain.provideAutocomplete().getSuggestions({
      editor,
      bufferPosition: new Point(10, 16),
      prefix: "P",
      activatedManually: true,
    });
    expect(
      suggestions.some(({ displayText, text, snippet }) =>
        (displayText || text || snippet || "").includes("Path"),
      ),
    ).toBe(true);
    editor.setText(valid + "Write-Output $emoji\n");
    await until(
      () =>
        diagnostics.filter(({ session: owner }) => owner === session).at(-1)?.diagnostics.length ===
        0,
      "complete diagnostic clearing",
    );
  });
  it("honours every supported feature gate, rejects XML data and reloads a fresh package generation", async () => {
    const fixture = createProject(directory);
    const session = await open(fixture);
    await until(
      () =>
        diagnostics.some(({ diagnostics: items }) =>
          items.some(({ code }) => code === "PSAvoidUsingCmdletAliases"),
        ),
      "diagnostics before gates",
    );
    for (const [feature, method] of [
      ["autocomplete", "textDocument/completion"],
      ["hover", "textDocument/hover"],
      ["signature", "textDocument/signatureHelp"],
      ["definition", "textDocument/definition"],
      ["references", "textDocument/references"],
      ["symbols", "textDocument/documentSymbol"],
      ["format", "textDocument/formatting"],
      ["rename", "textDocument/rename"],
      ["codeActions", "textDocument/codeAction"],
      ["semanticTokens", "textDocument/semanticTokens"],
    ]) {
      lumine.config.set(`ide-powershell.features.${feature}`, false);
      expect(await service.activeSessionForFeature(editor, method)).toBeNull();
      lumine.config.unset(`ide-powershell.features.${feature}`);
      expect(await service.activeSessionForFeature(editor, method)).toBe(session);
    }
    lumine.config.set("ide-powershell.features.diagnostics", false);
    expect(service.featureEnabled(session.adapter, "diagnostics", editor)).toBe(false);
    lumine.config.unset("ide-powershell.features.diagnostics");
    expect(service.featureEnabled(session.adapter, "diagnostics", editor)).toBe(true);
    const xml = lumine.workspace.buildTextEditor();
    xml.setGrammar(editor.getGrammar());
    xml.getBuffer().setPath(path.join(directory, "view.ps1xml"));
    expect(service.adaptersForEditor(xml)).toEqual([]);
    xml.destroy();
    const previous = lumine.packages.getActivePackage("ide-powershell").mainModule;
    await lumine.packages.deactivatePackage("ide-powershell");
    await until(() => session.state === "stopped", "old session stopped");
    await lumine.packages.unloadPackage("ide-powershell");
    lumine.packages.loadPackage("ide-powershell");
    const current = await lumine.packages.activatePackage("ide-powershell");
    expect(current.mainModule).not.toBe(previous);
    const replacement = await until(
      async () =>
        (await service.activeSessionsForEditor(editor)).find(
          ({ adapter }) => adapter.id === "ide-powershell",
        ),
      "fresh session",
    );
    expect(replacement).not.toBe(session);
  });
  it("stops a fresh production session and waits for its actual PowerShell process to exit", async () => {
    const session = await open(createProject(directory));
    const child = session.process;
    const request = session.connection.request.bind(session.connection);
    let shutdown;
    spyOn(session.connection, "request").and.callFake((method, ...args) => {
      const result = request(method, ...args);
      if (method === "shutdown") shutdown = result;
      return result;
    });
    const start = Date.now();
    await service.stop(session);
    expect(session.state).toBe("stopped");
    expect(shutdown).toBeDefined();
    await expectAsync(shutdown).toBeResolved();
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    expect(() => process.kill(child.pid, 0)).toThrow();
    console.log(
      `PSES cold stop: shutdown acknowledged, physical exit after ${Date.now() - start}ms; code=${child.exitCode}, signal=${child.signalCode}`,
    );
    editor.destroy();
    editor = null;
    lumine.project.setPaths(previousPaths);
    await lumine.fileWatchClient.settlePendingTeardown();
  });
});
