# Trouve le Bash de Git pour Windows (pas celui de WSL, C:\Windows\System32\bash.exe)
# et propose d'installer Git avec winget s'il manque. Les autres prérequis (Rust,
# Node.js, MSVC, Python, Inno Setup) sont proposés ensuite par scripts/lib/prereqs.sh.
# AUXI_INSTALL=oui installe sans demander ; AUXI_INSTALL=non n'installe rien.

function Find-GitBash {
  $candidats = @()
  $git = Get-Command git.exe -ErrorAction SilentlyContinue
  if ($git) { $candidats += Join-Path (Split-Path (Split-Path $git.Source)) 'bin\bash.exe' }
  $candidats += "$env:ProgramFiles\Git\bin\bash.exe", "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe"
  return $candidats | Where-Object { Test-Path $_ } | Select-Object -First 1
}

function Get-GitBash {
  $bash = Find-GitBash
  if ($bash) { return $bash }

  Write-Host "`n== Prérequis manquant`n  - Git pour Windows (fournit Git Bash, qui lance la compilation)" -ForegroundColor Yellow
  if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    Write-Host "`nErreur : winget introuvable : installez Git depuis https://git-scm.com/download/win" -ForegroundColor Red
    exit 1
  }
  $commande = 'winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements'
  Write-Host "`nCommande proposée :`n  $commande"
  switch -Regex ("$env:AUXI_INSTALL") {
    '^(oui|yes|1)$' { $reponse = 'o' }
    '^(non|no|0)$' { $reponse = 'n' }
    default { $reponse = Read-Host "`nInstaller maintenant ? [O/n]" }
  }
  if ($reponse -match '^[nN]') {
    Write-Host "`nErreur : Git pour Windows requis : lancez la commande ci-dessus, puis relancez ce script" -ForegroundColor Red
    exit 1
  }
  winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements | Out-Host
  $bash = Find-GitBash
  if (-not $bash) {
    Write-Host "`nErreur : Git Bash toujours introuvable : ouvrez un nouveau terminal et relancez ce script" -ForegroundColor Red
    exit 1
  }
  return $bash
}
