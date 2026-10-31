//! Relais intégré vers AuxiMailWeb (`--auximail-proxy http://127.0.0.1:8095`) :
//! tout ce qui est sous `/mail` part tel quel (chemin complet, méthode,
//! en-têtes dont le témoin de session, corps en flux) et la réponse revient
//! telle quelle, en flux elle aussi : le flux d'événements
//! `/mail/api/events` (Server-Sent Events) n'est ni mis en tampon ni coupé.
//! En production, nginx peut faire ce relais à la place (voir README).

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use std::sync::Arc;

/// En-têtes propres à une connexion, jamais relayés.
const HOP: &[&str] = &["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "proxy-connection"];

pub struct MailProxy {
    base: String,
    client: reqwest::Client,
}

impl MailProxy {
    pub fn new(base: &str) -> Result<MailProxy, String> {
        let base = base.trim_end_matches('/').to_string();
        if !base.starts_with("http://") {
            return Err(format!("--auximail-proxy : adresse http:// attendue (AuxiMailWeb sur ce serveur), reçu « {base} »"));
        }
        let client = reqwest::Client::builder()
            // Les redirections (/mail → /mail/) vont au navigateur.
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(std::time::Duration::from_secs(5))
            // Pas de délai total : le flux d'événements dure tant que l'onglet est ouvert.
            .build()
            .map_err(|e| e.to_string())?;
        Ok(MailProxy { base, client })
    }

    /// État d'AuxiMailWeb (`/mail/api/health`), pour l'administration.
    pub async fn health(&self) -> Result<serde_json::Value, String> {
        let r = self.client.get(format!("{}/mail/api/health", self.base)).timeout(std::time::Duration::from_secs(5)).send().await.map_err(|e| format!("AuxiMailWeb injoignable : {e}"))?;
        if !r.status().is_success() {
            return Err(format!("AuxiMailWeb : réponse {}", r.status()));
        }
        let bytes = r.bytes().await.map_err(|e| e.to_string())?;
        serde_json::from_slice(&bytes).map_err(|e| e.to_string())
    }
}

pub async fn relay(State(app): State<Arc<crate::AppState>>, req: Request) -> Response {
    let Some(proxy) = app.mail_proxy.as_ref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let (parts, body) = req.into_parts();
    let path = parts.uri.path_and_query().map(|p| p.as_str()).unwrap_or("/mail");
    let url = format!("{}{}", proxy.base, path);
    let mut out = proxy.client.request(parts.method.clone(), &url);
    for (k, v) in &parts.headers {
        if !HOP.contains(&k.as_str()) && k != "content-length" {
            out = out.header(k, v);
        }
    }
    if let Some(len) = parts.headers.get("content-length") {
        out = out.header("content-length", len);
    }
    let proto = if app.secure_cookies { "https" } else { "http" };
    out = out.header("x-forwarded-proto", proto);
    let upstream = match out.body(reqwest::Body::wrap_stream(body.into_data_stream())).send().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("auxi-online : relais AuxiMail : {e}");
            return (StatusCode::BAD_GATEWAY, "AuxiMail est momentanément indisponible.").into_response();
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
