use crate::packages::valid_file;
use std::{fs, net::SocketAddr, path::PathBuf, sync::Arc, thread};
use tiny_http::{Header, Method, Response, Server};
use uuid::Uuid;

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
    pub fn start(dir: PathBuf, digest: &str) -> Result<Self, String> {
        let server = Arc::new(Server::http("127.0.0.1:0").map_err(|_| "无法打开本地资源服务")?);
        let address: SocketAddr = server.server_addr().to_ip().ok_or("本地服务地址无效")?;
        let prefix = format!("/{}/{digest}/", Uuid::new_v4());
        let url = format!("http://{address}{prefix}");
        let listener = Arc::clone(&server);
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
                    for (name,value) in [("Content-Type",mime.as_ref()),("Cache-Control","no-store"),("X-Content-Type-Options","nosniff"),("Content-Security-Policy","default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'")] {
                        response.add_header(Header::from_bytes(name,value).unwrap());
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
