<#
.SYNOPSIS
Compile AuxiOffice et AuxiText pour le système courant (Windows, macOS, Linux) et, sur
demande, leurs installateurs.

.DESCRIPTION
Lance scripts/build.sh : sous Windows dans le Bash de Git pour Windows, ailleurs avec
/bin/sh (PowerShell 7). Voir build.sh pour le détail des installateurs produits.

.PARAMETER AuxiText
AuxiText seul (moteur inutile).

.PARAMETER Installer
Construit aussi les installateurs (Inno Setup 6 : winget install JRSoftware.InnoSetup).

.PARAMETER Help
Affiche l'aide (-h, -help, --help).

.EXAMPLE
scripts/build.ps1 -AuxiText -Installer
#>
param(
  [switch]$AuxiText,
  [switch]$Installer,
  [Alias('h')][switch]$Help,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Reste
)
$ErrorActionPreference = 'Stop'

$usage = @'
Usage : scripts/build.ps1 [-AuxiText] [-Installer] [-Help]

  scripts/build.ps1                       les applications (suite et AuxiText)
  scripts/build.ps1 -AuxiText             AuxiText seul (moteur inutile, rapide)
  scripts/build.ps1 -Installer            les applications et leurs installateurs
  scripts/build.ps1 -AuxiText -Installer  AuxiText et son installateur
  scripts/build.ps1 -Help                 cette aide (aussi -h, --help)

Installateurs produits :
  Windows  target\windows\AuxiOffice-<version>-windows-x64-setup.exe (la suite et AuxiText)
           et AuxiText-<version>-windows-x64-setup.exe        (Inno Setup 6 requis :
                                                              winget install JRSoftware.InnoSetup)
  macOS    target/macos/AuxiOffice-<version>-macos-arm64.dmg (la suite et AuxiText)
           et AuxiText-<version>-macos-arm64.dmg
  Linux    target/deb/auxioffice_<version>_<arch>.deb (dépend d'auxitext)
           et auxitext_<version>_<arch>.deb

Prérequis manquants (Git, Rust et outils MSVC, Node.js, Python, Inno Setup) :
  proposés à l'installation avec winget ; AUXI_INSTALL=oui installe sans demander.

Si Windows refuse d'exécuter le script :
  powershell -ExecutionPolicy Bypass -File scripts\build.ps1 [-AuxiText] [-Installer]
'@

# --help, --auxitext… (forme Git Bash) arrivent ici comme simples arguments.
foreach ($a in $Reste) {
  switch -Regex ($a) {
    '^(--?help|/\?)$' { $Help = $true }
    '^--auxitext$' { $AuxiText = $true }
    '^--installer$' { $Installer = $true }
    default { Write-Host "Option inconnue : $a`n" -ForegroundColor Red; Write-Host $usage; exit 1 }
  }
}
if ($Help) { Write-Host $usage; exit 0 }

$options = @()
if ($AuxiText) { $options += '--auxitext' }
if ($Installer) { $options += '--installer' }
$script = (Join-Path $PSScriptRoot 'build.sh') -replace '\\', '/'

# macOS et Linux (PowerShell 7) : le shell du système.
if ($env:OS -ne 'Windows_NT') {
  & /bin/sh $script @options
  exit $LASTEXITCODE
}

# Windows : le Bash de Git pour Windows (Git est proposé à l'installation s'il manque).
. (Join-Path $PSScriptRoot 'lib\git-bash.ps1')
$bash = Get-GitBash

& $bash $script @options
exit $LASTEXITCODE
