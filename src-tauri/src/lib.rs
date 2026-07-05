use base64::Engine;
use rand::seq::SliceRandom;
use rand::SeedableRng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
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

// 커맨드 인자로 받은 파일 이름이 순수 파일명(경로 구분자·`..` 없음)인지 검증.
// 웹뷰가 손상되더라도 선택 폴더 밖의 파일을 건드릴 수 없도록 하는 심층 방어.
fn validate_file_name(name: &str) -> Result<(), String> {
    let mut comps = Path::new(name).components();
    let single_normal = matches!(
        (comps.next(), comps.next()),
        (Some(std::path::Component::Normal(_)), None)
    );
    if single_normal && !name.contains('/') && !name.contains('\\') {
        Ok(())
    } else {
        Err("잘못된 파일 이름입니다.".to_string())
    }
}

// 숫자 구간은 수치로 비교하는 자연 정렬 (IMG_2 < IMG_10)
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let ac: Vec<char> = a.chars().collect();
    let bc: Vec<char> = b.chars().collect();
    let (mut i, mut j) = (0usize, 0usize);
    while i < ac.len() && j < bc.len() {
        if ac[i].is_ascii_digit() && bc[j].is_ascii_digit() {
            let si = i;
            while i < ac.len() && ac[i].is_ascii_digit() {
                i += 1;
            }
            let sj = j;
            while j < bc.len() && bc[j].is_ascii_digit() {
                j += 1;
            }
            let na: String = ac[si..i].iter().collect();
            let nb: String = bc[sj..j].iter().collect();
            let ta = na.trim_start_matches('0');
            let tb = nb.trim_start_matches('0');
            let ord = ta.len().cmp(&tb.len()).then_with(|| ta.cmp(tb));
            if ord != Ordering::Equal {
                return ord;
            }
        } else {
            let la = ac[i].to_lowercase().next().unwrap_or(ac[i]);
            let lb = bc[j].to_lowercase().next().unwrap_or(bc[j]);
            if la != lb {
                return la.cmp(&lb);
            }
            i += 1;
            j += 1;
        }
    }
    (ac.len() - i).cmp(&(bc.len() - j)).then_with(|| a.cmp(b))
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
    files.sort_by(|a, b| natural_cmp(a, b));
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
    if let Err(e) = validate_file_name(&old_name).and_then(|_| validate_file_name(&new_name)) {
        return OpResult { success: false, error: Some(e) };
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

// Skip 폴더에 같은 이름이 이미 있으면 "name (2).ext" 식으로 비어 있는 이름을 찾는다.
// fs::rename은 유닉스에서 기존 파일을 조용히 덮어쓰므로, 이 함수가 데이터 손실을 막는다.
fn unique_dest(dir: &Path, file_name: &str) -> PathBuf {
    let dest = dir.join(file_name);
    if !dest.exists() {
        return dest;
    }
    let (stem, ext) = match file_name.rfind('.') {
        Some(i) if i > 0 => (&file_name[..i], &file_name[i..]),
        _ => (file_name, ""),
    };
    let mut n = 2;
    loop {
        let candidate = dir.join(format!("{} ({}){}", stem, n, ext));
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}

#[tauri::command]
fn move_to_skip(folder_path: String, file_name: String) -> OpResult {
    if let Err(e) = validate_file_name(&file_name) {
        return OpResult { success: false, error: Some(e) };
    }
    let skip_dir = Path::new(&folder_path).join("Skip");
    let src = Path::new(&folder_path).join(&file_name);
    if let Err(e) = fs::create_dir_all(&skip_dir) {
        return OpResult { success: false, error: Some(e.to_string()) };
    }
    let dest = unique_dest(&skip_dir, &file_name);
    match fs::rename(&src, &dest) {
        Ok(()) => OpResult { success: true, error: None },
        Err(e) => OpResult { success: false, error: Some(e.to_string()) },
    }
}

// EXIF Orientation 값에 시계 방향 90° 회전을 합성한다 (표준 매핑 테이블)
fn rotate_cw_orientation(o: u16) -> u16 {
    match o {
        1 => 6,
        6 => 3,
        3 => 8,
        8 => 1,
        2 => 7,
        7 => 4,
        4 => 5,
        5 => 2,
        _ => 6, // 알 수 없는 값은 정상(1)으로 간주하고 90° 회전
    }
}

// JPEG의 EXIF Orientation 태그(0x0112) 값 2바이트만 제자리에서 수정한다.
// 픽셀 데이터와 다른 모든 메타데이터는 바이트 단위로 그대로 유지된다.
fn patch_jpeg_orientation(bytes: &mut [u8]) -> Result<(u16, u16), String> {
    if bytes.len() < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8 {
        return Err("JPEG 형식이 아닙니다.".into());
    }
    let mut i = 2usize;
    while i + 4 <= bytes.len() {
        if bytes[i] != 0xFF {
            return Err("JPEG 구조를 해석할 수 없습니다.".into());
        }
        let marker = bytes[i + 1];
        if marker == 0xFF {
            i += 1;
            continue;
        }
        if marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            i += 2;
            continue;
        }
        if marker == 0xDA || marker == 0xD9 {
            break; // 이미지 데이터 시작 — EXIF는 그 앞에만 존재
        }
        let len = ((bytes[i + 2] as usize) << 8) | bytes[i + 3] as usize;
        if len < 2 || i + 2 + len > bytes.len() {
            return Err("JPEG 세그먼트 길이가 올바르지 않습니다.".into());
        }
        if marker == 0xE1 && len >= 16 && &bytes[i + 4..i + 10] == b"Exif\0\0" {
            return patch_tiff_orientation(bytes, i + 10, i + 2 + len);
        }
        i += 2 + len;
    }
    Err("EXIF 정보가 없어 회전할 수 없습니다. (카메라 원본 JPG만 지원)".into())
}

fn patch_tiff_orientation(
    bytes: &mut [u8],
    tiff_start: usize,
    tiff_end: usize,
) -> Result<(u16, u16), String> {
    let tiff = &bytes[tiff_start..tiff_end];
    if tiff.len() < 8 {
        return Err("EXIF 데이터가 손상되었습니다.".into());
    }
    let le = match &tiff[0..2] {
        b"II" => true,
        b"MM" => false,
        _ => return Err("EXIF 바이트 순서를 해석할 수 없습니다.".into()),
    };
    let rd16 = |b: &[u8], p: usize| -> Option<u16> {
        let s = b.get(p..p + 2)?;
        Some(if le {
            u16::from_le_bytes([s[0], s[1]])
        } else {
            u16::from_be_bytes([s[0], s[1]])
        })
    };
    let rd32 = |b: &[u8], p: usize| -> Option<u32> {
        let s = b.get(p..p + 4)?;
        Some(if le {
            u32::from_le_bytes([s[0], s[1], s[2], s[3]])
        } else {
            u32::from_be_bytes([s[0], s[1], s[2], s[3]])
        })
    };
    let ifd0 = rd32(tiff, 4).ok_or("EXIF IFD 오프셋 오류")? as usize;
    let count = rd16(tiff, ifd0).ok_or("EXIF IFD 구조 오류")? as usize;
    for k in 0..count {
        let e = ifd0 + 2 + k * 12;
        let tag = rd16(tiff, e).ok_or("EXIF 엔트리 읽기 오류")?;
        if tag == 0x0112 {
            let cur = rd16(tiff, e + 8).ok_or("Orientation 값 읽기 오류")?;
            let new = rotate_cw_orientation(cur);
            let abs = tiff_start + e + 8;
            let nb = if le { new.to_le_bytes() } else { new.to_be_bytes() };
            bytes[abs] = nb[0];
            bytes[abs + 1] = nb[1];
            return Ok((cur, new));
        }
    }
    Err("EXIF에 회전(Orientation) 정보가 없어 회전할 수 없습니다.".into())
}

#[tauri::command]
fn rotate_image(folder_path: String, file_name: String) -> OpResult {
    fn fail(msg: String) -> OpResult {
        OpResult { success: false, error: Some(msg) }
    }
    if let Err(e) = validate_file_name(&file_name) {
        return fail(e);
    }
    let ext = get_ext(&file_name);
    if ext != ".jpg" && ext != ".jpeg" {
        return fail("JPEG(.jpg/.jpeg) 파일만 회전을 지원합니다.".into());
    }
    let path = Path::new(&folder_path).join(&file_name);
    let mut bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(e) => return fail(format!("파일 읽기 실패: {}", e)),
    };
    if let Err(e) = patch_jpeg_orientation(&mut bytes) {
        return fail(e);
    }
    // 임시 파일에 쓴 뒤 원자적으로 교체 — 쓰기 도중 실패해도 원본이 손상되지 않는다
    let tmp = Path::new(&folder_path).join(format!(".{}.rotating", file_name));
    if let Err(e) = fs::write(&tmp, &bytes) {
        let _ = fs::remove_file(&tmp);
        return fail(format!("임시 파일 쓰기 실패: {}", e));
    }
    if let Err(e) = fs::rename(&tmp, &path) {
        let _ = fs::remove_file(&tmp);
        return fail(format!("파일 교체 실패: {}", e));
    }
    OpResult { success: true, error: None }
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

// 번들 참조 이미지는 앱 수명 동안 불변이므로 목록·인코딩 결과를 캐시한다.
static REF_SPECIES: OnceLock<Vec<(String, Vec<PathBuf>)>> = OnceLock::new();
static REF_B64_CACHE: OnceLock<Mutex<HashMap<PathBuf, String>>> = OnceLock::new();
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn read_reference_image_b64(path: &Path) -> Result<String, String> {
    let cache = REF_B64_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(hit) = cache.lock().unwrap().get(path).cloned() {
        return Ok(hit);
    }
    let b64 = read_image_as_base64(path)?;
    cache.lock().unwrap().insert(path.to_path_buf(), b64.clone());
    Ok(b64)
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
    folder_path: String,
    file_name: String,
    ollama_endpoint: Option<String>,
    ollama_model: Option<String>,
) -> Result<Vec<Candidate>, String> {
    validate_file_name(&file_name)?;
    let query_path = Path::new(&folder_path).join(&file_name);
    let ext = get_ext(&file_name);
    if !BROWSER_IMAGE_EXT.contains(&ext.as_str()) {
        return Err("RAW/HEIC 등은 동정 미지원 — JPG/PNG로 변환해주세요.".into());
    }

    let resource_root = app
        .path()
        .resource_dir()
        .map_err(|e| format!("리소스 폴더를 찾을 수 없습니다: {}", e))?
        .join("resources")
        .join("reference_images");

    let species: &Vec<(String, Vec<PathBuf>)> = match REF_SPECIES.get() {
        Some(s) => s,
        None => {
            let loaded = collect_reference_images(&resource_root)?;
            REF_SPECIES.get_or_init(move || loaded)
        }
    };

    let query_b64 = read_image_as_base64(&query_path)?;

    let mut all_images_b64: Vec<String> = Vec::new();
    let mut species_blocks: Vec<String> = Vec::new();
    {
        let mut rng = rand::rngs::SmallRng::from_entropy();
        for (name, paths) in species {
            let mut sample: Vec<&PathBuf> = paths.iter().collect();
            sample.shuffle(&mut rng);
            sample.truncate(REFERENCE_SAMPLES_PER_SPECIES);
            let count = sample.len();
            for p in sample {
                all_images_b64.push(read_reference_image_b64(p)?);
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
    if !endpoint.starts_with("http://") && !endpoint.starts_with("https://") {
        return Err("Ollama 엔드포인트는 http:// 또는 https:// 주소여야 합니다.".into());
    }
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
    let client = HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(180))
            .build()
            .expect("HTTP 클라이언트 초기화 실패")
    });
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn natural_sort_orders_numeric_sequences() {
        let mut files = vec![
            "IMG_10.jpg".to_string(),
            "IMG_2.jpg".to_string(),
            "IMG_100.jpg".to_string(),
            "IMG_1.jpg".to_string(),
            "IMG_20.jpg".to_string(),
        ];
        files.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(
            files,
            vec!["IMG_1.jpg", "IMG_2.jpg", "IMG_10.jpg", "IMG_20.jpg", "IMG_100.jpg"]
        );
    }

    #[test]
    fn natural_sort_handles_korean_and_plain_names() {
        let mut files = vec!["돌돔_2.jpg".to_string(), "돌돔_10.jpg".to_string()];
        files.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(files, vec!["돌돔_2.jpg", "돌돔_10.jpg"]);
    }

    #[test]
    fn validate_file_name_accepts_plain_names() {
        assert!(validate_file_name("IMG_1234_돌돔_남애N_홍길동_20240815.jpg").is_ok());
        assert!(validate_file_name("a.jpg").is_ok());
    }

    #[test]
    fn validate_file_name_rejects_traversal() {
        assert!(validate_file_name("../etc/passwd").is_err());
        assert!(validate_file_name("..").is_err());
        assert!(validate_file_name("/etc/passwd").is_err());
        assert!(validate_file_name("a/b.jpg").is_err());
        assert!(validate_file_name("a\\b.jpg").is_err());
        assert!(validate_file_name("").is_err());
        assert!(validate_file_name(".").is_err());
    }

    fn synthetic_jpeg(le: bool, orientation: u16) -> Vec<u8> {
        let mut tiff: Vec<u8> = Vec::new();
        if le {
            tiff.extend(b"II");
            tiff.extend(42u16.to_le_bytes());
            tiff.extend(8u32.to_le_bytes());
            tiff.extend(1u16.to_le_bytes()); // IFD0 엔트리 수
            tiff.extend(0x0112u16.to_le_bytes()); // Orientation 태그
            tiff.extend(3u16.to_le_bytes()); // SHORT
            tiff.extend(1u32.to_le_bytes()); // count
            tiff.extend(orientation.to_le_bytes());
            tiff.extend([0u8, 0]);
            tiff.extend(0u32.to_le_bytes()); // 다음 IFD 없음
        } else {
            tiff.extend(b"MM");
            tiff.extend(42u16.to_be_bytes());
            tiff.extend(8u32.to_be_bytes());
            tiff.extend(1u16.to_be_bytes());
            tiff.extend(0x0112u16.to_be_bytes());
            tiff.extend(3u16.to_be_bytes());
            tiff.extend(1u32.to_be_bytes());
            tiff.extend(orientation.to_be_bytes());
            tiff.extend([0u8, 0]);
            tiff.extend(0u32.to_be_bytes());
        }
        let mut jpeg = vec![0xFF, 0xD8, 0xFF, 0xE1];
        jpeg.extend(((tiff.len() + 8) as u16).to_be_bytes());
        jpeg.extend(b"Exif\0\0");
        jpeg.extend(&tiff);
        jpeg.extend([0xFF, 0xD9]);
        jpeg
    }

    #[test]
    fn rotate_orientation_patches_only_two_bytes() {
        for &le in &[true, false] {
            let original = synthetic_jpeg(le, 1);
            let mut rotated = original.clone();
            let (cur, new) = patch_jpeg_orientation(&mut rotated).unwrap();
            assert_eq!((cur, new), (1, 6));
            let diff: Vec<usize> = original
                .iter()
                .zip(rotated.iter())
                .enumerate()
                .filter(|(_, (a, b))| a != b)
                .map(|(i, _)| i)
                .collect();
            assert!(diff.len() <= 2, "2바이트 초과 변경: {:?}", diff);
        }
    }

    #[test]
    fn rotate_orientation_cycles_through_four_states() {
        let mut jpeg = synthetic_jpeg(true, 1);
        let mut seen = Vec::new();
        for _ in 0..4 {
            let (_, new) = patch_jpeg_orientation(&mut jpeg).unwrap();
            seen.push(new);
        }
        assert_eq!(seen, vec![6, 3, 8, 1]); // 90° × 4 = 원상 복귀
    }

    #[test]
    fn rotate_orientation_rejects_non_jpeg() {
        let mut png = vec![0x89, b'P', b'N', b'G', 0, 0, 0, 0];
        assert!(patch_jpeg_orientation(&mut png).is_err());
        let mut no_exif = vec![0xFF, 0xD8, 0xFF, 0xD9];
        assert!(patch_jpeg_orientation(&mut no_exif).is_err());
    }

    #[test]
    fn unique_dest_numbers_conflicts() {
        let dir = std::env::temp_dir().join(format!("fish_test_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(unique_dest(&dir, "a.jpg"), dir.join("a.jpg"));
        fs::write(dir.join("a.jpg"), b"x").unwrap();
        assert_eq!(unique_dest(&dir, "a.jpg"), dir.join("a (2).jpg"));
        fs::write(dir.join("a (2).jpg"), b"x").unwrap();
        assert_eq!(unique_dest(&dir, "a.jpg"), dir.join("a (3).jpg"));
        // 확장자 없는 파일
        fs::write(dir.join("noext"), b"x").unwrap();
        assert_eq!(unique_dest(&dir, "noext"), dir.join("noext (2)"));
        fs::remove_dir_all(&dir).unwrap();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_files,
            rename_file,
            move_to_skip,
            rotate_image,
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
