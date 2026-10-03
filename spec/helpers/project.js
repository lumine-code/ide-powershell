const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL, fileURLToPath } = require("node:url");

exports.text =
  '. "$PSScriptRoot/helper.ps1"\nfunction Get-Greeting {\n    param([string]$Name)\n    "Hello $Name"\n}\n$emoji = "😀"; $greeting = Get-Greeting -Name "World"\ngci .\nGet-ChildItem -Path .\nWrite-Output $greeting\nGet-Utility -Value 2\n';
exports.createProject = (directory) => {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "demo.ps1");
  const helper = path.join(directory, "helper.ps1");
  const text = exports.text;
  fs.writeFileSync(file, text);
  fs.writeFileSync(
    helper,
    'function Get-Utility { param([int]$Value) $Value * 2 }\n$greeting = "separate scope"\nWrite-Output $greeting\n',
  );
  return { directory, file, helper, uri: pathToFileURL(file).href, text };
};
exports.position = (text, token, occurrence = 0, offset = 1) => {
  let index = -1;
  for (let i = 0; i <= occurrence; i++) index = text.indexOf(token, index + 1);
  if (index < 0) throw new Error(`Missing fixture token: ${token}`);
  const prefix = text.slice(0, index + offset).split("\n");
  return { line: prefix.length - 1, character: prefix.at(-1).length };
};
const indexFor = (text, position) => {
  const rows = text.split("\n");
  return (
    rows.slice(0, position.line).reduce((sum, row) => sum + row.length + 1, 0) + position.character
  );
};
exports.applyTextEdits = (text, edits) => {
  const ordered = edits
    .map((edit) => ({
      ...edit,
      start: indexFor(text, edit.range.start),
      end: indexFor(text, edit.range.end),
    }))
    .sort((a, b) => b.start - a.start);
  for (const edit of ordered)
    text = text.slice(0, edit.start) + edit.newText + text.slice(edit.end);
  return text;
};
exports.editsFor = (edit, file) => {
  const result = [];
  for (const [uri, edits] of Object.entries(edit.changes || {}))
    if (path.resolve(fileURLToPath(uri)).toLowerCase() === path.resolve(file).toLowerCase())
      result.push(...edits);
  for (const change of edit.documentChanges || [])
    if (
      change.textDocument &&
      path.resolve(fileURLToPath(change.textDocument.uri)).toLowerCase() ===
        path.resolve(file).toLowerCase()
    )
      result.push(...change.edits);
  return result;
};
exports.removeProject = (directory) => {
  const resolved = path.resolve(directory);
  const temp = fs.realpathSync.native(os.tmpdir());
  if (path.dirname(resolved) !== temp || !path.basename(resolved).startsWith("ide-powershell-"))
    throw new Error("Refusing unsafe PowerShell fixture deletion.");
  return fs.promises.rm(resolved, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
};
