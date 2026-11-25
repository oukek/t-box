use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use std::{
    borrow::Cow,
    collections::BTreeMap,
    fs,
    io::Write,
    path::Path,
    sync::{Arc, RwLock},
};
use tauri::{
    utils::assets::{AssetKey, AssetsIter, CspHash},
    Assets, Wry,
};

pub type Files = BTreeMap<String, Vec<u8>>;
pub type Active = Arc<RwLock<Option<Files>>>;
pub struct UiAssets {
    pub embedded: Box<dyn Assets<Wry>>,
    pub active: Active,
}
impl Assets<Wry> for UiAssets {
    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        if let Some(files) = self.active.read().ok()?.as_ref() {
            return files
                .get(key.as_ref().trim_start_matches('/'))
                .cloned()
                .map(Cow::Owned);
        }
        self.embedded.get(key)
    }
    fn iter(&self) -> Box<AssetsIter<'_>> {
        self.embedded.iter()
    }
    fn csp_hashes(&self, key: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        self.embedded.csp_hashes(key)
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SignedUi {
    pub version: String,
    pub signature: String,
    pub digest: String,
}
#[derive(Deserialize)]
struct Bundle {
    version: String,
    protocol: u32,
    files: BTreeMap<String, String>,
}

pub fn unpack(bytes: &[u8], meta: &SignedUi, key: &str) -> Result<Files, String> {
    use sha2::{Digest, Sha256};
    if bytes.len() > 32 * 1024 * 1024 || format!("{:x}", Sha256::digest(bytes)) != meta.digest {
        return Err("界面包摘要不匹配".into());
    }
    let decode = |s: &str| {
        STANDARD
            .decode(s.trim())
            .ok()
            .and_then(|v| String::from_utf8(v).ok())
            .ok_or("签名编码无效")
    };
    let pk = PublicKey::decode(&decode(key)?).map_err(|_| "界面签名公钥无效")?;
    let signature = Signature::decode(&decode(&meta.signature)?).map_err(|_| "界面签名无效")?;
    pk.verify(bytes, &signature, false)
        .map_err(|_| "界面签名校验失败")?;
    let bundle: Bundle = serde_json::from_slice(bytes).map_err(|_| "界面包格式错误")?;
    if bundle.version != meta.version
        || bundle.protocol != 1
        || !bundle.files.contains_key("index.html")
        || bundle.files.len() > 4096
    {
        return Err("界面版本或桥接协议不兼容".into());
    }
    bundle
        .files
        .into_iter()
        .map(|(p, v)| {
            if !crate::packages::valid_file(&p) {
                return Err("界面资源路径无效".into());
            }
            Ok((p, STANDARD.decode(v).map_err(|_| "界面文件编码错误")?))
        })
        .collect()
}

pub fn atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or("更新目录无效")?;
    fs::create_dir_all(dir).map_err(|_| "无法创建更新目录")?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir).map_err(|_| "无法创建更新文件")?;
    tmp.write_all(bytes)
        .and_then(|_| tmp.as_file().sync_all())
        .map_err(|_| "无法保存更新文件")?;
    tmp.persist(path).map_err(|_| "无法提交更新文件")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    #[test]
    fn signed_ui_binds_content_and_version() {
        let bytes = include_bytes!("../tests/fixtures/broken.json");
        let key = include_str!("../tests/fixtures/ui.key.pub");
        let mut meta = SignedUi {
            version: "1.1.18".into(),
            digest: format!("{:x}", Sha256::digest(bytes)),
            signature: include_str!("../tests/fixtures/broken.json.sig").into(),
        };
        assert!(unpack(bytes, &meta, key)
            .unwrap()
            .contains_key("index.html"));
        meta.version = "1.1.19".into();
        assert!(unpack(bytes, &meta, key).is_err());
        let mut changed = bytes.to_vec();
        changed.push(b' ');
        meta.digest = format!("{:x}", Sha256::digest(&changed));
        assert!(unpack(&changed, &meta, key).is_err());
    }
}
