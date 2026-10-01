# Tests unitaires d'AuxiText (QtTest) — exécutés par scripts/auxibuild test
QT += core testlib
QT -= gui
CONFIG += c++11 console testcase
CONFIG -= app_bundle
TARGET = tst_textio
INCLUDEPATH += $$PWD/../../src/auxitext
HEADERS += $$PWD/../../src/auxitext/textio.h
SOURCES += tst_textio.cpp $$PWD/../../src/auxitext/textio.cpp
