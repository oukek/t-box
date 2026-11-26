fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "desktop_login_identity",
            "desktop_version",
            "check_system",
            "apply_system",
            "desktop_transfer",
            "system_ready",
            "prepare_package",
            "open_package",
            "remove_package",
        ]),
    ))
    .expect("build desktop shell");
}
