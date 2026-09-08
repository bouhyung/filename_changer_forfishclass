// MYBOX 개인용 액세스 토큰(PAT) 보관.
//
// PAT 는 드라이브 전체 권한을 가지므로 비밀번호와 동일하게 취급한다.
// - OS 키체인(macOS Keychain / Windows 자격 증명 관리자)에만 저장한다
// - 평문 파일로 떨어뜨리지 않는다
// - 프론트엔드(웹뷰)로 원문을 내려보내지 않는다 (mod.rs 의 TokenStatus 참고)
// - 로그·에러 메시지에 싣지 않는다

const KEYCHAIN_SERVICE: &str = "com.file-rename.app.mybox";
const KEYCHAIN_ACCOUNT: &str = "access-token";

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| format!("키체인에 접근할 수 없습니다: {}", e))
}

pub fn store(token: &str) -> Result<(), String> {
    entry()?
        .set_password(token)
        .map_err(|e| format!("키체인에 토큰을 저장하지 못했습니다: {}", e))
}

pub fn load() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(t) => Ok(Some(t)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("키체인에서 토큰을 읽지 못했습니다: {}", e)),
    }
}

pub fn delete() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("키체인에서 토큰을 삭제하지 못했습니다: {}", e)),
    }
}

/// 화면 표시용 마스킹. 끝 4자만 남긴다.
/// 짧은 토큰은 어떤 정보도 남기지 않는다.
pub fn mask(token: &str) -> String {
    let chars: Vec<char> = token.chars().collect();
    if chars.len() < 12 {
        return "•".repeat(8);
    }
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{}{}", "•".repeat(8), tail)
}

#[cfg(test)]
mod tests {
    use super::mask;

    #[test]
    fn mask_keeps_only_tail() {
        assert_eq!(mask("abcdefghijklmnop"), "••••••••mnop");
    }

    #[test]
    fn mask_hides_short_tokens_entirely() {
        assert_eq!(mask("short"), "••••••••");
        assert_eq!(mask(""), "••••••••");
    }
}
