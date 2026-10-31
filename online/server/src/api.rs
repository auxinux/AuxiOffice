//! API HTTP : session, fichiers de l'utilisateur, documents vierges,
//! réglages (préférences, récents) et téléchargements temporaires.
//!
//! Toute requête qui modifie quelque chose doit porter l'en-tête `X-Auxi`
//! (un autre site ne peut pas l'ajouter sans autorisation CORS) en plus du
//! témoin de session SameSite=Strict.

use crate::auth::{cookie_token, User, COOKIE};
use crate::AppState;
use axum::body::Bytes;
use axum::extract::{Path as UrlPath, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

pub struct ApiError(StatusCode, String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error": self.1}))).into_response()
    }
}

impl From<String> for ApiError {
    fn from(e: String) -> Self {
        ApiError(StatusCode::BAD_REQUEST, e)
    }
}

type ApiResult<T> = Result<T, ApiError>;

fn user(app: &AppState, headers: &HeaderMap, method: &Method) -> ApiResult<User> {
    if method != Method::GET && method != Method::HEAD && !headers.contains_key("x-auxi") {
        return Err(ApiError(StatusCode::FORBIDDEN, "requête refusée (en-tête X-Auxi manquant)".into()));
    }
    let u = app.auth.session_user(cookie_token(headers).as_deref()).ok_or_else(|| ApiError(StatusCode::UNAUTHORIZED, "Session expirée : reconnectez-vous.".into()))?;
    app.store.ensure_user(&u.id).map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(u)
}

/// Travail sur le disque hors des fils de tokio.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> ApiResult<T> {
    tokio::task::spawn_blocking(f).await.map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?.map_err(ApiError::from)
}

pub async fn me(State(app): State<Arc<AppState>>, method: Method, headers: HeaderMap) -> Response {
    let auximail = app.settings.get().auximail_url;
    let base = json!({"auth": app.auth.enabled(), "version": env!("CARGO_PKG_VERSION"), "auximail": auximail, "auxicorrect": app.auxicorrect.is_some()});
    match user(&app, &headers, &method) {
        Ok(u) => {
            let mut v = base;
            v["user"] = json!({"email": u.email, "name": u.name, "admin": u.admin});
            // Espace du client : forfait, total, part des documents et d'AuxiMail.
            let a = app.clone();
            let us = tokio::task::spawn_blocking(move || crate::usage::of(&a, &u)).await.ok();
            if let Some(us) = us {
                v["usage"] = json!({
                    "used": us.used, "quota": us.quota, "files": us.files, "mail": us.mail,
                    "available": us.quota.saturating_sub(us.used),
                    "plan": {"id": us.plan.id, "name": if us.custom { "Espace particulier".to_string() } else { us.plan.name.clone() }},
                });
            }
            Json(v).into_response()
        }
        Err(_) => (StatusCode::UNAUTHORIZED, Json(base)).into_response(),
    }
}

#[derive(Deserialize)]
pub struct Login {
    email: String,
    password: String,
}

fn session_cookie(app: &AppState, value: &str, max_age: u64) -> HeaderValue {
    let secure = if app.secure_cookies { "; Secure" } else { "" };
    HeaderValue::from_str(&format!("{COOKIE}={value}; Path=/; HttpOnly; SameSite=Strict; Max-Age={max_age}{secure}")).unwrap()
}

pub async fn login(State(app): State<Arc<AppState>>, headers: HeaderMap, Json(body): Json<Login>) -> ApiResult<Response> {
    if !headers.contains_key("x-auxi") {
        return Err(ApiError(StatusCode::FORBIDDEN, "requête refusée".into()));
    }
    let a = app.clone();
    let (token, u) = tokio::task::spawn_blocking(move || a.auth.login(&body.email, &body.password))
        .await
        .map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map_err(|e| ApiError(StatusCode::UNAUTHORIZED, e))?;
    let mut r = Json(json!({"user": {"email": u.email, "name": u.name}})).into_response();
    r.headers_mut().insert(header::SET_COOKIE, session_cookie(&app, &token, app.auth.ttl().as_secs()));
    Ok(r)
}

pub async fn logout(State(app): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if let Some(t) = cookie_token(&headers) {
        app.auth.logout(&t);
    }
    let mut r = Json(json!({})).into_response();
    r.headers_mut().insert(header::SET_COOKIE, session_cookie(&app, "", 0));
    r
}

#[derive(Deserialize)]
pub struct PathQ {
    path: String,
    #[serde(default)]
    download: Option<String>,
}

pub async fn list(State(app): State<Arc<AppState>>, method: Method, headers: HeaderMap, Query(q): Query<PathQ>) -> ApiResult<Json<Value>> {
    let u = user(&app, &headers, &method)?;
    let store = app.store.clone();
    let path = crate::storage::normalize(&q.path)?;
    let p = path.clone();
    let entries = blocking(move || store.list(&u.id, &p)).await?;
    Ok(Json(json!({"path": path, "entries": entries})))
}

/// Type MIME d'après l'extension (affichage dans le navigateur).
fn mime_for(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "txt" | "md" | "csv" | "log" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// `filename*` d'un en-tête Content-Disposition (RFC 5987).
fn disposition(kind: &str, name: &str) -> HeaderValue {
    let enc: String = name
        .bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-._~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect();
    let ascii: String = name.chars().map(|c| if c.is_ascii_graphic() && c != '"' && c != '\\' || c == ' ' { c } else { '_' }).collect();
    HeaderValue::from_str(&format!("{kind}; filename=\"{ascii}\"; filename*=UTF-8''{enc}")).unwrap_or(HeaderValue::from_static("attachment"))
}

pub async fn read(State(app): State<Arc<AppState>>, method: Method, headers: HeaderMap, Query(q): Query<PathQ>) -> ApiResult<Response> {
    let u = user(&app, &headers, &method)?;
    let store = app.store.clone();
    let path = crate::storage::normalize(&q.path)?;
    let p = path.clone();
    let bytes = blocking(move || store.read(&u.id, &p)).await.map_err(|e| ApiError(StatusCode::NOT_FOUND, e.1))?;
    let name = crate::storage::file_name(&path).to_string();
    let mut r = bytes.into_response();
    let h = r.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static(if q.download.is_some() { "application/octet-stream" } else { mime_for(&name) }));
    h.insert(header::CONTENT_DISPOSITION, disposition(if q.download.is_some() { "attachment" } else { "inline" }, &name));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(r)
}

pub async fn write(State(app): State<Arc<AppState>>, method: Method, headers: HeaderMap, Query(q): Query<PathQ>, body: Bytes) -> ApiResult<Json<Value>> {
    let u = user(&app, &headers, &method)?;
    let store = app.store.clone();
    let path = crate::storage::normalize(&q.path)?;
    let a = app.clone();
    let stat = blocking(move || {
        // Forfait : documents et courriel ensemble.
        let us = crate::usage::of(&a, &u);
        let old = store.stat(&u.id, &path).size;
        if us.used + body.len() as u64 > us.quota + old {
            return Err(format!("Espace plein ({} sur votre forfait {}) : supprimez des fichiers ou des courriels pour continuer.", human(us.used), us.plan.name));
        }
        store.write(&u.id, &path, &body)
    })
    .await?;
    Ok(Json(json!(stat)))
}

#[derive(Deserialize)]
pub struct Paths {
    paths: Vec<String>,
}

pub async fn stat(State(app): State<Arc<AppState>>, method: Method, headers: HeaderMap, Json(b): Json<Paths>) -> ApiResult<Json<Value>> {
    let u = user(&app, &headers, &method)?;
    let store = app.store.clone();
    let stats = blocking(move || Ok(b.paths.iter().map(|p| store.stat(&u.id, p)).collect::<Vec<_>>())).await?;
    Ok(Json(json!(stats)))
}

#[derive(Deserialize)]
pub struct One {
    path: String,
}

pub async fn mkdir(State(app): State<Arc<AppState>>, method: Method, headers: HeaderMap, Json(b): Json<One>) -> ApiResult<Json<Value>> {
    let u = user(&app, &headers, &method)?;
    let store = app.store.clone();
    blocking(move || store.mkdir(&u.id, &b.path)).await?;
    Ok(Json(json!({})))
}

#[derive(Deserialize)]
pub struct Move {
    from: String,
    to: String,
}

pub async fn rename(State(app): State<Arc<AppState>>, method: Method, headers: HeaderMap, Json(b): Json<Move>) -> ApiResult<Json<Value>> {
    let u = user(&app, &headers, &method)?;
    let store = app.store.clone();
    blocking(move || store.rename(&u.id, &b.from, &b.to)).await?;
    Ok(Json(json!({})))
}

pub async fn delete(State(app): State<Arc<AppState>>, method: Method, headers: HeaderMap, Json(b): Json<One>) -> ApiResult<Json<Value>> {
    let u = user(&app, &headers, &method)?;
    let store = app.store.clone();
    blocking(move || store.delete(&u.id, &b.path)).await?;
    Ok(Json(json!({})))
}

#[derive(Deserialize)]
pub struct New {
    kind: String,
}

pub async fn new_document(State(app): State<Arc<AppState>>, method: Method, headers: HeaderMap, Json(b): Json<New>) -> ApiResult<Json<Value>> {
    let u = user(&app, &headers, &method)?;
    let a = app.clone();
    let path = blocking(move || a.pool.new_document(&a.store, &u.id, &b.kind)).await?;
    Ok(Json(json!({"path": path})))
}

fn kv_path(name: &str) -> ApiResult<String> {
    if name.is_empty() || name.len() > 40 || !name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') {
        return Err(ApiError(StatusCode::BAD_REQUEST, "nom de réglage invalide".into()));
    }
    Ok(format!("/.auxi/{name}.json"))
}

/// Réglages de l'utilisateur (préférences d'AuxiText, documents récents…).
pub async fn kv_get(State(app): State<Arc<AppState>>, method: Method, headers: HeaderMap, UrlPath(name): UrlPath<String>) -> ApiResult<Json<Value>> {
    let u = user(&app, &headers, &method)?;
    let path = kv_path(&name)?;
    let store = app.store.clone();
    let v = blocking(move || Ok(store.read(&u.id, &path).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).unwrap_or(Value::Null))).await?;
    Ok(Json(v))
}

pub async fn kv_put(State(app): State<Arc<AppState>>, method: Method, headers: HeaderMap, UrlPath(name): UrlPath<String>, Json(v): Json<Value>) -> ApiResult<Json<Value>> {
    let u = user(&app, &headers, &method)?;
    let path = kv_path(&name)?;
    let bytes = serde_json::to_vec(&v).unwrap();
    if bytes.len() > 1024 * 1024 {
        return Err(ApiError(StatusCode::PAYLOAD_TOO_LARGE, "réglage trop volumineux".into()));
    }
    let store = app.store.clone();
    blocking(move || store.write(&u.id, &path, &bytes).map(|_| ())).await?;
    Ok(Json(json!({})))
}

/// Fichier préparé par le serveur (PDF à imprimer), utilisable une fois
/// par son propriétaire pendant quelques minutes.
pub async fn download(State(app): State<Arc<AppState>>, method: Method, headers: HeaderMap, UrlPath(token): UrlPath<String>) -> ApiResult<Response> {
    let u = user(&app, &headers, &method)?;
    let d = app.take_download(&token, &u.id).ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "fichier expiré".into()))?;
    let mut r = d.bytes.into_response();
    r.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static(d.mime));
    r.headers_mut().insert(header::CONTENT_DISPOSITION, disposition("inline", &d.name));
    r.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(r)
}

pub async fn log(State(app): State<Arc<AppState>>, method: Method, headers: HeaderMap, body: String) -> ApiResult<Json<Value>> {
    let u = user(&app, &headers, &method)?;
    let line: String = body.chars().take(4000).collect();
    eprintln!("interface [{}] : {}", u.id, line.replace('\n', " ⏎ "));
    Ok(Json(json!({})))
}

/// Taille lisible (« 640 Mo »).
fn human(n: u64) -> String {
    let mb = n as f64 / 1024.0 / 1024.0;
    if mb >= 1024.0 {
        format!("{:.1} Go", mb / 1024.0).replace('.', ",")
    } else {
        format!("{:.0} Mo", mb)
    }
}

// --- Comptes ---------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ChangePassword {
    old: String,
    new: String,
}

/// Changer son mot de passe (les autres sessions du compte sont fermées).
pub async fn change_password(State(app): State<Arc<AppState>>, method: Method, headers: HeaderMap, Json(b): Json<ChangePassword>) -> ApiResult<Json<Value>> {
    let u = user(&app, &headers, &method)?;
    let token = cookie_token(&headers).unwrap_or_default();
    let a = app.clone();
    blocking(move || a.auth.change_own(&u.id, &token, &b.old, &b.new)).await?;
    Ok(Json(json!({})))
}

/// Administrateur seulement (comptes activés).
fn admin(app: &AppState, headers: &HeaderMap, method: &Method) -> ApiResult<User> {
    let u = user(app, headers, method)?;
    if !app.auth.enabled() || !u.admin {
        return Err(ApiError(StatusCode::FORBIDDEN, "Réservé aux administrateurs.".into()));
    }
    Ok(u)
}

pub async fn admin_list(State(app): State<Arc<AppState>>, method: Method, headers: HeaderMap) -> ApiResult<Json<Value>> {
    admin(&app, &headers, &method)?;
    let a = app.clone();
    let settings = app.settings.get();
    let list = blocking(move || {
        Ok(a.auth
            .list()
            .iter()
            .map(|u| {
                let us = crate::usage::of(&a, u);
                json!({"email": u.email, "name": u.name, "admin": u.admin, "plan": us.plan.id, "plan_name": us.plan.name, "quota_mb": us.quota / 1024 / 1024, "custom_quota": us.custom, "used": us.used, "files": us.files, "mail": us.mail})
            })
            .collect::<Vec<_>>())
    })
    .await?;
    Ok(Json(json!({"users": list, "default_quota_mb": settings.default_quota_mb, "plans": settings.plans, "default_plan": settings.default_plan, "mail_counted": app.mail_usage.enabled()})))
}

#[derive(Deserialize)]
pub struct NewAccount {
    email: String,
    #[serde(default)]
    name: String,
    password: String,
    #[serde(default)]
    admin: bool,
    #[serde(default)]
    quota_mb: Option<u64>,
    /// Forfait (identifiant) ; absent : forfait par défaut.
    #[serde(default)]
    plan: Option<String>,
}

pub async fn admin_add(State(app): State<Arc<AppState>>, method: Method, headers: HeaderMap, Json(b): Json<NewAccount>) -> ApiResult<Json<Value>> {
    admin(&app, &headers, &method)?;
    let a = app.clone();
    blocking(move || {
        let mut u = crate::auth::new_user(&b.email, &b.name, &b.password, b.quota_mb, b.admin)?;
        u.plan = b.plan.filter(|p| a.settings.get().plans.iter().any(|x| &x.id == p));
        a.auth.add(u)
    })
    .await?;
    Ok(Json(json!({})))
}

#[derive(Deserialize)]
pub struct UpdateAccount {
    email: String,
    #[serde(default)]
    name: Option<String>,
    /// Nouveau mot de passe (fermera les sessions du compte).
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    admin: Option<bool>,
    /// Espace particulier en Mo ; 0 : celui du forfait.
    #[serde(default)]
    quota_mb: Option<u64>,
    /// Forfait (identifiant) ; « » : forfait par défaut.
    #[serde(default)]
    plan: Option<String>,
}

pub async fn admin_update(State(app): State<Arc<AppState>>, method: Method, headers: HeaderMap, Json(b): Json<UpdateAccount>) -> ApiResult<Json<Value>> {
    let me = admin(&app, &headers, &method)?;
    if b.admin == Some(false) && me.email.eq_ignore_ascii_case(&b.email) {
        return Err(ApiError(StatusCode::BAD_REQUEST, "Vous ne pouvez pas retirer votre propre rôle d'administrateur.".into()));
    }
    let a = app.clone();
    blocking(move || {
        if let Some(p) = b.password.as_deref().filter(|p| !p.is_empty()) {
            a.auth.set_password(&b.email, p)?;
        }
        if let Some(p) = b.plan {
            let p = Some(p).filter(|p| !p.is_empty());
            if let Some(id) = &p {
                if !a.settings.get().plans.iter().any(|x| &x.id == id) {
                    return Err(format!("Forfait inconnu : {id}"));
                }
            }
            a.auth.set_plan(&b.email, p)?;
        }
        a.auth.set_profile(&b.email, b.name, b.quota_mb.map(|q| (q > 0).then_some(q)), b.admin)
    })
    .await?;
    Ok(Json(json!({})))
}

#[derive(Deserialize)]
pub struct DeleteAccount {
    email: String,
    /// Supprimer aussi ses fichiers.
    #[serde(default)]
    files: bool,
}

pub async fn admin_delete(State(app): State<Arc<AppState>>, method: Method, headers: HeaderMap, Json(b): Json<DeleteAccount>) -> ApiResult<Json<Value>> {
    let me = admin(&app, &headers, &method)?;
    if me.email.eq_ignore_ascii_case(&b.email) {
        return Err(ApiError(StatusCode::BAD_REQUEST, "Vous ne pouvez pas supprimer votre propre compte.".into()));
    }
    let a = app.clone();
    blocking(move || {
        let u = a.auth.remove(&b.email)?;
        if b.files {
            let _ = std::fs::remove_dir_all(a.store.user_root(&u.id));
        }
        Ok(())
    })
    .await?;
    Ok(Json(json!({})))
}

#[derive(Deserialize)]
pub struct Profile {
    name: String,
}

/// Son propre profil (nom affiché).
pub async fn update_profile(State(app): State<Arc<AppState>>, method: Method, headers: HeaderMap, Json(b): Json<Profile>) -> ApiResult<Json<Value>> {
    let u = user(&app, &headers, &method)?;
    if b.name.trim().is_empty() {
        return Err(ApiError(StatusCode::BAD_REQUEST, "Le nom ne peut pas être vide.".into()));
    }
    let a = app.clone();
    blocking(move || a.auth.set_profile(&u.email, Some(b.name), None, None)).await?;
    Ok(Json(json!({})))
}

/// Réglages du serveur (administrateurs).
pub async fn admin_settings(State(app): State<Arc<AppState>>, method: Method, headers: HeaderMap) -> ApiResult<Json<Value>> {
    admin(&app, &headers, &method)?;
    Ok(Json(json!(app.settings.get())))
}

pub async fn admin_settings_put(State(app): State<Arc<AppState>>, method: Method, headers: HeaderMap, Json(s): Json<crate::settings::Settings>) -> ApiResult<Json<Value>> {
    admin(&app, &headers, &method)?;
    let a = app.clone();
    let saved = blocking(move || a.settings.set(s)).await?;
    app.pool.setup.max_per_user.store(saved.max_docs_per_user, std::sync::atomic::Ordering::Relaxed);
    Ok(Json(json!(saved)))
}

/// État du serveur (administrateurs) : moteurs, documents, espace, options.
pub async fn admin_status(State(app): State<Arc<AppState>>, method: Method, headers: HeaderMap) -> ApiResult<Json<Value>> {
    admin(&app, &headers, &method)?;
    let a = app.clone();
    let (accounts, storage) = blocking(move || {
        let users = a.auth.list();
        let total: u64 = users.iter().map(|u| a.store.usage(&u.id)).sum();
        Ok((users.len(), total))
    })
    .await?;
    let auximail = match &app.mail_health {
        Some(p) => match p.health().await {
            Ok(v) => v,
            Err(e) => json!({"ok": false, "error": e}),
        },
        None => Value::Null,
    };
    let setup = &app.pool.setup;
    Ok(Json(json!({
        "version": env!("CARGO_PKG_VERSION"),
        "uptime_s": app.started.elapsed().as_secs(),
        "accounts": accounts,
        "storage": storage,
        "engines_running": app.pool.running(),
        "engines_max": setup.max_engines,
        "docs_open": app.pool.open_count(),
        "spares": setup.spares,
        "sandbox": app.sandbox_name,
        "auxicorrect": app.auxicorrect.as_ref().map(|(c, v)| json!({"cli": c, "version": v})),
        "max_open_mb": setup.max_open_mb,
        "auximail": auximail,
    })))
}

// --- AuxiCorrect -----------------------------------------------------------------

fn auxicorrect_state(app: &AppState, user: &str) -> Value {
    let opts = crate::grammar::user_options(&app.pool.setup.files_root, user);
    json!({
        "available": app.auxicorrect.is_some(),
        "version": app.auxicorrect.as_ref().and_then(|(_, v)| v.clone()),
        "options": opts,
    })
}

pub async fn auxicorrect_get(State(app): State<Arc<AppState>>, method: Method, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let u = user(&app, &headers, &method)?;
    Ok(Json(auxicorrect_state(&app, &u.id)))
}

/// Options d'AuxiCorrect de l'utilisateur : elles valent aussitôt pour les
/// paragraphes vérifiés ensuite, y compris dans les documents déjà ouverts.
pub async fn auxicorrect_put(State(app): State<Arc<AppState>>, method: Method, headers: HeaderMap, Json(o): Json<crate::auxicorrect::Options>) -> ApiResult<Json<Value>> {
    let u = user(&app, &headers, &method)?;
    crate::grammar::save_user_options(&app.pool.setup.files_root, &u.id, &o)?;
    Ok(Json(auxicorrect_state(&app, &u.id)))
}

fn cli(app: &AppState) -> ApiResult<std::path::PathBuf> {
    app.auxicorrect.as_ref().map(|(c, _)| c.clone()).ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "AuxiCorrect n'est pas installé sur ce serveur.".into()))
}

#[derive(Deserialize)]
pub struct Lookup {
    what: String,
    word: String,
}

/// Dictionnaire : définition, synonymes, antonymes, conjugaison.
pub async fn auxicorrect_lookup(State(app): State<Arc<AppState>>, method: Method, headers: HeaderMap, Json(b): Json<Lookup>) -> ApiResult<Json<Value>> {
    user(&app, &headers, &method)?;
    let cli = cli(&app)?;
    if b.word.chars().count() > 80 {
        return Err(ApiError(StatusCode::BAD_REQUEST, "mot trop long".into()));
    }
    let text = blocking(move || crate::auxicorrect::lookup(&cli, &b.what, &b.word)).await?;
    Ok(Json(json!({"text": text})))
}

#[derive(Deserialize)]
pub struct Check {
    text: String,
    #[serde(default)]
    international: bool,
}

/// Vérification d'un texte d'AuxiText (remarques, positions UTF-16).
pub async fn auxicorrect_check(State(app): State<Arc<AppState>>, method: Method, headers: HeaderMap, Json(b): Json<Check>) -> ApiResult<Json<Value>> {
    user(&app, &headers, &method)?;
    let cli = cli(&app)?;
    if b.text.len() > 2 << 20 {
        return Err(ApiError(StatusCode::PAYLOAD_TOO_LARGE, "texte trop long pour la vérification".into()));
    }
    let remarks = blocking(move || crate::text_auxicorrect::check(&cli, &b.text, b.international)).await?;
    Ok(Json(json!(remarks)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nom_telecharge() {
        let v = disposition("attachment", "Été 2026.pdf");
        assert_eq!(v.to_str().unwrap(), "attachment; filename=\"_t_ 2026.pdf\"; filename*=UTF-8''%C3%89t%C3%A9%202026.pdf");
        assert!(kv_path("../x").is_err());
        assert_eq!(kv_path("prefs-text").ok().unwrap(), "/.auxi/prefs-text.json");
    }
}
