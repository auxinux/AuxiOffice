/*
 * AuxiNux Office (macOS) — exécutable principal de l'application.
 *
 * Copyright (C) 2026 Projet AuxiNux
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * L'application macOS reprend le shell d'upstream (Objective-C, non recompilé) : il transmet sa
 * ligne de commande au moteur web (CEF) sans y ajouter les commutateurs de confidentialité que
 * le lanceur auxioffice ajoute sous Linux et Windows. Ce programme, déclaré comme exécutable du
 * bundle (CFBundleExecutable), remplace son image (execv, même processus : macOS lui adresse
 * toujours les fichiers à ouvrir) par celle du shell, renommé « AuxiNux Office Engine », avec
 * les commutateurs de privacy.engine_switches (branding/product.json) en tête des arguments.
 *
 * Compilé depuis Linux sans SDK Apple (clang + ld64.lld, voir scripts/auxibuild/macos.py) :
 * seules quelques fonctions de libSystem sont déclarées ici.
 */

typedef unsigned long size_t;
typedef struct __sFILE FILE;
extern FILE *__stderrp;
int fputs(const char *, FILE *);
void *malloc(size_t);
size_t strlen(const char *);
char *strrchr(const char *, int);
int strncmp(const char *, const char *, size_t);
void *memcpy(void *, const void *, size_t);
int execv(const char *, char *const *);
int _NSGetExecutablePath(char *, unsigned int *);
#define NULL ((void *)0)

#ifndef AUXI_ENGINE_SWITCHES
# error "AUXI_ENGINE_SWITCHES non défini (privacy.engine_switches)"
#endif
#ifndef AUXI_ENGINE_BINARY
# define AUXI_ENGINE_BINARY "AuxiNux Office Engine"
#endif
#define MAX_SWITCHES 16
#define DISABLE_FEATURES "--disable-features="

static char *join(const char *a, const char *b, const char *c)
{
    size_t la = strlen(a), lb = strlen(b), lc = strlen(c);
    char *out = (char *)malloc(la + lb + lc + 1);
    if (!out)
        return NULL;
    memcpy(out, a, la);
    memcpy(out + la, b, lb);
    memcpy(out + la + lb, c, lc + 1);
    return out;
}

int main(int argc, char **argv)
{
    static char switches[] = AUXI_ENGINE_SWITCHES;
    char exe[4096];
    unsigned int size = sizeof(exe);
    char *engine, *slash, *item, *extra = (char *)"";
    char **args;
    int i, n = 0;
    size_t prefix = strlen(DISABLE_FEATURES);

    if (_NSGetExecutablePath(exe, &size) != 0 || !(slash = strrchr(exe, '/'))) {
        fputs("AuxiNux Office : emplacement de l'application introuvable\n", __stderrp);
        return 1;
    }
    slash[1] = '\0';
    engine = join(exe, AUXI_ENGINE_BINARY, "");
    args = (char **)malloc(sizeof(char *) * (size_t)(argc + MAX_SWITCHES + 2));
    if (!engine || !args)
        return 1;

    /* --disable-features de l'appelant : fusionné avec celui d'AuxiNux (Chromium ne retient que
     * la dernière occurrence d'un commutateur). */
    for (i = 1; i < argc; ++i)
        if (!strncmp(argv[i], DISABLE_FEATURES, prefix) && argv[i][prefix]) {
            char *merged = join(extra, *extra ? "," : "", argv[i] + prefix);
            if (merged)
                extra = merged;
        }

    args[n++] = engine;
    item = switches;
    while (*item && n < MAX_SWITCHES) {
        char *end = item;
        while (*end && *end != ';')
            ++end;
        if (*end)
            *end++ = '\0';
        if (*item) {
            if (*extra && !strncmp(item, DISABLE_FEATURES, prefix))
                args[n++] = join(item, ",", extra);
            else
                args[n++] = item;
        }
        item = end;
    }
    for (i = 1; i < argc; ++i)
        if (strncmp(argv[i], DISABLE_FEATURES, prefix))
            args[n++] = argv[i];
    args[n] = NULL;

    execv(engine, args);
    fputs("AuxiNux Office : le moteur ne peut pas être lancé\n", __stderrp);
    return 1;
}
