/*
 * Tests unitaires d'AuxiText : détection d'encodage et de fins de ligne.
 * Copyright (C) 2026 Projet AuxiNux
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

#include "textio.h"

#include <QtTest>

using namespace TextIO;

class TestTextIO : public QObject
{
    Q_OBJECT
private slots:
    void detectsLf()
    {
        const Document d = decode(QByteArray("a\nb\nc\n"));
        QCOMPARE(int(d.eol), int(Eol::LF));
        QCOMPARE(d.text, QStringLiteral("a\nb\nc\n"));
        QVERIFY(!d.eolStats.mixed());
    }

    void detectsCrlf()
    {
        const Document d = decode(QByteArray("a\r\nb\r\nc\r\n"));
        QCOMPARE(int(d.eol), int(Eol::CRLF));
        QCOMPARE(d.text, QStringLiteral("a\nb\nc\n"));
        QCOMPARE(d.eolStats.crlf, 3);
    }

    void detectsCr()
    {
        const Document d = decode(QByteArray("a\rb\rc"));
        QCOMPARE(int(d.eol), int(Eol::CR));
        QCOMPARE(d.text, QStringLiteral("a\nb\nc"));
    }

    void mixedUsesMajority()
    {
        const Document d = decode(QByteArray("a\r\nb\r\nc\nd\r\n"));
        QVERIFY(d.eolStats.mixed());
        QCOMPARE(int(d.eol), int(Eol::CRLF));
    }

    void noNewlineUsesPlatformDefault()
    {
        const Document d = decode(QByteArray("une seule ligne"));
        QCOMPARE(int(d.eol), int(platformEol()));
    }

    void utf8WithoutBom()
    {
        const Document d = decode(QStringLiteral("éàü €").toUtf8());
        QCOMPARE(int(d.encoding), int(Encoding::Utf8));
        QCOMPARE(d.text, QStringLiteral("éàü €"));
        QVERIFY(!d.hadInvalidUtf8);
    }

    void utf8WithBom()
    {
        const Document d = decode(QByteArray("\xEF\xBB\xBF") + QStringLiteral("é").toUtf8());
        QCOMPARE(int(d.encoding), int(Encoding::Utf8Bom));
        QCOMPARE(d.text, QStringLiteral("é"));
    }

    void utf16LeWithBom()
    {
        QByteArray raw("\xFF\xFE", 2);
        raw.append("h\0i\0", 4);
        const Document d = decode(raw);
        QCOMPARE(int(d.encoding), int(Encoding::Utf16LE));
        QCOMPARE(d.text, QStringLiteral("hi"));
    }

    void invalidUtf8FallsBackTo8bit()
    {
        const Document d = decode(QByteArray("caf\xE9\n"));   // « café » en Latin-1
        QVERIFY(d.hadInvalidUtf8);
        QCOMPARE(int(d.encoding), int(Encoding::Windows1252));
        QCOMPARE(d.text, QStringLiteral("café\n"));
    }

    void emptyFile()
    {
        const Document d = decode(QByteArray());
        QVERIFY(d.text.isEmpty());
        QCOMPARE(int(d.encoding), int(Encoding::Utf8));
    }

    void roundTripPreservesBytes_data()
    {
        QTest::addColumn<QByteArray>("raw");
        QTest::newRow("lf") << QByteArray("x\ny\n");
        QTest::newRow("crlf") << QByteArray("x\r\ny\r\n");
        QTest::newRow("utf8") << QStringLiteral("Ligne é\nLigne à\n").toUtf8();
        QTest::newRow("bom") << (QByteArray("\xEF\xBB\xBF") + QByteArray("a\r\nb"));
        QTest::newRow("latin1") << QByteArray("caf\xE9\r\n");
    }

    void roundTripPreservesBytes()
    {
        QFETCH(QByteArray, raw);
        const Document d = decode(raw);
        QCOMPARE(encode(d.text, d.encoding, d.eol), raw);
    }

    void convertsLineEndings()
    {
        QCOMPARE(encode(QStringLiteral("a\nb\n"), Encoding::Utf8, Eol::CRLF), QByteArray("a\r\nb\r\n"));
        QCOMPARE(encode(QStringLiteral("a\nb\n"), Encoding::Utf8, Eol::LF), QByteArray("a\nb\n"));
    }

    void latin1CannotEncodeEuro()
    {
        QVERIFY(!canEncodeLosslessly(QStringLiteral("10 €"), Encoding::Latin1));
        QVERIFY(canEncodeLosslessly(QStringLiteral("10 €"), Encoding::Windows1252));
        QVERIFY(canEncodeLosslessly(QStringLiteral("10 €"), Encoding::Utf8));
    }
};

QTEST_APPLESS_MAIN(TestTextIO)
#include "tst_textio.moc"
