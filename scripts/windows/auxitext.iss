; Installateur Windows d'AuxiText (Inno Setup 6), compilé par scripts/build-win.sh --installer
; (ou --auxitext --installer). AuxiText s'installe seul, sans la suite ni son moteur.
; Définitions passées par le script : AppVersion, NumVersion, RepoDir, SourceDir
; (target\windows\AuxiText) et RegistryFile (entrées « Ouvrir avec » générées).
; Installation pour l'utilisateur courant, sans droits d'administrateur, au même endroit
; que scripts/install-apps.sh : %LOCALAPPDATA%\Programs\AuxiText.

[Setup]
AppId={{6DE735AA-32B7-451C-925E-AEFE8402BD7A}
AppName=AuxiText
AppVersion={#AppVersion}
AppVerName=AuxiText {#AppVersion}
AppPublisher=Projet AuxiNux
AppPublisherURL=https://office.auxinux.ca
AppCopyright=© 2026 Projet AuxiNux
VersionInfoVersion={#NumVersion}
DefaultDirName={autopf}\AuxiText
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
ChangesAssociations=yes
CloseApplications=yes
SetupIconFile={#RepoDir}\text\src-tauri\icons\icon.ico
UninstallDisplayIcon={app}\AuxiText.exe
UninstallDisplayName=AuxiText
OutputBaseFilename=AuxiText-{#AppVersion}-windows-x64-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\AuxiText"; Filename: "{app}\AuxiText.exe"; IconFilename: "{app}\AuxiText.ico"; WorkingDir: "{userdocs}"; Comment: "Éditeur de texte"
Name: "{autodesktop}\AuxiText"; Filename: "{app}\AuxiText.exe"; IconFilename: "{app}\AuxiText.ico"; WorkingDir: "{userdocs}"; Tasks: desktopicon

[Registry]
#include RegistryFile

[Run]
Filename: "{app}\AuxiText.exe"; Description: "{cm:LaunchProgram,AuxiText}"; Flags: nowait postinstall skipifsilent
