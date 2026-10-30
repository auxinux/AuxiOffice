<#
.SYNOPSIS
Compile AuxiOffice et AuxiText pour Windows 11 x64 : exécutables et, sur demande, installateurs.

.DESCRIPTION
Lance scripts/build-win.sh dans le Bash de Git pour Windows (voir ce script pour le détail).
Résultat dans target\windows\.

.PARAMETER AuxiText
AuxiText seul (moteur inutile).

.PARAMETER Installer
Construit aussi les installateurs (Inno Setup 6 : winget install JRSoftware.InnoSetup).

.PARAMETER Help
Affiche l'aide (-h, -help, --help).

.EXAMPLE
scripts\build-win.ps1 -AuxiText -Installer
#>
param(
  [switch]$AuxiText,
  [switch]$Installer,
  [Alias('h')][switch]$Help,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Reste
)
$ErrorActionPreference = 'Stop'

$usage = @'
Usage : scripts\build-win.ps1 [-AuxiText] [-Installer] [-Help]

  scripts\build-win.ps1                       target\windows\AuxiOffice\ (la suite et son moteur)
                                              et target\windows\AuxiText\
  scripts\build-win.ps1 -AuxiText             AuxiText seul (moteur inutile, rapide)
  scripts\build-win.ps1 -Installer            les deux, plus les installateurs
                                              target\windows\*-setup.exe
  scripts\build-win.ps1 -AuxiText -Installer  AuxiText et son installateur
  scripts\build-win.ps1 -Help                 cette aide (aussi -h, --help)

Prérequis : Git pour Windows, Rust (outils MSVC), Node.js 20.19+, Python 3 ;
pour -Installer : Inno Setup 6. Ce qui manque est proposé à l'installation
(winget) ; AUXI_INSTALL=oui installe sans demander.

Si Windows refuse d'exécuter le script :
  powershell -ExecutionPolicy Bypass -File scripts\build-win.ps1 [-AuxiText] [-Installer]
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

# Le Bash de Git pour Windows (Git est proposé à l'installation s'il manque).
. (Join-Path $PSScriptRoot 'lib\git-bash.ps1')
$bash = Get-GitBash

$options = @()
if ($AuxiText) { $options += '--auxitext' }
if ($Installer) { $options += '--installer' }
$script = (Join-Path $PSScriptRoot 'build-win.sh') -replace '\\', '/'
& $bash $script @options
exit $LASTEXITCODE
