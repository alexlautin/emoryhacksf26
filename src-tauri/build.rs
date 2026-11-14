fn main() {
    // The menu calls these three commands. Naming them here is what creates the
    // allow-open-dashboard, allow-quit-app and allow-resize-panel permissions
    // that capabilities/default.json grants. A build that does not list them
    // stops, because those names are not core permissions.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["open_dashboard", "quit_app", "resize_panel"]),
        ),
    )
    .expect("failed to run tauri-build");
}
