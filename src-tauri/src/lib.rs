// Seatbelt desktop app: a menu bar (macOS) / system tray (Windows) app around the Seatbelt server.
//
// The server is the same Node program as `pnpm start`. The app ships its own Node binary
// (a Tauri "sidecar"), starts the server on a free port, and reads one-line JSON messages it
// prints to stdout (see src/desktop.js) to keep the tray icon, its title and notifications current.
// Clicking the tray icon opens a small panel under it; "Open dashboard" opens the full window.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_positioner::{Position, WindowExt};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const TRAY_ID: &str = "seatbelt";
const PANEL: &str = "panel";
const DASHBOARD: &str = "dashboard";
const MAX_RESTARTS: u32 = 3;

// macOS menu bar icons are "template" images: black shapes the system tints for light/dark.
// Windows trays have no such thing, so they get colored ones.
#[cfg(target_os = "macos")]
const ICON_OK: &[u8] = include_bytes!("../icons/tray/ok-template.png");
#[cfg(target_os = "macos")]
const ICON_ALERT: &[u8] = include_bytes!("../icons/tray/alert-template.png");
#[cfg(not(target_os = "macos"))]
const ICON_OK: &[u8] = include_bytes!("../icons/tray/ok-color.png");
#[cfg(not(target_os = "macos"))]
const ICON_ALERT: &[u8] = include_bytes!("../icons/tray/alert-color.png");

#[derive(Default)]
struct Monitor {
    port: Mutex<Option<u16>>,
    child: Mutex<Option<CommandChild>>,
    alerting: Mutex<bool>,
    restarts: Mutex<u32>,
    /// When the panel last hid itself because it lost focus. Clicking the tray icon to close
    /// the panel blurs it first, so a click right after that should not reopen it.
    panel_blurred_at: Mutex<Option<Instant>>,
    quitting: Mutex<bool>,
}

fn url(app: &AppHandle, path: &str) -> Option<WebviewUrl> {
    let port = (*app.state::<Monitor>().port.lock().unwrap())?;
    format!("http://127.0.0.1:{port}{path}").parse().ok().map(WebviewUrl::External)
}

fn set_dock_visible(app: &AppHandle, visible: bool) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(if visible {
        tauri::ActivationPolicy::Regular
    } else {
        tauri::ActivationPolicy::Accessory
    });
    #[cfg(not(target_os = "macos"))]
    let _ = (app, visible);
}

fn toggle_panel(app: &AppHandle) {
    let Some(panel) = app.get_webview_window(PANEL) else { return };
    if panel.is_visible().unwrap_or(false) {
        let _ = panel.hide();
        return;
    }
    let recently_blurred = app
        .state::<Monitor>()
        .panel_blurred_at
        .lock()
        .unwrap()
        .is_some_and(|t| t.elapsed() < Duration::from_millis(300));
    if recently_blurred {
        return;
    }
    #[cfg(target_os = "macos")]
    let _ = panel.move_window(Position::TrayBottomCenter);
    #[cfg(not(target_os = "macos"))]
    let _ = panel.move_window(Position::TrayCenter);
    let _ = panel.show();
    let _ = panel.set_focus();
}

fn show_dashboard(app: &AppHandle) {
    if let Some(panel) = app.get_webview_window(PANEL) {
        let _ = panel.hide();
    }
    set_dock_visible(app, true);
    if let Some(win) = app.get_webview_window(DASHBOARD) {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }
    let Some(u) = url(app, "/") else { return };
    let _ = WebviewWindowBuilder::new(app, DASHBOARD, u)
        .title("Seatbelt")
        .inner_size(1200.0, 860.0)
        .min_inner_size(420.0, 500.0)
        .build();
}

#[tauri::command]
fn open_dashboard(app: AppHandle) {
    show_dashboard(&app);
}

/// The server is up: create the panel (hidden until the tray icon is clicked).
fn on_ready(app: &AppHandle, port: u16) {
    *app.state::<Monitor>().port.lock().unwrap() = Some(port);
    *app.state::<Monitor>().restarts.lock().unwrap() = 0;
    if let Some(old) = app.get_webview_window(PANEL) {
        let _ = old.destroy();
    }
    if let Some(dash) = app.get_webview_window(DASHBOARD) {
        if let Some(WebviewUrl::External(u)) = url(app, "/") {
            let _ = dash.navigate(u);
        }
    }
    let Some(u) = url(app, "/?view=panel") else { return };
    let _ = WebviewWindowBuilder::new(app, PANEL, u)
        .title("Seatbelt")
        .inner_size(400.0, 600.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build();
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some("Seatbelt is watching"));
    }
}

fn on_status(app: &AppHandle, msg: &Value) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    let paused = msg["paused"].as_array().map(|a| a.len()).unwrap_or(0);
    let active = msg["active"].as_u64().unwrap_or(0);
    let score = msg["score"].as_u64().unwrap_or(0);
    let band = msg["band"].as_str().unwrap_or("");

    let alert = paused > 0;
    let state = app.state::<Monitor>();
    let mut alerting = state.alerting.lock().unwrap();
    if *alerting != alert {
        *alerting = alert;
        if let Ok(img) = Image::from_bytes(if alert { ICON_ALERT } else { ICON_OK }) {
            let _ = tray.set_icon(Some(img));
            #[cfg(target_os = "macos")]
            let _ = tray.set_icon_as_template(true);
        }
    }
    // macOS shows the title next to the icon; keep it empty unless something needs attention.
    let _ = tray.set_title(if alert { Some(format!("{paused} paused")) } else { None::<String> });
    let sessions = match active {
        0 => "no agents running".to_string(),
        1 => "1 agent running".to_string(),
        n => format!("{n} agents running"),
    };
    let tip = if alert {
        format!("Seatbelt: {paused} paused, {sessions}")
    } else {
        format!("Seatbelt: score {score} ({band}), {sessions}")
    };
    let _ = tray.set_tooltip(Some(tip));
}

fn handle_line(app: &AppHandle, line: &str) {
    let Some(json) = line.trim().strip_prefix("@@seatbelt ") else { return };
    let Ok(msg) = serde_json::from_str::<Value>(json) else { return };
    match msg["type"].as_str() {
        Some("ready") => {
            if let Some(port) = msg["port"].as_u64() {
                on_ready(app, port as u16);
            }
        }
        Some("status") => on_status(app, &msg),
        Some("notify") => {
            let _ = app
                .notification()
                .builder()
                .title(msg["title"].as_str().unwrap_or("Seatbelt"))
                .body(msg["body"].as_str().unwrap_or(""))
                .show();
        }
        _ => {}
    }
}

/// Start the Seatbelt server with the bundled Node, and restart it a few times if it dies.
fn start_server(app: &AppHandle) -> tauri::Result<()> {
    let (script, data_dir) = if cfg!(debug_assertions) {
        // `tauri dev`: run straight from the repo, like `pnpm start`.
        let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        (repo.join("src").join("server.js"), None)
    } else {
        let res = app.path().resource_dir()?.join("app");
        (res.join("src").join("server.js"), Some(app.path().app_data_dir()?))
    };

    let mut cmd = app
        .shell()
        .sidecar("node")
        .map_err(|e| tauri::Error::Anyhow(e.into()))?
        .arg(script)
        .env("SEATBELT_DESKTOP", "1")
        .env("PORT", "0");
    if let Some(dir) = data_dir {
        cmd = cmd.env("SEATBELT_DATA_DIR", dir);
    }
    let (mut rx, child) = cmd.spawn().map_err(|e| tauri::Error::Anyhow(e.into()))?;
    *app.state::<Monitor>().child.lock().unwrap() = Some(child);

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut pending = String::new();
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    pending.push_str(&String::from_utf8_lossy(&bytes));
                    while let Some(i) = pending.find('\n') {
                        let line: String = pending.drain(..=i).collect();
                        handle_line(&app, &line);
                    }
                }
                CommandEvent::Stderr(bytes) => eprint!("{}", String::from_utf8_lossy(&bytes)),
                CommandEvent::Terminated(status) => {
                    let state = app.state::<Monitor>();
                    *state.child.lock().unwrap() = None;
                    if *state.quitting.lock().unwrap() {
                        return;
                    }
                    eprintln!("Seatbelt server stopped ({:?})", status.code);
                    let tries = {
                        let mut r = state.restarts.lock().unwrap();
                        *r += 1;
                        *r
                    };
                    if let Some(tray) = app.tray_by_id(TRAY_ID) {
                        let _ = tray.set_tooltip(Some("Seatbelt stopped watching"));
                    }
                    if tries <= MAX_RESTARTS {
                        tokio::time::sleep(Duration::from_secs(2)).await;
                        let _ = start_server(&app);
                    } else {
                        let _ = app
                            .notification()
                            .builder()
                            .title("Seatbelt stopped watching")
                            .body("Its monitor keeps crashing. Quit and reopen Seatbelt.")
                            .show();
                    }
                    return;
                }
                _ => {}
            }
        }
    });
    Ok(())
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open dashboard", true, None::<&str>)?;
    let login = CheckMenuItem::with_id(
        app,
        "login",
        "Open at login",
        true,
        app.autolaunch().is_enabled().unwrap_or(false),
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit Seatbelt", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&open, &PredefinedMenuItem::separator(app)?, &login, &PredefinedMenuItem::separator(app)?, &quit],
    )?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(ICON_OK)?)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Seatbelt is starting…")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "open" => show_dashboard(app),
            "login" => {
                let auto = app.autolaunch();
                let on = auto.is_enabled().unwrap_or(false);
                let _ = if on { auto.disable() } else { auto.enable() };
                let _ = login.set_checked(auto.is_enabled().unwrap_or(!on));
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                toggle_panel(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn stop_server(app: &AppHandle) {
    let state = app.state::<Monitor>();
    *state.quitting.lock().unwrap() = true;
    let child = state.child.lock().unwrap().take();
    if let Some(child) = child {
        let _ = child.kill();
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_dashboard(app)))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .manage(Monitor::default())
        .invoke_handler(tauri::generate_handler![open_dashboard])
        .setup(|app| {
            // A menu bar app: no Dock icon until the dashboard window is open.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            build_tray(app)?;
            start_server(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| match (window.label(), event) {
            (PANEL, WindowEvent::Focused(false)) => {
                if window.is_visible().unwrap_or(false) {
                    *window.app_handle().state::<Monitor>().panel_blurred_at.lock().unwrap() = Some(Instant::now());
                    let _ = window.hide();
                }
            }
            (DASHBOARD, WindowEvent::CloseRequested { api, .. }) => {
                // Keep it around (and keep watching); just hide it and drop the Dock icon.
                api.prevent_close();
                let _ = window.hide();
                set_dock_visible(window.app_handle(), false);
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while building Seatbelt")
        .run(|app, event| match event {
            // Closing windows never quits a tray app; only "Quit Seatbelt" does.
            RunEvent::ExitRequested { code: None, api, .. } => api.prevent_exit(),
            RunEvent::Exit => stop_server(app),
            _ => {}
        });
}
