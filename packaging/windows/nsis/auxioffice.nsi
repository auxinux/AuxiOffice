; AuxiNux Office — installateur Windows x64 (NSIS 3)
; SPDX-License-Identifier: AGPL-3.0-or-later
; Copyright (C) 2026 Projet AuxiNux
;
; Construit par scripts/auxibuild/package_windows.py (étape « package », cible windows), qui génère
; build/package/windows/generated.nsh (identité, version, chemins, liste des fichiers et types de
; fichiers, depuis branding/product.json et packaging/common/filetypes.json) et appelle :
;   makensis -INPUTCHARSET UTF8 -DGENERATED=<generated.nsh> auxioffice.nsi
;
; Paramètres de ligne de commande de l'installateur (voir aussi BUILD.md et docs/TESTING-WINDOWS.md) :
;   /S             installation silencieuse (aucune fenêtre)
;   /D=<dossier>   dossier d'installation ; toujours en dernier, sans guillemets
;   /NODESKTOP     ne pas créer de raccourci sur le Bureau
;   /NOASSOC       ne pas proposer AuxiNux Office pour les types de fichiers (« Ouvrir avec »)
;   /NOVCREDIST    ne pas installer le redistribuable Microsoft Visual C++ (déployé par ailleurs)
;   /LANG=fr|en    langue par défaut d'AuxiNux Office (sinon : langue de l'installateur)
; Codes de sortie : 0 succès, 1 annulé par l'utilisateur, 2 erreur, 3010 succès (redémarrage requis).
;
; AuxiNux Office n'est jamais imposé comme application par défaut : l'installateur le déclare
; seulement comme application capable d'ouvrir ces types (Capabilities, OpenWithProgids) ; le choix
; reste à l'utilisateur, dans Windows (Paramètres > Applications > Applications par défaut).

Unicode true
Target amd64-unicode
ManifestDPIAware true
ManifestSupportedOS Win10
SetCompressor /SOLID lzma
SetCompressorDictSize 64
RequestExecutionLevel admin

!include "${GENERATED}"

!include MUI2.nsh
!include LogicLib.nsh
!include Sections.nsh
!include FileFunc.nsh
!include WinVer.nsh
!include Win\COM.nsh
!include Win\Propkey.nsh

!define /ifndef VT_LPWSTR 31
!define SHCNE_ASSOCCHANGED 0x08000000
!define SYNCHRONIZE 0x00100000

Name "${PRODUCT_NAME}"
OutFile "${OUT_FILE}"
InstallDir "$PROGRAMFILES64\${INSTALL_DIR_NAME}"
InstallDirRegKey HKLM "${REG_APP_PATH}" "AppPath"
BrandingText "${PRODUCT_NAME} ${PRODUCT_VERSION}"
ShowInstDetails show
ShowUninstDetails show

Var AppLocale
Var NoVcRedist

; ---------------------------------------------------------------------------
; Interface
; ---------------------------------------------------------------------------
!define MUI_ICON "${BRANDING_ICO}/auxioffice.ico"
!define MUI_UNICON "${BRANDING_ICO}/auxioffice.ico"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "${BRANDING_BMP}/nsis-header.bmp"
!define MUI_HEADERIMAGE_UNBITMAP "${BRANDING_BMP}/nsis-header.bmp"
!define MUI_WELCOMEFINISHPAGE_BITMAP "${BRANDING_BMP}/nsis-welcome.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${BRANDING_BMP}/nsis-welcome.bmp"
!define MUI_ABORTWARNING
!define MUI_COMPONENTSPAGE_SMALLDESC

!define MUI_WELCOMEPAGE_TEXT "$(TXT_WELCOME)"
!insertmacro MUI_PAGE_WELCOME
; Page d'information : l'AGPL ne demande pas d'acceptation, seulement d'être portée à la connaissance.
!define MUI_PAGE_HEADER_TEXT "$(TXT_LICENSE_HEADER)"
!define MUI_PAGE_HEADER_SUBTEXT "$(TXT_LICENSE_SUBHEADER)"
!define MUI_LICENSEPAGE_TEXT_TOP "$(TXT_LICENSE_TOP)"
!define MUI_LICENSEPAGE_TEXT_BOTTOM "$(TXT_LICENSE_BOTTOM)"
!define MUI_LICENSEPAGE_BUTTON "$(^NextBtn)"
!insertmacro MUI_PAGE_LICENSE "${LICENSE_INFO}"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "$(TXT_RUN)"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchUnelevated
!define MUI_FINISHPAGE_LINK "$(TXT_WEBSITE)"
!define MUI_FINISHPAGE_LINK_LOCATION "${PRODUCT_WEBSITE}"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Anglais en premier : langue de repli si le système n'est ni en français ni en anglais.
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "French"

!include "${NSIS_STRINGS}"

VIProductVersion "${PRODUCT_VERSION4}"
VIFileVersion "${PRODUCT_VERSION4}"
VIAddVersionKey /LANG=${LANG_FRENCH} "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey /LANG=${LANG_FRENCH} "ProductVersion" "${PRODUCT_VERSION}"
VIAddVersionKey /LANG=${LANG_FRENCH} "FileVersion" "${PRODUCT_VERSION}"
VIAddVersionKey /LANG=${LANG_FRENCH} "FileDescription" "Installation de ${PRODUCT_NAME} ${PRODUCT_VERSION}"
VIAddVersionKey /LANG=${LANG_FRENCH} "CompanyName" "${PRODUCT_PUBLISHER}"
VIAddVersionKey /LANG=${LANG_FRENCH} "LegalCopyright" "${PRODUCT_COPYRIGHT}"

; ---------------------------------------------------------------------------
; Fonctions utilitaires
; ---------------------------------------------------------------------------

; Raccourci (.lnk) : ajoute l'AppUserModelID de l'application, pour le regroupement dans la barre
; des tâches et les notifications Windows. Pile : chemin du raccourci. Échec sans conséquence.
!macro AUXI_SET_SHORTCUT_AUMID UN
Function ${UN}SetShortcutAumid
  Exch $R0
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  !insertmacro ComHlpr_CreateInProcInstance ${CLSID_ShellLink} ${IID_IShellLink} r0 ""
  ${If} $0 P<> 0
    ${IUnknown::QueryInterface} $0 '("${IID_IPersistFile}",.r1)'
    ${If} $1 P<> 0
      ${IPersistFile::Load} $1 '("$R0",${STGM_READWRITE}).r2'
      ${If} $2 = 0
        ${IUnknown::QueryInterface} $0 '("${IID_IPropertyStore}",.r2)'
        ${If} $2 P<> 0
          System::Call '*(&w64 "${AUMID}")p.r5'
          System::Call '*${SYSSTRUCT_PROPERTYKEY}(${PKEY_AppUserModel_ID})p.r3'
          System::Call '*(&i2 ${VT_LPWSTR}, &i6 0, p r5, &i8 0)p.r4'
          ${IPropertyStore::SetValue} $2 '(r3,r4)'
          ${IPropertyStore::Commit} $2 ""
          System::Free $3
          System::Free $4
          System::Free $5
          ${IUnknown::Release} $2 ""
          ${IPersistFile::Save} $1 '("$R0",1)'
        ${EndIf}
      ${EndIf}
      ${IUnknown::Release} $1 ""
    ${EndIf}
    ${IUnknown::Release} $0 ""
  ${EndIf}
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
  Pop $R0
FunctionEnd
!macroend
!insertmacro AUXI_SET_SHORTCUT_AUMID ""

; AuxiNux Office ouvert ? (mutex d'instance unique du shell)
!macro AUXI_CHECK_NOT_RUNNING UN
Function ${UN}CheckNotRunning
  Push $0
  auxi_retry:
  System::Call 'kernel32::OpenMutexW(i ${SYNCHRONIZE}, i 0, w "${APP_MUTEX}")p.r0'
  ${If} $0 P<> 0
    System::Call 'kernel32::CloseHandle(p r0)'
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(TXT_RUNNING)" /SD IDCANCEL IDRETRY auxi_retry
    SetErrorLevel 2
    Quit
  ${EndIf}
  Pop $0
FunctionEnd
!macroend
!insertmacro AUXI_CHECK_NOT_RUNNING ""
!insertmacro AUXI_CHECK_NOT_RUNNING "un."

; Redistribuable Visual C++ 2015-2022 x64 déjà installé, en version suffisante ? -> 1 / 0
Function IsVCRedistInstalled
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  StrCpy $0 0
  SetRegView 64
  ReadRegDWORD $1 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  ${If} $1 <> 1
    SetRegView 32
  ${EndIf}
  ReadRegDWORD $1 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  ReadRegDWORD $2 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Major"
  ReadRegDWORD $3 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Minor"
  ReadRegDWORD $4 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Bld"
  SetRegView 64
  ${If} $1 = 1
    ${If} $2 > ${VC_MIN_MAJOR}
      StrCpy $0 1
    ${ElseIf} $2 = ${VC_MIN_MAJOR}
      ${If} $3 > ${VC_MIN_MINOR}
        StrCpy $0 1
      ${ElseIf} $3 = ${VC_MIN_MINOR}
      ${AndIf} $4 >= ${VC_MIN_BUILD}
        StrCpy $0 1
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Exch $0
FunctionEnd

; Lancement depuis la page finale sans les droits d'administrateur de l'installateur.
Function LaunchUnelevated
  Exec '"$WINDIR\explorer.exe" "$INSTDIR\auxioffice.exe"'
FunctionEnd

; ---------------------------------------------------------------------------
; Sections
; ---------------------------------------------------------------------------
Section "-VCRedist" SecVCRedist
  ${If} $NoVcRedist = 1
    DetailPrint "$(TXT_VC_SKIPPED)"
    Return
  ${EndIf}
  Call IsVCRedistInstalled
  Pop $0
  ${If} $0 = 1
    DetailPrint "$(TXT_VC_PRESENT)"
    Return
  ${EndIf}
  DetailPrint "$(TXT_VC_INSTALLING)"
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File "/oname=vc_redist.x64.exe" "${VCREDIST}"
  ExecWait '"$PLUGINSDIR\vc_redist.x64.exe" /install /quiet /norestart' $0
  Delete "$PLUGINSDIR\vc_redist.x64.exe"
  ${If} $0 = 3010
    SetRebootFlag true
  ${ElseIf} $0 <> 0
  ${AndIf} $0 <> 1638 ; 1638 : une version plus récente est déjà installée
    DetailPrint "vc_redist.x64.exe : code $0"
    MessageBox MB_OK|MB_ICONSTOP "$(TXT_VC_FAILED) ($0)" /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
SectionEnd

Section "!$(SEC_APP)" SecApp
  SectionIn RO
  SetShellVarContext all
  SetRegView 64

  ; Mise à jour : retirer d'abord les fichiers de la version précédente.
  ${If} ${FileExists} "$INSTDIR\auxioffice.exe"
    DetailPrint "$(TXT_UPGRADE)"
    !insertmacro AUXI_REMOVE_FILES
  ${EndIf}

  SetOutPath "$INSTDIR"
  File /r "${STAGE_DIR}/*"
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Réglages machine lus par l'application (langue par défaut, emplacement)
  WriteRegStr HKLM "${REG_APP_PATH}" "AppPath" "$INSTDIR"
  WriteRegStr HKLM "${REG_APP_PATH}" "Version" "${PRODUCT_VERSION}"
  WriteRegStr HKLM "${REG_APP_PATH}" "PackageType" "nsis"
  WriteRegStr HKLM "${REG_APP_PATH}" "locale" "$AppLocale"

  ; Commande « auxioffice » dans Exécuter (Win+R) et ShellExecute
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\auxioffice.exe" "" "$INSTDIR\auxioffice.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\auxioffice.exe" "Path" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\auxitext.exe" "" "$INSTDIR\auxitext.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\auxitext.exe" "Path" "$INSTDIR"

  ; Menu Démarrer : dossier « AuxiNux Office » (le raccourci principal est aussi celui qu'utilisent
  ; les notifications Windows du shell, avec l'AppUserModelID de l'application).
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\auxioffice.exe" "" "$INSTDIR\auxioffice.exe" 0 SW_SHOWNORMAL "" "$(TXT_SC_MAIN)"
  Push "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  Call SetShortcutAumid
  !insertmacro AUXI_APP_SHORTCUTS

  ; Applications installées (Paramètres > Applications)
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\auxioffice.exe,0"
  WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKLM "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegStr HKLM "${UNINST_KEY}" "URLInfoAbout" "${PRODUCT_WEBSITE}"
  WriteRegStr HKLM "${UNINST_KEY}" "HelpLink" "${PRODUCT_SUPPORT_URL}"
  WriteRegStr HKLM "${UNINST_KEY}" "Comments" "$(TXT_COMMENTS)"
  WriteRegDWORD HKLM "${UNINST_KEY}" "VersionMajor" ${VERSION_MAJOR}
  WriteRegDWORD HKLM "${UNINST_KEY}" "VersionMinor" ${VERSION_MINOR}
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "${UNINST_KEY}" "EstimatedSize" "$0"
SectionEnd

Section "$(SEC_DESKTOP)" SecDesktop
  SetShellVarContext all
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\auxioffice.exe" "" "$INSTDIR\auxioffice.exe" 0 SW_SHOWNORMAL "" "$(TXT_SC_MAIN)"
  Push "$DESKTOP\${PRODUCT_NAME}.lnk"
  Call SetShortcutAumid
SectionEnd

Section "$(SEC_ASSOC)" SecAssoc
  SetRegView 64
  ; Déclaration seulement (ProgID, « Ouvrir avec », Applications par défaut) : aucun choix
  ; par défaut n'est modifié ; Windows demande à l'utilisateur ou le laisse choisir.
  WriteRegStr HKLM "${REG_APP_PATH}\Capabilities" "ApplicationName" "${PRODUCT_NAME}"
  WriteRegStr HKLM "${REG_APP_PATH}\Capabilities" "ApplicationDescription" "$(TXT_COMMENTS)"
  WriteRegStr HKLM "${REG_APP_PATH}\Capabilities" "ApplicationIcon" "$INSTDIR\auxioffice.exe,0"
  WriteRegStr HKLM "Software\Classes\Applications\auxioffice.exe" "FriendlyAppName" "${PRODUCT_NAME}"
  WriteRegStr HKLM "Software\Classes\Applications\auxitext.exe" "FriendlyAppName" "${TEXT_APP_NAME}"
  !insertmacro AUXI_REGISTER_FILE_TYPES
  WriteRegStr HKLM "Software\RegisteredApplications" "${PRODUCT_NAME}" "${REG_APP_PATH}\Capabilities"
  System::Call 'shell32::SHChangeNotify(i ${SHCNE_ASSOCCHANGED}, i 0, p 0, p 0)'
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecApp} "$(DESC_APP)"
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "$(DESC_DESKTOP)"
  !insertmacro MUI_DESCRIPTION_TEXT ${SecAssoc} "$(DESC_ASSOC)"
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Function .onInit
  SetShellVarContext all
  SetRegView 64
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "$(TXT_NEED_WIN10)" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  Call CheckNotRunning

  ${If} $LANGUAGE = ${LANG_FRENCH}
    StrCpy $AppLocale "fr-FR"
  ${Else}
    StrCpy $AppLocale "en-US"
  ${EndIf}
  StrCpy $NoVcRedist 0

  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/NODESKTOP" $R1
  ${IfNot} ${Errors}
    !insertmacro UnselectSection ${SecDesktop}
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/NOASSOC" $R1
  ${IfNot} ${Errors}
    !insertmacro UnselectSection ${SecAssoc}
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/NOVCREDIST" $R1
  ${IfNot} ${Errors}
    StrCpy $NoVcRedist 1
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/LANG=" $R1
  ${IfNot} ${Errors}
    ${If} $R1 == "fr"
      StrCpy $AppLocale "fr-FR"
    ${ElseIf} $R1 == "en"
      StrCpy $AppLocale "en-US"
    ${EndIf}
  ${EndIf}
FunctionEnd

Function .onInstSuccess
  ${If} ${RebootFlag}
    SetErrorLevel 3010
  ${EndIf}
FunctionEnd

; ---------------------------------------------------------------------------
; Désinstallation : retire l'application et ses déclarations ; conserve les documents et les
; paramètres personnels (%APPDATA%\AuxiNux\AuxiNuxOffice, %LOCALAPPDATA%\AuxiNux\AuxiNuxOffice).
; ---------------------------------------------------------------------------
Function un.onInit
  SetShellVarContext all
  SetRegView 64
  Call un.CheckNotRunning
FunctionEnd

Section "Uninstall"
  SetShellVarContext all
  SetRegView 64

  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${PRODUCT_NAME}"

  !insertmacro AUXI_UNREGISTER_FILE_TYPES
  DeleteRegValue HKLM "Software\RegisteredApplications" "${PRODUCT_NAME}"
  DeleteRegKey HKLM "Software\Classes\Applications\auxioffice.exe"
  DeleteRegKey HKLM "Software\Classes\Applications\auxitext.exe"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\auxioffice.exe"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\auxitext.exe"
  DeleteRegKey HKLM "${REG_APP_PATH}"
  DeleteRegKey /ifempty HKLM "${REG_VENDOR_PATH}"
  DeleteRegKey HKLM "${UNINST_KEY}"
  System::Call 'shell32::SHChangeNotify(i ${SHCNE_ASSOCCHANGED}, i 0, p 0, p 0)'

  !insertmacro AUXI_REMOVE_FILES
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  DetailPrint "$(TXT_KEEP_DATA)"
SectionEnd
