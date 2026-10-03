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
            welNeedHelp: `Learn more about ${product} on $1.`,
            textHelpCenter: config.websiteLabel || 'office.auxinux.ca',
            newDoc: 'New document',
            newXlsx: 'New spreadsheet',
            newPptx: 'New presentation',
            auxOpenPdf: 'Open PDF',
            auxNewText: 'New text file',
            auxOpenFile: 'Open a file',
            portalEmptyAdv1: '',
            emptySlide3Text: 'Store your documents in the cloud of your choice and access them any time, from anywhere.',
            auxAiNotice: 'When enabled, the text you send to the AI assistant is transmitted to the provider you configure. With a local provider (Ollama, LM Studio, GPT4All), nothing leaves your computer.',
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
            welNeedHelp: `Pour en savoir plus sur ${product} : $1.`,
            textHelpCenter: config.websiteLabel || 'office.auxinux.ca',
            newDoc: 'Nouveau document',
            newXlsx: 'Nouvelle feuille de calcul',
            newPptx: 'Nouvelle présentation',
            auxOpenPdf: 'Ouvrir PDF',
            auxNewText: 'Nouveau fichier texte',
            auxOpenFile: 'Ouvrir un fichier',
            portalEmptyAdv1: '',
            emptySlide3Text: 'Stockez vos documents dans le cloud de votre choix et accédez-y partout, à tout moment.',
            auxAiNotice: 'Une fois activé, le texte que vous envoyez à l\'assistant IA est transmis au fournisseur que vous configurez. Avec un fournisseur local (Ollama, LM Studio, GPT4All), rien ne quitte votre ordinateur.',
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

    // macOS : shell natif d'upstream (pas de commandes AuxiNux) ; AuxiText présent seulement si
    // l'application a été construite sur un Mac (config.macTextEditor, ajouté par l'assemblage).
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
        return upstreamShell && !config.macTextEditor ? tiles.filter(t => t.id !== 'auxinux-new-text') : tiles;
    }

    // Renvoie true si l'action a été prise en charge ici.
    function onDocumentSelect(id) {
        switch (id) {
        case 'auxinux-open-pdf':
            if (upstreamShell) openFile(OPEN_FILE_FOLDER, '');
            else window.sdk.command('auxinux:open-pdf', '');
            return true;
        case 'auxinux-new-text':
            // macOS : le shell ouvre les liens avec le système, qui lance AuxiText.app (adresse auxitext://)
            if (upstreamShell) window.open('auxitext://new');
            else window.sdk.command('create:new', 'text');
            return true;
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
        .auxinux-ai-notice { margin: 4px 0 8px 26px; max-width: 520px; font-size: 11px; line-height: 1.4; opacity: .75; }
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

    /* ------------------------------------------------------------------ */
    /* Clouds : seulement les services que l'on peut héberger soi-même    */
    /* ------------------------------------------------------------------ */
    // Liste privacy.cloud_providers de branding/product.json. Aucune connexion n'est établie
    // tant que l'utilisateur n'a pas saisi l'adresse de son propre serveur.
    const cloudProviders = (config.cloudProviders || ['nextcloud', 'owncloud', 'seafile']).map(c => c.toLowerCase());
    const desktop = window.AscDesktopEditor;
    if (desktop && typeof desktop.GetExternalClouds === 'function') {
        const nativeClouds = desktop.GetExternalClouds.bind(desktop);
        desktop.GetExternalClouds = function () {
            const clouds = nativeClouds() || [];
            return clouds.filter(c => cloudProviders.includes(String(c.provider || c.id || '').toLowerCase()));
        };
    }

    /* ------------------------------------------------------------------ */
    /* Assistant IA : panneaux visibles seulement si l'IA est activée     */
    /* ------------------------------------------------------------------ */
    // Panneaux ajoutés à l'accueil par les modules IA (Agent IA) : cachés tant que le réglage
    // « Utiliser l'IA » est désactivé, affichés dès qu'il est activé (après « Appliquer »).
    const AI_PANELS = ['9DC93CDB-B576-4F0C-B55E-FCC9C48DD777', 'F2402876-659F-47FB-A646-67B49F2B5AAA'];
    let aiEnabled = false;

    function applyAiVisibility() {
        document.querySelectorAll('.action-panel iframe').forEach(frame => {
            if (!AI_PANELS.some(id => (frame.id || '').toUpperCase().includes(id)))
                return;
            const panel = frame.closest('.action-panel');
            const action = panel && Array.from(panel.classList).find(c => c.startsWith('external-panel-'));
            const link = action && document.querySelector(`.tool-menu a[action="${action}"]`);
            const item = link && link.closest('.menu-item');
            if (!item)
                return;
            item.style.display = aiEnabled ? '' : 'none';
            if (!aiEnabled && item.classList.contains('selected')) {   // panneau IA ouvert : retour à l'accueil
                const home = document.querySelector('.tool-menu a[action="recents"]');
                home && home.click();
            }
        });
        const box = document.getElementById('sett-box-use-ai');
        if (box && !document.querySelector('.auxinux-ai-notice')) {
            const note = document.createElement('div');
            note.className = 'auxinux-ai-notice';
            note.textContent = utils.Lang.auxAiNotice || strings.fr.auxAiNotice;
            box.insertAdjacentElement('afterend', note);
        }
    }

    let pending = false;
    new MutationObserver(() => {
        if (!pending) {
            pending = true;
            setTimeout(() => { pending = false; applyAiVisibility(); }, 50);
        }
    }).observe(document.documentElement, {childList: true, subtree: true});

    window.addEventListener('load', () => {
        if (window.sdk && typeof window.sdk.on === 'function') {
            window.sdk.on('on_native_message', (cmd, param) => {
                if (/settings:init$/.test(cmd)) {
                    try {
                        const holder = document.createElement('div');
                        holder.innerHTML = param;
                        const settings = JSON.parse(holder.textContent);
                        if (settings && settings.useai !== undefined)
                            aiEnabled = !!settings.useai;
                    } catch (e) { /* réglages illisibles : panneaux IA cachés */ }
                    applyAiVisibility();
                }
            });
        }
        // « Appliquer » dans les paramètres : la visibilité suit immédiatement le nouveau choix.
        document.addEventListener('click', e => {
            if (e.target.closest && e.target.closest('.sett-btn--apply')) {
                const box = document.getElementById('sett-use-ai');
                if (box) {
                    aiEnabled = box.checked;
                    applyAiVisibility();
                }
            }
        }, true);
        applyAiVisibility();
    });

    window.auxinux = {
        product,
        website: config.website || 'https://office.auxinux.ca',
        onlineTemplates: false,   // aucune requête automatique vers une galerie de modèles en ligne
        documentTypes,
        onDocumentSelect,
        aboutLegalHtml,
    };
}();
