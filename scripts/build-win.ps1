<#
Windows 11 x64 (PowerShell) : compile AuxiOffice et AuxiText en exécutables
prêts à l'emploi et, sur demande, leurs installateurs. Lance scripts/build-win.sh
dans le Bash de Git pour Windows (voir ce script pour le détail).

  scripts\build-win.ps1                       → target\windows\AuxiOffice\ et AuxiText\
  scripts\build-win.ps1 -AuxiText             → AuxiText seul (moteur inutile)
  scripts\build-win.ps1 -Installer            → les deux, plus target\windows\*-setup.exe
  scripts\build-win.ps1 -AuxiText -Installer  → AuxiText et son installateur

Si Windows refuse d'exécuter le script :
  powershell -ExecutionPolicy Bypass -File scripts\build-win.ps1 [-AuxiText] [-Installer]
#>
param(
  [switch]$AuxiText,
  [switch]$Installer
)
$ErrorActionPreference = 'Stop'

# Le Bash de Git pour Windows (pas celui de WSL, C:\Windows\System32\bash.exe).
$candidats = @()
$git = Get-Command git.exe -ErrorAction SilentlyContinue
if ($git) { $candidats += Join-Path (Split-Path (Split-Path $git.Source)) 'bin\bash.exe' }
$candidats += "$env:ProgramFiles\Git\bin\bash.exe", "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe"
$bash = $candidats | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $bash) {
  Write-Error 'Git pour Windows introuvable (il fournit Git Bash) : https://git-scm.com/download/win'
  exit 1
}

$options = @()
if ($AuxiText) { $options += '--auxitext' }
if ($Installer) { $options += '--installer' }
$script = (Join-Path $PSScriptRoot 'build-win.sh') -replace '\\', '/'
& $bash $script @options
exit $LASTEXITCODE
