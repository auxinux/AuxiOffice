# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux

<#
.SYNOPSIS
    Construit AuxiNux Office (avec AuxiText) sous Windows 11 : installateur et MSI dans dist\windows\.

.DESCRIPTION
    git clone git@git.auxinux.ca:Auxinux/AuxiNux_Office.git
    cd AuxiNux_Office
    powershell -ExecutionPolicy Bypass -File .\build.ps1

    La compilation s'exécute dans WSL 2 (Linux intégré à Windows, fourni par Microsoft), avec la
    même chaîne que les builds officiels. Le script :
      1. vérifie WSL 2 et choisit une distribution déjà installée qui convient (Debian 13,
         Ubuntu 24.04 ou plus récente) ; sinon, propose d'installer Ubuntu 24.04 (droits
         administrateur, redémarrage) ;
      2. installe dans WSL les quelques outils nécessaires (python3, git, make, Node.js) ;
      3. demande d'accepter les licences Microsoft du CRT Visual C++ et du SDK Windows,
         téléchargés pour compiler (sauf si -AcceptMsvcLicense est donné) ;
      4. lance le build : dist\windows\AuxiNuxOffice-<version>-x64.exe et .msi.
    Durée : 45 à 90 minutes la première fois.

.PARAMETER Clean
    Repartir de zéro.
.PARAMETER AcceptMsvcLicense
    Accepter sans question les licences Microsoft (CRT MSVC, SDK Windows).
.PARAMETER Distro
    Distribution WSL à utiliser (défaut : la première distribution installée compatible, en
    commençant par celle par défaut de WSL ; Ubuntu-24.04, installée si aucune ne convient).
#>
param(
    [switch]$Clean,
    [switch]$AcceptMsvcLicense,
    [string]$Distro = ""
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

function Say([string]$text) { Write-Host "`n==> $text" -ForegroundColor Yellow }
function Die([string]$text) { Write-Host "`nÉCHEC : $text" -ForegroundColor Red; exit 1 }

if ($env:OS -ne "Windows_NT") { Die "build.ps1 est prévu pour Windows. Sous Linux ou macOS : ./build.sh" }

# --- 1. WSL 2 ---------------------------------------------------------------
Say "Vérification de WSL 2"
if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    Die "WSL n'est pas disponible sur ce Windows. Windows 11 à jour requis."
}
$distros = @(& wsl.exe --list --quiet 2>$null | ForEach-Object { ($_ -replace "`0", "").Trim() } | Where-Object { $_ })

# Une distribution convient si elle tourne sous WSL 2, fournit apt-get et une glibc >= 2.38
# (Debian 13, Ubuntu 24.04 ou plus récente : voir BUILD.md).
function Test-Distro([string]$name) {
    # Pas de guillemets doubles (mal transmis par Windows PowerShell 5.1) ; --exec évite que le
    # shell de connexion de la distribution n'interprète la commande une seconde fois.
    $probe = 'uname -r | grep -q Microsoft && exit 1; command -v apt-get >/dev/null || exit 2; ' +
             'v=$(getconf GNU_LIBC_VERSION 2>/dev/null | cut -d'' '' -f2); ' +
             'test $(printf ''%s\n2.38\n'' $v | sort -V | head -n1) = 2.38 || exit 3; ' +
             '. /etc/os-release; echo $PRETTY_NAME'
    $out = (& wsl.exe -d $name --exec sh -c $probe 2>$null | Out-String).Trim()
    switch ($LASTEXITCODE) {
        0 { return @{ Ok = $true; Info = $out } }
        1 { return @{ Ok = $false; Info = "WSL 1 (WSL 2 requis : wsl --set-version $name 2)" } }
        2 { return @{ Ok = $false; Info = "pas de apt-get (Debian ou Ubuntu requis)" } }
        3 { return @{ Ok = $false; Info = "trop ancienne (glibc 2.38 requise : Debian 13, Ubuntu 24.04)" } }
        default { return @{ Ok = $false; Info = "ne démarre pas" } }
    }
}

if (-not $Distro) {
    # wsl --list place la distribution par défaut en tête : elle est essayée en premier.
    foreach ($d in $distros) {
        if ($d -match '^docker-desktop') { continue }
        $result = Test-Distro $d
        if ($result.Ok) { $Distro = $d; Write-Host "Distribution WSL : $d ($($result.Info))"; break }
        Write-Host "Distribution WSL « $d » ignorée : $($result.Info)"
    }
    if (-not $Distro) { $Distro = "Ubuntu-24.04" }
} elseif ($distros -contains $Distro) {
    $result = Test-Distro $Distro
    if (-not $result.Ok) { Die "la distribution WSL « $Distro » ne convient pas : $($result.Info)" }
    Write-Host "Distribution WSL : $Distro ($($result.Info))"
}

if ($distros -notcontains $Distro) {
    Write-Host "Aucune distribution WSL compatible n'est installée (Debian 13 ou Ubuntu 24.04 requis)."
    $answer = Read-Host "Installer « $Distro » maintenant ? (droits administrateur ; un redémarrage peut être demandé) [o/N]"
    if ($answer -notmatch '^[oOyY]') { Die "WSL 2 est nécessaire pour compiler AuxiNux Office (voir BUILD.md)." }
    Start-Process wsl.exe -ArgumentList @("--install", "-d", $Distro) -Verb RunAs -Wait
    Write-Host ""
    Write-Host "Si Windows demande un redémarrage, redémarrez. Ouvrez ensuite « $Distro » une fois depuis le"
    Write-Host "menu Démarrer pour créer votre utilisateur Linux, puis relancez .\build.ps1."
    exit 0
}

# --- 2. Outils dans WSL -----------------------------------------------------
Say "Outils de compilation dans WSL ($Distro)"
$check = 'command -v python3 >/dev/null && command -v git >/dev/null && command -v make >/dev/null && command -v npm >/dev/null && command -v curl >/dev/null'
& wsl.exe -d $Distro -- bash -c $check
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installation de python3, git, make, Node.js et curl dans $Distro (mot de passe Linux demandé)."
    & wsl.exe -d $Distro -- bash -c "sudo apt-get update && sudo apt-get install -y python3 python3-venv git make nodejs npm curl dpkg-dev"
    if ($LASTEXITCODE -ne 0) { Die "installation des outils dans WSL impossible" }
}

# --- 3. Licences Microsoft --------------------------------------------------
if (-not $AcceptMsvcLicense) {
    Write-Host ""
    Write-Host "Pour compiler, le build télécharge le CRT Microsoft Visual C++ et le SDK Windows."
    Write-Host "Ils sont soumis aux licences de Microsoft (voir LICENSING.md, section 6)."
    $answer = Read-Host "Acceptez-vous ces licences ? [o/N]"
    if ($answer -notmatch '^[oOyY]') { Die "licences Microsoft non acceptées : compilation impossible." }
}

# --- 4. Build -------------------------------------------------------------
Say "Build Windows (AuxiNux Office + AuxiText)"
$arguments = @{ Release = $true; AcceptMsvcLicense = $true; Distro = $Distro }
if ($Clean) { $arguments["Clean"] = $true }
& (Join-Path $root "scripts\build-windows.ps1") @arguments
if (-not $?) { Die "le build n'est pas terminé" }

Say "Terminé"
Write-Host "Installateur : $(Join-Path $root 'dist\windows')"
Write-Host "Installer en silencieux : .\dist\windows\AuxiNuxOffice-$((Get-Content (Join-Path $root 'VERSION')).Trim())-x64.exe /S"
