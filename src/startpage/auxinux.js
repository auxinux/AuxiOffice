/*
 * AuxiNux Office — extensions de la page d'accueil (desktop-apps/common/loginpage).
 *
 * Copyright (C) 2026 Projet AuxiNux
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Copié dans loginpage/src/ pendant l'étape « prepare » et concaténé juste après
 * locale.js (voir patches/desktop-apps/). Les fichiers upstream n'appellent que
 * window.auxinux.* : toute la logique AuxiNux est ici.
 */

+function () {
    'use strict';

    const config = window.AUXINUX_BRANDING || {};
    const product = config.productName || 'AuxiNux Office';

    /* ------------------------------------------------------------------ */
    /* Textes (français = langue principale, anglais = langue de repli)   */
    /* ------------------------------------------------------------------ */
    const strings = {
        en: {
            welWelcome: `Welcome to ${product}!`,
            welDescr: 'Create and edit your documents offline, privately: no account, no telemetry, no advertising.',
            welNeedHelp: 'Learn more about the AuxiNux project on $1.',
            textHelpCenter: config.websiteLabel || 'auxinux.ca',
            newDoc: 'New document',
            newXlsx: 'New spreadsheet',
            newPptx: 'New presentation',
            auxOpenPdf: 'Open PDF',
            auxNewText: 'New text file',
            auxOpenFile: 'Open a file',
            portalEmptyAdv1: '',
            emptySlide3Text: 'Store your documents in the cloud of your choice and access them any time, from anywhere.',
            auxLegalTitle: 'Free software and licenses',
            auxLegalBasedOn: `${product} is free software developed by the AuxiNux project. It uses and modifies components from $1 $2, originally developed by $3.`,
            auxLegalIndependent: `${product} is an independent project and is not an official product of ONLYOFFICE or Ascensio System SIA.`,
            auxLegalModified: 'This is a modified version: changes made by the AuxiNux project since $1.',
            auxLegalLicense: 'License: GNU Affero General Public License version 3, with the additional terms of the original program.',
            auxLegalTrademark: 'ONLYOFFICE is a trademark of Ascensio System SIA. No trademark rights are granted.',
            auxLegalPrivacy: 'No telemetry, no advertising, no mandatory account. Works offline.',
            auxLinkLicense: 'License (AGPL v3)',
            auxLinkNotice: 'Notices and modifications',
            auxLinkThirdParty: 'Third-party components',
            auxLinkSource: 'Source code',
            auxLinkUpstream: 'Original program',
            strVersionCommunity: 'Version',
            strVersionCommercial: 'Version',
        },
        fr: {
            welWelcome: `Bienvenue dans ${product} !`,
            welDescr: 'Créez et modifiez vos documents hors ligne, en toute confidentialité : aucun compte, aucune télémétrie, aucune publicité.',
            welNeedHelp: 'Pour en savoir plus sur le projet AuxiNux : $1.',
            textHelpCenter: config.websiteLabel || 'auxinux.ca',
            newDoc: 'Nouveau document',
            newXlsx: 'Nouvelle feuille de calcul',
            newPptx: 'Nouvelle présentation',
            auxOpenPdf: 'Ouvrir PDF',
            auxNewText: 'Nouveau fichier texte',
            auxOpenFile: 'Ouvrir un fichier',
            portalEmptyAdv1: '',
            emptySlide3Text: 'Stockez vos documents dans le cloud de votre choix et accédez-y partout, à tout moment.',
            auxLegalTitle: 'Logiciels libres et licences',
            auxLegalBasedOn: `${product} est un logiciel libre développé dans le cadre du projet AuxiNux. ${product} utilise et modifie des composants provenant de $1 $2, développé à l'origine par $3.`,
            auxLegalIndependent: `${product} est un projet indépendant et n'est pas un produit officiel de ONLYOFFICE ou d'Ascensio System SIA.`,
            auxLegalModified: 'Il s\'agit d\'une version modifiée : modifications apportées par le projet AuxiNux depuis le $1.',
            auxLegalLicense: 'Licence : GNU Affero General Public License version 3, avec les conditions additionnelles du programme d\'origine.',
            auxLegalTrademark: 'ONLYOFFICE est une marque d\'Ascensio System SIA. Aucun droit de marque n\'est accordé.',
            auxLegalPrivacy: 'Aucune télémétrie, aucune publicité, aucun compte obligatoire. Fonctionne hors ligne.',
            auxLinkLicense: 'Licence (AGPL v3)',
            auxLinkNotice: 'Mentions et modifications',
            auxLinkThirdParty: 'Composants tiers',
            auxLinkSource: 'Code source',
            auxLinkUpstream: 'Programme d\'origine',
            strVersionCommunity: 'Version',
            strVersionCommercial: 'Version',
            actAbout: 'À propos',
        },
    };

    for (const lang in strings)
        l10n[lang] = Object.assign(l10n[lang] || {}, strings[lang]);

    // Nom du produit dans toutes les langues livrées par upstream ; les autres mentions
    // d'ONLYOFFICE (offres cloud d'upstream) prennent le texte AuxiNux anglais, ou le nom du produit.
    const productRe = /ONLYOFFICE Desktop Editors|ONLYOFFICE Desktop/g;
    for (const lang in l10n) {
        for (const key in l10n[lang]) {
            let value = l10n[lang][key];
            if (typeof value !== 'string')
                continue;
            value = value.replace(productRe, product);
            if (/ONLYOFFICE/i.test(value) && !(strings[lang] && key in strings[lang]))
                value = key in strings.en ? strings.en[key]
                                          : value.replace(/ONLYOFFICE( Cloud Service| cloud| Cloud)?/gi, product);
            l10n[lang][key] = value;
        }
    }

    // locale.js a déjà calculé utils.Lang : on le recalcule avec nos textes.
    Object.assign(utils.Lang, l10n.en);
    if (utils.Lang.id) {
        const id = utils.Lang.id.replace(/-/g, '_');
        const code = id.substring(0, 2);
        const match = l10n[id] ? id : Object.keys(l10n).find(l => l.substring(0, 2) === code);
        if (match)
            loadLocale(match);
    }

    /* ------------------------------------------------------------------ */
    /* Écran d'accueil : tuiles de création / ouverture                   */
    /* ------------------------------------------------------------------ */
    const colors = config.colors || {};
    const tile = (id, langKey, label, color, icon) => ({
        id, title: utils.Lang[langKey], langKey, icon,
        formatLabel: { value: label, gradientColorStart: color[0], gradientColorEnd: color[1], bgColorWinXP: color[1] },
    });

    // macOS : shell natif d'upstream (pas de commandes AuxiNux, pas d'AuxiText en 0.1.0).
    const upstreamShell = /Mac/.test(navigator.platform);

    function documentTypes() {
        const tiles = [
            tile('word', 'newDoc', 'DOCX', colors.writer || ['#4C86E8', '#2F6FDE'], '#docx-big'),
            tile('cell', 'newXlsx', 'XLSX', colors.sheet || ['#34B46D', '#1F9D55'], '#xlsx-big'),
            tile('slide', 'newPptx', 'PPTX', colors.present || ['#EA7351', '#E4572E'], '#pptx-big'),
            tile('auxinux-open-pdf', 'auxOpenPdf', 'PDF', colors.pdf || ['#D44A5B', '#C8283C'], '#pdf-big'),
            tile('auxinux-new-text', 'auxNewText', 'TXT', colors.text || ['#7A8594', '#5F6B7A'], '#txt-big'),
            tile('auxinux-open', 'auxOpenFile', '…', colors.open || ['#F2B713', '#F26F00'], '#folder-big'),
        ];
        return upstreamShell ? tiles.filter(t => t.id !== 'auxinux-new-text') : tiles;
    }

    // Renvoie true si l'action a été prise en charge ici.
    function onDocumentSelect(id) {
        switch (id) {
        case 'auxinux-open-pdf':
            if (upstreamShell) openFile(OPEN_FILE_FOLDER, '');
            else window.sdk.command('auxinux:open-pdf', '');
            return true;
        case 'auxinux-new-text':  window.sdk.command('create:new', 'text'); return true;
        case 'auxinux-open':      openFile(OPEN_FILE_FOLDER, ''); return true;
        default:                  return false;
        }
    }

    /* ------------------------------------------------------------------ */
    /* À propos > Logiciels libres et licences                            */
    /* ------------------------------------------------------------------ */
    const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));

    function aboutLegalHtml(opts) {
        const legal = Object.assign({}, config.legal || {}, (opts && opts.auxinux) || {});
        if (!legal.license_file) {
            // shell d'upstream (macOS) : fichiers légaux à côté de la page d'accueil, dans le bundle
            const rel = f => new URL('../' + f, location.href).href;
            legal.license_file = rel('LICENSE.txt');
            legal.notice_file = rel('NOTICE.txt');
            legal.thirdparty_file = rel('licenses/index.html');
        }
        const L = utils.Lang;
        const link = (url, key) => url ? `<a class="link" draggable="false" href="#" onclick="window.open('${esc(url)}')" l10n>${esc(L[key])}</a>` : '';
        const basedOn = esc(L.auxLegalBasedOn)
            .replace('$1', esc(legal.upstream_name || 'ONLYOFFICE Desktop Editors'))
            .replace('$2', esc(legal.upstream_version || ''))
            .replace('$3', esc(legal.upstream_developer || 'Ascensio System SIA'));
        return `<div class="auxinux-legal">
                    <h4 l10n>${esc(L.auxLegalTitle)}</h4>
                    <p>${basedOn}</p>
                    <p l10n>${esc(L.auxLegalIndependent)}</p>
                    <p>${esc(L.auxLegalModified).replace('$1', esc(legal.modified_since || ''))}</p>
                    <p l10n>${esc(L.auxLegalLicense)}</p>
                    <p l10n>${esc(L.auxLegalTrademark)}</p>
                    <p l10n>${esc(L.auxLegalPrivacy)}</p>
                    <div class="auxinux-legal-links">
                        ${link(legal.license_file, 'auxLinkLicense')}
                        ${link(legal.notice_file, 'auxLinkNotice')}
                        ${link(legal.thirdparty_file, 'auxLinkThirdParty')}
                        ${link(legal.source_url, 'auxLinkSource')}
                        ${link(legal.upstream_url, 'auxLinkUpstream')}
                    </div>
                </div>`;
    }

    /* ------------------------------------------------------------------ */
    /* Styles AuxiNux                                                     */
    /* ------------------------------------------------------------------ */
    const css = `
        .newportal, #link-create { display: none !important; }
        /* Pas de connexion aux clouds proposés par upstream (offres ONLYOFFICE) en 0.1.0 */
        #idx-sidebar-portals { display: none !important; }
        .auxinux-legal { margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--border-divider, rgba(128,128,128,.3)); max-width: 560px; }
        .auxinux-legal h4 { margin: 0 0 8px; font-weight: bold; }
        .auxinux-legal p { margin: 0 0 6px; line-height: 1.45; opacity: .9; }
        .auxinux-legal-links { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 8px; }
        #area-document-creation-grid { overflow: visible; min-height: auto; flex-shrink: 0; }
        .document-creation-grid { display: grid !important; grid-template-columns: repeat(3, max-content);
                                  justify-content: center; gap: 16px 28px; }
        .document-creation-grid > * { margin-right: 0 !important; }`;
    const style = document.createElement('style');
    style.setAttribute('data-auxinux', '');
    style.textContent = css;
    document.head.appendChild(style);

    // macOS : sans le module AuxiNux du shell, l'assistant IA serait actif par défaut ; il est
    // désactivé une seule fois, au premier lancement (le choix ultérieur de l'utilisateur est respecté).
    if (upstreamShell && !localStorage.getItem('auxinux-ai-default')) {
        window.addEventListener('load', () => {
            if (window.sdk && typeof window.sdk.command === 'function') {
                window.sdk.command('settings:apply', JSON.stringify({useai: false}));
                localStorage.setItem('auxinux-ai-default', 'off');
            }
        });
    }

    window.auxinux = {
        product,
        website: config.website || 'https://auxinux.ca',
        onlineTemplates: false,   // aucune requête automatique vers une galerie de modèles en ligne
        documentTypes,
        onDocumentSelect,
        aboutLegalHtml,
    };
}();
