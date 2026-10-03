# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Privacy hardening of the installed HTML/JS layers (start page, editors, plugins), applied to
the assembled tree of every platform (Linux, Windows, macOS). See PRIVACY.md.

  - Content-Security-Policy on every page of the start page, the editors and the offline plugins:
    the web engine only loads local resources (file:, ascdesktop:, data:, blob:). An image or a
    style sheet referenced by URL in a document, a pasted HTML fragment or a macro cannot reach
    the network (tracking pixels), and the DNS prefetching of links is disabled;
  - Photo Editor plugin (TOAST UI Image Editor): its Google Analytics statistics are disabled
    (the plugin's opt-out was ineffective) and the collection URL is removed from the libraries;
  - Analytics component of the editors (dead code upstream): replaced by an inert version;
  - AI plugin: providers relayed by an ONLYOFFICE proxy server are removed; local providers
    (Ollama, LM Studio, GPT4All) are listed first.

Every change checks that the expected upstream text is present: an upstream update that moves it
stops the build instead of silently shipping an unprotected page."""

import json
import re
from pathlib import Path

from .common import fail, info, ok, product

# Origines autorisées : fichiers locaux de l'application et des documents, ressources du moteur
# (ascdesktop://fonts, plugins), données en mémoire. Aucune adresse http(s), ws(s) ou ftp.
LOCAL = "'self' file: ascdesktop: data: blob:"
CSP = "; ".join([
    f"default-src {LOCAL} 'unsafe-inline' 'unsafe-eval'",
    f"script-src {LOCAL} 'unsafe-inline' 'unsafe-eval'",
    f"style-src {LOCAL} 'unsafe-inline'",
    f"img-src {LOCAL}",
    f"font-src {LOCAL}",
    f"media-src {LOCAL}",
    f"connect-src {LOCAL}",
    f"worker-src {LOCAL}",
    f"frame-src {LOCAL} about:",
    f"child-src {LOCAL} about:",
    "object-src 'none'",
    "form-action 'none'",
])
CSP_META = (f'<meta http-equiv="Content-Security-Policy" content="{CSP}">'
            '<meta http-equiv="x-dns-prefetch-control" content="off">')
CSP_MARKER = 'http-equiv="Content-Security-Policy"'

# Pages des éditeurs (web-apps/apps) chargées par l'application de bureau
EDITOR_PAGES = [
    "api/documents/index.html",
    "documenteditor/main/index.html",
    "documenteditor/forms/index.html",
    "spreadsheeteditor/main/index.html",
    "spreadsheeteditor/main/index_internal.html",
    "presentationeditor/main/index.html",
    "presentationeditor/main/index.reporter.html",
    "pdfeditor/main/index.html",
    "visioeditor/main/index.html",
]

# Plugins qui utilisent le réseau par nature, à la demande de l'utilisateur : gestionnaire de
# plugins (catalogue en ligne), assistants IA (fournisseur choisi par l'utilisateur, désactivés
# par défaut). Tous les autres plugins livrés sont des pages locales et reçoivent la CSP.
NETWORK_PLUGINS = {
    "{AA2EA9B6-9EC2-415F-9762-634EE8D9A95E}": "gestionnaire de plugins",
    "{9DC93CDB-B576-4F0C-B55E-FCC9C48DD007}": "IA",
    "{9DC93CDB-B576-4F0C-B55E-FCC9C48DD777}": "agent IA",
}
PHOTO_EDITOR = "{07FD8DFA-DFE0-4089-AL24-0730933CC80A}"
AI_PLUGIN = "{9DC93CDB-B576-4F0C-B55E-FCC9C48DD007}"
GA_COLLECT = "https://www.google-analytics.com/collect"


def _replace_once(path, old, new, what):
    text = path.read_text(encoding="utf-8")
    if text.count(old) != 1:
        fail(f"{what} : motif d'upstream introuvable ou ambigu dans {path}")
    path.write_text(text.replace(old, new), encoding="utf-8")


def add_csp(page):
    """Ajoute la CSP en tête de <head> (avant tout script). Idempotent."""
    text = page.read_text(encoding="utf-8")
    if CSP_MARKER in text:
        if CSP not in text:
            fail(f"{page} contient déjà une autre Content-Security-Policy")
        return False
    m = re.search(r"<head(\s[^>]*)?>", text, re.IGNORECASE)
    if not m:
        fail(f"balise <head> introuvable : {page}")
    page.write_text(text[:m.end()] + CSP_META + text[m.end():], encoding="utf-8")
    return True


def harden_pages(start_page, editors):
    """CSP sur l'accueil, les éditeurs et les plugins locaux."""
    pages = [Path(start_page)]
    apps = Path(editors) / "web-apps" / "apps"
    pages += [apps / rel for rel in EDITOR_PAGES]
    missing = [p for p in pages if not p.exists()]
    if missing:
        fail("pages attendues absentes : " + ", ".join(str(p) for p in missing))
    plugins = Path(editors) / "sdkjs-plugins"
    for plugin in sorted(d for d in plugins.iterdir() if d.is_dir() and d.name.startswith("{")):
        if plugin.name in NETWORK_PLUGINS:
            continue
        pages += sorted(plugin.rglob("*.html"))
    for page in pages:
        add_csp(page)
    ok(f"Content-Security-Policy (ressources locales uniquement) : {len(pages)} pages")


def fix_photo_editor(editors):
    """Statistiques Google Analytics de TOAST UI désactivées et adresse de collecte retirée."""
    plugin = Path(editors) / "sdkjs-plugins" / PHOTO_EDITOR
    if not plugin.exists():
        return
    # L'option « usageStatistics: false » d'upstream est dans includeUI : la bibliothèque l'écrase
    # avec sa valeur par défaut (true). Elle doit être au premier niveau des options ; la variable
    # globale tui.usageStatistics couvre les sélecteurs de couleur et tui-code-snippet.
    script = plugin / "scripts" / "photoeditor.js"
    _replace_once(script, "imageEditor = new tui.ImageEditor('#tui-image-editor-container', {\n",
                  "imageEditor = new tui.ImageEditor('#tui-image-editor-container', {\n"
                  "                usageStatistics: false,  // AuxiNux : aucune statistique (Google Analytics)\n",
                  "Éditeur photo")
    text = script.read_text(encoding="utf-8")
    script.write_text("/* AuxiNux : aucune statistique d'utilisation envoyée par TOAST UI (Google Analytics). */\n"
                      "window.tui = window.tui || {};\nwindow.tui.usageStatistics = false;\n" + text,
                      encoding="utf-8")
    vendors = sorted((plugin / "vendor" / "tui").rglob("*.js"))
    changed = 0
    for js in vendors:
        text = js.read_text(encoding="utf-8")
        if GA_COLLECT in text:
            # Une image dont la source est « data:, » ne provoque aucune requête.
            js.write_text(text.replace(GA_COLLECT, "data:,"), encoding="utf-8")
            changed += 1
    if changed == 0:
        fail("Éditeur photo : adresse Google Analytics de TOAST UI introuvable (bibliothèque modifiée ?)")
    ok(f"Éditeur photo : statistiques désactivées, adresse de collecte retirée de {changed} bibliothèque(s)")


ANALYTICS_STUB = """/*
 * AuxiNux Office : composant d'analytique des éditeurs remplacé par une version inerte.
 * L'original (web-apps, apps/common/Analytics.js) injecte Google Analytics ; il n'est pas activé
 * dans l'application de bureau d'upstream, et AuxiNux n'en livre aucune trace.
 */
if (window.Common === undefined)
    window.Common = {};

Common.component = Common.component || {};

Common.Analytics = Common.component.Analytics = {
    initialize: function() {},
    trackEvent: function() {}
};
"""


def neutralize_analytics(editors):
    js = Path(editors) / "web-apps" / "apps" / "common" / "Analytics.js"
    if not js.exists():
        return
    if "google-analytics" not in js.read_text(encoding="utf-8") and "AuxiNux" in js.read_text(encoding="utf-8"):
        return
    js.write_text(ANALYTICS_STUB, encoding="utf-8")
    ok("composant d'analytique des éditeurs remplacé par une version inerte")


def remove_proxied_ai_providers(editors):
    """Fournisseurs d'IA relayés par le serveur proxy d'ONLYOFFICE : retirés de la liste."""
    removed = product()["privacy"].get("removed_ai_providers", [])
    plugin = Path(editors) / "sdkjs-plugins" / AI_PLUGIN
    config = plugin / "scripts" / "engine" / "providers" / "config.json"
    if not removed or not config.exists():
        return
    providers = json.loads(config.read_text(encoding="utf-8"))
    kept = [p for p in providers if p not in removed]
    # Fournisseurs locaux en tête de liste : avec eux, aucune donnée ne quitte l'ordinateur.
    local = [p for p in product()["privacy"].get("local_ai_providers_first", []) if p in kept]
    kept = local + [p for p in kept if p not in local]
    config.write_text(json.dumps(kept, indent="\t") + "\n", encoding="utf-8")
    for name in removed:
        f = plugin / "scripts" / "engine" / "providers" / "internal" / f"{name}.js"
        if f.exists():
            f.unlink()
    # Plus aucun fournisseur ne passe par le relais : adresse du serveur retirée.
    engine = plugin / "scripts" / "engine" / "engine.js"
    _replace_once(engine, 'AI.PROXY_URL = "https://plugins-services.onlyoffice.com/proxy";',
                  'AI.PROXY_URL = "";  // AuxiNux : aucun relais par un serveur tiers', "IA")
    info(f"IA : fournisseurs relayés par un serveur tiers retirés ({', '.join(removed)})")


def harden(start_page, editors):
    """Toutes les protections, sur un arbre assemblé (accueil + dossier editors)."""
    fix_photo_editor(editors)
    neutralize_analytics(editors)
    remove_proxied_ai_providers(editors)
    harden_pages(start_page, editors)
