//! Relais intégrés vers les composants servis sur le même hôte :
//!
//! - AuxiMailWeb (`--auximail-proxy http://127.0.0.1:8095`), sous `/mail` ;
//! - AuxiCorrect Online (`--auxicorrect-proxy http://127.0.0.1:8096`), sous `/correct`.
//!
//! Tout ce qui est sous le préfixe part tel quel (chemin complet, méthode,
//! en-têtes dont le témoin de session, corps en flux) et la réponse revient
//! telle quelle, en flux elle aussi : le flux d'événements
//! `/mail/api/events` (Server-Sent Events) n'est ni mis en tampon ni coupé.
//! Le composant vérifie lui-même la session (`GET /api/me`).
//! En production, nginx peut faire ce relais à la place (voir README).

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use std::sync::Arc;

/// En-têtes propres à une connexion, jamais relayés.
const HOP: &[&str] = &["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "proxy-connection"];

/// Un composant relayé : son adresse et son préfixe (`/mail`, `/correct`).
pub struct Proxy {
    base: String,
    prefix: &'static str,
    /// Nom montré dans les erreurs (« AuxiMail », « AuxiCorrect »).
    name: &'static str,
    /// Nom du service dans l'administration (« AuxiMailWeb »…).
    service: &'static str,
    client: reqwest::Client,
}

impl Proxy {
    /// Relais vers AuxiMailWeb.
    pub fn mail(base: &str) -> Result<Proxy, String> {
        Proxy::new(base, "/mail", "AuxiMail", "AuxiMailWeb", "--auximail-proxy")
    }

    /// Relais vers AuxiCorrect Online (`auxicorrect-web`).
    pub fn correct(base: &str) -> Result<Proxy, String> {
        Proxy::new(base, "/correct", "AuxiCorrect", "AuxiCorrect Online", "--auxicorrect-proxy")
    }

    fn new(base: &str, prefix: &'static str, name: &'static str, service: &'static str, option: &str) -> Result<Proxy, String> {
        let base = base.trim_end_matches('/').to_string();
        if !base.starts_with("http://") {
            return Err(format!("{option} : adresse http:// attendue ({service} sur ce serveur), reçu « {base} »"));
        }
        let client = reqwest::Client::builder()
            // Les redirections (/mail → /mail/) vont au navigateur.
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(std::time::Duration::from_secs(5))
            // Pas de délai total : le flux d'événements dure tant que l'onglet est ouvert.
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Proxy { base, prefix, name, service, client })
    }

    /// État du composant (`<préfixe>/api/health`), pour l'administration.
    pub async fn health(&self) -> Result<serde_json::Value, String> {
        let service = self.service;
        let r = self
            .client
            .get(format!("{}{}/api/health", self.base, self.prefix))
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await
            .map_err(|e| format!("{service} injoignable : {e}"))?;
        if !r.status().is_success() {
            return Err(format!("{service} : réponse {}", r.status()));
        }
        let bytes = r.bytes().await.map_err(|e| e.to_string())?;
        serde_json::from_slice(&bytes).map_err(|e| e.to_string())
    }

    /// Transmet la requête et rend la réponse du composant.
    async fn forward(&self, req: Request, secure: bool) -> Response {
        let (parts, body) = req.into_parts();
        let path = parts.uri.path_and_query().map(|p| p.as_str()).unwrap_or(self.prefix);
        let url = format!("{}{}", self.base, path);
        let mut out = self.client.request(parts.method.clone(), &url);
        for (k, v) in &parts.headers {
            if !HOP.contains(&k.as_str()) && k != "content-length" {
                out = out.header(k, v);
            }
        }
        if let Some(len) = parts.headers.get("content-length") {
            out = out.header("content-length", len);
        }
        out = out.header("x-forwarded-proto", if secure { "https" } else { "http" });
        let upstream = match out.body(reqwest::Body::wrap_stream(body.into_data_stream())).send().await {
            Ok(r) => r,
            Err(e) => {
                eprintln!("auxi-online : relais {} : {e}", self.name);
                return (StatusCode::BAD_GATEWAY, format!("{} est momentanément indisponible.", self.name)).into_response();
            }
        };
        let mut resp = Response::builder().status(upstream.status().as_u16());
        for (k, v) in upstream.headers() {
            if HOP.contains(&k.as_str()) {
                continue;
            }
            if let (Ok(name), Ok(value)) = (HeaderName::from_bytes(k.as_str().as_bytes()), HeaderValue::from_bytes(v.as_bytes())) {
                resp = resp.header(name, value);
            }
        }
        resp.body(Body::from_stream(upstream.bytes_stream())).unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
    }
}

/// `/mail/…` → AuxiMailWeb.
pub async fn relay_mail(State(app): State<Arc<crate::AppState>>, req: Request) -> Response {
    let Some(proxy) = app.mail_proxy.as_ref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    // Routes internes d'AuxiMailWeb (espace d'un client…) : pour ce serveur seulement.
    if req.uri().path().starts_with("/mail/api/internal") {
        return StatusCode::NOT_FOUND.into_response();
    }
    proxy.forward(req, app.secure_cookies).await
}

/// `/correct/…` → AuxiCorrect Online (routes posées seulement avec `--auxicorrect-proxy`).
pub async fn relay_correct(State(app): State<Arc<crate::AppState>>, req: Request) -> Response {
    let Some(proxy) = app.correct_proxy.as_ref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    proxy.forward(req, app.secure_cookies).await
}
