# Plan de test — Windows

Cibles : **Windows 10 22H2 x64** et **Windows 11 x64** (23H2, 24H2).
Artefacts : `AuxiNuxOffice-0.1.0-x64.exe` (installateur), `AuxiNuxOffice-0.1.0-x64.msi`.

La version 0.1.0 ne peut être déclarée terminée qu'après le passage des scénarios
**obligatoires** (O) ci-dessous sur Windows 10 et Windows 11. Notez pour chaque campagne :
édition et build de Windows (`winver`), langue, compte standard ou administrateur, artefact
et somme SHA-256.

Environnement conseillé : machine virtuelle neuve ou **Bac à sable Windows** (Windows Sandbox,
éditions Pro/Entreprise), qui repart d'un système propre à chaque ouverture et ne contient pas
le redistribuable Visual C++ : idéal pour tester l'installation complète.

## 1. Avant l'installation

| ID | Étapes | Résultat attendu |
|---|---|---|
| W-PRE-1 | `Get-FileHash .\AuxiNuxOffice-0.1.0-x64.exe -Algorithm SHA256` | identique à `SHA256SUMS` |
| W-PRE-2 | Propriétés du fichier > Détails | Produit « AuxiNux Office », version 0.1.0, société « Projet AuxiNux » |
| W-PRE-3 | Double-clic | les installateurs 0.1.0 ne sont pas signés : SmartScreen affiche « Windows a protégé votre ordinateur » → « Informations complémentaires » → « Exécuter quand même » (la signature Authenticode est prévue, voir ROADMAP.md) |

## 2. Installation interactive (O)

| ID | Étapes | Résultat attendu |
|---|---|---|
| W-INS-1 | Lancer l'installateur sur un Windows en français, puis en anglais | assistant dans la langue du système ; page d'accueil mentionnant « basé sur ONLYOFFICE Desktop Editors (Ascensio System SIA), projet indépendant » |
| W-INS-2 | Page « Licence et mentions légales » | texte de NOTICE (français et anglais) ; bouton Suivant, sans acceptation obligatoire |
| W-INS-3 | Composants | « AuxiNux Office (requis) », « Raccourci sur le Bureau », « Proposer pour ouvrir les documents » ; descriptions claires |
| W-INS-4 | Dossier par défaut | `C:\Program Files\AuxiNux Office` |
| W-INS-5 | Fin de l'installation, case « Lancer AuxiNux Office » | l'application démarre **sans** droits d'administrateur (Gestionnaire des tâches > Détails > colonne « Élevé » : Non) |
| W-INS-6 | Sans redistribuable Visual C++ (Bac à sable) | « Microsoft Visual C++ Redistributable … » installé pendant l'installation ; `Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64'` : Installed = 1, version ≥ 14.44.35211 |

## 3. Installation silencieuse et options (O)

PowerShell (administrateur) :

```powershell
$p = Start-Process .\AuxiNuxOffice-0.1.0-x64.exe -ArgumentList '/S' -Wait -PassThru; $p.ExitCode
$p = Start-Process .\AuxiNuxOffice-0.1.0-x64.exe -ArgumentList '/S','/NODESKTOP','/NOASSOC','/LANG=en','/D=C:\Apps\AuxiNux Office' -Wait -PassThru
```

| ID | Étapes | Résultat attendu |
|---|---|---|
| W-SIL-1 | `/S` | code 0 (ou 3010 si un redémarrage est requis) ; aucune fenêtre |
| W-SIL-2 | `/S /D=C:\Apps\AuxiNux Office` | installé dans ce dossier |
| W-SIL-3 | `/S /NODESKTOP` | pas de raccourci sur le Bureau |
| W-SIL-4 | `/S /NOASSOC` | aucune déclaration de types de fichiers (§5 sans objet) |
| W-SIL-5 | `/S /LANG=en` | `HKLM\Software\AuxiNux\AuxiOffice\locale` = `en-US` ; AuxiNux Office démarre en anglais |
| W-SIL-6 | `/S /NOVCREDIST` sur un système sans redistribuable | installation terminée, mais l'application ne démarre pas (DLL Visual C++ manquantes) : comportement attendu de cette option réservée aux parcs gérés |
| W-SIL-7 | Installation pendant qu'AuxiNux Office est ouvert | demande de fermer l'application (en silencieux : code 2, rien n'est modifié) |

## 4. Résultat de l'installation (O)

| ID | Vérification | Résultat attendu |
|---|---|---|
| W-RES-1 | `C:\Program Files\AuxiNux Office\` | `auxioffice.exe`, `auxioffice-editors.exe`, `auxitext.exe`, `converter\`, `editors\`, `LICENSE.txt`, `NOTICE.txt`, `licenses\`, `uninstall.exe` |
| W-RES-2 | Menu Démarrer > dossier « AuxiNux Office » | AuxiNux Office, AuxiWriter, AuxiSheet, AuxiPresent, AuxiPDF, AuxiText, avec leurs icônes |
| W-RES-3 | `Get-StartApps \| Where-Object Name -like 'Auxi*'` | AppID `AuxiNux.AuxiOffice` pour AuxiNux Office, AuxiWriter, AuxiSheet, AuxiPresent, AuxiPDF (identifiant d'application posé sur les raccourcis : regroupement dans la barre des tâches, notifications) |
| W-RES-4 | Bureau | raccourci AuxiNux Office (sauf `/NODESKTOP`) |
| W-RES-5 | Paramètres > Applications > Applications installées | AuxiNux Office, éditeur Projet AuxiNux, version 0.1.0, taille, icône ; pas de « Modifier » |
| W-RES-6 | `Win+R` → `auxioffice` | l'accueil s'ouvre (App Paths) |
| W-RES-7 | `& 'C:\Program Files\AuxiNux Office\auxioffice.exe' --version \| Out-String` ; dans `cmd` : `"C:\Program Files\AuxiNux Office\auxioffice.exe" --version \| more` | `AuxiNux Office 0.1.0` |
| W-RES-8 | `reg query "HKLM\Software\AuxiNux\AuxiOffice"` | AppPath, Version, PackageType, locale |

## 5. Types de fichiers et applications par défaut (O)

| ID | Étapes | Résultat attendu |
|---|---|---|
| W-ASS-1 | Avant l'installation, choisir une application par défaut pour `.docx` (ex. WordPad ou Word) ; installer | **le choix existant est conservé** : un double-clic ouvre toujours l'application choisie |
| W-ASS-2 | Clic droit sur un `.docx`, `.xlsx`, `.pptx`, `.pdf`, `.txt`, `.csv` > Ouvrir avec | « AuxiWriter (AuxiNux Office) », « AuxiSheet… », « AuxiPresent… », « AuxiPDF… », « AuxiText… » proposés ; icônes AuxiNux |
| W-ASS-3 | Paramètres > Applications > Applications par défaut > AuxiNux Office | page de l'application listant DOCX, DOC, ODT, RTF, XLSX, XLS, ODS, CSV, PPTX, PPT, ODP, PDF, TXT, LOG, MD, JSON, XML, YAML, YML, INI… ; l'utilisateur choisit type par type |
| W-ASS-4 | Choisir AuxiNux Office pour `.docx`, `.xlsx`, `.pptx`, `.pdf`, `.txt`, `.csv` puis double-cliquer | ouverture dans AuxiWriter, AuxiSheet, AuxiPresent, AuxiPDF, AuxiText, AuxiSheet ; icônes de fichiers AuxiNux |
| W-ASS-5 | Message « Souhaitez-vous faire de AuxiNux Office votre application par défaut… ? » (s'il apparaît) → Oui | ouverture de la page AuxiNux Office des Applications par défaut ; **aucun changement silencieux** |
| W-ASS-6 | Même message → Non, avec « Ne plus afficher ce message » | le message ne réapparaît plus |

## 6. Applications (O)

Reprendre les scénarios 3 à 8 de [TESTING-LINUX.md](TESTING-LINUX.md) (accueil, AuxiWriter,
AuxiSheet, AuxiPresent, AuxiPDF, AuxiText) sous Windows, en particulier :

| ID | Étapes | Résultat attendu |
|---|---|---|
| W-APP-1 | Accueil : les six actions | comme sous Linux ; dialogues Windows en français |
| W-APP-2 | DOCX, XLSX, PPTX : ouvrir, modifier, enregistrer, exporter en PDF, imprimer | fonctionnel |
| W-APP-3 | PDF : navigation, zoom, recherche, copie, rotation, impression | fonctionnel |
| W-APP-4 | AuxiText : fichier CRLF et fichier LF, UTF-8 avec accents ; « Ouvrir dans AuxiWriter » | fins de ligne conservées ; ouverture dans AuxiWriter |
| W-APP-5 | Ouvrir un second document depuis l'Explorateur, application déjà ouverte | ouvert dans l'instance existante |
| W-APP-6 | Interface en français par défaut (Windows français) ; changement de langue | fonctionnel |

## 7. Données et confidentialité (O)

| ID | Vérification | Résultat attendu |
|---|---|---|
| W-DAT-1 | `%APPDATA%\AuxiNux\AuxiOffice\` | `settings.ini`, `auxitext.ini` |
| W-DAT-2 | `%LOCALAPPDATA%\AuxiNux\AuxiOffice\` | `data\` (settings.xml, fonts, recents.xml, recover…), `cache\` |
| W-DAT-3 | `C:\Program Files\AuxiNux Office\` après utilisation | inchangé (aucune écriture de l'application) |
| W-DAT-4 | Réseau désactivé (mode avion) : scénarios du §6 | tout fonctionne |
| W-DAT-5 | Moniteur de ressources > Réseau, application ouverte avec des documents | aucune connexion de `auxioffice-editors.exe` ni `editors_helper.exe` (hors 127.0.0.1) |

## 8. Désinstallation (O)

| ID | Étapes | Résultat attendu |
|---|---|---|
| W-UNI-1 | Paramètres > Applications installées > AuxiNux Office > Désinstaller | dossier d'installation, raccourcis, entrée « Applications installées », clés `HKLM\Software\AuxiNux`, ProgID `AuxiOffice.*`, valeur `RegisteredApplications` supprimés |
| W-UNI-2 | Après désinstallation | les associations des autres applications sont intactes ; `%APPDATA%\AuxiNux\AuxiOffice` et `%LOCALAPPDATA%\AuxiNux\AuxiOffice` conservés |
| W-UNI-3 | Silencieuse : `Start-Process 'C:\Program Files\AuxiNux Office\uninstall.exe' -ArgumentList '/S'` | même résultat (le désinstalleur se recopie dans `%TEMP%` puis se termine : attendre quelques secondes avant de vérifier) |
| W-UNI-4 | Réinstaller par-dessus une installation existante | remplacement propre ; réglages conservés |

## 9. Paquet MSI (O pour les parcs gérés)

```bat
vc_redist.x64.exe /install /quiet /norestart
msiexec /i AuxiNuxOffice-0.1.0-x64.msi /qn /l*v install.log
msiexec /i AuxiNuxOffice-0.1.0-x64.msi /qn NODESKTOP=1 NOASSOC=1 APPLOCALE=en-US
msiexec /x AuxiNuxOffice-0.1.0-x64.msi /qn
```

| ID | Étapes | Résultat attendu |
|---|---|---|
| W-MSI-1 | Sans redistribuable Visual C++ | échec (code 1603) avec le message « AuxiNux Office nécessite Microsoft Visual C++ Redistributable… » dans le journal |
| W-MSI-2 | Avec redistribuable, `/qn` | code 0 ; mêmes vérifications que §4 (raccourcis **pour tous les utilisateurs**, sauf AppID, non posé par le MSI) |
| W-MSI-3 | Propriétés `NODESKTOP`, `NOASSOC`, `APPLOCALE`, `INSTALLDIR` | appliquées |
| W-MSI-4 | `msiexec /x` | désinstallation complète, données personnelles conservées |

## 10. Résultats pour la version 0.1.0

### Vérifications automatiques (build)

Étape `test` de la cible Windows (`build/test-reports/windows/report.md`) : tous les imports
des trois exécutables résolus par les DLL livrées (`auxioffice.exe` et `auxitext.exe` depuis le
dossier de l'application seul, le shell avec `converter\` comme le prévoit le lanceur),
sous-système graphique, métadonnées « AuxiNux Office 0.1.0 ».

### Vérifications sous Wine (indicatives)

Wine 10.0 (Debian 13), préfixe 64 bits neuf. **Wine n'est pas Windows** : ces essais
détectent des erreurs grossières (installation, registre, chargement des DLL, démarrage) mais
ne remplacent pas les scénarios ci-dessus. Résultats détaillés dans [CHANGELOG.md](../CHANGELOG.md).

### Restant à faire sur un vrai Windows 10 et Windows 11

Tous les scénarios (O) des §1 à §9, en particulier : SmartScreen, installation du
redistribuable Visual C++, AppID des raccourcis (`Get-StartApps`), Applications par défaut,
icônes de fichiers, impression, notifications, audit réseau, désinstallation.
