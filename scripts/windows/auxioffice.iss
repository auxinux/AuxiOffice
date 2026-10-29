; Installateur Windows d'AuxiOffice (Inno Setup 6), compilé par scripts/build-win.sh --installer.
; Définitions passées par le script : AppVersion, NumVersion, RepoDir, SourceDir
; (target\windows\AuxiOffice) et RegistryFile (entrées « Ouvrir avec » générées).
; Installation pour l'utilisateur courant, sans droits d'administrateur, au même endroit
; que scripts/install-apps.sh : %LOCALAPPDATA%\Programs\AuxiOffice.

[Setup]
AppId={{9E5FC55B-7414-46B4-BA8A-C1490BA0F2F4}
AppName=AuxiOffice
AppVersion={#AppVersion}
AppVerName=AuxiOffice {#AppVersion}
AppPublisher=Projet AuxiNux
AppPublisherURL=https://office.auxinux.ca
AppCopyright=© 2026 Projet AuxiNux
VersionInfoVersion={#NumVersion}
DefaultDirName={autopf}\AuxiOffice
DefaultGroupName=AuxiOffice
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
ChangesAssociations=yes
CloseApplications=yes
SetupIconFile={#RepoDir}\branding\generated\ico\auxioffice.ico
UninstallDisplayIcon={app}\AuxiOffice.exe
UninstallDisplayName=AuxiOffice
OutputBaseFilename=AuxiOffice-{#AppVersion}-windows-x64-setup
Compression=lzma2/max
SolidCompression=yes
LZMAUseSeparateProcess=yes
WizardStyle=modern

[Languages]
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[InstallDelete]
; Une mise à jour du moteur ne doit pas laisser les fichiers de l'ancienne version.
Type: filesandordirs; Name: "{app}\engine"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\AuxiOffice"; Filename: "{app}\AuxiOffice.exe"; IconFilename: "{app}\icons\auxioffice.ico"; WorkingDir: "{userdocs}"
Name: "{group}\AuxiWriter"; Filename: "{app}\AuxiWriter.exe"; IconFilename: "{app}\icons\auxiwriter.ico"; WorkingDir: "{userdocs}"; Comment: "Traitement de texte"
Name: "{group}\AuxiSheet"; Filename: "{app}\AuxiSheet.exe"; IconFilename: "{app}\icons\auxisheet.ico"; WorkingDir: "{userdocs}"; Comment: "Tableur"
Name: "{group}\AuxiPresent"; Filename: "{app}\AuxiPresent.exe"; IconFilename: "{app}\icons\auxipresent.ico"; WorkingDir: "{userdocs}"; Comment: "Présentations"
Name: "{group}\AuxiDraw"; Filename: "{app}\AuxiDraw.exe"; IconFilename: "{app}\icons\auxidraw.ico"; WorkingDir: "{userdocs}"; Comment: "Dessin vectoriel et mise en page"
Name: "{group}\AuxiPDF"; Filename: "{app}\AuxiPDF.exe"; IconFilename: "{app}\icons\auxipdf.ico"; WorkingDir: "{userdocs}"; Comment: "Lecteur de documents PDF"
Name: "{autodesktop}\AuxiOffice"; Filename: "{app}\AuxiOffice.exe"; IconFilename: "{app}\icons\auxioffice.ico"; WorkingDir: "{userdocs}"; Tasks: desktopicon

[Registry]
#include RegistryFile

[Run]
Filename: "{app}\AuxiOffice.exe"; Description: "{cm:LaunchProgram,AuxiOffice}"; Flags: nowait postinstall skipifsilent
