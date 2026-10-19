# AuxiText — éditeur de texte brut d'AuxiNux Office
# Copyright (C) 2026 Projet AuxiNux
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Même projet pour Linux (Qt 5.9.9 livrée par upstream) et Windows (Qt 5.15.2 MSVC).
# Construit par scripts/auxibuild (build_auxitext.py).

QT += core gui widgets printsupport
CONFIG += c++11 release warn_on
TEMPLATE = app
TARGET = auxitext

# Version : source de vérité unique = fichier VERSION à la racine du dépôt
AUXI_VERSION = $$cat($$PWD/../../VERSION)
DEFINES += AUXI_VERSION=\\\"$$AUXI_VERSION\\\"
DEFINES += QT_NO_CAST_FROM_BYTEARRAY

HEADERS += app.h codeeditor.h finddialog.h highlighter.h mainwindow.h spellchecker.h textio.h
SOURCES += app.cpp codeeditor.cpp finddialog.cpp highlighter.cpp mainwindow.cpp main.cpp spellchecker.cpp textio.cpp

TRANSLATIONS += i18n/auxitext_fr.ts i18n/auxitext_en.ts

RESOURCES += resources/auxitext.qrc
# Traductions compilées (.qm) générées dans le répertoire de build par build_auxitext.py
exists($$OUT_PWD/i18n/i18n.qrc): RESOURCES += $$OUT_PWD/i18n/i18n.qrc

unix:!macx {
    # Les bibliothèques Qt sont livrées à côté du binaire (/usr/lib/auxinux-office)
    QMAKE_LFLAGS += "-Wl,-rpath,\'\$$ORIGIN\'" -Wl,--disable-new-dtags -Wl,--as-needed -static-libstdc++ -static-libgcc
    QMAKE_LFLAGS_RPATH =
}

win32 {
    # Ressource Windows (icône + informations de version) générée par qmake
    VERSION = $${AUXI_VERSION}.0
    RC_ICONS = $$PWD/../../branding/generated/ico/auxitext.ico
    RC_LANG = 0x040C
    QMAKE_TARGET_COMPANY = "Projet AuxiNux"
    QMAKE_TARGET_PRODUCT = "AuxiNux Office"
    QMAKE_TARGET_DESCRIPTION = "AuxiText - editeur de texte d AuxiNux Office"
    QMAKE_TARGET_COPYRIGHT = "(C) 2026 Projet AuxiNux - AGPL-3.0"
    CONFIG -= console
}
