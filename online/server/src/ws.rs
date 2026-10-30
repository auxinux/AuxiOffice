//! Canal WebSocket entre l'interface et les moteurs : requêtes numérotées,
//! réponses JSON, tuiles en binaire (compressées zlib, décompressées par le
//! navigateur), et rappels des moteurs (`{"event": "engine", …}`).
//!
//! Trame binaire du serveur : numéro de requête (u32, petit-boutiste),
//! un octet de format (0 : brut, 1 : zlib), puis les octets RGBA.
//!
//! Premier message du serveur : `{"event": "hello", "session": …, "docs": […]}`.
//! Après une coupure, l'interface se reconnecte avec `/ws?resume=<session>` :
//! ses documents, restés ouverts, reprennent là où ils étaient.

use crate::engines::WsOut;
use crate::AppState;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde_json::{json, Value};
use std::io::Write;
use std::sync::Arc;


/// L'origine de la page doit être le serveur lui-même (pas de WebSocket
/// ouvert depuis un autre site avec le témoin de l'utilisateur).
fn same_origin(headers: &HeaderMap) -> bool {
    let Some(origin) = headers.get("origin").and_then(|v| v.to_str().ok()) else { return true };
    let host = headers.get("x-forwarded-host").or_else(|| headers.get("host")).and_then(|v| v.to_str().ok()).unwrap_or("");
    let origin_host = origin.split("://").nth(1).unwrap_or("");
    !host.is_empty() && origin_host.eq_ignore_ascii_case(host)
}

#[derive(serde::Deserialize)]
pub struct WsQuery {
    resume: Option<String>,
}

pub async fn handler(ws: WebSocketUpgrade, State(app): State<Arc<AppState>>, headers: HeaderMap, Query(q): Query<WsQuery>) -> Response {
    if !same_origin(&headers) {
        return (StatusCode::FORBIDDEN, "origine refusée").into_response();
    }
    let token = crate::auth::cookie_token(&headers);
    let Some(user) = app.auth.session_user(token.as_deref()) else {
        return (StatusCode::UNAUTHORIZED, "session expirée").into_response();
    };
    ws.max_message_size(64 * 1024 * 1024).on_upgrade(move |socket| session(socket, app, user.id, q.resume))
}

async fn session(socket: WebSocket, app: Arc<AppState>, user: String, resume: Option<String>) {
    use futures_util::{SinkExt, StreamExt};
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<WsOut>();
    let (session, docs) = app.pool.attach(&user, resume.as_deref(), tx.clone());
    let _ = tx.send(WsOut::Text(json!({"event": "hello", "session": session, "docs": docs}).to_string()));
    // Documents repris : tout redessiner (des tuiles ont pu manquer pendant la coupure).
    for doc in docs {
        let _ = tx.send(WsOut::Text(json!({"event": "engine", "payload": {"doc": doc, "event": "callback", "type": 0, "name": "invalidate_tiles", "payload": "EMPTY"}}).to_string()));
    }
    let writer = tokio::spawn(async move {
        while let Some(m) = rx.recv().await {
            let msg = match m {
                WsOut::Text(t) => Message::Text(t.into()),
                WsOut::Binary(b) => Message::Binary(b.into()),
            };
            if sink.send(msg).await.is_err() {
                break;
            }
        }
    });
    while let Some(Ok(msg)) = stream.next().await {
        let Message::Text(text) = msg else {
            if matches!(msg, Message::Close(_)) {
                break;
            }
            continue;
        };
        let Ok(req) = serde_json::from_str::<Value>(&text) else { continue };
        let (app, user, tx, session) = (app.clone(), user.clone(), tx.clone(), session.clone());
        tokio::spawn(async move {
            let id = req.get("id").and_then(Value::as_u64).unwrap_or(0);
            let out = tokio::task::spawn_blocking({
                let tx = tx.clone();
                move || handle(&app, &user, &session, tx, req)
            })
            .await
            .unwrap_or_else(|e| Err(e.to_string()));
            let msg = match out {
                Ok(Reply::Json(v)) => WsOut::Text(json!({"id": id, "ok": true, "result": v}).to_string()),
                Ok(Reply::Bin(b)) => WsOut::Binary(b),
                Err(e) => WsOut::Text(json!({"id": id, "ok": false, "error": e}).to_string()),
            };
            let _ = tx.send(msg);
        });
    }
    writer.abort();
    app.pool.detach(&session);
}

enum Reply {
    Json(Value),
    Bin(Vec<u8>),
}

fn handle(app: &AppState, user: &str, session: &str, tx: crate::engines::Outbox, req: Value) -> Result<Reply, String> {
    let id = req.get("id").and_then(Value::as_u64).unwrap_or(0) as u32;
    let doc = req.get("doc").and_then(Value::as_u64).unwrap_or(0);
    let s = |k: &str| req.get(k).and_then(Value::as_str).map(str::to_owned);
    match req.get("cmd").and_then(Value::as_str).unwrap_or("") {
        "doc_open" => {
            let path = s("path").ok_or("champ path manquant")?;
            app.pool.open(&app.store, user, session, tx, &path, s("password").filter(|p| !p.is_empty())).map(Reply::Json)
        }
        "doc_call" => app.pool.call(&app.store, user, doc, req.get("req").cloned().unwrap_or(Value::Null)).map(Reply::Json),
        "doc_paint" => {
            let px = app.pool.paint(user, doc, req.get("req").cloned().unwrap_or(Value::Null))?;
            let mut out = Vec::with_capacity(px.len() / 8 + 5);
            out.extend_from_slice(&id.to_le_bytes());
            if px.len() > 1024 {
                out.push(1);
                let mut z = flate2::write::ZlibEncoder::new(out, flate2::Compression::fast());
                z.write_all(&px).map_err(|e| e.to_string())?;
                out = z.finish().map_err(|e| e.to_string())?;
            } else {
                out.push(0);
                out.extend_from_slice(&px);
            }
            Ok(Reply::Bin(out))
        }
        "doc_close" => {
            app.pool.close(user, doc);
            Ok(Reply::Json(Value::Null))
        }
        "warm" => {
            app.pool.refill();
            Ok(Reply::Json(Value::Null))
        }
        "pdf" => {
            let (name, bytes) = app.pool.pdf(user, doc, &s("title").unwrap_or_default(), &s("pages").unwrap_or_default())?;
            let token = app.add_download(user, &name, "application/pdf", bytes);
            Ok(Reply::Json(json!({"url": format!("/api/download/{token}"), "name": name})))
        }
        "ping" => Ok(Reply::Json(json!("pong"))),
        other => Err(format!("commande inconnue : {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origine() {
        let mut h = HeaderMap::new();
        h.insert("host", "web.office.auxinux.ca".parse().unwrap());
        assert!(same_origin(&h));
        h.insert("origin", "https://web.office.auxinux.ca".parse().unwrap());
        assert!(same_origin(&h));
        h.insert("origin", "https://pirate.example".parse().unwrap());
        assert!(!same_origin(&h));
    }
}
