const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

const REPOSITORY = "PowerShell/PowerShellEditorServices";
const SCRIPT = path.join("PowerShellEditorServices", "Start-EditorServices.ps1");
const VERSION = /^\d+\.\d+\.\d+$/;
exports.run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { windowsHide: true, timeout: 15000, ...options },
      (error, stdout, stderr) =>
        error
          ? reject(new Error(String(stderr || stdout || error.message).trim(), { cause: error }))
          : resolve(String(stdout).trim()),
    );
  });
exports.findOnPath = (name, env = process.env) => {
  for (const directory of (env.PATH || env.Path || "").split(path.delimiter).filter(Boolean)) {
    for (const suffix of process.platform === "win32" ? [".exe", ""] : [""]) {
      const candidate = path.join(directory, name + suffix);
      try {
        if (fs.statSync(candidate).isFile()) {
          fs.accessSync(candidate, fs.constants.X_OK);
          return candidate;
        }
      } catch {
        /* Continue searching. */
      }
    }
  }
  return null;
};
exports.resolveRuntime = async (configured = "") => {
  const candidate = configured || exports.findOnPath("pwsh");
  if (!candidate) return null;
  const command = await fs.promises.realpath(candidate);
  if (!(await fs.promises.stat(command)).isFile() || /\.(cmd|bat)$/i.test(command))
    throw new Error("PowerShell Path must name the native pwsh executable.");
  await fs.promises.access(command, fs.constants.X_OK);
  const info = JSON.parse(
    await exports.run(command, [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "@{Version=$PSVersionTable.PSVersion.ToString();Edition=$PSVersionTable.PSEdition}|ConvertTo-Json -Compress",
    ]),
  );
  if (
    !VERSION.test(info.Version || "") ||
    Number(info.Version.split(".")[0]) < 7 ||
    info.Edition !== "Core"
  )
    throw new Error("Editor Services requires a supported PowerShell 7+ runtime. Select pwsh.");
  return { command, version: info.Version };
};
exports.resolveServer = async ({
  serverPath = "",
  powershellPath = "",
  managedServer,
  rootPath,
} = {}) => {
  const runtime = await exports.resolveRuntime(powershellPath);
  if (!runtime) return null;
  let candidate = serverPath || managedServer?.modulePath || managedServer?.binaryPath;
  if (!candidate) {
    candidate = await exports.run(runtime.command, [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$m=Get-Module -ListAvailable PowerShellEditorServices|Sort-Object Version -Descending|Select-Object -First 1;if($m){Join-Path $m.ModuleBase 'Start-EditorServices.ps1'}",
    ]);
  }
  if (!candidate) return null;
  const script = await fs.promises.realpath(candidate);
  if (path.basename(script).toLowerCase() !== "start-editorservices.ps1")
    throw new Error(
      "Server Path must name Start-EditorServices.ps1 from the complete distribution.",
    );
  const modulePath = path.dirname(script);
  await fs.promises.access(
    path.join(modulePath, "PowerShellEditorServices.psd1"),
    fs.constants.R_OK,
  );
  await fs.promises.access(script, fs.constants.R_OK);
  return {
    command: runtime.command,
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-File",
      script,
      "-Stdio",
      "-LanguageServiceOnly",
      "-LogLevel",
      "Error",
      "-BundledModulesPath",
      path.dirname(modulePath),
      "-HostName",
      "Lumine",
      "-HostProfileId",
      "lumine",
      "-HostVersion",
      "1.0.0",
    ],
    cwd: rootPath,
    transport: "stdio",
    version: serverPath ? undefined : managedServer?.version,
  };
};
exports.latestServerVersion = async (api) => {
  const release = await api.latestGithubRelease(REPOSITORY);
  if (!VERSION.test(release.version))
    throw new Error("Editor Services published no stable release version.");
  return release.version;
};
exports.installServer = async ({ storagePath, version, api }) => {
  if (version && !VERSION.test(version))
    throw new Error("Choose a stable Editor Services release version.");
  api.setServerInstallationStatus("checking");
  const release = version
    ? await api.githubReleaseByTag(REPOSITORY, `v${version}`)
    : await api.latestGithubRelease(REPOSITORY);
  const asset = release.assets.find((entry) => entry.name === "PowerShellEditorServices.zip");
  if (
    !VERSION.test(release.version || "") ||
    release.tag !== `v${release.version}` ||
    (version && release.version !== version) ||
    asset?.url !==
      `https://github.com/${REPOSITORY}/releases/download/${release.tag}/PowerShellEditorServices.zip` ||
    !/^sha256:[a-f0-9]{64}$/i.test(asset.digest || "")
  )
    throw new Error(
      "Editor Services release has no exact official ZIP with SHA256 integrity metadata.",
    );
  api.setServerInstallationStatus("downloading");
  await api.downloadFile(asset.url, storagePath, { type: "zip", digest: asset.digest });
  for (const relative of [
    SCRIPT,
    path.join("PowerShellEditorServices", "PowerShellEditorServices.psd1"),
    "LICENSE",
    "NOTICE.txt",
  ])
    await fs.promises.access(path.join(storagePath, relative), fs.constants.R_OK);
  if (!(await fs.promises.stat(path.join(storagePath, "PSScriptAnalyzer"))).isDirectory())
    throw new Error("The Editor Services distribution is missing its bundled ScriptAnalyzer.");
  const manifest = await fs.promises.readFile(
    path.join(storagePath, "PowerShellEditorServices", "PowerShellEditorServices.psd1"),
    "utf8",
  );
  if (manifest.match(/^ModuleVersion\s*=\s*'([^']+)'/m)?.[1] !== release.version)
    throw new Error("The Editor Services module version does not match the selected release.");
  return {
    version: release.version,
    module: SCRIPT,
    distribution: asset.url,
    checksum: asset.digest,
    source: "github-release",
  };
};
