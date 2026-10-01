/*
 * AuxiText — éditeur de texte brut d'AuxiNux Office
 * Copyright (C) 2026 Projet AuxiNux
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

#include "codeeditor.h"

#include <QFontDatabase>
#include <QPainter>
#include <QScrollBar>
#include <QTextBlock>
#include <QWheelEvent>

namespace {
class LineNumberArea : public QWidget
{
public:
    explicit LineNumberArea(CodeEditor* editor) : QWidget(editor), m_editor(editor) {}
    QSize sizeHint() const override { return QSize(m_editor->lineNumberAreaWidth(), 0); }

protected:
    void paintEvent(QPaintEvent* event) override { m_editor->paintLineNumbers(event); }

private:
    CodeEditor* m_editor;
};

int textWidth(const QFontMetrics& fm, const QString& s)
{
#if QT_VERSION >= QT_VERSION_CHECK(5, 11, 0)
    return fm.horizontalAdvance(s);
#else
    return fm.width(s);
#endif
}
}

CodeEditor::CodeEditor(QWidget* parent)
    : QPlainTextEdit(parent)
    , m_lineNumberArea(new LineNumberArea(this))
{
    QFont font = QFontDatabase::systemFont(QFontDatabase::FixedFont);
    font.setStyleHint(QFont::Monospace);
    if (font.pointSizeF() < 10)
        font.setPointSizeF(10.5);
    setFont(font);
    setFrameShape(QFrame::NoFrame);
    applyTabWidth();

    connect(this, &QPlainTextEdit::blockCountChanged, this, [this](int) { updateMarginWidth(); });
    connect(this, &QPlainTextEdit::updateRequest, this, &CodeEditor::updateLineNumberArea);
    connect(this, &QPlainTextEdit::cursorPositionChanged, this, &CodeEditor::highlightCurrentLine);
    updateMarginWidth();
    highlightCurrentLine();
}

void CodeEditor::applyTabWidth()
{
    const int width = textWidth(QFontMetrics(font()), QStringLiteral("    "));
#if QT_VERSION >= QT_VERSION_CHECK(5, 10, 0)
    setTabStopDistance(width);
#else
    setTabStopWidth(width);
#endif
}

void CodeEditor::setLineNumbersVisible(bool visible)
{
    m_lineNumbers = visible;
    m_lineNumberArea->setVisible(visible);
    updateMarginWidth();
}

void CodeEditor::setWordWrap(bool wrap)
{
    setLineWrapMode(wrap ? QPlainTextEdit::WidgetWidth : QPlainTextEdit::NoWrap);
}

void CodeEditor::setDark(bool dark)
{
    m_dark = dark;
    highlightCurrentLine();
    m_lineNumberArea->update();
}

void CodeEditor::zoomBy(int steps)
{
    if (steps == 0 || m_zoom + steps < -8 || m_zoom + steps > 24)
        return;
    m_zoom += steps;
    if (steps > 0)
        zoomIn(steps);
    else
        zoomOut(-steps);
    applyTabWidth();
    updateMarginWidth();
}

void CodeEditor::resetZoom()
{
    zoomBy(-m_zoom);
}

void CodeEditor::goToLine(int line)
{
    const QTextBlock block = document()->findBlockByLineNumber(qMax(0, line - 1));
    if (!block.isValid())
        return;
    QTextCursor cursor(block);
    setTextCursor(cursor);
    centerCursor();
    setFocus();
}

int CodeEditor::lineNumberAreaWidth() const
{
    if (!m_lineNumbers)
        return 0;
    int digits = 1;
    int max = qMax(1, blockCount());
    while (max >= 10) {
        max /= 10;
        ++digits;
    }
    return 12 + textWidth(fontMetrics(), QString(qMax(3, digits), QLatin1Char('9')));
}

void CodeEditor::updateMarginWidth()
{
    setViewportMargins(lineNumberAreaWidth(), 0, 0, 0);
}

void CodeEditor::updateLineNumberArea(const QRect& rect, int dy)
{
    if (dy)
        m_lineNumberArea->scroll(0, dy);
    else
        m_lineNumberArea->update(0, rect.y(), m_lineNumberArea->width(), rect.height());
    if (rect.contains(viewport()->rect()))
        updateMarginWidth();
}

void CodeEditor::resizeEvent(QResizeEvent* event)
{
    QPlainTextEdit::resizeEvent(event);
    const QRect cr = contentsRect();
    m_lineNumberArea->setGeometry(QRect(cr.left(), cr.top(), lineNumberAreaWidth(), cr.height()));
}

void CodeEditor::wheelEvent(QWheelEvent* event)
{
    if (event->modifiers() & Qt::ControlModifier) {
        zoomBy(event->angleDelta().y() > 0 ? 1 : -1);
        event->accept();
        return;
    }
    QPlainTextEdit::wheelEvent(event);
}

void CodeEditor::highlightCurrentLine()
{
    QList<QTextEdit::ExtraSelection> selections;
    if (!isReadOnly()) {
        QTextEdit::ExtraSelection selection;
        selection.format.setBackground(m_dark ? QColor(0xF2, 0x6F, 0x00, 28) : QColor(0xF2, 0xB7, 0x13, 38));
        selection.format.setProperty(QTextFormat::FullWidthSelection, true);
        selection.cursor = textCursor();
        selection.cursor.clearSelection();
        selections.append(selection);
    }
    setExtraSelections(selections);
}

void CodeEditor::paintLineNumbers(QPaintEvent* event)
{
    QPainter painter(m_lineNumberArea);
    painter.fillRect(event->rect(), m_dark ? QColor("#25272B") : QColor("#F3F3F1"));
    const int currentBlock = textCursor().blockNumber();

    QTextBlock block = firstVisibleBlock();
    int number = block.blockNumber();
    int top = qRound(blockBoundingGeometry(block).translated(contentOffset()).top());
    int bottom = top + qRound(blockBoundingRect(block).height());
    const int width = m_lineNumberArea->width() - 6;

    while (block.isValid() && top <= event->rect().bottom()) {
        if (block.isVisible() && bottom >= event->rect().top()) {
            const bool current = number == currentBlock;
            painter.setPen(current ? (m_dark ? QColor("#F2B713") : QColor("#C85A00"))
                                   : (m_dark ? QColor("#6E7681") : QColor("#9A9EA3")));
            painter.drawText(0, top, width, fontMetrics().height(), Qt::AlignRight, QString::number(number + 1));
        }
        block = block.next();
        top = bottom;
        bottom = top + qRound(blockBoundingRect(block).height());
        ++number;
    }
}
