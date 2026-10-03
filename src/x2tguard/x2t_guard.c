/*
 * x2t (garde AuxiNux) — convertisseur de documents d'AuxiNux Office sans accès réseau.
 *
 * Copyright (C) 2026 Projet AuxiNux
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Le convertisseur d'upstream (x2t, renommé x2t-engine) télécharge de lui-même les ressources
 * distantes d'un document pendant sa conversion : image liée par URL dans un DOCX, ODT ou PPTX,
 * image ou feuille de style d'une page HTML (curl ou wget sous Linux et macOS, URLDownloadToFile
 * ou PowerShell sous Windows). Ouvrir un document suffirait alors à prévenir son expéditeur
 * (adresse IP, heure d'ouverture), comme un pixel espion dans un courriel.
 *
 * x2t lit ses paramètres dans un fichier XML (TaskQueueDataConvert) ; son option
 * <options><allowNetworkRequest>false</allowNetworkRequest></options> désactive tout
 * téléchargement (core, Common/Network/FileTransporter). Le moteur web ne l'écrit pas : cette
 * garde, installée sous le nom x2t, l'ajoute au fichier de paramètres puis exécute x2t-engine
 * avec les mêmes arguments. Les autres appels (sans fichier de paramètres) sont transmis tels
 * quels. Si l'option ne peut pas être ajoutée, la conversion est refusée.
 */

#if defined(AUXI_MACOS_NO_SDK)
/* macOS compilé depuis Linux sans SDK Apple : déclarations minimales de libSystem. */
typedef unsigned long size_t;
typedef struct __sFILE FILE;
extern FILE *__stderrp;
FILE *fopen(const char *, const char *);
size_t fread(void *, size_t, size_t, FILE *);
size_t fwrite(const void *, size_t, size_t, FILE *);
int fclose(FILE *);
int fputs(const char *, FILE *);
void *malloc(size_t);
void free(void *);
size_t strlen(const char *);
char *strstr(const char *, const char *);
char *strrchr(const char *, int);
void *memcpy(void *, const void *, size_t);
int execv(const char *, char *const *);
int _NSGetExecutablePath(char *, unsigned int *);
# define stderr __stderrp
# define NULL ((void *)0)
#else
# include <stdio.h>
# include <stdlib.h>
# include <string.h>
# if defined(_WIN32)
#  include <windows.h>
# elif defined(__APPLE__)
#  include <mach-o/dyld.h>
#  include <unistd.h>
# else
#  include <unistd.h>
# endif
#endif

#define MAX_PARAMS (64L * 1024 * 1024)
#define OPTION "<allowNetworkRequest>false</allowNetworkRequest>"

#if defined(_WIN32)
typedef wchar_t pathchar;
# define open_file(path, mode) _wfopen(path, L##mode)
#else
typedef char pathchar;
# define open_file(path, mode) fopen(path, mode)
#endif

static void complain(const char *message)
{
    fputs("x2t (AuxiNux) : ", stderr);
    fputs(message, stderr);
    fputs("\n", stderr);
}

/* Contenu complet du fichier (terminé par un zéro), NULL s'il est illisible ou trop gros. */
static char *read_all(const pathchar *path, long *size)
{
    FILE *f = open_file(path, "rb");
    char *data;
    long n = 0;
    size_t got;
    if (!f)
        return NULL;
    data = (char *)malloc((size_t)MAX_PARAMS + 1);
    if (!data) {
        fclose(f);
        return NULL;
    }
    while (n < MAX_PARAMS && (got = fread(data + n, 1, (size_t)(MAX_PARAMS - n), f)) > 0)
        n += (long)got;
    fclose(f);
    if (n >= MAX_PARAMS) {
        free(data);
        return NULL;
    }
    data[n] = '\0';
    *size = n;
    return data;
}

/* Réécrit le fichier : data[0..at), insert, data[at..size). */
static int write_with_insert(const pathchar *path, const char *data, long size, long at, const char *insert)
{
    FILE *f = open_file(path, "wb");
    size_t len = strlen(insert);
    int good = 1;
    if (!f)
        return 0;
    if (at > 0 && fwrite(data, 1, (size_t)at, f) != (size_t)at)
        good = 0;
    if (fwrite(insert, 1, len, f) != len)
        good = 0;
    if (size > at && fwrite(data + at, 1, (size_t)(size - at), f) != (size_t)(size - at))
        good = 0;
    if (fclose(f) != 0)
        good = 0;
    return good;
}

/* 1 : fichier de paramètres complété ; 0 : pas un fichier de paramètres ; -1 : échec. */
static int forbid_network(const pathchar *path)
{
    long size = 0, at;
    char *data = read_all(path, &size);
    char *pos;
    const char *insert;
    int state;
    if (!data)
        return 0;
    if (!strstr(data, "<TaskQueueDataConvert")) {
        state = 0;
    } else if (strstr(data, OPTION)) {
        state = 1;
    } else if (strstr(data, "allowNetworkRequest")) {
        /* Autre valeur écrite par un autre composant : on ne la corrige pas, on refuse. */
        state = -1;
    } else {
        if ((pos = strstr(data, "<options>")) != NULL) {
            at = (long)(pos - data) + (long)strlen("<options>");
            insert = OPTION;
        } else if ((pos = strstr(data, "</TaskQueueDataConvert>")) != NULL) {
            at = (long)(pos - data);
            insert = "<options>" OPTION "</options>";
        } else {
            free(data);
            return -1;
        }
        state = write_with_insert(path, data, size, at, insert) ? 1 : -1;
    }
    free(data);
    return state;
}

#if defined(_WIN32)

static int run_engine(void)
{
    wchar_t exe[MAX_PATH * 2], *slash;
    const wchar_t *cmd = GetCommandLineW();
    const wchar_t *tail = cmd;
    wchar_t *line;
    size_t len;
    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    DWORD code = 1;
    DWORD n = GetModuleFileNameW(NULL, exe, MAX_PATH * 2);
    if (n == 0 || n >= MAX_PATH * 2 - 16)
        return 1;
    slash = wcsrchr(exe, L'\\');
    if (!slash)
        return 1;
    wcscpy_s(slash + 1, MAX_PATH * 2 - (slash + 1 - exe), L"x2t-engine.exe");
    /* Arguments d'origine inchangés : la ligne de commande après le nom du programme. */
    if (*tail == L'"') {
        ++tail;
        while (*tail && *tail != L'"')
            ++tail;
        if (*tail)
            ++tail;
    } else {
        while (*tail && *tail != L' ' && *tail != L'\t')
            ++tail;
    }
    len = wcslen(tail) + 32;
    line = (wchar_t *)malloc(len * sizeof(wchar_t));
    if (!line)
        return 1;
    _snwprintf_s(line, len, _TRUNCATE, L"x2t-engine%s", tail);
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    ZeroMemory(&pi, sizeof(pi));
    /* Processus enfant dans le même objet de travail (job) que la garde : arrêté avec elle. */
    if (!CreateProcessW(exe, line, NULL, NULL, TRUE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) {
        free(line);
        complain("x2t-engine.exe introuvable");
        return 1;
    }
    WaitForSingleObject(pi.hProcess, INFINITE);
    GetExitCodeProcess(pi.hProcess, &code);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    free(line);
    return (int)code;
}

int wmain(int argc, wchar_t **argv)
{
    if (argc == 2 && argv[1][0] != L'-' && forbid_network(argv[1]) < 0) {
        complain("accès réseau non désactivable, conversion refusée");
        return 1;
    }
    return run_engine();
}

#else

static int engine_path(char *out, unsigned int size, const char *argv0)
{
    char *slash;
    const char *name = "x2t-engine";
    unsigned int len;
#if defined(__APPLE__)
    unsigned int n = size;
    (void)argv0;
    if (_NSGetExecutablePath(out, &n) != 0)
        return -1;
#else
    ssize_t n = readlink("/proc/self/exe", out, size - 1);
    (void)argv0;
    if (n <= 0)
        return -1;
    out[n] = '\0';
#endif
    slash = strrchr(out, '/');
    if (!slash)
        return -1;
    len = (unsigned int)(slash + 1 - out);
    if (len + strlen(name) + 1 > size)
        return -1;
    memcpy(slash + 1, name, strlen(name) + 1);
    return 0;
}

int main(int argc, char **argv)
{
    char engine[4096];
    if (argc == 2 && argv[1][0] != '-' && forbid_network(argv[1]) < 0) {
        complain("accès réseau non désactivable, conversion refusée");
        return 1;
    }
    if (engine_path(engine, sizeof(engine), argv[0]) != 0) {
        complain("emplacement de x2t-engine introuvable");
        return 1;
    }
    argv[0] = engine;
    execv(engine, argv);
    complain("x2t-engine ne peut pas être exécuté");
    return 1;
}

#endif
