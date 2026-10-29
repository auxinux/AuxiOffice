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

Prérequis : Git pour Windows, Rust (outils MSVC), Node.js 22+, Python 3 ;
pour -Installer : Inno Setup 6 (winget install JRSoftware.InnoSetup).

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

# Le Bash de Git pour Windows (pas celui de WSL, C:\Windows\System32\bash.exe).
$candidats = @()
$git = Get-Command git.exe -ErrorAction SilentlyContinue
if ($git) { $candidats += Join-Path (Split-Path (Split-Path $git.Source)) 'bin\bash.exe' }
$candidats += "$env:ProgramFiles\Git\bin\bash.exe", "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe"
$bash = $candidats | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $bash) {
  Write-Host 'Erreur : Git pour Windows introuvable (il fournit Git Bash) : https://git-scm.com/download/win' -ForegroundColor Red
  exit 1
}

$options = @()
if ($AuxiText) { $options += '--auxitext' }
if ($Installer) { $options += '--installer' }
$script = (Join-Path $PSScriptRoot 'build-win.sh') -replace '\\', '/'
& $bash $script @options
exit $LASTEXITCODE
