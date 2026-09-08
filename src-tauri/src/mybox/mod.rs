// MyBox 업로드 기능 — 1단계: 토큰 저장/검증 + 용량 조회.
// 전체 설계는 docs/mybox-upload-design.md 참고.
//
// 이 단계의 목적은 두 가지다.
//   1) 토큰을 안전하게 보관하는 경로를 확정한다 (OS 키체인).
//   2) 인증 헤더 형식과 API 주소가 실제로 맞는지 실측으로 검증한다.
// 그래서 실패 시 HTTP 상태 코드와 응답 원문을 화면까지 그대로 올려보낸다.

pub mod client;
pub mod token;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

/// 프론트엔드로 돌려보내는 오류. 1단계에서는 원인 진단이 중요하므로
/// 상태 코드와 응답 원문을 함께 싣는다. 토큰은 포함되지 않는다.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    message: String,
    status: Option<u16>,
    body: Option<String>,
}

impl From<String> for CommandError {
    fn from(message: String) -> Self {
        CommandError { message, status: None, body: None }
    }
}

impl From<client::ApiError> for CommandError {
    fn from(e: client::ApiError) -> Self {
        CommandError { message: e.message, status: e.status, body: e.body }
    }
}

type CmdResult<T> = Result<T, CommandError>;

/// 비밀이 아닌 설정만 담는다. 토큰 원문은 절대 여기 들어가지 않는다.
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Meta {
    api_base: Option<String>,
    masked_tail: Option<String>,
    last_verified_at_ms: Option<u64>,
    /// 마지막 호출이 401/403 이었는지. 재발급 안내를 띄우는 데 쓴다.
    invalid: bool,
}

fn meta_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("mybox.json")
}

fn load_meta(app: &tauri::AppHandle) -> Meta {
    fs::read_to_string(meta_path(app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_meta(app: &tauri::AppHandle, meta: &Meta) -> Result<(), String> {
    let path = meta_path(app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("설정 폴더 생성 실패: {}", e))?;
    }
    let json = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("설정 저장 실패: {}", e))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn effective_api_base(meta: &Meta) -> String {
    meta.api_base
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(client::DEFAULT_API_BASE)
        .to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenStatus {
    configured: bool,
    /// "••••••••abcd" 형태. 토큰 원문은 어떤 경우에도 반환하지 않는다.
    masked_tail: Option<String>,
    last_verified_at_ms: Option<u64>,
    invalid: bool,
    api_base: String,
    default_api_base: String,
    /// 키체인 자체에 접근하지 못한 경우의 사유.
    keychain_error: Option<String>,
}

fn status_from(meta: &Meta) -> TokenStatus {
    let (configured, keychain_error) = match token::load() {
        Ok(t) => (t.is_some(), None),
        Err(e) => (false, Some(e)),
    };
    TokenStatus {
        configured,
        masked_tail: if configured { meta.masked_tail.clone() } else { None },
        last_verified_at_ms: if configured { meta.last_verified_at_ms } else { None },
        invalid: configured && meta.invalid,
        api_base: effective_api_base(meta),
        default_api_base: client::DEFAULT_API_BASE.to_string(),
        keychain_error,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quota {
    used_bytes: Option<u64>,
    quota_bytes: Option<u64>,
    max_file_bytes: Option<u64>,
    /// 1단계 진단용 응답 원문. 스펙이 확정되면 제거한다.
    raw: serde_json::Value,
}

fn quota_from(raw: serde_json::Value) -> Quota {
    Quota {
        used_bytes: client::extract_u64(&raw, "usedBytes"),
        quota_bytes: client::extract_u64(&raw, "quotaBytes"),
        max_file_bytes: client::extract_u64(&raw, "maxFileBytes"),
        raw,
    }
}

#[tauri::command]
pub fn mybox_token_status(app: tauri::AppHandle) -> TokenStatus {
    let meta = load_meta(&app);
    status_from(&meta)
}

/// 토큰을 검증한 뒤에만 저장한다.
/// 검증은 부수 효과가 없는 `GET /drive/storage` 로 한다.
#[tauri::command]
pub async fn mybox_set_token(
    app: tauri::AppHandle,
    token_value: String,
    api_base: Option<String>,
) -> CmdResult<TokenStatus> {
    let token_value = token_value.trim().to_string();
    if token_value.is_empty() {
        return Err("토큰을 입력해주세요.".to_string().into());
    }

    let mut meta = load_meta(&app);
    let base = match api_base.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(b) => client::validate_api_base(b)?,
        None => effective_api_base(&meta),
    };

    // 저장보다 검증을 먼저 한다 — 잘못된 토큰이 키체인에 남지 않도록.
    client::get_storage(&base, &token_value).await?;

    token::store(&token_value)?;
    meta.api_base = Some(base);
    meta.masked_tail = Some(token::mask(&token_value));
    meta.last_verified_at_ms = Some(now_ms());
    meta.invalid = false;
    save_meta(&app, &meta)?;

    Ok(status_from(&meta))
}

/// 토큰은 그대로 두고 API 주소만 바꾼다.
/// 공식 문서와 대조하며 주소를 조정할 때 쓴다. 토큰이 있으면 새 주소로 재검증한다.
#[tauri::command]
pub async fn mybox_set_api_base(
    app: tauri::AppHandle,
    api_base: Option<String>,
) -> CmdResult<TokenStatus> {
    let mut meta = load_meta(&app);
    let base = match api_base.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(b) => client::validate_api_base(b)?,
        None => client::DEFAULT_API_BASE.to_string(),
    };

    if let Some(t) = token::load()? {
        client::get_storage(&base, &t).await?;
        meta.last_verified_at_ms = Some(now_ms());
        meta.invalid = false;
    }
    meta.api_base = Some(base);
    save_meta(&app, &meta)?;
    Ok(status_from(&meta))
}

#[tauri::command]
pub fn mybox_clear_token(app: tauri::AppHandle) -> CmdResult<TokenStatus> {
    token::delete()?;
    let mut meta = load_meta(&app);
    meta.masked_tail = None;
    meta.last_verified_at_ms = None;
    meta.invalid = false;
    save_meta(&app, &meta)?;
    Ok(status_from(&meta))
}

#[tauri::command]
pub async fn mybox_get_quota(app: tauri::AppHandle) -> CmdResult<Quota> {
    let mut meta = load_meta(&app);
    let stored = token::load()?
        .ok_or_else(|| CommandError::from("MyBox 토큰이 설정되지 않았습니다.".to_string()))?;
    let base = effective_api_base(&meta);

    match client::get_storage(&base, &stored).await {
        Ok(raw) => {
            meta.last_verified_at_ms = Some(now_ms());
            meta.invalid = false;
            let _ = save_meta(&app, &meta);
            Ok(quota_from(raw))
        }
        Err(e) => {
            // 401/403 은 토큰 문제로 확정하고 표시 상태를 바꾼다.
            if matches!(e.status, Some(401) | Some(403)) && !meta.invalid {
                meta.invalid = true;
                let _ = save_meta(&app, &meta);
            }
            Err(e.into())
        }
    }
}

/// 폴더 하나. 최상위 목록에서는 `item_type`, 경로 검색에서는 `path` 가 채워진다.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceEntry {
    name: String,
    resource_id: String,
    item_type: Option<String>,
    path: Option<String>,
}

/// "이 폴더가 Open API 로 보이는가"에 대한 답.
/// 공유 받은 폴더·암호 폴더는 Open API 로 보이지 않으므로, 업로드 대상이
/// 쓸 수 있는 폴더인지 판정하는 용도다. 읽기만 하고 아무것도 만들지 않는다.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderProbe {
    /// 조회한 경로. 빈 문자열이면 최상위 목록.
    query_path: String,
    found: bool,
    entries: Vec<ResourceEntry>,
    truncated: bool,
    raw: serde_json::Value,
}

const PROBE_ENTRY_LIMIT: usize = 300;

fn entries_from(raw: &serde_json::Value) -> (Vec<ResourceEntry>, bool) {
    let items = match client::extract_array(raw, "resources") {
        Some(a) => a,
        None => return (Vec::new(), false),
    };
    let truncated = items.len() > PROBE_ENTRY_LIMIT;
    let entries = items
        .iter()
        .take(PROBE_ENTRY_LIMIT)
        .filter_map(|v| {
            Some(ResourceEntry {
                name: v.get("name")?.as_str()?.to_string(),
                resource_id: v
                    .get("resourceId")
                    .and_then(|x| x.as_str())
                    .unwrap_or_default()
                    .to_string(),
                item_type: v.get("type").and_then(|x| x.as_str()).map(str::to_string),
                path: v.get("path").and_then(|x| x.as_str()).map(str::to_string),
            })
        })
        .collect();
    (entries, truncated)
}

/// 경로를 `/어류조사/20240815` 형태로 다듬는다. 빈 값이면 최상위 조회.
fn normalize_folder_path(path: Option<String>) -> String {
    let p = path.unwrap_or_default();
    let p = p.trim();
    if p.is_empty() {
        return String::new();
    }
    let trimmed = p.trim_end_matches('/');
    if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{}", trimmed)
    }
}

#[tauri::command]
pub async fn mybox_probe_folder(
    app: tauri::AppHandle,
    path: Option<String>,
) -> CmdResult<FolderProbe> {
    let meta = load_meta(&app);
    let stored = token::load()?
        .ok_or_else(|| CommandError::from("MyBox 토큰이 설정되지 않았습니다.".to_string()))?;
    let base = effective_api_base(&meta);
    let query_path = normalize_folder_path(path);

    let raw = if query_path.is_empty() {
        client::get_root_resources(&base, &stored).await?
    } else {
        client::search_folder_by_path(&base, &stored, &query_path).await?
    };

    let (entries, truncated) = entries_from(&raw);
    Ok(FolderProbe {
        found: !entries.is_empty(),
        query_path,
        entries,
        truncated,
        raw,
    })
}

#[cfg(test)]
mod tests {
    use super::normalize_folder_path;

    #[test]
    fn normalize_folder_path_shapes_input() {
        assert_eq!(normalize_folder_path(None), "");
        assert_eq!(normalize_folder_path(Some("   ".into())), "");
        assert_eq!(normalize_folder_path(Some("어류조사".into())), "/어류조사");
        assert_eq!(normalize_folder_path(Some("/어류조사/".into())), "/어류조사");
        assert_eq!(
            normalize_folder_path(Some(" /어류조사/20240815/ ".into())),
            "/어류조사/20240815"
        );
    }
}
