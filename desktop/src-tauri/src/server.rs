use crate::packages::valid_file;
use std::{fs, net::SocketAddr, path::PathBuf, sync::Arc, thread};
use tiny_http::{Header, Method, Response, Server};
use uuid::Uuid;

fn content_security_policy(app_id: &str) -> String {
    // Only passive product media may contact external HTTPS origins. SDK/API and
    // executable resources keep the same isolation as other applications.
    let remote = if app_id == "shop-tools" {
        " https:"
    } else {
        ""
    };
    format!("default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:{remote}; connect-src 'self'; font-src 'self'; media-src 'self' blob:{remote}; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'")
}

pub struct PackageServer {
    server: Arc<Server>,
    pub url: String,
}
impl Drop for PackageServer {
    fn drop(&mut self) {
        self.server.unblock();
    }
}

impl PackageServer {
    pub fn start(dir: PathBuf, digest: &str, app_id: &str) -> Result<Self, String> {
        let server = Arc::new(Server::http("127.0.0.1:0").map_err(|_| "无法打开本地资源服务")?);
        let address: SocketAddr = server.server_addr().to_ip().ok_or("本地服务地址无效")?;
        let prefix = format!("/{}/{digest}/", Uuid::new_v4());
        let url = format!("http://{address}{prefix}");
        let listener = Arc::clone(&server);
        let policy = content_security_policy(app_id);
        thread::spawn(move || {
            for request in listener.incoming_requests() {
                let host = request
                    .headers()
                    .iter()
                    .find(|h| h.field.equiv("Host"))
                    .map(|h| h.value.as_str());
                let file = request
                    .url()
                    .split('?')
                    .next()
                    .and_then(|v| v.strip_prefix(&prefix))
                    .map(|v| if v.is_empty() { "index.html" } else { v });
                if request.method() != &Method::Get
                    || host != Some(address.to_string().as_str())
                    || !file.is_some_and(valid_file)
                {
                    let _ = request.respond(Response::empty(404));
                    continue;
                }
                let path = file.unwrap();
                if let Ok(bytes) = fs::read(dir.join(path)) {
                    let mime = mime_guess::from_path(path).first_or_octet_stream();
                    let mut response = Response::from_data(bytes);
                    for (name, value) in [
                        ("Content-Type", mime.as_ref()),
                        ("Cache-Control", "no-store"),
                        ("X-Content-Type-Options", "nosniff"),
                        ("Content-Security-Policy", policy.as_str()),
                    ] {
                        response.add_header(Header::from_bytes(name, value).unwrap());
                    }
                    let _ = request.respond(response);
                } else {
                    let _ = request.respond(Response::empty(404));
                }
            }
        });
        Ok(Self { server, url })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_commerce_can_load_remote_passive_media() {
        let policy = content_security_policy("shop-tools");
        assert!(policy.contains("img-src 'self' data: blob: https:"));
        assert!(policy.contains("media-src 'self' blob: https:"));
        assert!(policy.contains("connect-src 'self';"));
        assert!(policy.contains("script-src 'self';"));
        assert!(!content_security_policy("todo").contains("https:"));
        assert!(!content_security_policy("shop-tools-other").contains("https:"));
    }
    #[test]
    fn package_response_contains_media_policy() {
        let root = tempfile::tempdir().unwrap();
        fs::write(
            root.path().join("index.html"),
            "<img src='https://example.com/product.jpg'>",
        )
        .unwrap();
        let server =
            PackageServer::start(root.path().to_path_buf(), &"a".repeat(64), "shop-tools").unwrap();
        let response = reqwest::blocking::get(&server.url).unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(
            response.headers()["content-security-policy"],
            content_security_policy("shop-tools")
        );
    }
}
