mod login_bridge;
use login_bridge::{desktop_login_identity, LoginBridge};
mod packages;
mod server;
mod system_ui;
mod system_update;
use system_update::{apply_system, check_system, desktop_transfer, system_ready, Updates};

use packages::Package;
use serde::Serialize;
use server::PackageServer;
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{ipc::Channel, Manager, State};
use uuid::Uuid;

struct Desktop {
    root: PathBuf,
    bundled: PathBuf,
    key: String,
    servers: Mutex<HashMap<PathBuf, PackageServer>>,
    writes: Mutex<()>,
}

fn origin() -> &'static str {
    option_env!("TBOX_ARTIFACT_ORIGIN").unwrap_or("https://apps.tboxos.cn")
}

fn authorize<'a>(desktop: &'a Desktop, key: &str) -> Result<&'a Desktop, String> {
    if key == desktop.key {
        Ok(desktop)
    } else {
        Err("仅允许方舟主窗口操作本地资源".into())
    }
}

fn bundled_package(state: &Desktop, pkg: &Package) -> Option<PathBuf> {
    let dir = pkg.directory(&state.bundled, origin()).ok()?;
    (fs::read_to_string(dir.with_extension("complete"))
        .ok()
        .as_deref()
        == Some(&pkg.digest)
        && dir.join("index.html").is_file())
    .then_some(dir)
}

#[tauri::command]
fn bundled_applications(key: String, state: State<'_, Arc<Desktop>>) -> Result<String, String> {
    authorize(&state, &key)?;
    fs::read_to_string(state.bundled.join("index.json")).map_err(|_| "未找到内置应用目录".into())
}

#[tauri::command]
fn desktop_version(
    key: String,
    state: State<'_, Arc<Desktop>>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    authorize(&state, &key)?;
    Ok(app.package_info().version.to_string())
}

#[derive(Clone, Serialize)]
struct Progress {
    completed: usize,
    total: usize,
    bytes: usize,
}

#[tauri::command]
async fn prepare_package(
    key: String,
    pkg: Package,
    progress: Channel<Progress>,
    state: State<'_, Arc<Desktop>>,
) -> Result<(), String> {
    authorize(&state, &key)?;
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let dir = pkg.directory(&state.root, origin())?;
        if packages::ready(&dir, &pkg.digest) || bundled_package(&state, &pkg).is_some() {
            return Ok(());
        }
        let _guard = state.writes.lock().map_err(|_| "资源缓存不可用")?;
        packages::prepare(&state.root, origin(), &pkg, |completed, total, bytes| {
            let _ = progress.send(Progress {
                completed,
                total,
                bytes,
            });
        })
    })
    .await
    .map_err(|_| "应用资源任务中断")?
}

#[tauri::command]
fn open_package(
    key: String,
    pkg: Package,
    state: State<'_, Arc<Desktop>>,
) -> Result<String, String> {
    authorize(&state, &key)?;
    let dir = pkg.directory(&state.root, origin())?;
    let dir = if packages::ready(&dir, &pkg.digest) {
        dir
    } else {
        bundled_package(&state, &pkg).ok_or("请先在应用市场下载或修复此版本")?
    };
    let mut servers = state.servers.lock().map_err(|_| "本地服务不可用")?;
    if let Some(server) = servers.get(&dir) {
        return Ok(server.url.clone());
    }
    let server = PackageServer::start(dir.clone(), &pkg.digest, &pkg.app_id)?;
    let url = server.url.clone();
    servers.insert(dir, server);
    Ok(url)
}

#[tauri::command]
async fn remove_package(
    key: String,
    pkg: Package,
    state: State<'_, Arc<Desktop>>,
) -> Result<(), String> {
    authorize(&state, &key)?;
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let dir = pkg.directory(&state.root, origin())?;
        let _guard = state.writes.lock().map_err(|_| "资源缓存不可用")?;
        state
            .servers
            .lock()
            .map_err(|_| "本地服务不可用")?
            .remove(&dir);
        if dir.exists() {
            fs::remove_dir_all(dir).map_err(|_| "移除资源失败")?;
        }
        Ok(())
    })
    .await
    .map_err(|_| "清理资源任务中断")?
}

fn main() {
    let mut context = tauri::generate_context!();
    let active = system_ui::Active::default();
    context.assets = Box::new(system_ui::UiAssets {
        embedded: context.assets,
        active: active.clone(),
    });
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            #[cfg(target_os = "macos")]
            let _ = app.show();
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            let menu = tauri::menu::Menu::default(app.handle())?;
            let inspector = tauri::menu::MenuItem::with_id(app, "developer-tools", "开发者工具", true, Some("CmdOrCtrl+Alt+I"))?;
            let developer = tauri::menu::Submenu::with_items(app, "开发", true, &[&inspector])?;
            menu.append(&developer)?;
            app.set_menu(menu)?;
            let system_dir = app.path().app_local_data_dir()?.join("system");
            app.manage(Updates::new(system_dir, active));
            app.state::<Updates>().boot(app.handle());
            app.manage(LoginBridge::start());
            let key = Uuid::new_v4().to_string();
            let root = app.path().app_local_data_dir()?.join("applications");
            app.manage(Arc::new(Desktop {
                root,
                bundled: app.path().resource_dir()?.join("applications"),
                key: key.clone(),
                servers: Mutex::default(),
                writes: Mutex::default(),
            }));
            let initialization = format!(
                "if (window === window.top && location.protocol === 'tauri:' && location.hostname === 'localhost') Object.defineProperty(window,'__TBOX_DESKTOP_KEY__',{{value:'{key}'}});"
            );
            tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .devtools(true)
                .initialization_script(initialization)
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_system,
            apply_system,
            desktop_transfer,
            system_ready,
            desktop_login_identity,
            desktop_version,
            bundled_applications,
            prepare_package,
            open_package,
            remove_package,
        ])
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "developer-tools" {
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_devtools_open() { window.close_devtools(); } else { window.open_devtools(); }
                }
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<Updates>().busy.load(std::sync::atomic::Ordering::Acquire) {
                    api.prevent_close();
                }
            }
        })
        .build(context)
        .expect("run T Ark")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { code, api, .. } = event {
                if app.state::<Updates>().prevents_exit(code)
                {
                    api.prevent_exit();
                }
            }
        });
}
