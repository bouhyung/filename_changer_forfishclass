/**
 * electron-builder 빌드 후 blockmap 파일 삭제
 * 자동 업데이트 미사용 시 불필요한 파일 제거
 */
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
if (!fs.existsSync(distDir)) return;

const files = fs.readdirSync(distDir);
let removed = 0;
for (const file of files) {
  if (file.endsWith('.blockmap')) {
    fs.unlinkSync(path.join(distDir, file));
    removed++;
    console.log(`  removed: ${file}`);
  }
}
if (removed > 0) {
  console.log(`  blockmap 파일 ${removed}개 삭제됨`);
}
