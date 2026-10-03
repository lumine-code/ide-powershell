const assert = require("node:assert/strict");
const fs = require("node:fs");
const { fileURLToPath } = require("node:url");
const { position, editsFor, applyTextEdits } = require("./project");

exports.exerciseServer = async (client, fixture) => {
  const covered = [];
  const check = (condition, label) => {
    assert(condition, label);
    covered.push(label);
  };
  const request = (method, extra = {}) =>
    client.request(method, { textDocument: { uri: fixture.uri }, ...extra });
  let text = fixture.text,
    version = 1;
  const change = (next) => {
    text = next;
    client.connection.sendNotification("textDocument/didChange", {
      textDocument: { uri: fixture.uri, version: ++version },
      contentChanges: [{ text }],
    });
  };
  const latest = () =>
    client.messages("textDocument/publishDiagnostics").at(-1)?.params.diagnostics;
  client.open(fixture.uri, "powershell", text);
  const diagnostics = await client.waitFor(
    () => latest()?.some(({ code }) => code === "PSAvoidUsingCmdletAliases") && latest(),
    "ScriptAnalyzer diagnostics",
  );
  check(
    diagnostics.some(
      ({ source, code }) =>
        source === "PSScriptAnalyzer" && code === "PSUseDeclaredVarsMoreThanAssignments",
    ),
    "ScriptAnalyzer diagnostics",
  );
  const hover = await request("textDocument/hover", { position: position(text, "Get-ChildItem") });
  check(JSON.stringify(hover.contents).includes("Get-ChildItem"), "cmdlet hover");
  const signature = await request("textDocument/signatureHelp", {
    position: position(text, "Get-ChildItem -Path", 0, "Get-ChildItem -Path ".length),
  });
  check(
    signature.signatures.some(({ parameters }) =>
      parameters?.some(({ label }) => label === "-Path"),
    ),
    "parameter signatures",
  );
  const definition = await request("textDocument/definition", {
    position: position(text, "Get-Greeting", 1),
  });
  check(
    fileURLToPath((Array.isArray(definition) ? definition[0] : definition).uri).toLowerCase() ===
      fixture.file.toLowerCase(),
    "local definition",
  );
  const external = await request("textDocument/definition", {
    position: position(text, "Get-Utility"),
  });
  check(
    fileURLToPath((Array.isArray(external) ? external[0] : external).uri).toLowerCase() ===
      fixture.helper.toLowerCase(),
    "closed helper definition",
  );
  const references = await request("textDocument/references", {
    position: position(text, "Get-Greeting", 1),
    context: { includeDeclaration: true },
  });
  check(references.length >= 2, "references");
  const symbols = await request("textDocument/documentSymbol");
  check(
    symbols.some(({ name }) => name.includes("Get-Greeting")),
    "document symbols",
  );
  const workspace = await client.request("workspace/symbol", { query: "Get-" });
  check(
    workspace.some(({ name }) => name.includes("Get-Utility")),
    "workspace symbols",
  );
  const formatting = await request("textDocument/formatting", {
    options: { tabSize: 4, insertSpaces: true },
  });
  check(
    formatting.length && applyTextEdits(text, formatting).includes('"😀"'),
    "document formatting",
  );
  const rangeFormatting = await request("textDocument/rangeFormatting", {
    range: { start: { line: 1, character: 0 }, end: { line: 5, character: 0 } },
    options: { tabSize: 4, insertSpaces: true },
  });
  check(rangeFormatting.length > 0, "range formatting");
  const semantic = await request("textDocument/semanticTokens/full");
  check(semantic.data.length > 0 && semantic.data.length % 5 === 0, "semantic tokens");
  const alias = diagnostics.find(({ code }) => code === "PSAvoidUsingCmdletAliases");
  const actions = await request("textDocument/codeAction", {
    range: alias.range,
    context: { diagnostics: [alias] },
  });
  const fix = actions.find(
    ({ title, edit }) => edit && title.includes("Replace gci with Get-ChildItem"),
  );
  check(!!fix, "ScriptAnalyzer quickfix");
  change(applyTextEdits(text, editsFor(fix.edit, fixture.file)));
  await client.waitFor(
    () => latest() && !latest().some(({ code }) => code === "PSAvoidUsingCmdletAliases"),
    "alias diagnostic clearing",
  );
  check(
    latest().some(({ code }) => code === "PSUseDeclaredVarsMoreThanAssignments"),
    "independent diagnostic retention",
  );
  const prepared = await request("textDocument/prepareRename", {
    position: position(text, "$greeting", 0, 2),
  });
  check(prepared.defaultBehavior || prepared.range, "prepare rename");
  const renamed = await request("textDocument/rename", {
    position: position(text, "$greeting", 0, 2),
    newName: "salutation",
  });
  const changedUris = Object.keys(renamed.changes || {});
  check(
    changedUris.length === 1 &&
      editsFor(renamed, fixture.helper).length === 0 &&
      fs.readFileSync(fixture.helper, "utf8").includes("$greeting"),
    "single-file rename",
  );
  change(applyTextEdits(text, editsFor(renamed, fixture.file)));
  check(
    text.includes('$emoji = "😀"; $salutation = Get-Greeting') &&
      text.includes("Write-Output $salutation"),
    "UTF-16 rename after emoji",
  );
  const valid = text;
  change(valid + "Get-Chi");
  const commandItems = await client.waitFor(async () => {
    const response = await request("textDocument/completion", {
      position: { line: 10, character: 7 },
      context: { triggerKind: 1 },
    });
    const items = Array.isArray(response) ? response : response.items;
    return items.some(({ label }) => label === "Get-ChildItem") && items;
  }, "cmdlet completion");
  const completed = await client.request(
    "completionItem/resolve",
    commandItems.find(({ label }) => label === "Get-ChildItem"),
  );
  check(!!completed.detail || !!completed.documentation, "resolved cmdlet completion");
  change(valid + "Get-ChildItem -P");
  const parameters = await client.waitFor(async () => {
    const response = await request("textDocument/completion", {
      position: { line: 10, character: 16 },
      context: { triggerKind: 1 },
    });
    const items = Array.isArray(response) ? response : response.items;
    return items.some(({ label }) => label === "Path") && items;
  }, "parameter completion");
  check(
    parameters.find(({ label }) => label === "Path").textEdit.newText === "-Path",
    "parameter completion edits",
  );
  change(valid + "$broken = (\n");
  await client.waitFor(
    () => latest()?.some(({ severity }) => severity === 1),
    "parser diagnostics",
  );
  covered.push("parser diagnostics");
  change(valid + "Write-Output $emoji\n");
  await client.waitFor(() => latest()?.length === 0, "complete diagnostic clearing");
  covered.push("complete diagnostic clearing");
  return covered;
};
