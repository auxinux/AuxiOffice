# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux

<#
.SYNOPSIS
    Build complet d'AuxiNux Office pour Windows x64 et création de l'installateur (voir BUILD.md).

.DESCRIPTION
    Étapes : vérification des dépendances, récupération des sources et du moteur upstream épinglés
    (upstream\upstream.lock.json), vérification des versions et des sommes SHA-256, patches AuxiNux,
    branding, compilation, tests, paquets dans dist\windows\ :
      AuxiNuxOffice-<version>-x64.exe  (installateur)
      AuxiNuxOffice-<version>-x64.msi  (paquet MSI)

    La chaîne de compilation de référence d'AuxiNux Office est la compilation croisée Windows
    (clang-cl et lld-link, CRT MSVC et SDK Windows téléchargés par xwin, Qt 5.15.2 msvc2019_64).
    Sous Windows, ce script l'exécute dans WSL 2 (Debian 13 ou Ubuntu 24.04) : les sources
    upstream, les outils et les fichiers intermédiaires restent dans le système de fichiers WSL
    (%USERPROFILE% n'est pas utilisé) ; seuls les paquets sont écrits dans dist\windows\.
    Sous Linux (PowerShell 7), l'orchestrateur est appelé directement.

    Le script s'arrête au premier échec (code de sortie non nul) : aucun paquet n'est alors valide.

.PARAMETER Clean
    Repartir de sources et d'arbres de build propres.
.PARAMETER Debug
    Build avec informations de débogage.
.PARAMETER Release
    Build optimisé (défaut).
.PARAMETER AcceptMsvcLicense
    Accepter les licences Microsoft du CRT MSVC et du SDK Windows téléchargés par xwin
    (obligatoire pour compiler ; voir LICENSING.md).
.PARAMETER SkipTests
    Ne pas exécuter les tests (les paquets ne sont alors PAS validés).
.PARAMETER Formats
    Paquets à produire : "exe,msi" (défaut), "exe" ou "msi".
.PARAMETER Distro
    Distribution WSL à utiliser (défaut : distribution WSL par défaut).
.PARAMETER Jobs
    Nombre de tâches de compilation parallèles (défaut : nombre de processeurs).
.PARAMETER Command
    "all" (défaut) : build complet ; "package" : réassembler et réempaqueter un build existant
    (utilisé par package-windows.ps1).

.EXAMPLE
    .\scripts\build-windows.ps1 -Release -AcceptMsvcLicense
.EXAMPLE
    .\scripts\build-windows.ps1 -Clean -Release -AcceptMsvcLicense -Formats exe
#>
param(
    [switch]$Clean,
    [switch]$Debug,
    [switch]$Release,
    [switch]$AcceptMsvcLicense,
    [switch]$SkipTests,
    [string]$Formats = "exe,msi",
    [string]$Distro = "",
    [int]$Jobs = 0,
    [ValidateSet("all", "package")]
    [string]$Command = "all"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

if ($Debug -and $Release) { throw "-Debug et -Release sont incompatibles." }
$mode = if ($Debug) { "debug" } else { "release" }
$root = Split-Path -Parent $PSScriptRoot
$onWindows = ($env:OS -eq "Windows_NT")

function Quote-Bash([string]$value) {
    # Chaîne entre apostrophes pour bash (les apostrophes internes sont échappées).
    return "'" + $value.Replace("'", "'\''") + "'"
}

# Arguments de l'orchestrateur (scripts/auxibuild)
$common = @("--target", "windows", "--mode", $mode, "--local-deps", "--formats", $Formats)
if ($Jobs -gt 0) { $common += @("-j", "$Jobs") }
if ($AcceptMsvcLicense) { $common += "--accept-msvc-license" }
if ($Command -eq "all") {
    if (-not $AcceptMsvcLicense -and $env:AUXI_ACCEPT_MSVC_LICENSE -ne "1") {
        throw ("La compilation télécharge le CRT MSVC et le SDK Windows de Microsoft (xwin). " +
               "Relancez avec -AcceptMsvcLicense après avoir lu leurs licences (voir LICENSING.md).")
    }
    $steps = @(, (@("all") + $common + $(if ($Clean) { @("--clean") } else { @() }) +
                  $(if ($SkipTests) { @("--skip-tests") } else { @() })))
} else {
    $steps = @((@("assemble") + $common), (@("package") + $common))
}

Write-Host "AuxiNux Office — build Windows x64 ($mode, $Command)"

if (-not $onWindows) {
    # PowerShell 7 sous Linux : appel direct.
    foreach ($s in $steps) {
        & python3 (Join-Path $root "scripts/auxibuild") @s
        if ($LASTEXITCODE -ne 0) { throw "ÉCHEC (code $LASTEXITCODE) : le build n'est PAS terminé." }
    }
    exit 0
}

# Windows : exécution dans WSL 2
if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    throw ("WSL est introuvable. Installez WSL 2 et Ubuntu 24.04 ou Debian 13 " +
           "(wsl --install -d Ubuntu-24.04), puis relancez ce script. Voir BUILD.md.")
}
$distroArgs = @()
if ($Distro) { $distroArgs = @("-d", $Distro) }

$wslRoot = (& wsl.exe @distroArgs -- wslpath -a ($root.Replace("\", "/")) | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $wslRoot) { throw "Impossible de convertir le chemin du dépôt pour WSL : $root" }

# Une seule ligne, sans guillemets doubles : Windows PowerShell 5.1 ne les échappe pas
# correctement dans les arguments des programmes natifs.
$cache = '$HOME/.cache/auxinux-office'
$lines = @(
    "cd $(Quote-Bash $wslRoot)",
    "export AUXI_BUILD_DIR=$cache/build AUXI_UPSTREAM_SRC=$cache/upstream-src " +
        "AUXI_CACHE_DIR=$cache/upstream-cache AUXI_TOOLCHAINS_DIR=$cache/toolchains " +
        "AUXI_DIST_DIR=$(Quote-Bash ($wslRoot + '/dist'))"
)
foreach ($s in $steps) {
    $lines += "python3 scripts/auxibuild " + (($s | ForEach-Object { Quote-Bash $_ }) -join " ")
}
$script = $lines -join " && "

& wsl.exe @distroArgs -- bash -c $script
if ($LASTEXITCODE -ne 0) {
    throw "ÉCHEC (code $LASTEXITCODE) : le build n'est PAS terminé ; aucun paquet ne doit être considéré comme valide."
}

Write-Host ""
Write-Host "Paquets produits :"
Get-ChildItem (Join-Path $root "dist\windows") -File | ForEach-Object {
    Write-Host ("  {0}  ({1:N0} Mio)" -f $_.FullName, ($_.Length / 1MB))
}
