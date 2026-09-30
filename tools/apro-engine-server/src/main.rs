//! `apro-engine-server` — a dependency-free HTTP host for browser use.
//!
//! Serves the built frontend (`frontend/dist`) as static files and exposes the
//! full Tauri command surface over JSON, so the whole app runs in a browser with
//! real computation (not mocks):
//!
//!   POST /api/<command>   with a JSON body of the command arguments
//!
//! Uses only `std::net` so it stays a single offline binary with no HTTP-crate
//! (and no `windows-sys`/`dlltool`) dependencies.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;

use engine_core::{EngineDesign, FieldValue};

type DesignState = Arc<Mutex<Option<EngineDesign>>>;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let port: u16 = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(8787);
    let web_root = PathBuf::from(args.get(2).cloned().unwrap_or_else(|| "frontend/dist".into()));

    let state: DesignState = Arc::new(Mutex::new(None));

    let addr = format!("127.0.0.1:{port}");
    let listener = match TcpListener::bind(&addr) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("failed to bind {addr}: {e}");
            std::process::exit(1);
        }
    };
    println!("Propulsor web host on http://{addr}");
    println!("  serving static files from {}", web_root.display());
    println!("  API: POST /api/<command>");

    for stream in listener.incoming() {
        match stream {
            Ok(s) => {
                let root = web_root.clone();
                let st = state.clone();
                thread::spawn(move || handle(s, &root, &st));
            }
            Err(e) => eprintln!("connection error: {e}"),
        }
    }
}

fn handle(mut stream: TcpStream, web_root: &PathBuf, state: &DesignState) {
    let (method, path, body) = match read_request(&mut stream) {
        Some(r) => r,
        None => return,
    };
    let path = path.split('?').next().unwrap_or("/").to_string();

    if let Some(cmd) = path.strip_prefix("/api/") {
        let args: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::json!({}));
        match dispatch(state, cmd, &args) {
            Ok(v) => respond_json(&mut stream, v),
            Err(e) => respond_json(&mut stream, serde_json::json!({ "error": e })),
        }
        return;
    }
    let _ = method;
    serve_static(&mut stream, web_root, &path);
}

/// Read method, path and body (honouring Content-Length) from the stream.
fn read_request(stream: &mut TcpStream) -> Option<(String, String, String)> {
    let mut data: Vec<u8> = Vec::new();
    let mut buf = [0u8; 4096];
    let mut header_end = None;
    let mut content_length = 0usize;
    loop {
        let n = stream.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        data.extend_from_slice(&buf[..n]);
        if header_end.is_none() {
            if let Some(pos) = find(&data, b"\r\n\r\n") {
                header_end = Some(pos);
                let headers = String::from_utf8_lossy(&data[..pos]);
                for line in headers.lines() {
                    if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        content_length = v.trim().parse().unwrap_or(0);
                    }
                }
            }
        }
        if let Some(pos) = header_end {
            if data.len() >= pos + 4 + content_length {
                break;
            }
        }
        if data.len() > 2_000_000 {
            break;
        }
    }
    let pos = header_end?;
    let head = String::from_utf8_lossy(&data[..pos]).to_string();
    let mut parts = head.split_whitespace();
    let method = parts.next().unwrap_or("GET").to_string();
    let path = parts.next().unwrap_or("/").to_string();
    let body = String::from_utf8_lossy(&data[pos + 4..]).to_string();
    Some((method, path, body))
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

fn default_design() -> EngineDesign {
    // Blank start — no pre-fed engine. The user enters requirements in the UI and
    // every tier resolves from those (matches the Tauri host and the browser mock).
    EngineDesign::blank("untitled", "propulsor")
}

/// Dispatch a command against the shared in-memory design.
fn dispatch(state: &DesignState, cmd: &str, args: &serde_json::Value) -> Result<serde_json::Value, String> {
    let num = |k: &str| args.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0);
    let text = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();

    match cmd {
        "get_design" => {
            let mut guard = state.lock().map_err(|e| e.to_string())?;
            let mut design = guard.clone().unwrap_or_else(default_design);
            simulate::resolve(&mut design).map_err(|e| e.to_string())?;
            *guard = Some(design.clone());
            serde_json::to_value(design).map_err(|e| e.to_string())
        }
        "set_field" => {
            let field_id = text("fieldId");
            let fv = match args.get("value") {
                Some(serde_json::Value::Number(n)) => FieldValue::Num(n.as_f64().unwrap_or(0.0)),
                Some(serde_json::Value::String(s)) => FieldValue::Text(s.clone()),
                _ => return Err("field value must be a number or string".into()),
            };
            let mut guard = state.lock().map_err(|e| e.to_string())?;
            let mut design = guard.clone().unwrap_or_else(default_design);
            design.apply_field(&field_id, fv).map_err(|e| e.to_string())?;
            simulate::resolve(&mut design).map_err(|e| e.to_string())?;
            *guard = Some(design.clone());
            serde_json::to_value(design).map_err(|e| e.to_string())
        }
        "perf_map" => {
            let design = current(state)?;
            let map = simulate::steady_state_map(&design, (1.8, 3.0), 9, (0.0, 20_000.0), 7)
                .map_err(|e| e.to_string())?;
            serde_json::to_value(map).map_err(|e| e.to_string())
        }
        "design_advice" => {
            let mut d = current(state)?;
            let v = simulate::design::design_advice(&mut d, num("burnoutAltitudeM")).map_err(|e| e.to_string())?;
            serde_json::to_value(v).map_err(|e| e.to_string())
        }
        "cooling_study" => {
            let mut d = current(state)?;
            let v = simulate::design::cooling_study(&mut d, &text("material"), &text("method")).map_err(|e| e.to_string())?;
            serde_json::to_value(v).map_err(|e| e.to_string())
        }
        "turbopump_study" => {
            let mut d = current(state)?;
            let v = simulate::design::turbopump_study(&mut d, num("speedRpm")).map_err(|e| e.to_string())?;
            serde_json::to_value(v).map_err(|e| e.to_string())
        }
        "analysis_study" => {
            let mut d = current(state)?;
            let v = simulate::design::analysis_study(&mut d).map_err(|e| e.to_string())?;
            serde_json::to_value(v).map_err(|e| e.to_string())
        }
        "blade_study" => {
            let mut d = current(state)?;
            let v = simulate::design::blade_study(&mut d, num("speedRpm")).map_err(|e| e.to_string())?;
            serde_json::to_value(v).map_err(|e| e.to_string())
        }
        "control_study" => {
            let mut d = current(state)?;
            let v = simulate::design::control_study(&mut d, &text("feedType")).map_err(|e| e.to_string())?;
            serde_json::to_value(v).map_err(|e| e.to_string())
        }
        "validation_study" => {
            let mut d = current(state)?;
            let v = simulate::design::validation_study(&mut d).map_err(|e| e.to_string())?;
            serde_json::to_value(v).map_err(|e| e.to_string())
        }
        "trade_bundle" => {
            let mut d = current(state)?;
            let v = simulate::design::trade_bundle(&mut d).map_err(|e| e.to_string())?;
            serde_json::to_value(v).map_err(|e| e.to_string())
        }
        "feed_study" => {
            let mut d = current(state)?;
            let v = simulate::design::feed_study(&mut d, num("burnTimeS"), &text("feedType")).map_err(|e| e.to_string())?;
            serde_json::to_value(v).map_err(|e| e.to_string())
        }
        other => Err(format!("unknown command: {other}")),
    }
}

fn current(state: &DesignState) -> Result<EngineDesign, String> {
    Ok(state
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .unwrap_or_else(default_design))
}

fn respond_json(stream: &mut TcpStream, value: serde_json::Value) {
    let body = serde_json::to_string(&value).unwrap_or_else(|_| "{}".into());
    let header = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body.as_bytes());
}

fn serve_static(stream: &mut TcpStream, web_root: &PathBuf, path: &str) {
    let rel = path.trim_start_matches('/');
    let rel = if rel.is_empty() { "index.html" } else { rel };
    let mut file_path = web_root.join(rel);
    if !file_path.exists() || file_path.is_dir() {
        file_path = web_root.join("index.html");
    }

    match std::fs::read(&file_path) {
        Ok(bytes) => {
            let mime = mime_for(&file_path);
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                bytes.len()
            );
            let _ = stream.write_all(header.as_bytes());
            let _ = stream.write_all(&bytes);
        }
        Err(_) => {
            let body = "404 Not Found";
            let header = format!(
                "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(header.as_bytes());
            let _ = stream.write_all(body.as_bytes());
        }
    }
}

fn mime_for(path: &PathBuf) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript",
        Some("css") => "text/css",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("ico") => "image/x-icon",
        Some("json") => "application/json",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}
