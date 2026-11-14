// Harness desktop app: a menu bar (macOS) / system tray (Windows) app around the Harness server.
//
// The server is the same Node program as `pnpm start`. The app ships its own Node binary
// (a Tauri "sidecar"), starts the server on a free port, and reads one-line JSON messages it
// prints to stdout (see src/desktop.js) to keep the tray icon, its title and notifications current,
// and sends it commands from the tray menu on stdin.
// Clicking the tray icon opens a small panel under it; "Open dashboard" opens the full window.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent, Wry};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_positioner::{Position, WindowExt};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const TRAY_ID: &str = "harness";
const PANEL: &str = "panel";
const DASHBOARD: &str = "dashboard";
const MAX_RESTARTS: u32 = 3;
/// Claude Code hooks (`pnpm protect`) look for Harness here. The server falls back to a free
/// port if something else is using it.
const PREFERRED_PORT: &str = "4100";
const LEVELS: [(&str, &str); 3] = [("off", "Off"), ("dangerous", "Dangerous only"), ("risky", "Anything risky")];
const DISPLAYS: [(&str, &str); 4] = [("score", "Score"), ("icon", "Icon only"), ("agents", "Agent count"), ("alerts", "Alert count")];

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
    /// The Auto-protect menu's check items, by level, so status updates can tick the right one.
    levels: Mutex<Vec<(String, CheckMenuItem<Wry>)>>,
    /// What the menu bar item itself shows: score, icon, agents, or alerts.
    displays: Mutex<Vec<(String, CheckMenuItem<Wry>)>>,
}

/// Send one command to the server (see src/desktop.js for the list).
fn send(app: &AppHandle, cmd: Value) -> bool {
    match app.state::<Monitor>().child.lock().unwrap().as_mut() {
        Some(child) => child.write(format!("{cmd}\n").as_bytes()).is_ok(),
        None => false,
    }
}

fn pick_folder(app: &AppHandle, title: &str, cmd: &'static str) {
    let app2 = app.clone();
    app.dialog().file().set_title(title).pick_folder(move |dir| {
        if let Some(path) = dir.and_then(|d| d.into_path().ok()) {
            send(&app2, serde_json::json!({ "cmd": cmd, "dir": path }));
        }
    });
}

/// Ask first, then have the server take Harness's hooks and decoy files off this computer.
/// The server answers with "uninstalled" and `finish_uninstall` does the rest.
fn begin_uninstall(app: &AppHandle) {
    let app2 = app.clone();
    app.dialog()
        .message(
            "This removes Harness's Claude Code hooks from every folder you protected, deletes its decoy files, \
             its settings and history, and its login item, then moves Harness to the Trash (Windows: runs its uninstaller).\n\n\
             Without this step, Claude Code would stay blocked in protected folders once Harness is gone.",
        )
        .title("Uninstall Harness?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("Uninstall".into(), "Cancel".into()))
        .show(move |confirmed| {
            // Without the server nothing can remove the hooks, so say so instead of doing nothing.
            if confirmed && !send(&app2, serde_json::json!({ "cmd": "uninstall" })) {
                app2.dialog()
                    .message("Harness's monitor isn't running, so it can't remove its Claude Code hooks yet. Quit and reopen Harness, then try again. Nothing was uninstalled.")
                    .title("Can't uninstall yet")
                    .kind(MessageDialogKind::Error)
                    .show(|_| {});
            }
        });
}

/// The server has cleaned up. Stop it, remove what the app itself left (login item, data, caches), then the app.
/// If the hooks couldn't all be removed, stop here and say so: the app stays so you can try again.
fn finish_uninstall(app: &AppHandle, ok: bool, summary: &str) {
    if !ok {
        app.dialog()
            .message(format!("Harness could not remove everything, so it was left installed.\n\n{summary}"))
            .title("Uninstall incomplete")
            .kind(MessageDialogKind::Error)
            .show(|_| {});
        return;
    }
    let _ = app.autolaunch().disable();
    stop_server(app);

    let paths = app.path();
    let mut dirs: Vec<std::path::PathBuf> = [paths.app_data_dir(), paths.app_cache_dir(), paths.app_local_data_dir(), paths.app_log_dir()]
        .into_iter()
        .flatten()
        .collect();
    if let Ok(data) = paths.app_data_dir() {
        if let Some(parent) = data.parent() {
            // Folders from before the Lookout and Seatbelt names became Harness.
            dirs.extend(["dev.lookout.monitor", "dev.seatbelt.monitor"].map(|name| parent.join(name)));
        }
    }
    #[cfg(target_os = "macos")]
    if let Ok(home) = paths.home_dir() {
        let lib = home.join("Library");
        dirs.extend(["WebKit", "HTTPStorages", "Saved Application State"].map(|d| lib.join(d).join("dev.harness.monitor")));
        let _ = std::fs::remove_file(lib.join("Preferences").join("dev.harness.monitor.plist"));
    }
    for dir in dirs {
        let _ = std::fs::remove_dir_all(dir);
    }

    remove_app_itself();
    app.exit(0);
}

/// macOS: move the app bundle to the Trash through Finder. Windows: run the installer's uninstaller.
/// `tauri dev` runs a loose binary, which is left alone.
fn remove_app_itself() {
    if cfg!(debug_assertions) {
        return;
    }
    let Ok(exe) = std::env::current_exe() else { return };
    #[cfg(target_os = "macos")]
    if let Some(bundle) = exe.ancestors().nth(3).filter(|p| p.extension().is_some_and(|e| e == "app")) {
        let path = bundle.display().to_string().replace('\\', "\\\\").replace('"', "\\\"");
        let _ = std::process::Command::new("osascript")
            .args(["-e", &format!("tell application \"Finder\" to delete POSIX file \"{path}\"")])
            .spawn();
    }
    #[cfg(windows)]
    if let Some(uninstaller) = exe.parent().map(|dir| dir.join("uninstall.exe")).filter(|p| p.exists()) {
        let _ = std::process::Command::new(uninstaller).spawn();
    }
    let _ = exe;
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
    // On Windows, building a window on the thread that handles tray, menu and command events
    // deadlocks it: a white window that can't be closed. Build it from another thread.
    let app = app.clone();
    std::thread::spawn(move || {
        let builder = WebviewWindowBuilder::new(&app, DASHBOARD, u)
            .title("Harness")
            .inner_size(1200.0, 860.0)
            .min_inner_size(420.0, 500.0);
        // On macOS the sidebar runs up under the window buttons, like Finder or Mail.
        // The page leaves room for them and marks its toolbar as the drag area.
        // Windows keeps its standard title bar.
        #[cfg(target_os = "macos")]
        let builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(18.0, 20.0));
        let _ = builder.build();
    });
}

#[tauri::command]
fn open_dashboard(app: AppHandle) {
    show_dashboard(&app);
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// The panel asks for this after it lays out, so the window matches the menu instead of leaving a gap.
#[tauri::command]
fn resize_panel(app: AppHandle, height: f64) {
    let Some(panel) = app.get_webview_window(PANEL) else { return };
    let h = height.clamp(180.0, 640.0);
    let _ = panel.set_size(tauri::Size::Logical(tauri::LogicalSize::new(280.0, h)));
    if panel.is_visible().unwrap_or(false) {
        #[cfg(target_os = "macos")]
        let _ = panel.move_window(Position::TrayBottomCenter);
        #[cfg(not(target_os = "macos"))]
        let _ = panel.move_window(Position::TrayCenter);
    }
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
        .title("Harness")
        .inner_size(280.0, 480.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build();
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some("Harness is watching"));
    }
}

fn menu_bar_title(mode: &str, score: u64, active: u64, alerts: u64) -> Option<String> {
    match mode {
        "icon" => None,
        "agents" => Some(active.to_string()),
        "alerts" => {
            if alerts == 0 {
                None
            } else {
                Some(alerts.to_string())
            }
        }
        _ => Some(score.to_string()),
    }
}

fn on_status(app: &AppHandle, msg: &Value) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    let paused = msg["paused"].as_array().map(|a| a.len()).unwrap_or(0);
    let active = msg["active"].as_u64().unwrap_or(0);
    let score = msg["score"].as_u64().unwrap_or(100);
    let alerts = msg["alerts"].as_u64().unwrap_or(paused as u64);
    let mode = msg["menuBarDisplay"].as_str().unwrap_or("score");
    if let Some(level) = msg["autoProtect"].as_str() {
        for (id, item) in app.state::<Monitor>().levels.lock().unwrap().iter() {
            let _ = item.set_checked(id == level);
        }
    }
    for (id, item) in app.state::<Monitor>().displays.lock().unwrap().iter() {
        let _ = item.set_checked(id == mode);
    }

    // Monitors that stopped working (for example "Process watch stalled").
    let degraded: Vec<&str> = msg["degraded"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();
    let alert = alerts > 0 || paused > 0 || !degraded.is_empty();
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
    let _ = tray.set_title(menu_bar_title(mode, score, active, alerts));
    let sessions = match active {
        0 => "no agents running".to_string(),
        1 => "1 agent running".to_string(),
        n => format!("{n} agents running"),
    };
    let extra = if alerts > 0 { format!(", {alerts} alerts") } else { String::new() };
    let tooltip = if degraded.is_empty() {
        format!("Harness: {score} / 100, {sessions}{extra}")
    } else {
        format!("Harness is not fully watching: {}. {score} / 100, {sessions}{extra}", degraded.join(", "))
    };
    let _ = tray.set_tooltip(Some(tooltip));
}

fn handle_line(app: &AppHandle, line: &str) {
    let trimmed = line.trim();
    let Some(json) = trimmed.strip_prefix("@@harness ").or_else(|| trimmed.strip_prefix("@@lookout ")).or_else(|| trimmed.strip_prefix("@@seatbelt ")) else { return };
    let Ok(msg) = serde_json::from_str::<Value>(json) else { return };
    match msg["type"].as_str() {
        Some("ready") => {
            if let Some(port) = msg["port"].as_u64() {
                on_ready(app, port as u16);
            }
        }
        Some("status") => on_status(app, &msg),
        Some("uninstalled") => finish_uninstall(app, msg["ok"].as_bool().unwrap_or(false), msg["summary"].as_str().unwrap_or("")),
        Some("notify") => {
            let _ = app
                .notification()
                .builder()
                .title(msg["title"].as_str().unwrap_or("Harness"))
                .body(msg["body"].as_str().unwrap_or(""))
                .show();
        }
        _ => {}
    }
}

/// On Windows, Tauri can hand back `\\?\C:\...` paths. Node fails to start from those
/// (`EISDIR: lstat 'C:'`), so drop the prefix before passing a path to it.
fn plain_path(p: std::path::PathBuf) -> std::path::PathBuf {
    #[cfg(windows)]
    {
        if let Some(rest) = p.to_str().and_then(|s| s.strip_prefix(r"\\?\")) {
            if !rest.starts_with("UNC\\") {
                return std::path::PathBuf::from(rest);
            }
        }
    }
    p
}

/// Start the Harness server with the bundled Node, and restart it a few times if it dies.
fn start_server(app: &AppHandle) -> tauri::Result<()> {
    let (script, data_dir) = if cfg!(debug_assertions) {
        // `tauri dev`: run straight from the repo, like `pnpm start`.
        let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        (repo.join("src").join("server.js"), None)
    } else {
        let res = app.path().resource_dir()?.join("app");
        (res.join("src").join("server.js"), Some(app.path().app_data_dir()?))
    };
    let (script, data_dir) = (plain_path(script), data_dir.map(plain_path));

    let mut cmd = app
        .shell()
        .sidecar("node")
        .map_err(|e| tauri::Error::Anyhow(e.into()))?
        .arg(script)
        .env("HARNESS_DESKTOP", "1")
        .env("PORT", PREFERRED_PORT);
    if let Some(dir) = data_dir {
        cmd = cmd.env("HARNESS_DATA_DIR", dir);
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
                    eprintln!("Harness server stopped ({:?})", status.code);
                    let tries = {
                        let mut r = state.restarts.lock().unwrap();
                        *r += 1;
                        *r
                    };
                    if let Some(tray) = app.tray_by_id(TRAY_ID) {
                        let _ = tray.set_tooltip(Some("Harness stopped watching"));
                    }
                    if tries <= MAX_RESTARTS {
                        tokio::time::sleep(Duration::from_secs(2)).await;
                        let _ = start_server(&app);
                    } else {
                        let _ = app
                            .notification()
                            .builder()
                            .title("Harness stopped watching")
                            .body("Its monitor keeps crashing. Quit and reopen Harness.")
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
    let open = MenuItem::with_id(app, "open", "Open Dashboard", true, Some("CmdOrCtrl+O"))?;
    let login = CheckMenuItem::with_id(
        app,
        "login",
        "Open at login",
        true,
        app.autolaunch().is_enabled().unwrap_or(false),
        None::<&str>,
    )?;
    let uninstall = MenuItem::with_id(app, "uninstall", "Uninstall Harness…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Harness", true, Some("CmdOrCtrl+Q"))?;

    let mut levels = Vec::new();
    for (id, label) in LEVELS {
        levels.push((id.to_string(), CheckMenuItem::with_id(app, format!("level:{id}"), label, true, id == "dangerous", None::<&str>)?));
    }
    let level_refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = levels.iter().map(|(_, i)| i as _).collect();
    let protect_level = Submenu::with_items(app, "Auto-protect", true, &level_refs)?;
    *app.state::<Monitor>().levels.lock().unwrap() = levels;

    let mut displays = Vec::new();
    for (id, label) in DISPLAYS {
        displays.push((id.to_string(), CheckMenuItem::with_id(app, format!("display:{id}"), label, true, id == "score", None::<&str>)?));
    }
    let display_refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = displays.iter().map(|(_, i)| i as _).collect();
    let display_menu = Submenu::with_items(app, "Menu bar shows", true, &display_refs)?;
    *app.state::<Monitor>().displays.lock().unwrap() = displays;

    let protect = MenuItem::with_id(app, "protect", "Protect a folder for Claude Code…", true, None::<&str>)?;
    let unprotect = MenuItem::with_id(app, "unprotect", "Stop protecting a folder…", true, None::<&str>)?;
    let demo = MenuItem::with_id(app, "demo", "Run demo attack", true, None::<&str>)?;
    let sep = || PredefinedMenuItem::separator(app);
    let menu = Menu::with_items(
        app,
        &[&open, &sep()?, &protect_level, &display_menu, &sep()?, &protect, &unprotect, &sep()?, &demo, &sep()?, &login, &uninstall, &sep()?, &quit],
    )?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(ICON_OK)?)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Harness is starting…")
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
            "uninstall" => begin_uninstall(app),
            "quit" => app.exit(0),
            "demo" => {
                send(app, serde_json::json!({ "cmd": "demo" }));
                show_dashboard(app);
            }
            "protect" => pick_folder(app, "Choose a folder to protect for Claude Code", "protect"),
            "unprotect" => pick_folder(app, "Choose a folder to stop protecting", "unprotect"),
            id => {
                if let Some(level) = id.strip_prefix("level:") {
                    send(app, serde_json::json!({ "cmd": "auto-protect", "level": level }));
                } else if let Some(mode) = id.strip_prefix("display:") {
                    send(app, serde_json::json!({ "cmd": "menu-bar", "mode": mode }));
                }
            }
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .manage(Monitor::default())
        .invoke_handler(tauri::generate_handler![open_dashboard, quit_app, resize_panel])
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
        .expect("error while building Harness")
        .run(|app, event| match event {
            // Closing windows never quits a tray app; only "Quit Harness" does.
            RunEvent::ExitRequested { code: None, api, .. } => api.prevent_exit(),
            RunEvent::Exit => stop_server(app),
            _ => {}
        });
}
