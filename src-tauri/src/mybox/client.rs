// MYBOX Open API 의 HTTP 와이어 포맷을 다루는 유일한 파일.
//
// 주의: 작성 시점에 developers.mybox.naver.com 원문을 확인하지 못했다
// (docs/mybox-upload-design.md 0장 참고). 인증 헤더 형식과 응답 구조는
// 서드파티 SDK 설명에서 재구성한 것이므로 실측으로 검증해야 한다.
// 그래서 이 모듈은 (1) API 주소를 설정으로 바꿀 수 있게 하고,
// (2) 실패 시 서버 응답 원문을 그대로 올려보내 진단할 수 있게 한다.

use std::sync::OnceLock;
use std::time::Duration;

pub const DEFAULT_API_BASE: &str = "https://open-api.mybox.naver.com/v1";

static HTTP: OnceLock<reqwest::Client> = OnceLock::new();

fn http() -> &'static reqwest::Client {
    HTTP.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("HTTP 클라이언트 초기화 실패")
    })
}

/// API 주소 검증. 토큰이 임의의 호스트로 새어나가지 않도록 https 만 허용한다.
/// (localhost 는 목 서버로 스펙을 검증할 때 필요해서 http 도 허용)
pub fn validate_api_base(base: &str) -> Result<String, String> {
    let base = base.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("API 주소가 비어 있습니다.".into());
    }
    let is_local = base.starts_with("http://127.0.0.1")
        || base.starts_with("http://localhost");
    if !base.starts_with("https://") && !is_local {
        return Err("API 주소는 https:// 로 시작해야 합니다.".into());
    }
    Ok(base.to_string())
}

#[derive(Debug)]
pub struct ApiError {
    pub status: Option<u16>,
    pub message: String,
    /// 서버 응답 원문(잘라냄). 진단용이며 토큰은 절대 포함되지 않는다.
    pub body: Option<String>,
}

impl ApiError {
    fn net(message: String) -> Self {
        ApiError { status: None, message, body: None }
    }
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(n).collect();
        out.push_str("…");
        out
    }
}

/// 응답 본문이 JSON 이 아니라 HTML 페이지인지 판별한다.
/// API 주소 대신 웹 서비스 주소를 넣었을 때를 구분해 안내하기 위한 것.
fn looks_like_html(body: &str) -> bool {
    let head: String = body.trim_start().chars().take(200).collect::<String>().to_lowercase();
    head.starts_with("<!doctype html") || head.starts_with("<html") || head.starts_with("<?xml")
}

/// GET {base}/drive/storage — 용량 조회.
/// 1단계에서 토큰 유효성 검증에도 이 호출을 그대로 쓴다.
/// 부수 효과가 없는 읽기 호출이라 검증용으로 가장 안전하다.
pub async fn get_storage(api_base: &str, token: &str) -> Result<serde_json::Value, ApiError> {
    let url = format!("{}/drive/storage", api_base);
    let resp = http()
        .get(&url)
        .bearer_auth(token)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() {
                ApiError::net(format!("MYBOX 서버에 연결할 수 없습니다 ({}). 네트워크를 확인해주세요.", url))
            } else if e.is_timeout() {
                ApiError::net("MYBOX 서버 응답 시간이 초과되었습니다.".to_string())
            } else {
                ApiError::net(format!("요청 실패: {}", e))
            }
        })?;

    let status = resp.status();
    let raw = resp
        .text()
        .await
        .map_err(|e| ApiError::net(format!("응답 본문 읽기 실패: {}", e)))?;

    if !status.is_success() {
        let code = status.as_u16();
        // 웹 페이지가 돌아왔다면 엔드포인트 문제가 아니라 주소 자체가 API 가 아니다.
        if looks_like_html(&raw) {
            return Err(ApiError {
                status: Some(code),
                message: format!(
                    "이 주소는 JSON API 가 아니라 웹 페이지를 반환했습니다 (HTTP {}). \
                     API 서버 주소가 아닌 것 같습니다 — 공식 문서의 요청 URL 을 확인해 고급 설정에서 바꿔주세요.",
                    code
                ),
                body: Some(truncate(&raw, 600)),
            });
        }
        let message = match code {
            401 => "토큰이 유효하지 않거나 만료되었습니다. MYBOX 웹에서 새 토큰을 발급받아 주세요.".to_string(),
            403 => "토큰에 이 작업을 수행할 권한이 없습니다.".to_string(),
            404 => format!(
                "엔드포인트를 찾을 수 없습니다 ({}). API 주소가 맞는지 확인해주세요.",
                url
            ),
            429 => "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.".to_string(),
            500..=599 => format!("MYBOX 서버 오류 (HTTP {}). 잠시 후 다시 시도해주세요.", code),
            _ => format!("MYBOX API 오류 (HTTP {})", code),
        };
        return Err(ApiError {
            status: Some(code),
            message,
            body: Some(truncate(&raw, 600)),
        });
    }

    serde_json::from_str(&raw).map_err(|e| ApiError {
        status: Some(status.as_u16()),
        message: if looks_like_html(&raw) {
            "이 주소는 JSON API 가 아니라 웹 페이지를 반환했습니다. API 서버 주소가 아닌 것 같습니다 — \
             공식 문서의 요청 URL 을 확인해 고급 설정에서 바꿔주세요."
                .to_string()
        } else {
            format!("응답 JSON 파싱 실패: {}", e)
        },
        body: Some(truncate(&raw, 600)),
    })
}

/// 응답에서 용량 필드를 꺼낸다.
/// 공식 문서를 확인하지 못해 래퍼 키(`data` / `result` / `storage`)로 한 겹
/// 감싸여 있을 가능성에 대비한다. 확인되면 이 함수는 단순화할 수 있다.
pub fn extract_u64(value: &serde_json::Value, key: &str) -> Option<u64> {
    fn as_u64(v: &serde_json::Value) -> Option<u64> {
        v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))
    }
    if let Some(v) = value.get(key).and_then(as_u64) {
        return Some(v);
    }
    for wrapper in ["data", "result", "storage", "drive"] {
        if let Some(v) = value.get(wrapper).and_then(|w| w.get(key)).and_then(as_u64) {
            return Some(v);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;

    /// 요청 한 건만 받고 정해진 응답을 돌려주는 최소 HTTP 서버.
    /// 반환값은 (base_url, 서버가 받은 요청 헤더).
    fn serve_once(status_line: &str, body: &str) -> (String, std::sync::mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind 실패");
        let port = listener.local_addr().unwrap().port();
        let (tx, rx) = std::sync::mpsc::channel();
        let response = format!(
            "{}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            status_line,
            body.len(),
            body
        );
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept 실패");
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut head = String::new();
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    break;
                }
                if line == "\r\n" {
                    break;
                }
                head.push_str(&line);
            }
            let _ = tx.send(head);
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
            let _ = stream.read(&mut [0u8; 1]);
        });
        (format!("http://127.0.0.1:{}", port), rx)
    }

    #[tokio::test]
    async fn sends_bearer_token_and_parses_storage() {
        let (base, rx) = serve_once(
            "HTTP/1.1 200 OK",
            r#"{"usedBytes":123,"quotaBytes":1000,"maxFileBytes":50}"#,
        );
        let value = get_storage(&base, "secret-token").await.expect("성공해야 함");

        let head = rx.recv().unwrap();
        assert!(
            head.contains("authorization: Bearer secret-token")
                || head.contains("Authorization: Bearer secret-token"),
            "Authorization 헤더가 없습니다: {}",
            head
        );
        assert!(head.starts_with("GET /drive/storage "), "경로가 다릅니다: {}", head);

        assert_eq!(extract_u64(&value, "usedBytes"), Some(123));
        assert_eq!(extract_u64(&value, "quotaBytes"), Some(1000));
        assert_eq!(extract_u64(&value, "maxFileBytes"), Some(50));
    }

    #[tokio::test]
    async fn maps_401_to_token_guidance_and_keeps_body() {
        let (base, _rx) = serve_once("HTTP/1.1 401 Unauthorized", r#"{"error":"invalid_token"}"#);
        let err = get_storage(&base, "bad").await.err().expect("실패해야 함");
        assert_eq!(err.status, Some(401));
        assert!(err.message.contains("만료"), "안내 문구가 다릅니다: {}", err.message);
        assert!(err.body.unwrap().contains("invalid_token"));
    }

    #[tokio::test]
    async fn reports_parse_failure_with_raw_body() {
        let (base, _rx) = serve_once("HTTP/1.1 200 OK", "{oops");
        let err = get_storage(&base, "t").await.err().expect("실패해야 함");
        assert!(err.message.contains("파싱"), "{}", err.message);
        assert!(err.body.unwrap().contains("{oops"));
    }

    /// 실제로 겪은 경우: api.mybox.naver.com 이 MyBox 웹 페이지를 404 로 돌려줬다.
    /// "엔드포인트를 찾을 수 없음"이 아니라 "API 주소가 아님"으로 안내해야 한다.
    #[tokio::test]
    async fn html_response_says_the_address_is_not_an_api() {
        let page = "<!DOCTYPE html><html><head><title>Drive</title></head><body></body></html>";
        for status_line in ["HTTP/1.1 404 Not Found", "HTTP/1.1 200 OK"] {
            let (base, _rx) = serve_once(status_line, page);
            let err = get_storage(&base, "t").await.err().expect("실패해야 함");
            assert!(
                err.message.contains("웹 페이지"),
                "{} 에서 안내가 다릅니다: {}",
                status_line,
                err.message
            );
            assert!(err.body.unwrap().contains("<title>Drive</title>"));
        }
    }

    #[test]
    fn looks_like_html_only_matches_markup() {
        assert!(looks_like_html("<!DOCTYPE html><html>"));
        assert!(looks_like_html("\n  <html lang=\"ko\">"));
        assert!(!looks_like_html(r#"{"usedBytes":1}"#));
        assert!(!looks_like_html(""));
    }

    #[test]
    fn extract_u64_unwraps_common_envelopes() {
        let flat = serde_json::json!({ "usedBytes": 5 });
        let wrapped = serde_json::json!({ "data": { "usedBytes": 5 } });
        let stringy = serde_json::json!({ "result": { "usedBytes": "5" } });
        for v in [flat, wrapped, stringy] {
            assert_eq!(extract_u64(&v, "usedBytes"), Some(5));
        }
        assert_eq!(extract_u64(&serde_json::json!({}), "usedBytes"), None);
    }

    #[test]
    fn api_base_rejects_plain_http_except_localhost() {
        assert!(validate_api_base("http://evil.example.com").is_err());
        assert!(validate_api_base("").is_err());
        assert_eq!(
            validate_api_base("https://open-api.mybox.naver.com/v1/").unwrap(),
            "https://open-api.mybox.naver.com/v1"
        );
        assert!(validate_api_base("http://127.0.0.1:8080").is_ok());
    }
}
