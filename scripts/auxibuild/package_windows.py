# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Windows packages built from build/stage/windows/auxioffice (étape assemble):

  dist/windows/AuxiNuxOffice-<version>-x64.exe   installateur NSIS (makensis)
  dist/windows/AuxiNuxOffice-<version>-x64.msi   paquet MSI (wixl, msitools) — format « msi »

Les deux fonctionnent depuis Linux (makensis et wixl sont des outils natifs Linux) ou Windows.
Identité, version et types de fichiers viennent de branding/product.json, VERSION et
packaging/common/filetypes.json, comme pour Linux."""

import hashlib
import json
import re
import uuid
from pathlib import Path

from .assemble import stage_dir
from .common import (BUILD_DIR, DIST_DIR, ROOT, TOOLCHAINS_DIR, build_number, download, fail, info, lock, ok,
                     product, rmtree, run, step, version, version_tuple4, which, write_text)

NSIS_DIR = ROOT / "packaging" / "windows" / "nsis"
WIX_DIR = ROOT / "packaging" / "windows" / "wix"
GEN = ROOT / "branding" / "generated"
OUT = BUILD_DIR / "package" / "windows"
FILETYPES = json.loads((ROOT / "packaging" / "common" / "filetypes.json").read_text(encoding="utf-8"))

APPS = ["writer", "sheet", "present", "pdf", "text"]
# Index des groupes d'icônes de auxioffice.exe (ressources 1 à 11 de src/launcher/auxioffice.rc.in)
APP_ICON_INDEX = {"writer": 6, "sheet": 7, "present": 8, "pdf": 9, "text": 10}


def dist_name(ext):
    return f"AuxiNuxOffice-{version()}-x64.{ext}"


def ensure_vc_redist():
    spec = lock()["windows_runtime"]["vc_redist_x64"]
    return download(spec["url"], TOOLCHAINS_DIR / "downloads" / "vc_redist.x64.exe",
                    sha256=spec["sha256"], size=spec["size"])


def _tool_env(tool):
    """makensis / wixl : outil du système, sinon (--local-deps) paquets Debian extraits sans root."""
    from .toolchain import TOOLS_ROOT, local_tool_env
    if which(tool):
        return which(tool), {}
    env = local_tool_env([tool])
    exe = TOOLS_ROOT / "usr" / "bin" / tool
    if not exe.exists():
        fail(f"{tool} introuvable : installer le paquet Debian/Ubuntu correspondant "
             "(nsis, ou wixl pour le MSI) ou relancer avec --local-deps")
    if tool == "makensis":
        env["NSISDIR"] = str(TOOLS_ROOT / "usr" / "share" / "nsis")
    return str(exe), env


# ---------------------------------------------------------------------------
# Description commune des types de fichiers
# ---------------------------------------------------------------------------

def file_types(p):
    """[(app, ext, progid, icon_resource_id)] pour les associations proposées."""
    prefix = p["windows"]["progid_prefix"]
    out = []
    for app in APPS:
        win = FILETYPES[app]["windows"]
        for ext in win["extensions"]:
            out.append((app, ext, f"{prefix}.{ext}", win["icon_resource_id"]))
    return out


def open_command(app, binary_dir="$INSTDIR"):
    if app == "text":
        return f'"{binary_dir}\\auxitext.exe" "%1"'
    return f'"{binary_dir}\\auxioffice.exe" --app={app} "%1"'


# ---------------------------------------------------------------------------
# NSIS
# ---------------------------------------------------------------------------

def _nsis_quote(text):
    return '"' + text.replace("$", "$$").replace('"', '$\\"') + '"'


def generated_nsh(p, stage, license_file, vc, out_file):
    prod, win = p["product"], p["windows"]
    v4 = version_tuple4(build_number())
    vc_spec = lock()["windows_runtime"]["vc_redist_x64"]
    vc_min = vc_spec["min_installed"].split(".")
    defines = {
        "PRODUCT_NAME": prod["name"],
        "PRODUCT_VERSION": version(),
        "PRODUCT_VERSION4": ".".join(str(n) for n in v4),
        "VERSION_MAJOR": str(v4[0]),
        "VERSION_MINOR": str(v4[1]),
        "PRODUCT_PUBLISHER": prod["vendor"],
        "PRODUCT_COPYRIGHT": f"© {prod['copyright_first_year']} {prod['copyright_holder']} — AGPL-3.0",
        "PRODUCT_WEBSITE": prod["website"],
        "PRODUCT_SUPPORT_URL": prod["support_url"],
        "INSTALL_DIR_NAME": win["install_dir_name"],
        "REG_VENDOR_PATH": f"Software\\{win['registry_vendor']}",
        "REG_APP_PATH": f"Software\\{win['registry_vendor']}\\{win['registry_app']}",
        "UNINST_KEY": f"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{win['uninstall_key']}",
        "APP_MUTEX": win["single_instance_key"],
        "AUMID": win["app_user_model_id"],
        "TEXT_APP_NAME": p["apps"]["text"]["name"],
        "STAGE_DIR": str(stage),
        "OUT_FILE": str(out_file),
        "BRANDING_ICO": str(GEN / "ico"),
        "BRANDING_BMP": str(GEN / "bmp"),
        "LICENSE_INFO": str(license_file),
        "NSIS_STRINGS": str(NSIS_DIR / "strings.nsh"),
        "VCREDIST": str(vc),
        "VC_REDIST_VERSION": vc_spec["version"],
        "VC_MIN_MAJOR": vc_min[0],
        "VC_MIN_MINOR": vc_min[1],
        "VC_MIN_BUILD": vc_min[2],
    }
    lines = ["; Généré par scripts/auxibuild/package_windows.py depuis branding/product.json, VERSION,",
             "; upstream/upstream.lock.json et packaging/common/filetypes.json — ne pas modifier.", ""]
    lines += [f"!define {k} {_nsis_quote(v)}" for k, v in defines.items()]

    # Fichiers installés : uniquement les entrées de premier niveau de l'arbre (jamais $INSTDIR entier).
    lines += ["", "!macro AUXI_REMOVE_FILES"]
    for entry in sorted(stage.iterdir(), key=lambda e: e.name.lower()):
        if not re.fullmatch(r"[\w.@+-]+", entry.name):
            fail(f"nom d'entrée inattendu dans l'arbre d'installation : {entry.name!r}")
        target = f'"$INSTDIR\\{entry.name}"'
        lines.append(f"  RMDir /r {target}" if entry.is_dir() else f"  Delete {target}")
    lines.append("!macroend")

    smdir = "$SMPROGRAMS\\${PRODUCT_NAME}"
    lines += ["", "!macro AUXI_APP_SHORTCUTS"]
    for app in APPS:
        name = p["apps"][app]["name"]
        link = f"{smdir}\\{name}.lnk"
        if app == "text":
            lines.append(f'  CreateShortCut "{link}" "$INSTDIR\\auxitext.exe" "" "$INSTDIR\\auxitext.exe" 0 '
                         f'SW_SHOWNORMAL "" "$(SC_{app})"')
        else:
            lines.append(f'  CreateShortCut "{link}" "$INSTDIR\\auxioffice.exe" "--app={app}" '
                         f'"$INSTDIR\\auxioffice.exe" {APP_ICON_INDEX[app]} SW_SHOWNORMAL "" "$(SC_{app})"')
            lines += [f'  Push "{link}"', "  Call SetShortcutAumid"]
    lines.append("!macroend")

    caps = "${REG_APP_PATH}\\Capabilities"
    reg, unreg = ["", "!macro AUXI_REGISTER_FILE_TYPES"], ["", "!macro AUXI_UNREGISTER_FILE_TYPES"]
    for app, ext, progid, icon in file_types(p):
        app_name = p["apps"][app]["name"]
        key = f"Software\\Classes\\{progid}"
        exe = "auxitext.exe" if app == "text" else "auxioffice.exe"
        command = open_command(app).replace('"', '$\\"')
        reg += [f"  ; {app_name} — .{ext}",
                f'  WriteRegStr HKLM "{key}" "" "$(FT_{app}) {ext.upper()}"',
                f'  WriteRegStr HKLM "{key}\\DefaultIcon" "" "$INSTDIR\\auxioffice.exe,-{icon}"',
                f'  WriteRegStr HKLM "{key}\\shell\\open" "FriendlyAppName" "{app_name} (${{PRODUCT_NAME}})"',
                f'  WriteRegStr HKLM "{key}\\shell\\open\\command" "" "{command}"']
        if app != "text":
            reg.append(f'  WriteRegStr HKLM "{key}" "AppUserModelID" "${{AUMID}}"')
        reg += [f'  WriteRegStr HKLM "Software\\Classes\\.{ext}\\OpenWithProgids" "{progid}" ""',
                f'  WriteRegStr HKLM "{caps}\\FileAssociations" ".{ext}" "{progid}"',
                f'  WriteRegStr HKLM "Software\\Classes\\Applications\\{exe}\\SupportedTypes" ".{ext}" ""']
        unreg += [f'  DeleteRegKey HKLM "{key}"',
                  f'  DeleteRegValue HKLM "Software\\Classes\\.{ext}\\OpenWithProgids" "{progid}"',
                  f'  DeleteRegKey /ifnosubkeys /ifnovalues HKLM "Software\\Classes\\.{ext}\\OpenWithProgids"',
                  f'  DeleteRegKey /ifnosubkeys /ifnovalues HKLM "Software\\Classes\\.{ext}"']
    lines += reg + ["!macroend"] + unreg + ["!macroend", ""]
    return "\n".join(lines)


def license_info(stage):
    """Page d'information de l'installateur : NOTICE.txt (FR + EN), en UTF-16LE avec BOM."""
    text = (stage / "NOTICE.txt").read_text(encoding="utf-8").replace("\r\n", "\n").replace("\n", "\r\n")
    dest = OUT / "license-info.txt"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(b"\xff\xfe" + text.encode("utf-16-le"))
    return dest


def _pe_version(path):
    from .toolchain import ensure_venv
    py = ensure_venv()
    code = ("import pefile,sys,json\n"
            "pe=pefile.PE(sys.argv[1],fast_load=True)\n"
            "pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_RESOURCE']])\n"
            "d={}\n"
            "for fi in getattr(pe,'FileInfo',[]) or []:\n"
            "  for e in fi:\n"
            "    for st in getattr(e,'StringTable',[]):\n"
            "      d.update({k.decode():v.decode() for k,v in st.entries.items()})\n"
            "d['_machine']=hex(pe.FILE_HEADER.Machine)\n"
            "print(json.dumps(d))\n")
    res = run([py, "-c", code, path], capture=True, quiet=True)
    return json.loads(res.stdout)


def build_nsis(p, stage, vc):
    step("Installateur Windows (NSIS)")
    makensis, env = _tool_env("makensis")
    out_file = DIST_DIR / "windows" / dist_name("exe")
    out_file.parent.mkdir(parents=True, exist_ok=True)
    if out_file.exists():
        out_file.unlink()
    gen = write_text(OUT / "generated.nsh", generated_nsh(p, stage, license_info(stage), vc, out_file))
    run([makensis, "-V2", "-INPUTCHARSET", "UTF8", f"-DGENERATED={gen}", NSIS_DIR / "auxioffice.nsi"],
        env=env, log_file=OUT / "makensis.log")
    if not out_file.exists():
        fail(f"makensis n'a pas produit {out_file}")
    meta = _pe_version(out_file)
    if meta.get("ProductName") != p["product"]["name"] or meta.get("ProductVersion") != version():
        fail(f"métadonnées inattendues dans {out_file.name} : {meta}")
    ok(f"{out_file} ({out_file.stat().st_size // (1024 * 1024)} Mio, {meta['ProductName']} {meta['ProductVersion']})")
    return out_file


# ---------------------------------------------------------------------------
# MSI (wixl)
# ---------------------------------------------------------------------------

def _guid(name):
    """GUID stable (UUID v5) : les composants gardent le même GUID d'une version à l'autre."""
    namespace = uuid.UUID(product()["windows"]["msi_upgrade_code"].strip("{}"))
    return "{" + str(uuid.uuid5(namespace, name)).upper() + "}"


def _xml(text):
    return (text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;"))


def _wxs_files(stage):
    """Arborescence <Directory>/<Component>/<File> de l'arbre d'installation."""
    lines, refs, counter = [], [], [0]

    def ident(prefix):
        counter[0] += 1
        return f"{prefix}{counter[0]:05d}"

    def walk(directory, indent):
        for entry in sorted(directory.iterdir(), key=lambda e: e.name):
            rel = entry.relative_to(stage).as_posix()
            if entry.is_dir():
                did = ident("d")
                lines.append(f'{indent}<Directory Id="{did}" Name="{_xml(entry.name)}">')
                walk(entry, indent + "  ")
                lines.append(f"{indent}</Directory>")
            else:
                cid, fid = ident("c"), ident("f")
                refs.append(cid)
                lines.append(f'{indent}<Component Id="{cid}" Guid="{_guid("file:" + rel)}" Win64="yes">')
                lines.append(f'{indent}  <File Id="{fid}" Source="{_xml(str(entry))}" KeyPath="yes"/>')
                lines.append(f"{indent}</Component>")
    walk(stage, "          ")
    return "\n".join(lines), refs


APP_ICON_FILES = {"writer": "auxiwriter", "sheet": "auxisheet", "present": "auxipresent", "pdf": "auxipdf",
                  "text": "auxitext"}


def build_msi(p, stage):
    step("Paquet MSI (wixl)")
    wixl, env = _tool_env("wixl")
    out_file = DIST_DIR / "windows" / dist_name("msi")
    if out_file.exists():
        out_file.unlink()
    files_xml, file_refs = _wxs_files(stage)
    prod, win = p["product"], p["windows"]
    caps = f"Software\\{win['registry_vendor']}\\{win['registry_app']}\\Capabilities"
    labels = {"writer": "Document", "sheet": "Classeur", "present": "Présentation", "pdf": "Document",
              "text": "Fichier texte"}

    reg = []
    for app, ext, progid, icon in file_types(p):
        app_name = p["apps"][app]["name"]
        exe = "auxitext.exe" if app == "text" else "auxioffice.exe"
        cmd = _xml(open_command(app, "[INSTALLDIR]").replace("[INSTALLDIR]\\", "[INSTALLDIR]"))
        key = f"Software\\Classes\\{progid}"
        reg += [f'<RegistryValue Root="HKLM" Key="{key}" Type="string" Value="{_xml(labels[app])} {ext.upper()}"/>',
                f'<RegistryValue Root="HKLM" Key="{key}\\DefaultIcon" Type="string" '
                f'Value="[INSTALLDIR]auxioffice.exe,-{icon}"/>',
                f'<RegistryValue Root="HKLM" Key="{key}\\shell\\open" Name="FriendlyAppName" Type="string" '
                f'Value="{_xml(app_name)} ({_xml(prod["name"])})"/>',
                f'<RegistryValue Root="HKLM" Key="{key}\\shell\\open\\command" Type="string" Value="{cmd}"/>',
                f'<RegistryValue Root="HKLM" Key="Software\\Classes\\.{ext}\\OpenWithProgids" Name="{progid}" '
                'Type="string" Value=""/>',
                f'<RegistryValue Root="HKLM" Key="{caps}\\FileAssociations" Name=".{ext}" Type="string" '
                f'Value="{progid}"/>',
                f'<RegistryValue Root="HKLM" Key="Software\\Classes\\Applications\\{exe}\\SupportedTypes" '
                f'Name=".{ext}" Type="string" Value=""/>']
        if app != "text":
            reg.append(f'<RegistryValue Root="HKLM" Key="{key}" Name="AppUserModelID" Type="string" '
                       f'Value="{win["app_user_model_id"]}"/>')

    icons = [f'    <Icon Id="auxioffice.ico" SourceFile="{_xml(str(GEN / "ico" / "auxioffice.ico"))}"/>']
    shortcuts = []
    for app in APPS:
        name, ico = p["apps"][app]["name"], APP_ICON_FILES[app]
        icons.append(f'    <Icon Id="{ico}.ico" SourceFile="{_xml(str(GEN / "ico" / (ico + ".ico")))}"/>')
        target, args = ("auxitext.exe", "") if app == "text" else ("auxioffice.exe", f' Arguments="--app={app}"')
        shortcuts.append(f'<Shortcut Id="sc_{app}" Name="{_xml(name)}" Target="[INSTALLDIR]{target}"{args} '
                         f'WorkingDirectory="INSTALLDIR" Icon="{ico}.ico"/>')

    vc_spec = lock()["windows_runtime"]["vc_redist_x64"]
    values = {
        "@PRODUCT_NAME@": _xml(prod["name"]),
        "@TEXT_APP_NAME@": _xml(p["apps"]["text"]["name"]),
        "@PUBLISHER@": _xml(prod["vendor"]),
        "@VERSION4@": ".".join(str(n) for n in version_tuple4(build_number())),
        "@VERSION@": version(),
        "@UPGRADE_CODE@": win["msi_upgrade_code"],
        "@WEBSITE@": _xml(prod["website"]),
        "@SUPPORT_URL@": _xml(prod["support_url"]),
        "@INSTALL_DIR_NAME@": _xml(win["install_dir_name"]),
        "@REG_APP_PATH@": f"Software\\{win['registry_vendor']}\\{win['registry_app']}",
        "@VC_REDIST_VERSION@": vc_spec["version"],
        "@VC_MIN@": vc_spec["min_installed"],
        "@GUID_SHORTCUTS@": _guid("shortcuts"),
        "@GUID_REGISTRY@": _guid("registry"),
        "@GUID_ASSOC@": _guid("associations"),
        "@GUID_DESKTOP@": _guid("desktop"),
        "@ICONS@": "\n".join(icons),
        "@FILES@": files_xml,
        "@FILE_REFS@": "\n".join(f'      <ComponentRef Id="{c}"/>' for c in file_refs),
        "@ASSOC_REGISTRY@": "\n".join("        " + r for r in reg),
        "@SHORTCUTS@": "\n".join("        " + s for s in shortcuts),
    }
    template = (WIX_DIR / "auxioffice.wxs.in").read_text(encoding="utf-8")
    for k, v in values.items():
        template = template.replace(k, v)
    leftovers = sorted(set(re.findall(r"@[A-Z0-9_]+@", template)))
    if leftovers:
        fail(f"variables non remplacées dans auxioffice.wxs.in : {leftovers}")
    wxs = write_text(OUT / "auxioffice.wxs", template)
    run([wixl, "-a", "x64", "-o", out_file, wxs], env=env, log_file=OUT / "wixl.log")
    if not out_file.exists():
        fail(f"wixl n'a pas produit {out_file}")
    ok(f"{out_file} ({out_file.stat().st_size // (1024 * 1024)} Mio)")
    return out_file


def package(args):
    p = product()
    stage = stage_dir("windows")
    for exe in ("auxioffice.exe", "auxioffice-editors.exe", "auxitext.exe", "NOTICE.txt", "LICENSE.txt"):
        if not (stage / exe).exists():
            fail(f"{stage / exe} absent : lancer l'étape assemble (cible windows)")
    formats = [f.strip() for f in (args.formats or "exe,msi").split(",") if f.strip()]
    vc = ensure_vc_redist()
    if "exe" in formats:
        build_nsis(p, stage, vc)
    if "msi" in formats:
        build_msi(p, stage)
    dist = DIST_DIR / "windows"
    lines = []
    for f in sorted(dist.glob("*")):
        if f.is_file() and f.name != "SHA256SUMS":
            h = hashlib.sha256()
            with open(f, "rb") as fh:
                for chunk in iter(lambda: fh.read(1 << 20), b""):
                    h.update(chunk)
            lines.append(f"{h.hexdigest()}  {f.name}")
    sums = write_text(dist / "SHA256SUMS", "\n".join(lines) + "\n")
    ok(f"sommes de contrôle : {sums}")
