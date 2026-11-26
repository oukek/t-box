//! First-party loopback bridge. The Mac token never leaves this process through HTTP.
use crate::{authorize, Desktop};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::Read,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::State;
use tiny_http::{Header, Method, Request, Response, Server};
use uuid::Uuid;

const ADDRESS: &str = "127.0.0.1:17436";
const SITE: &str = "https://tboxos.cn";
const API: &str = "https://api.tboxos.cn/api/v1";
#[derive(Default)]
struct Identity {
    token: String,
    api: String,
    challenges: HashMap<String, (String, Instant)>,
}
pub struct LoginBridge {
    server: Option<Arc<Server>>,
    identity: Arc<Mutex<Identity>>,
}
impl Drop for LoginBridge {
    fn drop(&mut self) {
        if let Some(server) = &self.server {
            server.unblock();
        }
    }
}
fn allowed_origin(origin: &str) -> bool {
    origin == SITE
        || (cfg!(debug_assertions)
            && matches!(origin, "http://localhost:5173" | "http://127.0.0.1:5173"))
}
fn allowed_api(api: &str) -> bool {
    api == API || (cfg!(debug_assertions) && matches!(api, "http://127.0.0.1:6868/api/v1"))
}
fn header<'a>(request: &'a Request, name: &str) -> &'a str {
    request
        .headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str())
        .unwrap_or("")
}
fn respond(request: Request, status: u16, value: Value, origin: &str) {
    let mut response = Response::from_string(value.to_string()).with_status_code(status);
    for (name, value) in [
        ("Content-Type", "application/json"),
        ("Cache-Control", "no-store"),
        ("X-Content-Type-Options", "nosniff"),
        ("Vary", "Origin"),
    ] {
        response.add_header(Header::from_bytes(name, value).unwrap());
    }
    if allowed_origin(origin) {
        for (name, value) in [
            ("Access-Control-Allow-Origin", origin),
            ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
            ("Access-Control-Allow-Headers", "content-type, x-tbox-login"),
            ("Access-Control-Allow-Private-Network", "true"),
        ] {
            response.add_header(Header::from_bytes(name, value).unwrap());
        }
    }
    let _ = request.respond(response);
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Account {
    id: String,
    nickname: String,
    avatar_url: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Approval {
    id: String,
    secret: String,
    user_id: String,
    target: String,
    challenge: String,
}
fn consume(identity: &mut Identity, approval: &Approval) -> Result<(), String> {
    let (user, expires) = identity
        .challenges
        .remove(&approval.challenge)
        .ok_or("请重新识别 Mac 版账号")?;
    if identity.token.is_empty() || expires <= Instant::now() || user != approval.user_id {
        return Err("Mac 版账号已变化，请重新识别".into());
    }
    if !matches!(approval.target.as_str(), "browser" | "collector")
        || Uuid::parse_str(&approval.id).is_err()
        || approval.secret.len() != 64
        || !approval
            .secret
            .bytes()
            .all(|v| v.is_ascii_hexdigit() && !v.is_ascii_uppercase())
    {
        return Err("快捷登录请求无效".into());
    }
    Ok(())
}
fn handle(mut request: Request, host: &str, state: &Arc<Mutex<Identity>>, client: &Client) {
    let origin = header(&request, "Origin").to_string();
    let path = request.url().to_string();
    if header(&request, "Host") != host
        || !allowed_origin(&origin)
        || !matches!(path.as_str(), "/v1/account" | "/v1/approve")
    {
        respond(
            request,
            403,
            json!({"error":"不允许的本机登录请求"}),
            &origin,
        );
        return;
    }
    if request.method() == &Method::Options {
        respond(request, 204, Value::Null, &origin);
        return;
    }
    if header(&request, "X-Tbox-Login") != "1" {
        respond(
            request,
            403,
            json!({"error":"请从方舟登录页面操作"}),
            &origin,
        );
        return;
    }
    let result: Result<Value, String> = (|| {
        if path == "/v1/account" && request.method() == &Method::Get {
            let (token, api) = {
                let identity = state.lock().map_err(|_| "Mac 登录服务不可用")?;
                if identity.token.is_empty() {
                    return Err("请先在 Mac 版登录".into());
                }
                (identity.token.clone(), identity.api.clone())
            };
            let response = client
                .get(format!("{api}/auth/me"))
                .bearer_auth(&token)
                .send()
                .map_err(|_| "无法核实 Mac 版账号，请检查网络")?;
            if !response.status().is_success() {
                return Err("Mac 版登录已失效，请重新登录".into());
            }
            let mut body = String::new();
            response
                .take(65_536)
                .read_to_string(&mut body)
                .map_err(|_| "账号响应无效")?;
            let value: Value = serde_json::from_str(&body).map_err(|_| "账号响应无效")?;
            let account: Account =
                serde_json::from_value(value["data"].clone()).map_err(|_| "账号响应无效")?;
            let mut identity = state.lock().map_err(|_| "Mac 登录服务不可用")?;
            if identity.token != token {
                return Err("Mac 版账号已变化，请重新识别".into());
            }
            identity
                .challenges
                .retain(|_, (_, expiry)| *expiry > Instant::now());
            if identity.challenges.len() >= 16 {
                return Err("登录请求较多，请稍后重试".into());
            }
            let challenge = Uuid::new_v4().to_string();
            identity.challenges.insert(
                challenge.clone(),
                (account.id.clone(), Instant::now() + Duration::from_secs(90)),
            );
            return Ok(json!({"user":account,"challenge":challenge}));
        }
        if path != "/v1/approve"
            || request.method() != &Method::Post
            || header(&request, "Content-Type").split(';').next() != Some("application/json")
            || !request.body_length().is_some_and(|n| n <= 2048)
        {
            return Err("快捷登录请求无效".into());
        }
        let mut body = String::new();
        request
            .as_reader()
            .take(2049)
            .read_to_string(&mut body)
            .map_err(|_| "快捷登录请求无效")?;
        let approval: Approval = serde_json::from_str(&body).map_err(|_| "快捷登录请求无效")?;
        let (token, api) = {
            let mut identity = state.lock().map_err(|_| "Mac 登录服务不可用")?;
            consume(&mut identity, &approval)?;
            (identity.token.clone(), identity.api.clone())
        };
        let response = client.post(format!("{api}/auth/handoff/approve"))
            .bearer_auth(token).header("Content-Type", "application/json")
            .body(json!({"id":approval.id,"secret":approval.secret,"userId":approval.user_id,"target":approval.target}).to_string())
            .send().map_err(|_| "快捷登录连接失败，请重试")?;
        if !response.status().is_success() {
            return Err("快捷登录已失效，请重新识别 Mac 版账号".into());
        }
        Ok(json!({"approved":true}))
    })();
    match result {
        Ok(value) => respond(request, 200, value, &origin),
        Err(error) => respond(request, 409, json!({"error":error}), &origin),
    }
}
impl LoginBridge {
    pub fn start() -> Self {
        let identity = Arc::new(Mutex::new(Identity::default()));
        let server = Server::http(ADDRESS).ok().map(Arc::new);
        if let Some(server) = &server {
            let listener = Arc::clone(server);
            let state = Arc::clone(&identity);
            thread::spawn(move || {
                let Ok(client) = Client::builder()
                    .connect_timeout(Duration::from_secs(3))
                    .timeout(Duration::from_secs(8))
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                else {
                    return;
                };
                for request in listener.incoming_requests() {
                    handle(request, ADDRESS, &state, &client);
                }
            });
        }
        Self { server, identity }
    }
}
#[tauri::command]
pub fn desktop_login_identity(
    key: String,
    token: String,
    api: String,
    desktop: State<'_, Arc<Desktop>>,
    bridge: State<'_, LoginBridge>,
) -> Result<(), String> {
    authorize(&desktop, &key)?;
    if !allowed_api(&api)
        || (!token.is_empty()
            && (token.len() != 64
                || !token
                    .bytes()
                    .all(|v| v.is_ascii_hexdigit() && !v.is_ascii_uppercase())))
    {
        return Err("登录配置无效".into());
    }
    let mut identity = bridge.identity.lock().map_err(|_| "Mac 登录服务不可用")?;
    if identity.token != token || identity.api != api {
        identity.challenges.clear();
    }
    identity.token = token;
    identity.api = api;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn approval(challenge: &str) -> Approval {
        Approval {
            id: Uuid::new_v4().to_string(),
            secret: "a".repeat(64),
            user_id: "user".into(),
            target: "browser".into(),
            challenge: challenge.into(),
        }
    }
    #[test]
    fn exact_origin_and_api_only() {
        assert!(allowed_origin(SITE));
        for value in [
            "null",
            "https://evil.test",
            "https://tboxos.cn.evil.test",
            "http://tboxos.cn",
            "chrome-extension://abc",
        ] {
            assert!(!allowed_origin(value));
        }
        assert!(allowed_api(API));
        assert!(!allowed_api("https://api.tboxos.cn.evil.test/api/v1"));
    }
    #[test]
    fn challenge_is_single_use_and_account_bound() {
        let mut identity = Identity {
            token: "a".repeat(64),
            ..Identity::default()
        };
        identity.challenges.insert(
            "one".into(),
            ("user".into(), Instant::now() + Duration::from_secs(1)),
        );
        assert!(consume(&mut identity, &approval("one")).is_ok());
        assert!(consume(&mut identity, &approval("one")).is_err());
        identity.challenges.insert(
            "two".into(),
            ("other".into(), Instant::now() + Duration::from_secs(1)),
        );
        assert!(consume(&mut identity, &approval("two")).is_err());
        identity.challenges.insert(
            "old".into(),
            ("user".into(), Instant::now() - Duration::from_secs(1)),
        );
        assert!(consume(&mut identity, &approval("old")).is_err());
    }
    #[test]
    fn http_origin_host_preflight_and_token_isolation() {
        let upstream = Server::http("127.0.0.1:0").unwrap();
        let api = format!("http://{}", upstream.server_addr());
        let upstream_worker = thread::spawn(move || {
            let request = upstream.recv().unwrap();
            assert_eq!(
                header(&request, "Authorization"),
                format!("Bearer {}", "a".repeat(64))
            );
            request
                .respond(Response::from_string(
                    json!({"data":{"id":"user","nickname":"Mac test"}}).to_string(),
                ))
                .unwrap();
            let mut request = upstream.recv().unwrap();
            assert_eq!(request.url(), "/auth/handoff/approve");
            let mut body = String::new();
            request.as_reader().read_to_string(&mut body).unwrap();
            let body: Value = serde_json::from_str(&body).unwrap();
            assert_eq!(body["userId"], "user");
            assert_eq!(body["target"], "collector");
            request.respond(Response::empty(204)).unwrap();
        });
        let server = Server::http("127.0.0.1:0").unwrap();
        let host = server.server_addr().to_string();
        let base = format!("http://{host}");
        let state = Arc::new(Mutex::new(Identity {
            token: "a".repeat(64),
            api,
            challenges: HashMap::new(),
        }));
        let worker = thread::spawn(move || {
            let client = Client::builder()
                .timeout(Duration::from_secs(3))
                .build()
                .unwrap();
            for _ in 0..9 {
                handle(server.recv().unwrap(), &host, &state, &client);
            }
        });
        let client = Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let account = format!("{base}/v1/account");
        assert_eq!(client.get(&account).send().unwrap().status(), 403);
        assert_eq!(
            client
                .get(&account)
                .header("Origin", "https://evil.test")
                .send()
                .unwrap()
                .status(),
            403
        );
        assert_eq!(
            client
                .get(&account)
                .header("Origin", SITE)
                .header("Host", "evil.test")
                .send()
                .unwrap()
                .status(),
            403
        );
        let preflight = client
            .request(reqwest::Method::OPTIONS, &account)
            .header("Origin", SITE)
            .send()
            .unwrap();
        assert_eq!(preflight.status(), 204);
        assert_eq!(preflight.headers()["access-control-allow-origin"], SITE);
        assert_eq!(
            client
                .get(&account)
                .header("Origin", SITE)
                .send()
                .unwrap()
                .status(),
            403
        );
        let response = client
            .get(&account)
            .header("Origin", SITE)
            .header("X-Tbox-Login", "1")
            .send()
            .unwrap()
            .text()
            .unwrap();
        assert!(!response.contains(&"a".repeat(64)));
        let value: Value = serde_json::from_str(&response).unwrap();
        let mut body = json!({"id":Uuid::new_v4().to_string(),"secret":"b".repeat(64),"target":"collector","userId":"user","challenge":"wrong"});
        let send = |body: &Value| {
            client
                .post(format!("{base}/v1/approve"))
                .header("Origin", SITE)
                .header("X-Tbox-Login", "1")
                .header("Content-Type", "application/json")
                .body(body.to_string())
                .send()
                .unwrap()
        };
        assert_eq!(send(&body).status(), 409);
        body["challenge"] = value["challenge"].clone();
        let response = send(&body);
        assert_eq!(response.status(), 200);
        assert!(!response.text().unwrap().contains(&"a".repeat(64)));
        assert_eq!(send(&body).status(), 409);
        upstream_worker.join().unwrap();
        worker.join().unwrap();
    }
}
