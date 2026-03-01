use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

const IMAGE_EXT: &[&str] = &[
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp",
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

const VIDEO_EXT: &[&str] = &[".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"];

const NO_PREVIEW_EXT: &[&str] = &[
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

fn get_ext(name: &str) -> String {
    Path::new(name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
        .unwrap_or_default()
}

fn is_media_file(name: &str) -> bool {
    let ext = get_ext(name);
    IMAGE_EXT.contains(&ext.as_str()) || VIDEO_EXT.contains(&ext.as_str())
}

fn make_placeholder_svg(ext: &str) -> String {
    let upper = ext.to_uppercase();
    let svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect fill="#1c2530" width="400" height="300"/><text x="200" y="140" text-anchor="middle" fill="#8b9cb3" font-size="14" font-family="sans-serif">미리보기 불가</text><text x="200" y="165" text-anchor="middle" fill="#5c6f87" font-size="12" font-family="sans-serif">{} (이름 변경 가능)</text></svg>"##,
        upper
    );
    let b64 = STANDARD.encode(svg.as_bytes());
    format!("data:image/svg+xml;base64,{}", b64)
}

#[tauri::command]
fn get_video_ext() -> Vec<String> {
    VIDEO_EXT.iter().map(|s| s.to_string()).collect()
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

#[tauri::command]
fn get_image_data(folder_path: String, file_name: String) -> Result<Option<String>, String> {
    let ext = get_ext(&file_name);
    if VIDEO_EXT.contains(&ext.as_str()) {
        return Ok(None);
    }

    if NO_PREVIEW_EXT.contains(&ext.as_str()) {
        return Ok(Some(make_placeholder_svg(&ext)));
    }

    let file_path = Path::new(&folder_path).join(&file_name);
    let buf = fs::read(&file_path).map_err(|e| format!("파일 읽기 실패: {}", e))?;
    let b64 = STANDARD.encode(&buf);

    let mime = match ext.as_str() {
        ".jpg" | ".jpeg" => "image/jpeg",
        ".png" => "image/png",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        ".bmp" => "image/bmp",
        _ => "application/octet-stream",
    };

    Ok(Some(format!("data:{};base64,{}", mime, b64)))
}

#[tauri::command]
fn get_file_url(folder_path: String, file_name: String) -> String {
    let file_path = Path::new(&folder_path).join(&file_name);
    file_path.to_string_lossy().to_string()
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

#[tauri::command]
async fn open_help(app: tauri::AppHandle) -> Result<(), String> {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            get_video_ext,
            read_files,
            get_image_data,
            get_file_url,
            rename_file,
            move_to_skip,
            load_defaults,
            save_defaults,
            open_help,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
