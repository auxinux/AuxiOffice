# AuxiNux Office — composants AuxiNux ajoutés au shell, en plus de auxinux.{h,cpp}
# (inclus par win-linux/defaults.pri, patch desktop-apps 0012).
# Copyright (C) 2026 Projet AuxiNux
# SPDX-License-Identifier: AGPL-3.0-or-later

HEADERS += $$PWD/texttabs.h $$PWD/texttabs_config.h
SOURCES += $$PWD/texttabs.cpp

# AuxiText intégré aux onglets : sources de src/auxitext copiées dans auxitext/ par le build
# (scripts/auxibuild/branding.py), sans son main.cpp ; traductions compilées par build_native.py.
exists($$PWD/auxitext/mainwindow.cpp) {
    DEFINES += AUXI_VERSION=\\\"$$cat($$PWD/auxitext/VERSION)\\\"
    INCLUDEPATH += $$PWD/auxitext
    HEADERS += $$PWD/auxitext/app.h $$PWD/auxitext/codeeditor.h $$PWD/auxitext/finddialog.h \
               $$PWD/auxitext/highlighter.h $$PWD/auxitext/mainwindow.h $$PWD/auxitext/textio.h
    SOURCES += $$PWD/auxitext/app.cpp $$PWD/auxitext/codeeditor.cpp $$PWD/auxitext/finddialog.cpp \
               $$PWD/auxitext/highlighter.cpp $$PWD/auxitext/mainwindow.cpp $$PWD/auxitext/textio.cpp
    exists($$PWD/auxitext/i18n/auxitext-i18n.qrc): RESOURCES += $$PWD/auxitext/i18n/auxitext-i18n.qrc
}
