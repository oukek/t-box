use reqwest::blocking::Client;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::Duration,
};

const MAX_FILE: usize = 5 * 1024 * 1024;
const MAX_PACKAGE: usize = 20 * 1024 * 1024;
const MAX_MANIFEST: usize = 1024 * 1024;
const COMPLETE: &str = ".complete";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Package {
    pub app_id: String,
    pub digest: String,
    pub entry_url: String,
}

pub fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

pub fn valid_file(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 240
        && path.split('/').all(|part| {
            !part.is_empty()
                && !part.starts_with('.')
                && part
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"._@-".contains(&c))
        })
}

impl Package {
    pub fn directory(&self, root: &Path, origin: &str) -> Result<PathBuf, String> {
        let source = reqwest::Url::parse(origin).map_err(|_| "桌面资源站地址无效")?;
        let local_test = cfg!(debug_assertions)
            && source.scheme() == "http"
            && source.host_str() == Some("127.0.0.1");
        if (!local_test && source.scheme() != "https")
            || source.origin().ascii_serialization() != origin
            || !source.username().is_empty()
            || source.password().is_some()
        {
            return Err("桌面资源站必须是受信任的 HTTPS 来源".into());
        }
        if self.app_id.is_empty()
            || self.app_id.len() > 64
            || !self.app_id.as_bytes()[0].is_ascii_lowercase()
            || !self
                .app_id
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"_-".contains(&c))
            || !valid_hash(&self.digest)
            || self.entry_url != format!("{origin}/{}/{}/", self.app_id, self.digest)
        {
            return Err("应用资源地址与已配置的发布源不一致".into());
        }
        Ok(root.join(&self.app_id).join(&self.digest))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    protocol: u32,
    app_id: String,
    digest: String,
    files: serde_json::Map<String, serde_json::Value>,
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn ready(dir: &Path, digest: &str) -> bool {
    fs::read_to_string(dir.join(COMPLETE)).ok().as_deref() == Some(digest)
        && dir.join("index.html").is_file()
}

fn download(client: &Client, url: &str, limit: usize) -> Result<Vec<u8>, String> {
    let response = client.get(url).send().map_err(|_| "无法连接应用资源站")?;
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|size| size > limit as u64)
    {
        return Err("应用资源下载失败或过大".into());
    }
    let mut bytes = Vec::new();
    response
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取应用资源失败")?;
    if bytes.len() > limit {
        return Err("应用资源超过大小限制".into());
    }
    Ok(bytes)
}

pub fn prepare(
    root: &Path,
    origin: &str,
    pkg: &Package,
    progress: impl Fn(usize, usize, usize),
) -> Result<(), String> {
    let dir = pkg.directory(root, origin)?;
    if ready(&dir, &pkg.digest) {
        return Ok(());
    }
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "无法初始化资源下载")?;
    let manifest: Manifest = serde_json::from_slice(&download(
        &client,
        &(pkg.entry_url.clone() + "artifact.json"),
        MAX_MANIFEST,
    )?)
    .map_err(|_| "应用资源清单无效")?;
    let count = manifest.files.len();
    if manifest.protocol != 1
        || manifest.app_id != pkg.app_id
        || manifest.digest != pkg.digest
        || count > 2000
        || !manifest.files.contains_key("index.html")
        || hash(&serde_json::to_vec(&manifest.files).map_err(|_| "清单无效")?) != pkg.digest
    {
        return Err("应用资源清单校验失败".into());
    }
    let parent = dir.parent().ok_or("目录无效")?;
    fs::create_dir_all(parent).map_err(|_| "无法创建缓存目录")?;
    let temp = tempfile::tempdir_in(parent).map_err(|_| "无法创建临时目录")?;
    let mut total = 0;
    progress(0, count, 0);
    for (i, (path, expected)) in manifest.files.iter().enumerate() {
        if !valid_file(path) || !expected.as_str().is_some_and(valid_hash) {
            return Err("应用资源路径或摘要无效".into());
        }
        let bytes = download(
            &client,
            &(pkg.entry_url.clone() + path),
            MAX_FILE.min(MAX_PACKAGE - total),
        )?;
        if Some(hash(&bytes).as_str()) != expected.as_str() {
            return Err("应用文件校验失败".into());
        }
        total += bytes.len();
        let target = temp.path().join(path);
        fs::create_dir_all(target.parent().unwrap())
            .and_then(|_| fs::write(target, bytes))
            .map_err(|_| "写入应用资源失败")?;
        progress(i + 1, count, total);
    }
    fs::write(temp.path().join(COMPLETE), &pkg.digest).map_err(|_| "无法保存完成标记")?;
    if !ready(&dir, &pkg.digest) {
        if dir.exists() {
            fs::remove_dir_all(&dir).map_err(|_| "无法修复损坏的缓存")?;
        }
        fs::rename(temp.path(), dir).map_err(|_| "无法启用应用资源")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::PackageServer;
    use tiny_http::{Response, Server};

    #[test]
    fn verifies_files_and_opens_previous_version_offline() {
        let root = tempfile::tempdir().unwrap();
        let source = Server::http("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", source.server_addr());
        let package = |html: &[u8]| {
            let files = serde_json::json!({"index.html": hash(html)});
            let digest = hash(&serde_json::to_vec(&files).unwrap());
            let manifest =
                serde_json::json!({"protocol":1,"appId":"todo","digest":digest,"files":files});
            (
                Package {
                    app_id: "todo".into(),
                    entry_url: format!("{origin}/todo/{digest}/"),
                    digest,
                },
                manifest.to_string(),
            )
        };
        let (first, manifest) = package(b"old");
        let (next, next_manifest) = package(b"new");
        let requests = std::thread::spawn(move || {
            for reply in [manifest, "old".into(), next_manifest, "corrupted".into()] {
                source
                    .recv_timeout(Duration::from_secs(10))
                    .unwrap()
                    .unwrap()
                    .respond(Response::from_string(reply))
                    .unwrap();
            }
        });
        prepare(root.path(), &origin, &first, |_, _, _| {}).unwrap();
        assert!(prepare(root.path(), &origin, &next, |_, _, _| {}).is_err());
        requests.join().unwrap();
        assert_eq!(fs::read_dir(root.path().join("todo")).unwrap().count(), 1);
        prepare(root.path(), &origin, &first, |_, _, _| {
            panic!("unexpected download")
        })
        .unwrap();
        let local = PackageServer::start(
            first.directory(root.path(), &origin).unwrap(),
            &first.digest,
        )
        .unwrap();
        assert_eq!(
            reqwest::blocking::get(&local.url).unwrap().text().unwrap(),
            "old"
        );
        assert!(!valid_file("../.complete"));
        assert!(first
            .directory(root.path(), "https://other.example")
            .is_err());
    }
}
