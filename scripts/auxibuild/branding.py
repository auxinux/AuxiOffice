# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Branding step: inject the AuxiNux identity (branding/product.json + VERSION)
into the patched upstream trees, through the white-label hooks provided by
upstream (src/prop/defines_p.h, version_p.h) and AuxiNux overlay files.

Nothing here edits upstream logic: behaviour changes live in patches/."""

import json
import shutil
from pathlib import Path

from .common import ROOT, UPSTREAM_SRC, copytree, fail, info, ok, product, step, version, version_tuple4, build_number, write_text

BRANDING = ROOT / "branding"
GENERATED_HEADER = "/* Fichier généré par scripts/auxibuild/branding.py depuis branding/product.json et VERSION — ne pas modifier. */\n"


def c_str(value):
    return json.dumps(value, ensure_ascii=False)


def text_extensions(p):
    return [e for e in p["apps"]["text"]["extensions"] if e != "csv"]


def shell_branding_header(p):
    prod, up, lin, win = p["product"], p["upstream"], p["linux"], p["windows"]
    v = version()
    year = prod["copyright_first_year"]
    defs = {
        "AUXI_PRODUCT_NAME": prod["name"],
        "AUXI_PRODUCT_SHORT_NAME": prod["short_name"],
        "AUXI_VERSION": v,
        "AUXI_VERSION_FULL": ".".join(str(x) for x in version_tuple4(build_number())),
        "AUXI_VENDOR": prod["vendor"],
        "AUXI_COPYRIGHT": f"© {year} {prod['copyright_holder']}",
        "AUXI_WEBSITE": prod["website"],
        "AUXI_WEBSITE_LABEL": prod["website"].split("://", 1)[-1],
        "AUXI_SOURCE_URL": prod["source_url"],
        "AUXI_MODIFICATION_DATE": prod["modification_start_date"],
        "AUXI_UPSTREAM_NAME": up["name"],
        "AUXI_UPSTREAM_DEVELOPER": up["developer"],
        "AUXI_UPSTREAM_URL": up["url"],
        "AUXI_UPSTREAM_VERSION": json.loads((ROOT / "upstream" / "upstream.lock.json").read_text())["upstream"]["version"],
        "AUXI_DOCUMENT_APPLICATION_NAME": prod["name"],
        "AUXI_DOCUMENT_APPLICATION_COMPANY": "",
        "AUXI_TEXT_EXTENSIONS": ";".join(text_extensions(p)),
        "AUXI_XDG_NAME": lin["xdg_name"],
        "AUXI_WIN_VENDOR_DIR": win["vendor_dir"],
        "AUXI_WIN_APP_DIR": win["app_dir"],
    }
    lines = [GENERATED_HEADER, "#ifndef AUXINUX_BRANDING_H", "#define AUXINUX_BRANDING_H", ""]
    for k, val in defs.items():
        lines.append(f"#define {k:<36} {c_str(val)}")
    lines += [
        "",
        "#ifdef _WIN32",
        f"# define AUXI_TEXT_EDITOR_BINARY             {c_str(win['text_binary'])}",
        f"# define AUXI_LAUNCH_NAME                    {c_str(win['executable'])}",
        "#else",
        f"# define AUXI_TEXT_EDITOR_BINARY             {c_str(lin['text_binary'])}",
        f"# define AUXI_LAUNCH_NAME                    {c_str(lin['executable'])}",
        "#endif",
        "",
        "/* Les assistants IA (envoi de contenu à un tiers) sont désactivés par défaut. */",
        "#define AUXI_DEFAULT_DISABLE_AI 1",
        "",
        "#endif",
        "",
    ]
    return "\n".join(lines)


def shell_defines_p(p):
    """Override header included at the end of upstream src/defines.h (white-label hook)."""
    lin, win = p["linux"], p["windows"]
    name = p["product"]["name"]
    return f"""{GENERATED_HEADER}
#ifndef DEFINES_PRIVATE_H
#define DEFINES_PRIVATE_H

#include "auxinux_branding.h"

#undef APP_NAME
#undef APP_TITLE
#undef APP_DATA_PATH
#undef REG_GROUP_KEY
#undef APP_MUTEX_NAME
#undef DESKTOP_FILE_NAME
#undef APP_REG_NAME
#undef REG_UNINST_KEY
#undef WINDOW_NAME
#undef WINDOW_TITLE
#undef REG_APP_NAME
#undef APP_DEFAULT_LOCALE
#undef APP_USER_MODEL_ID
#undef APP_SIMPLE_WINDOW_TITLE
#undef APP_PROTOCOL
#undef FILE_PREFIX
#undef URL_SITE
#undef URL_SIGNUP
#undef DOWNLOAD_PAGE
#undef RELEASE_NOTES

#define APP_NAME                {c_str(p['product']['short_name'])}
#define APP_TITLE               {c_str(name)}
#ifdef __linux
# define APP_DATA_PATH          {c_str('/' + lin['xdg_name'])}
# define REG_GROUP_KEY          {c_str(lin['xdg_name'])}
# define APP_MUTEX_NAME         {c_str(lin['single_instance_key'])}
# define DESKTOP_FILE_NAME      {c_str(lin['app_id'])}
#else
# define APP_DATA_PATH          {c_str('/' + win['vendor_dir'] + '/' + win['app_dir'])}
# define APP_REG_NAME           {c_str(name)}
# define REG_GROUP_KEY          {c_str(win['registry_vendor'])}
# define REG_UNINST_KEY         {c_str(win['uninstall_key'])}
# define APP_MUTEX_NAME         {c_str(win['single_instance_key'])}
#endif
#define WINDOW_NAME             {c_str(name)}
#define WINDOW_TITLE            WINDOW_NAME
#define REG_APP_NAME            {c_str(win['registry_app'])}
#define APP_DEFAULT_LOCALE      "fr-FR"
#define APP_USER_MODEL_ID       {c_str(win['app_user_model_id'])}
#define APP_SIMPLE_WINDOW_TITLE {c_str(name)}
#define APP_PROTOCOL            {c_str(win['url_protocol'])}
#define FILE_PREFIX             "auxioffice_"
#define URL_SITE                AUXI_WEBSITE
#define URL_SIGNUP              ""
#define DOWNLOAD_PAGE           AUXI_WEBSITE
#define RELEASE_NOTES           ""
#define ABOUT_PAGE_APP_NAME     AUXI_PRODUCT_NAME

#ifdef _WIN32
/* Configuration utilisateur dans %APPDATA%\\{win['vendor_dir']}\\{win['app_dir']}\\settings.ini (au lieu du registre). */
# include <QSettings>
# include "auxinux/auxinux.h"
# undef GET_REGISTRY_USER
# define GET_REGISTRY_USER(variable) \\
    QSettings variable(AuxiNux::configFile(), QSettings::IniFormat);
#endif

#endif // DEFINES_PRIVATE_H
"""


def shell_version_p(p):
    prod = p["product"]
    v4 = version_tuple4(build_number())
    vstr = ".".join(str(x) for x in v4)
    year = prod["copyright_first_year"]
    return f"""{GENERATED_HEADER}
#ifndef VERSION_PRIVATE_H
#define VERSION_PRIVATE_H

#undef VER_FILEVERSION
#undef VER_FILEVERSION_STR
#undef VER_PRODUCTVERSION
#undef VER_PRODUCTVERSION_STR
#undef VER_COMPANYNAME_STR
#undef VER_LEGALCOPYRIGHT_STR
#undef VER_COMPANYDOMAIN_STR
#undef ABOUT_COPYRIGHT_STR
#undef VER_FILEDESCRIPTION_STR
#undef VER_INTERNALNAME_STR
#undef VER_LEGALTRADEMARKS1_STR
#undef VER_LEGALTRADEMARKS2_STR
#undef VER_ORIGINALFILENAME_STR
#undef VER_PRODUCTNAME_STR

#define VER_FILEVERSION             {",".join(str(x) for x in v4)}
#define VER_FILEVERSION_STR         "{vstr}\\0"
#define VER_PRODUCTVERSION          VER_FILEVERSION
#define VER_PRODUCTVERSION_STR      "{version()}\\0"
#define VER_COMPANYNAME_STR         {c_str(prod['vendor'])[:-1]}\\0"
#define VER_LEGALCOPYRIGHT_STR      "© {year} {prod['copyright_holder']}. Logiciel libre (AGPL-3.0), basé sur ONLYOFFICE d'Ascensio System SIA.\\0"
#define VER_COMPANYDOMAIN_STR       {c_str(prod['website'].split('://', 1)[-1])[:-1]}\\0"
#define ABOUT_COPYRIGHT_STR         "© {year} {prod['copyright_holder']}"
#define VER_FILEDESCRIPTION_STR     {c_str(prod['name'])[:-1]}\\0"
#define VER_INTERNALNAME_STR        {c_str(p['linux']['shell_binary'])[:-1]}\\0"
#define VER_LEGALTRADEMARKS1_STR    "ONLYOFFICE is a trademark of Ascensio System SIA.\\0"
#define VER_LEGALTRADEMARKS2_STR    VER_LEGALTRADEMARKS1_STR
#define VER_ORIGINALFILENAME_STR    {c_str(p['windows']['shell_binary'])[:-1]}\\0"
#define VER_PRODUCTNAME_STR         {c_str(prod['name'])[:-1]}\\0"

#endif // VERSION_PRIVATE_H
"""


def brand_shell(p):
    src = UPSTREAM_SRC / "desktop-apps" / "win-linux" / "src"
    if not src.exists():
        return
    write_text(src / "prop" / "auxinux_branding.h", shell_branding_header(p))
    write_text(src / "prop" / "defines_p.h", shell_defines_p(p))
    write_text(src / "prop" / "version_p.h", shell_version_p(p))
    copytree(ROOT / "src" / "shell" / "auxinux", src / "auxinux")
    overlay = BRANDING / "overlays" / "desktop-apps"
    if overlay.exists():
        copytree(overlay, UPSTREAM_SRC / "desktop-apps")
    ok("shell : identité, version et extensions AuxiNux injectées")


def apply(args):
    step("Branding AuxiNux")
    p = product()
    brand_shell(p)
    from . import branding_web
    branding_web.apply(p, args)
