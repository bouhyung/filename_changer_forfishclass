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
            read_files,
            rename_file,
            move_to_skip,
            load_defaults,
            save_defaults,
            open_help,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
