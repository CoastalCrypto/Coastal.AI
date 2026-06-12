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

/// Triple used by packages/core/scripts/bundle-sidecar.mjs. Spike: Windows only.
fn target_triple() -> &'static str {
    "x86_64-pc-windows-msvc"
}

fn runtime_path(app: &AppHandle) -> Result<PathBuf, String> {
    let name = format!("coastal-core-{}.exe", target_triple());
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
        // Allow the platform webview origins so CORS preflight succeeds.
        .env(
            "CC_CORS_ORIGINS",
            "http://tauri.localhost,https://tauri.localhost,tauri://localhost,http://localhost",
        )
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

    rx.recv_timeout(Duration::from_secs(40))
        .map_err(|_| "core did not signal CC_SIDECAR_READY within 40s".to_string())?;
    Ok(child)
}
