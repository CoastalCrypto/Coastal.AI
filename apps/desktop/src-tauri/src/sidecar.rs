// Sidecar supervisor: locate the folder-bundled node runtime + deployed app,
// spawn `coastal-core-<triple> dist/main.js` on an OS-assigned free port, and
// block until it announces `CC_SIDECAR_READY <port>` on stdout. A dedicated
// reader thread drains stdout for the process lifetime so the OS pipe buffer
// never fills (which would otherwise stall core's logging).
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// Build a `data:text/html` URL for a branded error screen shown when the core
/// sidecar fails to start — far better UX than a silent panic-to-nothing.
pub fn error_window_url(msg: &str) -> String {
    let html = format!(
        "<!doctype html><html><head><meta charset=utf-8><style>\
         body{{background:#050d1a;color:#cde3ff;font-family:system-ui;margin:0;\
         display:flex;align-items:center;justify-content:center;height:100vh}}\
         .card{{max-width:560px;padding:36px;text-align:center}}\
         h1{{color:#ff8a8a;font-weight:600;margin:0 0 12px}}\
         p{{color:#9fb6d6;line-height:1.55}}\
         code{{display:block;background:#0f1830;padding:10px 12px;border-radius:8px;\
         color:#6ee7a8;margin:14px 0;word-break:break-word}}</style></head>\
         <body><div class=card><h1>Coastal.AI couldn't start its engine</h1>\
         <p>The local backend did not start.</p><code>{msg}</code>\
         <p>Make sure any required services (e.g. Ollama) are available, then relaunch. \
         Logs are in the app data directory.</p></div></body></html>",
        msg = html_escape(msg),
    );
    let mut url = String::from("data:text/html,");
    for b in html.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => url.push(b as char),
            _ => url.push_str(&format!("%{b:02X}")),
        }
    }
    url
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// Strip the Windows `\\?\` extended-length prefix. Tauri's resource_dir()
/// returns canonicalized paths carrying this prefix, but Node.js cannot parse
/// `\\?\C:\...` as a script entry point (it mis-resolves to `lstat 'C:'`).
fn clean_path(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(stripped) => PathBuf::from(stripped),
        None => p,
    }
}

/// Ask the OS for a free TCP port by binding :0 and immediately releasing it.
pub fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("bind 127.0.0.1:0")
        .local_addr()
        .unwrap()
        .port()
}

/// Build target triple, emitted by build.rs. Matches the name bundle-sidecar.mjs
/// gives the runtime on this OS (e.g. x86_64-pc-windows-msvc, aarch64-apple-darwin).
fn target_triple() -> &'static str {
    env!("COASTAL_TARGET_TRIPLE")
}

fn runtime_path(app: &AppHandle) -> Result<PathBuf, String> {
    let ext = if cfg!(windows) { ".exe" } else { "" };
    let name = format!("coastal-core-{}{ext}", target_triple());
    if let Ok(res) = app.path().resource_dir() {
        let p = res.join("binaries").join(&name);
        if p.exists() {
            return Ok(p);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join(&name);
    if dev.exists() {
        return Ok(dev);
    }
    Err(format!("sidecar runtime not found: {name} (run `pnpm --filter @coastal-ai/desktop presync`)"))
}

fn core_main(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(res) = app.path().resource_dir() {
        let p = res.join("resources").join("app").join("dist").join("main.js");
        if p.exists() {
            return Ok(p);
        }
        let p2 = res.join("app").join("dist").join("main.js");
        if p2.exists() {
            return Ok(p2);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("packages")
        .join("core")
        .join("sidecar-build")
        .join("app")
        .join("dist")
        .join("main.js");
    if dev.exists() {
        return Ok(dev);
    }
    Err("core dist/main.js not found (run `pnpm --filter @coastal-ai/core bundle:sidecar`)".into())
}

/// Spawn the core sidecar and block until it is ready. Returns the live child
/// so the caller can kill it on app exit.
pub fn spawn_core(app: &AppHandle, port: u16) -> Result<Child, String> {
    let runtime = clean_path(runtime_path(app)?);
    let main_js = clean_path(core_main(app)?);
    let mut child = Command::new(&runtime)
        .arg(&main_js)
        .env("CC_PORT", port.to_string())
        .env("CC_HOST", "127.0.0.1")
        // The Tauri webview is a cross-origin caller to the sidecar's HTTP API.
        // Allow ONLY the actual platform webview origins (Windows uses
        // http://tauri.localhost; macOS/Linux use tauri://localhost). Do NOT
        // include a broad http://localhost — it would needlessly let any local
        // browser page reach the API if it discovered the random port.
        .env("CC_CORS_ORIGINS", "http://tauri.localhost,tauri://localhost")
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("failed to spawn core sidecar: {e}"))?;

    let stdout = child.stdout.take().ok_or("core sidecar produced no stdout")?;
    let (tx, rx) = mpsc::channel::<()>();
    let needle = format!("CC_SIDECAR_READY {port}");
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            eprintln!("[core] {line}");
            if line.contains(&needle) {
                let _ = tx.send(());
            }
        }
    });

    // Cold start does a lot (Ollama scan, model registry, MCP probes), so allow
    // generous time — but on timeout KILL the child, or it leaks as an orphan
    // (std::process::Child does not kill on drop).
    match rx.recv_timeout(Duration::from_secs(90)) {
        Ok(_) => Ok(child),
        Err(_) => {
            let _ = child.kill();
            Err("core did not signal CC_SIDECAR_READY within 90s".to_string())
        }
    }
}
