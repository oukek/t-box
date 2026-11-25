use crate::{
    authorize,
    system_ui::{self, Active, SignedUi},
    Desktop,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tauri_plugin_updater::UpdaterExt;

#[derive(Clone, Deserialize, Serialize)]
struct UiDownload {
    #[serde(flatten)]
    signed: SignedUi,
    url: String,
    bytes: Option<u64>,
}
#[derive(Clone, Deserialize, Serialize)]
struct Core {
    version: String,
    endpoint: String,
    bytes: Option<u64>,
}
#[derive(Clone, Deserialize, Serialize)]
struct Plan {
    id: uuid::Uuid,
    notes: String,
    ui: Option<UiDownload>,
    core: Option<Core>,
}
#[derive(Default, Clone, Serialize, Deserialize)]
struct Journal {
    active: Option<SignedUi>,
    last_release: Option<uuid::Uuid>,
    downloading: Option<uuid::Uuid>,
    pending: Option<Plan>,
    attempted: bool,
    message: String,
}
#[derive(Serialize, Clone)]
pub struct Offer {
    id: String,
    notes: String,
    ui: Option<String>,
    core: Option<String>,
}
#[derive(Serialize, Clone)]
pub struct Progress {
    phase: String,
    component: String,
    completed_bytes: u64,
    download_total: Option<u64>,
    bytes: u64,
    total: Option<u64>,
}
#[derive(Clone, Default, Serialize)]
pub struct Transfer {
    busy: bool,
    offer: Option<Offer>,
    progress: Option<Progress>,
    error: Option<String>,
}
#[tauri::command]
pub fn desktop_transfer(
    key: String,
    state: State<'_, Arc<Desktop>>,
    updates: State<'_, Updates>,
) -> Result<Transfer, String> {
    authorize(&state, &key)?;
    let mut snapshot = updates.transfer.lock().unwrap().clone();
    snapshot.busy = updates.busy.load(Ordering::Acquire);
    Ok(snapshot)
}
impl Plan {
    fn offer(&self) -> Offer {
        Offer {
            id: self.id.to_string(),
            notes: self.notes.clone(),
            ui: self.ui.as_ref().map(|u| u.signed.version.clone()),
            core: self.core.as_ref().map(|c| c.version.clone()),
        }
    }
}
pub struct Updates {
    transfer: Mutex<Transfer>,
    dir: PathBuf,
    assets: Active,
    journal: Mutex<Journal>,
    offer: Mutex<Option<Plan>>,
    pub busy: AtomicBool,
}

fn ui_key() -> &'static str {
    option_env!("TBOX_UI_PUBLIC_KEY").unwrap_or("")
}
fn valid_url(value: &str) -> Result<reqwest::Url, String> {
    let u = reqwest::Url::parse(value).map_err(|_| "更新地址无效")?;
    if u.scheme() != "https"
        && !(cfg!(debug_assertions) && u.scheme() == "http" && u.host_str() == Some("127.0.0.1"))
    {
        return Err("更新需要 HTTPS".into());
    }
    Ok(u)
}
fn newer(next: &str, current: &str) -> Result<bool, String> {
    fn parts(v: &str) -> Result<Vec<&str>, String> {
        let parts: Vec<_> = v.split('.').collect();
        if v.len() > 96
            || parts.len() != 3
            || parts.iter().any(|n| {
                n.is_empty()
                    || n.len() > 1 && n.starts_with('0')
                    || !n.bytes().all(|c| c.is_ascii_digit())
            })
        {
            return Err("版本号无效".into());
        }
        Ok(parts)
    }
    Ok(parts(next)?
        .iter()
        .map(|s| (s.len(), *s))
        .cmp(parts(current)?.iter().map(|s| (s.len(), *s)))
        .is_gt())
}
impl Updates {
    pub fn new(dir: PathBuf, assets: Active) -> Self {
        let journal = fs::read(dir.join("state.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        Self {
            transfer: Mutex::default(),
            dir,
            assets,
            journal: Mutex::new(journal),
            offer: Mutex::default(),
            busy: AtomicBool::new(false),
        }
    }
    fn save(&self, j: &Journal) -> Result<(), String> {
        system_ui::atomic(
            &self.dir.join("state.json"),
            &serde_json::to_vec(j).map_err(|_| "更新记录编码失败")?,
        )
    }
    fn load_ui(&self, meta: Option<&SignedUi>) -> Result<(), String> {
        let files = if let Some(m) = meta {
            if !crate::packages::valid_hash(&m.digest) {
                return Err("界面包标识无效".into());
            }
            Some(system_ui::unpack(
                &fs::read(self.dir.join(&m.digest)).map_err(|_| "找不到界面包")?,
                m,
                ui_key(),
            )?)
        } else {
            None
        };
        *self.assets.write().unwrap() = files;
        Ok(())
    }
    pub fn boot(&self, app: &AppHandle) {
        let mut j = self.journal.lock().unwrap();
        if j.downloading.take().is_some() && j.pending.is_none() {
            j.message = "上次更新下载中断，已保留当前版本。".into();
            let _ = self.save(&j);
        }
        if let Some(p) = j.pending.clone() {
            if !j.attempted
                && p.core
                    .as_ref()
                    .is_none_or(|c| c.version == app.package_info().version.to_string())
                && self
                    .load_ui(p.ui.as_ref().map(|u| &u.signed).or(j.active.as_ref()))
                    .is_ok()
            {
                j.attempted = true;
                if self.save(&j).is_ok() {
                    self.busy.store(true, Ordering::Release);
                    let id = p.id;
                    let handle = app.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_secs(25));
                        let state = handle.state::<Updates>();
                        let mut journal = state.journal.lock().unwrap();
                        if journal.pending.as_ref().is_some_and(|x| x.id == id) && journal.attempted
                        {
                            state.restore(&mut journal);
                            drop(journal);
                            if let Some(window) = handle.get_webview_window("main") {
                                let _ = window.reload();
                            }
                        }
                    });
                    return;
                }
            }
            self.restore(&mut j);
        } else if self.load_ui(j.active.as_ref()).is_err() {
            self.restore(&mut j);
        }
    }
    fn restore(&self, j: &mut Journal) {
        j.pending = None;
        j.attempted = false;
        if self.load_ui(j.active.as_ref()).is_err() {
            j.active = None;
            let _ = self.load_ui(None);
        }
        j.message = "上次更新未能启动，已恢复可用界面。".into();
        let _ = self.save(j);
        self.busy.store(false, Ordering::Release);
    }
}
#[tauri::command]
pub fn system_ready(
    key: String,
    version: String,
    state: State<'_, Arc<Desktop>>,
    updates: State<'_, Updates>,
) -> Result<String, String> {
    authorize(&state, &key)?;
    let mut j = updates.journal.lock().unwrap();
    if let Some(p) = j.pending.clone().filter(|_| j.attempted) {
        let mut completed = j.clone();
        if let Some(u) = p.ui {
            if version != u.signed.version {
                return Err("运行界面与目标版本不一致".into());
            }
            completed.active = Some(u.signed);
        }
        completed.last_release = Some(p.id);
        completed.pending = None;
        completed.attempted = false;
        completed.message = "更新完成".into();
        updates.save(&completed)?;
        *j = completed;
        updates.busy.store(false, Ordering::Release);
    }
    let message = std::mem::take(&mut j.message);
    if !message.is_empty() {
        updates.save(&j)?;
    }
    Ok(message)
}
#[tauri::command]
pub async fn check_system(
    key: String,
    ui: String,
    app: AppHandle,
    state: State<'_, Arc<Desktop>>,
    updates: State<'_, Updates>,
) -> Result<Option<Offer>, String> {
    authorize(&state, &key)?;
    if updates.busy.load(Ordering::Acquire) {
        return Err("正在更新".into());
    }
    let endpoint = option_env!("TBOX_UPDATE_ENDPOINT").ok_or("此构建尚未配置桌面更新渠道")?;
    let mut url = valid_url(endpoint)?;
    let core = app.package_info().version.to_string();
    url.query_pairs_mut()
        .append_pair("ui", &ui)
        .append_pair("core", &core)
        .append_pair("arch", std::env::consts::ARCH)
        .append_pair("platform", std::env::consts::OS);
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "无法初始化连接")?
        .get(url)
        .send()
        .await
        .map_err(|_| "无法连接更新服务")?;
    if response.status() == 204 {
        *updates.offer.lock().unwrap() = None;
        return Ok(None);
    }
    let bytes = response
        .error_for_status()
        .map_err(|_| "更新服务暂不可用")?
        .bytes()
        .await
        .map_err(|_| "无法读取更新计划")?;
    let mut p: Plan = serde_json::from_slice(&bytes).map_err(|_| "更新计划格式错误")?;
    if let Some(u) = &p.ui {
        if !newer(&u.signed.version, &ui)? {
            p.ui = None
        } else if !crate::packages::valid_hash(&u.signed.digest) || ui_key().is_empty() {
            return Err("缺少可信的界面签名配置".into());
        }
    }
    if let Some(c) = &p.core {
        if !newer(&c.version, &core)? {
            p.core = None
        }
    }
    if p.ui.is_none() && p.core.is_none() {
        *updates.offer.lock().unwrap() = None;
        return Ok(None);
    }
    let result = p.offer();
    *updates.offer.lock().unwrap() = Some(p);
    Ok(Some(result))
}

#[tauri::command]
pub async fn apply_system(
    key: String,
    id: String,
    progress: Channel<Progress>,
    app: AppHandle,
    state: State<'_, Arc<Desktop>>,
    updates: State<'_, Updates>,
) -> Result<(), String> {
    authorize(&state, &key)?;
    let p = updates
        .offer
        .lock()
        .unwrap()
        .clone()
        .filter(|p| p.id.to_string() == id)
        .ok_or("请重新检查更新")?;
    if updates.busy.swap(true, Ordering::AcqRel) {
        return Err("正在更新".into());
    }
    *updates.transfer.lock().unwrap() = Transfer {
        offer: Some(p.offer()),
        ..Default::default()
    };
    let ui_size = p.ui.as_ref().and_then(|u| u.bytes);
    let core_size = p.core.as_ref().and_then(|c| c.bytes);
    let mut ui_downloaded = 0;
    let send = |component: &str, phase: &str, bytes: u64, total: Option<u64>, previous: u64| {
        let download_total = if component == "core" {
            total.or(core_size).and_then(|n| previous.checked_add(n))
        } else if p.core.is_some() {
            total
                .or(ui_size)
                .zip(core_size)
                .and_then(|(a, b)| a.checked_add(b))
        } else {
            total.or(ui_size)
        };
        let event = Progress {
            component: component.into(),
            phase: phase.into(),
            bytes,
            total,
            completed_bytes: previous.saturating_add(bytes),
            download_total,
        };
        updates.transfer.lock().unwrap().progress = Some(event.clone());
        let _ = progress.send(event);
    };
    let result: Result<(), String> = async {
        {
            let mut journal = updates.journal.lock().unwrap();
            journal.downloading = Some(p.id);
            updates.save(&journal)?;
        }
        if let Some(u) = &p.ui {
            send("ui", "下载方舟界面", 0, ui_size, 0);
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(180))
                .build()
                .map_err(|_| "无法初始化下载")?;
            let mut r = client
                .get(valid_url(&u.url)?)
                .send()
                .await
                .map_err(|_| "界面下载失败")?
                .error_for_status()
                .map_err(|_| "界面下载失败")?;
            let total = r.content_length();
            let mut bytes = Vec::new();
            while let Some(chunk) = r.chunk().await.map_err(|_| "界面下载中断")? {
                if bytes.len() + chunk.len() > 32 * 1024 * 1024 {
                    return Err("界面包过大".into());
                }
                bytes.extend_from_slice(&chunk);
                send("ui", "下载方舟界面", bytes.len() as u64, total, 0);
            }
            ui_downloaded = bytes.len() as u64;
            send("ui", "校验方舟界面", ui_downloaded, Some(ui_downloaded), 0);
            system_ui::unpack(&bytes, &u.signed, ui_key())?;
            system_ui::atomic(&updates.dir.join(&u.signed.digest), &bytes)?;
        }
        let core = if let Some(c) = &p.core {
            send("core", "下载桌面核心", 0, core_size, ui_downloaded);
            let pubkey = option_env!("TBOX_CORE_PUBLIC_KEY").ok_or("缺少桌面核心签名公钥")?;
            let updater = app
                .updater_builder()
                .pubkey(pubkey)
                .endpoints(vec![valid_url(&c.endpoint)?])
                .map_err(|_| "核心更新地址无效")?
                .timeout(Duration::from_secs(180))
                .build()
                .map_err(|_| "核心更新配置无效")?;
            let candidate = updater
                .check()
                .await
                .map_err(|_| "无法读取核心更新")?
                .filter(|v| v.version == c.version)
                .ok_or("核心目标版本不匹配")?;
            valid_url(candidate.download_url.as_str())?;
            let n = std::sync::atomic::AtomicU64::new(0);
            let bytes = candidate
                .download(
                    |len, total| {
                        n.fetch_add(len as u64, Ordering::Relaxed);
                        send(
                            "core",
                            "下载桌面核心",
                            n.load(Ordering::Relaxed),
                            total,
                            ui_downloaded,
                        )
                    },
                    || {
                        send(
                            "core",
                            "校验桌面核心",
                            n.load(Ordering::Relaxed),
                            Some(n.load(Ordering::Relaxed)),
                            ui_downloaded,
                        )
                    },
                )
                .await
                .map_err(|_| "桌面核心下载或签名校验失败")?;
            Some((candidate, bytes))
        } else {
            None
        };
        {
            let mut j = updates.journal.lock().unwrap();
            j.downloading = None;
            j.pending = Some(p.clone());
            j.attempted = false;
            j.message.clear();
            updates.save(&j)?;
        }
        if let Some((candidate, bytes)) = core {
            send(
                "core",
                "正在安装，完成后自动重启",
                bytes.len() as u64,
                Some(bytes.len() as u64),
                ui_downloaded,
            );
            tauri::async_runtime::spawn_blocking(move || candidate.install(bytes))
                .await
                .map_err(|_| "安装任务中断")?
                .map_err(|_| "核心安装失败")?;
            app.request_restart();
        } else {
            updates.boot(&app);
            send("ui", "正在切换界面", ui_downloaded, Some(ui_downloaded), 0);
            app.get_webview_window("main")
                .ok_or("主窗口不可用")?
                .reload()
                .map_err(|_| "无法刷新界面")?;
        }
        Ok(())
    }
    .await;
    if let Err(ref cause) = result {
        updates.transfer.lock().unwrap().error = Some(cause.clone());
        let mut j = updates.journal.lock().unwrap();
        j.downloading = None;
        if j.pending.is_some() {
            updates.restore(&mut j);
        } else {
            let _ = updates.save(&j);
        }
        updates.busy.store(false, Ordering::Release);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::newer;
    #[test]
    fn compares_arbitrary_length_decimal_components() {
        assert!(newer("1.1.15", "1.1.9").unwrap());
        assert!(!newer("1.2.11", "1.3.0").unwrap());
        assert!(newer("1.999999999999999999999999.3", "1.10.0").unwrap());
        assert!(newer("1.01.0", "1.1.0").is_err());
    }
}
