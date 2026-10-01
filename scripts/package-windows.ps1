# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux

<#
.SYNOPSIS
    Réassemble et réempaquette un build Windows existant (voir build-windows.ps1 et BUILD.md).

.DESCRIPTION
    Produit dist\windows\AuxiNuxOffice-<version>-x64.exe (installateur NSIS) et, par défaut,
    dist\windows\AuxiNuxOffice-<version>-x64.msi, à partir des binaires déjà compilés par
    .\scripts\build-windows.ps1 (même environnement WSL).

.PARAMETER Formats
    "exe,msi" (défaut), "exe" ou "msi".
.PARAMETER Distro
    Distribution WSL à utiliser (défaut : distribution WSL par défaut).
.PARAMETER Debug
    Empaqueter un build de débogage.

.EXAMPLE
    .\scripts\package-windows.ps1
.EXAMPLE
    .\scripts\package-windows.ps1 -Formats exe
#>
param(
    [string]$Formats = "exe,msi",
    [string]$Distro = "",
    [switch]$Debug
)

$ErrorActionPreference = "Stop"
$arguments = @{ Command = "package"; Formats = $Formats; Distro = $Distro }
if ($Debug) { $arguments["Debug"] = $true } else { $arguments["Release"] = $true }
& (Join-Path $PSScriptRoot "build-windows.ps1") @arguments
