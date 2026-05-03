use base64::Engine;
use rand::seq::SliceRandom;
use rand::SeedableRng;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

const RAW_EXT: &[&str] = &[
    ".heic", ".heif",
    ".orf", ".ori",
    ".cr2", ".cr3",
    ".arw", ".arw2", ".srf", ".sr2",
    ".nef", ".nrw", ".nr2",
    ".dng",
    ".rw2",
    ".raf",
    ".pef", ".ptx",
];

const BROWSER_IMAGE_EXT: &[&str] = &[".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

const VIDEO_EXT: &[&str] = &[".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"];

fn is_raw_ext(ext: &str) -> bool {
    RAW_EXT.contains(&ext)
}

fn get_ext(name: &str) -> String {
    Path::new(name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
        .unwrap_or_default()
}

fn is_media_file(name: &str) -> bool {
    let ext = get_ext(name);
    BROWSER_IMAGE_EXT.contains(&ext.as_str()) || is_raw_ext(&ext) || VIDEO_EXT.contains(&ext.as_str())
}

#[tauri::command]
fn read_files(folder_path: String) -> Result<Vec<String>, String> {
    let entries =
        fs::read_dir(&folder_path).map_err(|e| format!("폴더 읽기 실패: {}", e))?;
    let mut files: Vec<String> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let ft = entry.file_type().ok()?;
            if ft.is_file() && is_media_file(&entry.file_name().to_string_lossy()) {
                Some(entry.file_name().to_string_lossy().to_string())
            } else {
                None
            }
        })
        .collect();
    files.sort();
    Ok(files)
}

#[derive(Serialize, Deserialize)]
struct OpResult {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[tauri::command]
fn rename_file(folder_path: String, old_name: String, new_name: String) -> OpResult {
    if old_name == new_name {
        return OpResult { success: true, error: None };
    }
    let old_path = Path::new(&folder_path).join(&old_name);
    let new_path = Path::new(&folder_path).join(&new_name);
    if new_path.exists() {
        return OpResult { success: false, error: Some("동일한 이름의 파일이 이미 존재합니다.".into()) };
    }
    match fs::rename(&old_path, &new_path) {
        Ok(()) => OpResult { success: true, error: None },
        Err(e) => OpResult { success: false, error: Some(e.to_string()) },
    }
}

#[tauri::command]
fn move_to_skip(folder_path: String, file_name: String) -> OpResult {
    let skip_dir = Path::new(&folder_path).join("Skip");
    let src = Path::new(&folder_path).join(&file_name);
    let dest = skip_dir.join(&file_name);
    if let Err(e) = fs::create_dir_all(&skip_dir) {
        return OpResult { success: false, error: Some(e.to_string()) };
    }
    match fs::rename(&src, &dest) {
        Ok(()) => OpResult { success: true, error: None },
        Err(e) => OpResult { success: false, error: Some(e.to_string()) },
    }
}

fn config_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    dir.join("defaults.json")
}

#[tauri::command]
fn load_defaults(app: tauri::AppHandle) -> Option<serde_json::Value> {
    let path = config_path(&app);
    let data = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

#[tauri::command]
fn save_defaults(app: tauri::AppHandle, defaults: serde_json::Value) -> Result<(), String> {
    let path = config_path(&app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&defaults).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

fn history_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    dir.join("history.json")
}

#[tauri::command]
fn load_history(app: tauri::AppHandle) -> Option<serde_json::Value> {
    let path = history_path(&app);
    let data = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

#[tauri::command]
fn save_history(app: tauri::AppHandle, history: serde_json::Value) -> Result<(), String> {
    let path = history_path(&app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&history).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn open_help(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("help") {
        let _ = existing.set_focus();
        return Ok(());
    }
    let _help = tauri::WebviewWindowBuilder::new(
        &app,
        "help",
        tauri::WebviewUrl::App("help.html".into()),
    )
    .title("사용 도움말 - File Arrange for Fish Class")
    .inner_size(560.0, 720.0)
    .resizable(true)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
struct Candidate {
    name: String,
    confidence: f32,
}

const REFERENCE_SAMPLES_PER_SPECIES: usize = 4;
const DEFAULT_OLLAMA_ENDPOINT: &str = "http://localhost:11434";
const DEFAULT_OLLAMA_MODEL: &str = "gemma3:4b";

fn read_image_as_base64(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("이미지 읽기 실패 ({}): {}", path.display(), e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn collect_reference_images(root: &Path) -> Result<Vec<(String, Vec<PathBuf>)>, String> {
    let entries = fs::read_dir(root)
        .map_err(|e| format!("참조 이미지 폴더를 읽을 수 없습니다 ({}): {}", root.display(), e))?;
    let mut species: Vec<(String, Vec<PathBuf>)> = Vec::new();
    for entry in entries.flatten() {
        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if !ft.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let mut imgs: Vec<PathBuf> = Vec::new();
        if let Ok(rd) = fs::read_dir(entry.path()) {
            for f in rd.flatten() {
                let p = f.path();
                if p.is_file() {
                    let ext = get_ext(&p.file_name().unwrap_or_default().to_string_lossy());
                    if BROWSER_IMAGE_EXT.contains(&ext.as_str()) {
                        imgs.push(p);
                    }
                }
            }
        }
        if !imgs.is_empty() {
            species.push((name, imgs));
        }
    }
    if species.is_empty() {
        return Err(format!(
            "참조 이미지가 없습니다. {} 아래에 종별 폴더를 만들고 이미지를 넣어주세요.",
            root.display()
        ));
    }
    Ok(species)
}

#[tauri::command]
async fn suggest_species(
    app: tauri::AppHandle,
    image_path: String,
    ollama_endpoint: Option<String>,
    ollama_model: Option<String>,
) -> Result<Vec<Candidate>, String> {
    let query_path = PathBuf::from(&image_path);
    let ext = get_ext(&query_path.file_name().unwrap_or_default().to_string_lossy());
    if !BROWSER_IMAGE_EXT.contains(&ext.as_str()) {
        return Err("RAW/HEIC 등은 동정 미지원 — JPG/PNG로 변환해주세요.".into());
    }

    let resource_root = app
        .path()
        .resource_dir()
        .map_err(|e| format!("리소스 폴더를 찾을 수 없습니다: {}", e))?
        .join("resources")
        .join("reference_images");

    let species = collect_reference_images(&resource_root)?;

    let query_b64 = read_image_as_base64(&query_path)?;

    let mut all_images_b64: Vec<String> = Vec::new();
    let mut species_blocks: Vec<String> = Vec::new();
    {
        let mut rng = rand::rngs::SmallRng::from_entropy();
        for (name, paths) in &species {
            let mut sample: Vec<&PathBuf> = paths.iter().collect();
            sample.shuffle(&mut rng);
            sample.truncate(REFERENCE_SAMPLES_PER_SPECIES);
            let count = sample.len();
            for p in sample {
                all_images_b64.push(read_image_as_base64(p)?);
            }
            species_blocks.push(format!("- {} ({}장)", name, count));
        }
    }

    all_images_b64.push(query_b64);

    let species_names: Vec<&str> = species.iter().map(|(n, _)| n.as_str()).collect();
    let species_list = species_blocks.join("\n");
    let allowed_names = species_names.join(", ");
    let prompt = format!(
        "당신은 한국 연안 어류 분류 전문가입니다. 다음은 외형이 비슷해 혼동되는 어종들의 참조 사진입니다. 각 종별로 여러 장이 순서대로 제공됩니다:\n{}\n\n마지막 사진(참조 묶음 다음의 1장)이 분류 대상입니다. 참조 사진의 외형 특징(체형, 무늬, 지느러미 모양, 색조 등)을 비교해 마지막 사진의 어종을 추정하세요.\n\n반드시 아래 JSON 스키마 그대로만 출력하고 다른 텍스트는 금지합니다:\n{{\"candidates\":[{{\"name\":\"종이름\",\"confidence\":0.0}}]}}\n\n규칙:\n- name 값은 반드시 다음 중 하나여야 합니다: [{}]\n- candidates 배열은 신뢰도 내림차순으로 1개 이상 3개 이하를 항상 채울 것 (절대 빈 배열을 반환하지 말 것)\n- 확신이 부족하더라도 가장 닮은 후보 1개는 반드시 포함시키고 낮은 confidence를 부여할 것\n- confidence는 0~1 범위, 모든 값의 합이 1이 되도록 정규화",
        species_list, allowed_names
    );

    let endpoint = ollama_endpoint
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_OLLAMA_ENDPOINT.to_string());
    let model = ollama_model
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_OLLAMA_MODEL.to_string());

    let body = serde_json::json!({
        "model": model,
        "stream": false,
        "format": "json",
        "messages": [
            {
                "role": "user",
                "content": prompt,
                "images": all_images_b64,
            }
        ]
    });

    let url = format!("{}/api/chat", endpoint.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("HTTP 클라이언트 초기화 실패: {}", e))?;
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() {
                format!("Ollama에 연결할 수 없습니다 ({}). 'ollama serve'를 실행하셨나요?", url)
            } else {
                format!("Ollama 요청 실패: {}", e)
            }
        })?;

    let status = resp.status();
    let raw = resp.text().await.map_err(|e| format!("응답 본문 읽기 실패: {}", e))?;
    if !status.is_success() {
        if raw.contains("not found") || raw.contains("pull") {
            return Err(format!(
                "모델 '{}'을 찾을 수 없습니다. 'ollama pull {}' 로 받으세요.",
                model, model
            ));
        }
        return Err(format!("Ollama HTTP {}: {}", status, raw));
    }

    let outer: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| format!("Ollama 응답 파싱 실패: {} (원문: {})", e, truncate(&raw, 300)))?;
    let content = outer
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .ok_or_else(|| format!("Ollama 응답에 message.content 없음: {}", truncate(&raw, 300)))?;

    let parsed: serde_json::Value = serde_json::from_str(content).map_err(|e| {
        format!("모델 출력 JSON 파싱 실패: {} (출력: {})", e, truncate(content, 300))
    })?;

    let arr = parsed
        .get("candidates")
        .and_then(|v| v.as_array())
        .ok_or_else(|| format!("'candidates' 배열이 없습니다 (출력: {})", truncate(content, 300)))?;

    let mut result: Vec<Candidate> = Vec::new();
    for v in arr.iter().take(3) {
        let name = v
            .get("name")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let confidence = v
            .get("confidence")
            .and_then(|x| x.as_f64())
            .unwrap_or(0.0) as f32;
        if !name.is_empty() {
            result.push(Candidate { name, confidence });
        }
    }
    if result.is_empty() {
        return Err(format!(
            "모델이 판단을 보류했습니다. 다른 사진으로 다시 시도하거나 더 큰 모델(예: gemma3:12b)로 교체해보세요. (모델 출력: {})",
            truncate(content, 200)
        ));
    }
    Ok(result)
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(n).collect();
        out.push_str("...");
        out
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            read_files,
            rename_file,
            move_to_skip,
            load_defaults,
            save_defaults,
            load_history,
            save_history,
            open_help,
            suggest_species,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
