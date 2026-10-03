/*
 * AuxiNux Office (macOS) — fichiers texte brut ouverts dans AuxiText.
 *
 * Copyright (C) 2026 Projet AuxiNux
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Le shell macOS d'upstream (non recompilé) ouvre les fichiers .txt dans AuxiWriter. Ce script,
 * ajouté à la page de l'éditeur de documents de l'application macOS (scripts/auxibuild/macos.py),
 * renvoie un fichier texte local à AuxiText (adresse auxitext://open?path=…, ouverte par macOS)
 * puis ferme l'onglet. Exception : « Ouvrir dans AuxiWriter » d'AuxiText laisse une marque
 * récente (/tmp/auxinux-writer/<empreinte du chemin>) et le fichier reste alors dans AuxiWriter.
 * Sous Linux et Windows, le shell AuxiNux fait ce routage lui-même : script non installé.
 */
(function () {
    'use strict';
    var TEXT_EXTENSIONS = window.AUXINUX_TEXT_EXTENSIONS || ['txt'];
    var native = window.AscDesktopEditor;
    if (!native || !/mac os/i.test(navigator.userAgent) || typeof native.LocalFileGetSourcePath !== 'function')
        return;

    // FNV-1a 32 bits du chemin en UTF-8 (même calcul que App::writerMarkName d'AuxiText)
    function fingerprint(text) {
        var bytes = new TextEncoder().encode(text), h = 0x811c9dc5;
        for (var i = 0; i < bytes.length; ++i) {
            h ^= bytes[i];
            h = Math.imul(h, 0x01000193) >>> 0;
        }
        return ('0000000' + h.toString(16)).slice(-8);
    }

    function writerRequested(path) {
        try {
            var request = new XMLHttpRequest();
            request.open('GET', 'file:///tmp/auxinux-writer/' + fingerprint(path), false);
            request.send();
            var stamp = parseInt(request.responseText, 10);
            return stamp > 0 && Math.abs(Date.now() / 1000 - stamp) < 300;
        } catch (e) {
            return false;
        }
    }

    var attempts = 0;
    var timer = setInterval(function () {
        var path = '';
        try { path = native.LocalFileGetSourcePath() || ''; } catch (e) { /* pas encore ouvert */ }
        if (++attempts > 120)
            clearInterval(timer);
        if (!path)
            return;
        clearInterval(timer);
        var name = path.split('/').pop();
        var dot = name.lastIndexOf('.');
        var ext = dot > 0 ? name.substring(dot + 1).toLowerCase() : '';
        if (TEXT_EXTENSIONS.indexOf(ext) < 0 || writerRequested(path))
            return;
        window.open('auxitext://open?path=' + encodeURIComponent(path));
        native.execCommand('editor:event', JSON.stringify({action: 'file:close'}));
    }, 250);
})();
