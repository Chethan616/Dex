//! The Dex shell.
//!
//! Hosts the Leptos UI and owns everything a WebView cannot: the supervised
//! processes, the system tray, the global hotkey, the native file picker, and
//! reading the core's handshake off disk.
//!
//! Replaces `app/dex.exe`. `RUN.bat` launches this.

// A console window behind the app is noise; the logs are the output.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod job;
mod paths;
mod supervisor;

use std::sync::Arc;

use serde::Serialize;
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, State, WindowEvent};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

use supervisor::{StepReport, Supervisor};

/// Copy from `app/lib/platform/win/tray.dart`.
const TRAY_TOOLTIP: &str = "Dex — calm cockpit";
const TRAY_SHOW: &str = "Show Dex";
const TRAY_QUIT_ON_CLOSE: &str = "Quit on close";
const TRAY_QUIT: &str = "Quit Dex";

struct AppState {
    supervisor: Arc<Supervisor>,
    /// When false, closing the window hides Dex to the tray instead of exiting.
    quit_on_close: std::sync::atomic::AtomicBool,
}

/// `%LOCALAPPDATA%\DEX\ui.json`, read natively because a WebView cannot.
#[derive(Serialize)]
struct Handshake {
    port: u16,
    token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
}

#[tauri::command]
fn dex_handshake() -> Result<Handshake, String> {
    let path = paths::handshake_file();
    let text = std::fs::read_to_string(&path)
        .map_err(|_| format!("no handshake at {}", path.display()))?;
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("unreadable handshake: {e}"))?;

    let port = value
        .get("port")
        .and_then(serde_json::Value::as_u64)
        .and_then(|p| u16::try_from(p).ok())
        .ok_or_else(|| "the handshake has no port".to_owned())?;
    let token = value
        .get("token")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "the handshake has no token".to_owned())?
        .to_owned();

    Ok(Handshake {
        port,
        token,
        pid: value
            .get("pid")
            .and_then(serde_json::Value::as_u64)
            .and_then(|p| u32::try_from(p).ok()),
        version: value
            .get("version")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned),
    })
}

#[tauri::command]
fn dex_boot_status(state: State<'_, AppState>) -> Vec<StepReport> {
    state.supervisor.report()
}

#[tauri::command]
fn dex_retry_boot(state: State<'_, AppState>) {
    state.supervisor.retry();
}

/// The native file picker. Returns absolute paths; the UI attaches them.
#[tauri::command]
async fn dex_pick_files(app: AppHandle) -> Vec<String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp", "bmp"])
        .add_filter("All files", &["*"])
        .pick_files(move |paths| {
            let _ = tx.send(paths.unwrap_or_default());
        });

    rx.recv()
        .unwrap_or_default()
        .into_iter()
        .map(|p| p.to_string())
        .collect()
}

/// Rebind the summon hotkey. "None" unbinds.
#[tauri::command]
fn dex_set_hotkey(app: AppHandle, combo: String) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();

    let Some(shortcut) = parse_hotkey(&combo) else {
        // "None" is a valid choice, not a failure.
        return Ok(());
    };
    shortcuts
        .register(shortcut)
        .map_err(|e| format!("could not bind {combo}: {e}"))
}

/// `Ctrl+K` and `Alt+Space` are the two the Flutter client offers.
fn parse_hotkey(combo: &str) -> Option<Shortcut> {
    match combo {
        "Ctrl+K" => Some(Shortcut::new(Some(Modifiers::CONTROL), Code::KeyK)),
        "Alt+Space" => Some(Shortcut::new(Some(Modifiers::ALT), Code::Space)),
        _ => None,
    }
}

/// Bring the main window forward.
fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// The Ctrl+K overlay: a small borderless window that takes one prompt.
///
/// A separate window rather than a mode of the main one, so summoning Dex
/// never disturbs whatever is already on screen in the app. `?spotlight=1`
/// tells the UI which surface to draw.
fn toggle_spotlight(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("spotlight") {
        // A second press dismisses it, which is what a summon key should do.
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
        return;
    }

    let built = tauri::WebviewWindowBuilder::new(
        app,
        "spotlight",
        tauri::WebviewUrl::App("index.html?spotlight=1".into()),
    )
    .title("Dex Spotlight")
    .inner_size(720.0, 420.0)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .center()
    .resizable(false)
    .build();

    if let Ok(window) = built {
        let _ = window.set_focus();
    }
}

/// Send a prompt from the Spotlight window to the main one, then close it.
///
/// The main window is raised *after* the prompt is handed over, so the owner
/// lands on the reply already streaming rather than on an empty screen.
#[tauri::command]
fn dex_spotlight_submit(app: AppHandle, text: String) {
    use tauri::Emitter;
    if let Some(window) = app.get_webview_window("spotlight") {
        let _ = window.hide();
    }
    let _ = app.emit("dex://spotlight-prompt", text);
    show_window(&app);
}

fn main() {
    let sup = Supervisor::new();
    sup.boot();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    // Fire on press only; the release would raise it twice.
                    if event.state() == ShortcutState::Pressed {
                        toggle_spotlight(app);
                    }
                })
                .build(),
        )
        .manage(AppState {
            supervisor: Arc::clone(&sup),
            quit_on_close: std::sync::atomic::AtomicBool::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            dex_handshake,
            dex_boot_status,
            dex_retry_boot,
            dex_pick_files,
            dex_set_hotkey,
            dex_spotlight_submit,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();

            let show = MenuItem::with_id(app, "show", TRAY_SHOW, true, None::<&str>)?;
            let quit_on_close =
                CheckMenuItem::with_id(app, "quit_on_close", TRAY_QUIT_ON_CLOSE, true, false, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", TRAY_QUIT, true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit_on_close, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().ok_or("no icon")?)
                .tooltip(TRAY_TOOLTIP)
                .menu(&menu)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "show" => show_window(app),
                    "quit_on_close" => {
                        let state = app.state::<AppState>();
                        let now = !state
                            .quit_on_close
                            .load(std::sync::atomic::Ordering::Relaxed);
                        state
                            .quit_on_close
                            .store(now, std::sync::atomic::Ordering::Relaxed);
                    }
                    "quit" => {
                        app.state::<AppState>().supervisor.shutdown();
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // Ctrl+K by default, matching the Flutter client.
            let _ = dex_set_hotkey(handle, "Ctrl+K".to_owned());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                if state
                    .quit_on_close
                    .load(std::sync::atomic::Ordering::Relaxed)
                {
                    state.supervisor.shutdown();
                } else {
                    // Hide to the tray rather than exiting, which is what the
                    // preference means.
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("Dex could not start: {e}");
            std::process::exit(1);
        });
}
