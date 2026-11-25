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
        if packages::ready(&dir, &pkg.digest) {
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
    if !packages::ready(&dir, &pkg.digest) {
        return Err("请先完成资源下载".into());
    }
    let mut servers = state.servers.lock().map_err(|_| "本地服务不可用")?;
    if let Some(server) = servers.get(&dir) {
        return Ok(server.url.clone());
    }
    let server = PackageServer::start(dir.clone(), &pkg.digest)?;
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
            let system_dir = app.path().app_local_data_dir()?.join("system");
            app.manage(Updates::new(system_dir, active));
            app.state::<Updates>().boot(app.handle());
            let key = Uuid::new_v4().to_string();
            let root = app.path().app_local_data_dir()?.join("applications");
            app.manage(Arc::new(Desktop {
                root,
                key: key.clone(),
                servers: Mutex::default(),
                writes: Mutex::default(),
            }));
            let initialization = format!(
                "if (window === window.top && location.protocol === 'tauri:' && location.hostname === 'localhost') Object.defineProperty(window,'__TBOX_DESKTOP_KEY__',{{value:'{key}'}});"
            );
            tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .initialization_script(initialization)
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_system,
            apply_system,
            desktop_transfer,
            system_ready,
            desktop_version,
            prepare_package,
            open_package,
            remove_package,
        ])
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
                if code != Some(tauri::RESTART_EXIT_CODE)
                    && app.state::<Updates>().busy.load(std::sync::atomic::Ordering::Acquire)
                {
                    api.prevent_exit();
                }
            }
        });
}
