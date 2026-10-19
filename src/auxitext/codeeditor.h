/*
 * AuxiText — éditeur de texte brut d'AuxiNux Office
 * Copyright (C) 2026 Projet AuxiNux
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Zone d'édition : QPlainTextEdit + marge de numéros de ligne + surlignage
 * de la ligne courante.
 */

#ifndef AUXITEXT_CODEEDITOR_H
#define AUXITEXT_CODEEDITOR_H

#include <QPlainTextEdit>

#include <functional>

class QMenu;

class CodeEditor : public QPlainTextEdit
{
    Q_OBJECT
public:
    explicit CodeEditor(QWidget* parent = nullptr);

    void setLineNumbersVisible(bool visible);
    bool lineNumbersVisible() const { return m_lineNumbers; }
    void setWordWrap(bool wrap);
    void setDark(bool dark);
    void zoomBy(int steps);
    void resetZoom();
    int zoomSteps() const { return m_zoom; }
    void goToLine(int line);

    // Soulignements de la correction (AuxiCorrect), affichés avec la ligne courante
    void setDiagnosticSelections(const QList<QTextEdit::ExtraSelection>& selections);
    // Complète le menu contextuel ; reçoit la position du texte sous le pointeur
    void setContextMenuHook(const std::function<void(QMenu*, int)>& hook) { m_contextMenuHook = hook; }

    int lineNumberAreaWidth() const;
    void paintLineNumbers(QPaintEvent* event);

protected:
    void resizeEvent(QResizeEvent* event) override;
    void wheelEvent(QWheelEvent* event) override;
    void contextMenuEvent(QContextMenuEvent* event) override;

private:
    void updateMarginWidth();
    void updateLineNumberArea(const QRect& rect, int dy);
    void highlightCurrentLine();
    void applyTabWidth();

    QWidget* m_lineNumberArea;
    bool m_lineNumbers = true;
    bool m_dark = false;
    int m_zoom = 0;
    QList<QTextEdit::ExtraSelection> m_diagnostics;
    std::function<void(QMenu*, int)> m_contextMenuHook;
};

#endif // AUXITEXT_CODEEDITOR_H
