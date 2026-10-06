# ide-powershell

Provide PowerShell language features with Editor Services.

Registers the official [PowerShell Editor Services](https://github.com/PowerShell/PowerShellEditorServices) language server with `ide`. Install `language-powershell` for syntax highlighting and the editor service frontends for the features you want to display.

## Features

- **Code intelligence**: supplies cmdlet, parameter, variable and member completion, command help and signature information.
- **Diagnostics**: reports parser errors and bundled PSScriptAnalyzer warnings with applicable corrections.
- **Navigation**: finds definitions, references and document or workspace symbols, including dot-sourced scripts.
- **Refactoring**: applies analyzer fixes and renames local symbols within a single script on a best-effort basis.
- **Formatting**: formats scripts and selections with PSScriptAnalyzer.
- **Semantic information**: classifies PowerShell symbols with semantic tokens.
- **Managed installation**: verifies the official release ZIP and preserves its bundled analyzer, modules, dependencies and legal notices.

## Installation

To install `ide-powershell` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/ide-powershell`.

Install a [supported PowerShell 7+ runtime](https://learn.microsoft.com/powershell/scripting/install/powershell-support-lifecycle), `ide` and `language-powershell`. Use `ide:manage-servers` to install Editor Services, or select `Start-EditorServices.ps1` from a complete official distribution. An explicit server path takes precedence over the managed copy, which takes precedence over an installed PowerShell module. The adapter finds `pwsh` on PATH unless you select its executable in the settings. It does not install a runtime or global modules.

## Usage

Open a script or the folder containing your PowerShell project. The selected runtime and its module environment determine which cmdlets are available. PowerShell profiles are not loaded by the language session. Select your project's `PSScriptAnalyzerSettings.psd1` file to apply its analysis rules without rewriting it; relative paths resolve from the workspace root. An empty analyzer settings path uses the server's default rules.

Editor Services uses stdio for language features. Its Extension Terminal, debugger, Pester run/debug lenses and client documentation commands require separate client integrations and are unavailable here. Compiler-style code actions that contain edits remain available.

PowerShell rename is best effort and restricted to one file. Dynamic scope, generated names, cross-file relationships and several scoped-variable cases cannot be renamed reliably. The server asks you to acknowledge [its documented limitations](https://github.com/PowerShell/PowerShellEditorServices#rename-disclaimer) on first use in each session; the explicit acknowledgement setting preserves that choice across sessions. Review the proposed edits before applying a rename. PowerShell `.ps1xml` files contain XML and are excluded from this server.

## Services

- `ide`: consumed to register Editor Services and its managed installation.
- `background-tips.provider`: provided to background-tips to explain runtime selection and analyzer fixes.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
