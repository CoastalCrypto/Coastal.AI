// Coastal.AI desktop shell (Tauri v2). Spawns the folder-bundled Node `core`
// as a sidecar on a free port, then opens a frameless window pointed at the UI
// with the chosen port passed through the query string. Kills the sidecar on
// app exit so no orphaned core process survives.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;

use std::process::Child;
use std::sync::Mutex;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

struct CoreChild(Mutex<Option<Child>>);

fn main() {
    tauri::Builder::default()
        .manage(CoreChild(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            let port = sidecar::free_port();
            let child = sidecar::spawn_core(&handle, port)?;
            app.state::<CoreChild>().0.lock().unwrap().replace(child);

            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App(format!("index.html?corePort={port}").into()),
            )
            .title("Coastal.AI")
            .inner_size(1280.0, 800.0)
            .min_inner_size(800.0, 600.0)
            .decorations(false)
            .build()?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Coastal.AI desktop app")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(mut child) = app.state::<CoreChild>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
