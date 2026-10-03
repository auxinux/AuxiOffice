/*
 * auxioffice — lanceur d'AuxiNux Office (Linux et Windows, même code).
 *
 * Copyright (C) 2026 Projet AuxiNux
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 *   auxioffice                     écran d'accueil AuxiNux Office
 *   auxioffice document.docx       AuxiWriter / AuxiSheet / AuxiPresent / AuxiPDF
 *   auxioffice notes.txt           AuxiText (éditeur de texte léger, sans moteur CEF)
 *   auxioffice --version           "AuxiNux Office <version>"
 *
 * Les fichiers de texte brut (extensions de branding/product.json, et fichiers
 * sans extension dont le contenu est textuel) sont confiés à AuxiText ; les autres
 * au shell auxioffice-editors (le shell gère lui-même l'instance unique).
 */

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
# define WIN32_LEAN_AND_MEAN
# include <windows.h>
# include <shellapi.h>
# define SHELL_BINARY L"auxioffice-editors.exe"
# define TEXT_BINARY  L"auxitext.exe"
#else
# include <errno.h>
# include <limits.h>
# include <sys/stat.h>
# include <sys/types.h>
# include <sys/wait.h>
# include <unistd.h>
# define SHELL_BINARY "auxioffice-editors"
# define TEXT_BINARY  "auxitext"
#endif

#ifndef AUXI_PRODUCT_NAME
# define AUXI_PRODUCT_NAME "AuxiNux Office"
#endif
#ifndef AUXI_VERSION
# define AUXI_VERSION "0.0.0"
#endif
#ifndef AUXI_TEXT_EXTENSIONS
# define AUXI_TEXT_EXTENSIONS "txt;log;md;markdown;json;xml;yaml;yml;ini;conf;cfg"
#endif

static const char *HELP_TEXT =
    "Usage : auxioffice [option] [fichier...]\n"
    "\n"
    "Suite bureautique libre de l'écosystème AuxiNux.\n"
    "\n"
    "  auxioffice                     ouvre l'écran d'accueil\n"
    "  auxioffice document.docx       ouvre le fichier dans l'éditeur adapté\n"
    "  auxioffice notes.txt           ouvre le fichier texte dans AuxiText\n"
    "\n"
    "Options :\n"
    "  --version                      affiche la version\n"
    "  --help                         affiche cette aide\n"
    "  --new-document                 nouveau document (AuxiWriter)\n"
    "  --new-spreadsheet              nouvelle feuille de calcul (AuxiSheet)\n"
    "  --new-presentation             nouvelle présentation (AuxiPresent)\n"
    "  --new-text                     nouveau fichier texte (AuxiText)\n"
    "  --writer FICHIER               force l'ouverture dans AuxiWriter (ex. un .txt)\n"
    "  --app=writer|sheet|present|pdf|text\n"
    "                                 application cible (entrées de menu) : sans fichier,\n"
    "                                 crée un nouveau document ; avec fichiers, les ouvre\n"
    "                                 dans cette application\n"
    "\n"
    "Les autres options sont transmises au moteur d'édition.\n";

/* ------------------------------------------------------------------------ */
/* Détection des fichiers texte                                             */
/* ------------------------------------------------------------------------ */

static int ascii_ieq(const char *a, const char *b, size_t n)
{
    size_t i;
    for (i = 0; i < n; ++i) {
        if (tolower((unsigned char)a[i]) != tolower((unsigned char)b[i]))
            return 0;
    }
    return 1;
}

/* Extension (sans le point) d'un chemin, ou NULL. */
static const char *path_extension(const char *path)
{
    const char *base = path, *p, *dot = NULL;
    for (p = path; *p; ++p)
        if (*p == '/' || *p == '\\')
            base = p + 1;
    for (p = base; *p; ++p)
        if (*p == '.')
            dot = p;
    if (!dot || dot == base || !dot[1])
        return NULL;
    return dot + 1;
}

static int extension_is_text(const char *ext)
{
    const char *list = AUXI_TEXT_EXTENSIONS;
    size_t len = strlen(ext);
    while (*list) {
        const char *end = strchr(list, ';');
        size_t item = end ? (size_t)(end - list) : strlen(list);
        if (item == len && ascii_ieq(list, ext, len))
            return 1;
        if (!end)
            break;
        list = end + 1;
    }
    return 0;
}

/* Fichier sans extension : texte si aucune signature de document connue et
 * aucun octet NUL dans les 8 premiers Kio. */
static int content_is_text(FILE *f)
{
    unsigned char buf[8192];
    size_t n = fread(buf, 1, sizeof(buf), f), i;
    if (n >= 4 && buf[0] == 'P' && buf[1] == 'K' && buf[2] == 3 && buf[3] == 4)
        return 0;   /* OOXML / ODF (zip) */
    if (n >= 4 && memcmp(buf, "%PDF", 4) == 0)
        return 0;
    if (n >= 4 && buf[0] == 0xD0 && buf[1] == 0xCF && buf[2] == 0x11 && buf[3] == 0xE0)
        return 0;   /* OLE2 : .doc/.xls/.ppt */
    if (n >= 5 && memcmp(buf, "{\\rtf", 5) == 0)
        return 0;
    if (n >= 2 && ((buf[0] == 0xFF && buf[1] == 0xFE) || (buf[0] == 0xFE && buf[1] == 0xFF)))
        return 1;   /* UTF-16 avec BOM */
    for (i = 0; i < n; ++i)
        if (buf[i] == 0)
            return 0;
    return 1;
}

#ifdef _WIN32
static int is_text_document(const wchar_t *wpath)
{
    char path[4 * MAX_PATH];
    const char *ext;
    FILE *f;
    int text;
    if (!WideCharToMultiByte(CP_UTF8, 0, wpath, -1, path, sizeof(path), NULL, NULL))
        return 0;
    ext = path_extension(path);
    if (ext)
        return extension_is_text(ext);
    if (_wfopen_s(&f, wpath, L"rb") != 0 || !f)
        return 0;
    text = content_is_text(f);
    fclose(f);
    return text;
}
#else
static int is_text_document(const char *path)
{
    struct stat st;
    const char *ext = path_extension(path);
    FILE *f;
    int text;
    if (ext)
        return extension_is_text(ext);
    if (stat(path, &st) != 0 || !S_ISREG(st.st_mode))
        return 0;
    f = fopen(path, "rb");
    if (!f)
        return 0;
    text = content_is_text(f);
    fclose(f);
    return text;
}
#endif

/* Commutateurs Chromium/CEF ajoutés à chaque lancement du moteur d'édition :
 * aucune communication réseau d'arrière-plan (sondes DNS-over-HTTPS vers Google et
 * Cloudflare observées au démarrage, services d'arrière-plan, pings, dictionnaires
 * téléchargés). Liste « privacy.engine_switches » de branding/product.json, séparée par « ; ».
 * Voir PRIVACY.md. */
#ifndef AUXI_ENGINE_SWITCHES
# define AUXI_ENGINE_SWITCHES "--disable-features=DnsOverHttps;--disable-background-networking;" \
    "--disable-domain-reliability;--no-pings;--disable-spell-checking"
#endif
#define ENGINE_SWITCH_MAX 16
#define DISABLE_FEATURES "--disable-features="

/* Remplit out avec les commutateurs du moteur ; extra_features (valeurs de --disable-features
 * données par l'appelant, ou NULL) est fusionné avec celles d'AuxiNux : Chromium ne retient que
 * la dernière occurrence d'un commutateur, un --disable-features de l'appelant annulerait sinon
 * la désactivation du DNS sur HTTPS. Renvoie le nombre de commutateurs. */
static int engine_switches(const char *extra_features, char **out)
{
    static char buffer[1024];
    static char merged[2048];
    char *item, *next;
    int n = 0;
    snprintf(buffer, sizeof(buffer), "%s", AUXI_ENGINE_SWITCHES);
    for (item = buffer; item && *item && n < ENGINE_SWITCH_MAX; item = next) {
        next = strchr(item, ';');
        if (next)
            *next++ = '\0';
        if (!*item)
            continue;
        if (extra_features && *extra_features && !strncmp(item, DISABLE_FEATURES, strlen(DISABLE_FEATURES))) {
            snprintf(merged, sizeof(merged), "%s,%s", item, extra_features);
            out[n++] = merged;
        } else {
            out[n++] = item;
        }
    }
    return n;
}

/* Ajoute la valeur d'un --disable-features de l'appelant à la liste accumulée. */
static void add_feature(char *acc, size_t size, const char *value)
{
    size_t len = strlen(acc);
    if (!*value)
        return;
    snprintf(acc + len, size - len, "%s%s", len ? "," : "", value);
}

/* --app=... : application demandée par une entrée de menu / association. */
enum target_app { APP_AUTO, APP_WRITER, APP_SHEET, APP_PRESENT, APP_PDF, APP_TEXT };

static enum target_app parse_app(const char *value)
{
    if (!strcmp(value, "writer")) return APP_WRITER;
    if (!strcmp(value, "sheet")) return APP_SHEET;
    if (!strcmp(value, "present")) return APP_PRESENT;
    if (!strcmp(value, "pdf")) return APP_PDF;
    if (!strcmp(value, "text")) return APP_TEXT;
    return APP_AUTO;
}

/* Argument du shell créant un nouveau document pour l'application demandée. */
static const char *new_document_arg(enum target_app app)
{
    switch (app) {
    case APP_WRITER:  return "--new:word";
    case APP_SHEET:   return "--new:cell";
    case APP_PRESENT: return "--new:slide";
    default:          return NULL;
    }
}

/* ------------------------------------------------------------------------ */
/* Windows                                                                  */
/* ------------------------------------------------------------------------ */
#ifdef _WIN32

static void print_line(const char *text)
{
    /* Programme GUI : sortie redirigée si présente, sinon console parente. */
    HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);
    BOOL attached = FALSE;
    DWORD written;
    if (out == NULL || out == INVALID_HANDLE_VALUE || GetFileType(out) == FILE_TYPE_UNKNOWN) {
        if (AttachConsole(ATTACH_PARENT_PROCESS)) {
            attached = TRUE;
            out = CreateFileW(L"CONOUT$", GENERIC_WRITE, FILE_SHARE_WRITE, NULL, OPEN_EXISTING, 0, NULL);
        }
    }
    if (out != NULL && out != INVALID_HANDLE_VALUE)
        WriteFile(out, text, (DWORD)strlen(text), &written, NULL);
    if (attached)
        FreeConsole();
}

/* Ajoute un argument correctement échappé (règles de CommandLineToArgvW). */
static void append_arg(wchar_t *cmd, size_t cap, const wchar_t *arg)
{
    size_t len = wcslen(cmd);
    const wchar_t *p;
    if (len && len + 1 < cap)
        cmd[len++] = L' ';
    if (len + 1 < cap)
        cmd[len++] = L'"';
    for (p = arg; *p && len + 4 < cap; ++p) {
        size_t bs = 0;
        while (*p == L'\\') { ++bs; ++p; }
        if (*p == L'\0') { while (bs-- && len + 2 < cap) { cmd[len++] = L'\\'; cmd[len++] = L'\\'; } break; }
        if (*p == L'"') { while (bs-- && len + 2 < cap) { cmd[len++] = L'\\'; cmd[len++] = L'\\'; } cmd[len++] = L'\\'; cmd[len++] = L'"'; continue; }
        while (bs-- && len + 1 < cap) cmd[len++] = L'\\';
        cmd[len++] = *p;
    }
    if (len + 1 < cap)
        cmd[len++] = L'"';
    cmd[len] = L'\0';
}

static int spawn(const wchar_t *dir, const wchar_t *exe, wchar_t **args, int count)
{
    wchar_t path[MAX_PATH * 2];
    wchar_t *cmd;
    size_t cap = 32768;
    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    int i;
    _snwprintf_s(path, MAX_PATH * 2, _TRUNCATE, L"%s\\%s", dir, exe);
    cmd = (wchar_t *)calloc(cap, sizeof(wchar_t));
    if (!cmd)
        return 1;
    append_arg(cmd, cap, path);
    for (i = 0; i < count; ++i)
        append_arg(cmd, cap, args[i]);
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    if (!CreateProcessW(path, cmd, NULL, NULL, FALSE, 0, NULL, dir, &si, &pi)) {
        wchar_t msg[MAX_PATH * 3];
        _snwprintf_s(msg, MAX_PATH * 3, _TRUNCATE, L"Impossible de lancer :\n%s", path);
        MessageBoxW(NULL, msg, L"" AUXI_PRODUCT_NAME, MB_ICONERROR);
        free(cmd);
        return 1;
    }
    AllowSetForegroundWindow(pi.dwProcessId);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    free(cmd);
    return 0;
}

/* Les bibliothèques du moteur (kernel.dll, graphics.dll, ICU, PdfFile.dll…) sont dans converter\ :
 * comme le lanceur upstream, on place ce dossier en tête du PATH hérité par le shell. */
static void prepend_converter_to_path(const wchar_t *dir)
{
    DWORD len = GetEnvironmentVariableW(L"PATH", NULL, 0);
    size_t cap = (size_t)len + wcslen(dir) + 16;
    size_t used;
    wchar_t *value = (wchar_t *)calloc(cap, sizeof(wchar_t));
    if (!value)
        return;
    _snwprintf_s(value, cap, _TRUNCATE, L"%s\\converter;", dir);
    used = wcslen(value);
    if (len > 0)
        GetEnvironmentVariableW(L"PATH", value + used, (DWORD)(cap - used));
    SetEnvironmentVariableW(L"PATH", value);
    free(value);
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE prev, PWSTR cmdline, int show)
{
    int argc = 0, i, ntext = 0, nshell = 0, rc = 0, force_writer = 0;
    char features[1024] = "";
    enum target_app app = APP_AUTO;
    wchar_t **argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    wchar_t dir[MAX_PATH * 2], *slash;
    wchar_t **text_args, **shell_args;
    (void)inst; (void)prev; (void)cmdline; (void)show;

    if (!argv)
        return 1;
    for (i = 1; i < argc; ++i) {
        if (!wcscmp(argv[i], L"--version") || !wcscmp(argv[i], L"-v")) {
            print_line(AUXI_PRODUCT_NAME " " AUXI_VERSION "\n");
            return 0;
        }
        if (!wcscmp(argv[i], L"--help") || !wcscmp(argv[i], L"-h") || !wcscmp(argv[i], L"/?")) {
            print_line(HELP_TEXT);
            return 0;
        }
    }

    GetModuleFileNameW(NULL, dir, MAX_PATH * 2);
    slash = wcsrchr(dir, L'\\');
    if (slash)
        *slash = L'\0';

    text_args = (wchar_t **)calloc((size_t)argc + 1, sizeof(wchar_t *));
    shell_args = (wchar_t **)calloc((size_t)argc + 4, sizeof(wchar_t *));
    if (!text_args || !shell_args)
        return 1;

    for (i = 1; i < argc; ++i) {
        const wchar_t *a = argv[i];
        if (!wcsncmp(a, L"--app=", 6)) {
            char value[32];
            WideCharToMultiByte(CP_UTF8, 0, a + 6, -1, value, sizeof(value), NULL, NULL);
            app = parse_app(value);
            continue;
        }
        if (!wcscmp(a, L"--new-text")) { text_args[ntext++] = (wchar_t *)L"--new"; continue; }
        if (!wcscmp(a, L"--new-document")) { shell_args[nshell++] = (wchar_t *)L"--new:word"; continue; }
        if (!wcscmp(a, L"--new-spreadsheet")) { shell_args[nshell++] = (wchar_t *)L"--new:cell"; continue; }
        if (!wcscmp(a, L"--new-presentation")) { shell_args[nshell++] = (wchar_t *)L"--new:slide"; continue; }
        if (!wcscmp(a, L"--writer")) {
            /* transmis au shell : il n'envoie pas ces fichiers texte à AuxiText */
            force_writer = 1;
            shell_args[nshell++] = argv[i];
            continue;
        }
        if (!wcsncmp(a, L"" DISABLE_FEATURES, wcslen(L"" DISABLE_FEATURES))) {
            char value[512];
            WideCharToMultiByte(CP_UTF8, 0, a + wcslen(L"" DISABLE_FEATURES), -1, value, sizeof(value), NULL, NULL);
            add_feature(features, sizeof(features), value);
            continue;
        }
        if (a[0] == L'-' && a[1] == L'-') { shell_args[nshell++] = argv[i]; continue; }
        if (app == APP_TEXT || (app == APP_AUTO && !force_writer && is_text_document(a)))
            text_args[ntext++] = argv[i];
        else
            shell_args[nshell++] = argv[i];
    }
    if (ntext == 0 && nshell == 0) {
        if (app == APP_TEXT) {
            text_args[ntext++] = (wchar_t *)L"--new";
        } else if (new_document_arg(app)) {
            static wchar_t newarg[32];
            MultiByteToWideChar(CP_UTF8, 0, new_document_arg(app), -1, newarg, 32);
            shell_args[nshell++] = newarg;
        }
    }

    if (ntext > 0)
        rc |= spawn(dir, TEXT_BINARY, text_args, ntext);
    if (nshell > 0 || ntext == 0) {
        wchar_t **full = (wchar_t **)calloc((size_t)nshell + ENGINE_SWITCH_MAX + 1, sizeof(wchar_t *));
        static wchar_t switches[ENGINE_SWITCH_MAX][2048];
        char *engine[ENGINE_SWITCH_MAX];
        int count = engine_switches(features, engine);
        int n = 0;
        if (!full)
            return 1;
        for (i = 0; i < count; ++i) {
            MultiByteToWideChar(CP_UTF8, 0, engine[i], -1, switches[i], 2048);
            full[n++] = switches[i];
        }
        for (i = 0; i < nshell; ++i)
            full[n++] = shell_args[i];
        prepend_converter_to_path(dir);
        rc |= spawn(dir, SHELL_BINARY, full, n);
        free(full);
    }
    LocalFree(argv);
    return rc;
}

/* ------------------------------------------------------------------------ */
/* Linux / POSIX                                                            */
/* ------------------------------------------------------------------------ */
#else

static int app_dir(char *out, size_t size)
{
    ssize_t n = readlink("/proc/self/exe", out, size - 1);
    char *slash;
    if (n <= 0)
        return -1;
    out[n] = '\0';
    slash = strrchr(out, '/');
    if (!slash)
        return -1;
    *slash = '\0';
    return 0;
}

static void prepend_env_path(const char *name, const char *dir)
{
    const char *old = getenv(name);
    size_t len = strlen(dir) + (old ? strlen(old) + 1 : 0) + 1;
    char *value = (char *)malloc(len);
    if (!value)
        return;
    if (old && *old)
        snprintf(value, len, "%s:%s", dir, old);
    else
        snprintf(value, len, "%s", dir);
    setenv(name, value, 1);
    free(value);
}

/* Lance un binaire de l'installation. exec_in_place : remplace le processus courant. */
static int launch(const char *dir, const char *binary, char **args, int count, int exec_in_place)
{
    char path[PATH_MAX];
    char **argv2 = (char **)calloc((size_t)count + 2, sizeof(char *));
    pid_t pid;
    int i;
    if (!argv2)
        return 1;
    snprintf(path, sizeof(path), "%s/%s", dir, binary);
    argv2[0] = path;
    for (i = 0; i < count; ++i)
        argv2[i + 1] = args[i];
    argv2[count + 1] = NULL;
    if (exec_in_place) {
        execv(path, argv2);
        fprintf(stderr, "auxioffice : impossible de lancer %s : %s\n", path, strerror(errno));
        free(argv2);
        return 127;
    }
    pid = fork();
    if (pid == 0) {
        setsid();
        execv(path, argv2);
        fprintf(stderr, "auxioffice : impossible de lancer %s : %s\n", path, strerror(errno));
        _exit(127);
    }
    free(argv2);
    return pid > 0 ? 0 : 1;
}

int main(int argc, char **argv)
{
    char dir[PATH_MAX];
    char **text_args, **shell_args;
    int i, ntext = 0, nshell = 0, rc = 0, force_writer = 0;
    char features[1024] = "";
    enum target_app app = APP_AUTO;

    for (i = 1; i < argc; ++i) {
        if (!strcmp(argv[i], "--version") || !strcmp(argv[i], "-v")) {
            printf("%s %s\n", AUXI_PRODUCT_NAME, AUXI_VERSION);
            return 0;
        }
        if (!strcmp(argv[i], "--help") || !strcmp(argv[i], "-h")) {
            fputs(HELP_TEXT, stdout);
            return 0;
        }
    }
    if (app_dir(dir, sizeof(dir)) != 0) {
        fprintf(stderr, "auxioffice : répertoire d'installation introuvable\n");
        return 1;
    }
    /* Comme le lanceur upstream : bibliothèques embarquées prioritaires. */
    prepend_env_path("LD_LIBRARY_PATH", dir);

    text_args = (char **)calloc((size_t)argc + 1, sizeof(char *));
    shell_args = (char **)calloc((size_t)argc + 1, sizeof(char *));
    if (!text_args || !shell_args)
        return 1;
    for (i = 1; i < argc; ++i) {
        char *a = argv[i];
        if (!strncmp(a, "--app=", 6)) { app = parse_app(a + 6); continue; }
        if (!strcmp(a, "--new-text")) { text_args[ntext++] = (char *)"--new"; continue; }
        if (!strcmp(a, "--new-document")) { shell_args[nshell++] = (char *)"--new:word"; continue; }
        if (!strcmp(a, "--new-spreadsheet")) { shell_args[nshell++] = (char *)"--new:cell"; continue; }
        if (!strcmp(a, "--new-presentation")) { shell_args[nshell++] = (char *)"--new:slide"; continue; }
        if (!strcmp(a, "--writer")) {
            /* transmis au shell : il n'envoie pas ces fichiers texte à AuxiText */
            force_writer = 1;
            shell_args[nshell++] = a;
            continue;
        }
        if (!strncmp(a, DISABLE_FEATURES, strlen(DISABLE_FEATURES))) {
            add_feature(features, sizeof(features), a + strlen(DISABLE_FEATURES));
            continue;
        }
        if (a[0] == '-' && a[1] == '-') { shell_args[nshell++] = a; continue; }
        if (!strncmp(a, "file://", 7)) {
            /* URI locale transmise par certains gestionnaires de fichiers */
            if (app == APP_TEXT || (app == APP_AUTO && !force_writer && is_text_document(a + 7)))
                text_args[ntext++] = a + 7;
            else
                shell_args[nshell++] = a;
            continue;
        }
        if (app == APP_TEXT || (app == APP_AUTO && !force_writer && is_text_document(a)))
            text_args[ntext++] = a;
        else
            shell_args[nshell++] = a;
    }
    if (ntext == 0 && nshell == 0) {
        if (app == APP_TEXT)
            text_args[ntext++] = (char *)"--new";
        else if (new_document_arg(app))
            shell_args[nshell++] = (char *)new_document_arg(app);
    }

    if (ntext > 0 && nshell == 0)
        return launch(dir, TEXT_BINARY, text_args, ntext, 1);
    if (ntext > 0)
        rc |= launch(dir, TEXT_BINARY, text_args, ntext, 0);
    {
        char **full = (char **)calloc((size_t)nshell + ENGINE_SWITCH_MAX + 1, sizeof(char *));
        int n = 0;
        if (!full)
            return 1;
        n = engine_switches(features, full);
        for (i = 0; i < nshell; ++i)
            full[n++] = shell_args[i];
        return rc | launch(dir, SHELL_BINARY, full, n, 1);
    }
}

#endif
