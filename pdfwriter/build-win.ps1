<#
.SYNOPSIS
Compile AuxiPDFWriter pour Windows 11 x64.

.DESCRIPTION
Produit pdfwriter\target\windows\AuxiPDFWriter\AuxiPDFWriter.exe, qui se lance tel quel.
Prérequis : Rust avec les outils MSVC, Node.js 22 ou plus. WebView2 est fourni avec Windows 11.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File pdfwriter\build-win.ps1
#>
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Fail([string]$message) {
  Write-Host "`nErreur : $message" -ForegroundColor Red
  exit 1
}

# Lance une commande et s'arrête si elle échoue.
function Run([string]$exe, [string[]]$arguments) {
  & $exe @arguments
  if ($LASTEXITCODE -ne 0) { Fail "$exe $($arguments -join ' ') a échoué (code $LASTEXITCODE)." }
}

foreach ($c in 'node', 'npm.cmd', 'cargo', 'rustc') {
  if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { Fail "commande absente : $c (voir pdfwriter\README.md)." }
}
if (-not ((& rustc -vV) -match 'host: .*-msvc')) {
  Fail "Rust doit utiliser les outils MSVC (rustup default stable-x86_64-pc-windows-msvc)."
}

# Le contrôle intelligent des applications bloque les programmes que Rust compile puis lance.
$policy = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -ErrorAction SilentlyContinue
if ($policy -and $policy.VerifiedAndReputablePolicyState -eq 1) {
  Fail "désactivez le contrôle intelligent des applications : Sécurité Windows, Contrôle des applications et du navigateur (sinon « os error 4551 »)."
}

Write-Host "`n== Interface"
Run 'npm.cmd' @('install', '--no-audit', '--no-fund')
Run 'npm.cmd' @('run', 'build')

Write-Host "`n== Application"
Push-Location 'src-tauri'
try {
  Run 'cargo' @('build', '--release', '--features', 'custom-protocol')
} finally {
  Pop-Location
}

$out = Join-Path $PSScriptRoot 'target\windows\AuxiPDFWriter'
New-Item -ItemType Directory -Force -Path $out | Out-Null
Copy-Item 'src-tauri\target\release\auxipdfwriter.exe' (Join-Path $out 'AuxiPDFWriter.exe') -Force

Write-Host "`nTerminé : $out\AuxiPDFWriter.exe" -ForegroundColor Green
