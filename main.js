const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')
const convert = require('heic-convert')

const SRC_DIR = path.join(__dirname, 'src')
let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    webPreferences: {
      preload: path.join(SRC_DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'File Arrange for Fish Class'
  })

  mainWindow.loadFile(path.join(SRC_DIR, 'index.html'))
}

function openHelpWindow() {
  const helpWin = new BrowserWindow({
    width: 560,
    height: 720,
    parent: mainWindow,
    modal: false,
    backgroundColor: '#0f1419',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    },
    title: '사용 도움말 - File Arrange for Fish Class'
  })
  helpWin.loadFile(path.join(SRC_DIR, 'help.html'))
  helpWin.setMenuBarVisibility(false)
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// 도움말 창 열기
ipcMain.handle('open-help', () => {
  openHelpWindow()
})

// 폴더 선택
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (result.canceled) return null
  return result.filePaths[0]
})

const IMAGE_EXT = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  '.heic', '.heif',           // iPhone HEIC
  '.orf', '.ori',            // Olympus RAW
  '.cr2', '.cr3',            // Canon RAW
  '.arw', '.arw2', '.srf', '.sr2',  // Sony RAW
  '.nef', '.nrw', '.nr2',           // Nikon RAW
  '.dng',                    // Adobe DNG
  '.rw2',                    // Panasonic RAW
  '.raf',                    // Fujifilm RAW
  '.pef', '.ptx',            // Pentax RAW
]

const VIDEO_EXT = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v']

const MEDIA_EXT = [...IMAGE_EXT, ...VIDEO_EXT]

// 미리보기 불가 포맷 (RAW만 - HEIC는 변환하여 미리보기)
const NO_PREVIEW_EXT = ['.orf', '.ori', '.cr2', '.cr3', '.arw', '.arw2', '.srf', '.sr2', '.nef', '.nrw', '.nr2', '.dng', '.rw2', '.raf', '.pef', '.ptx']

// 이미지/동영상 파일 목록 읽기
ipcMain.handle('read-files', async (_, folderPath) => {
  const entries = fs.readdirSync(folderPath, { withFileTypes: true })
  return entries
    .filter(e => e.isFile() && MEDIA_EXT.includes(path.extname(e.name).toLowerCase()))
    .map(e => e.name)
})

// 이미지 데이터 로드 (base64 data URL) - 이미지 전용
ipcMain.handle('get-image-data', async (_, folderPath, fileName) => {
  const ext = path.extname(fileName).toLowerCase()
  if (VIDEO_EXT.includes(ext)) return null
  const filePath = path.join(folderPath, fileName)

  // HEIC/HEIF → JPEG 변환 후 미리보기
  if (ext === '.heic' || ext === '.heif') {
    try {
      const inputBuffer = fs.readFileSync(filePath)
      const outputBuffer = await convert({
        buffer: inputBuffer,
        format: 'JPEG',
        quality: 0.9
      })
      const base64 = Buffer.isBuffer(outputBuffer) ? outputBuffer.toString('base64') : Buffer.from(outputBuffer).toString('base64')
      return `data:image/jpeg;base64,${base64}`
    } catch (err) {
      console.error('HEIC 변환 실패:', err)
      return makePlaceholderSvg(ext)
    }
  }

  // RAW → 플레이스홀더
  if (NO_PREVIEW_EXT.includes(ext)) {
    return makePlaceholderSvg(ext)
  }

  // 일반 이미지
  const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' }
  const mime = mimeMap[ext] || 'application/octet-stream'
  const buf = fs.readFileSync(filePath)
  return `data:${mime};base64,${buf.toString('base64')}`
})

// 동영상용 파일 URL 반환 (file:// 프로토콜)
ipcMain.handle('get-file-url', async (_, folderPath, fileName) => {
  const filePath = path.join(folderPath, fileName)
  return pathToFileURL(filePath).href
})

function makePlaceholderSvg(ext) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
    <rect fill="#1c2530" width="400" height="300"/>
    <text x="200" y="140" text-anchor="middle" fill="#8b9cb3" font-size="14" font-family="sans-serif">미리보기 불가</text>
    <text x="200" y="165" text-anchor="middle" fill="#5c6f87" font-size="12" font-family="sans-serif">${ext.toUpperCase()} (이름 변경 가능)</text>
  </svg>`
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
}

// 기본값 로드
ipcMain.handle('load-defaults', async () => {
  const configPath = path.join(app.getPath('userData'), 'defaults.json')
  try {
    const data = fs.readFileSync(configPath, 'utf-8')
    return JSON.parse(data)
  } catch {
    return null
  }
})

// 기본값 저장
ipcMain.handle('save-defaults', async (_, defaults) => {
  const configPath = path.join(app.getPath('userData'), 'defaults.json')
  const dir = path.dirname(configPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(defaults, null, 2), 'utf-8')
})

// Skip 폴더로 파일 이동
ipcMain.handle('move-to-skip', async (_, { folderPath, fileName }) => {
  const skipDir = path.join(folderPath, 'Skip')
  const srcPath = path.join(folderPath, fileName)
  const destPath = path.join(skipDir, fileName)
  try {
    if (!fs.existsSync(skipDir)) fs.mkdirSync(skipDir, { recursive: true })
    fs.renameSync(srcPath, destPath)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// 단일 파일 이름 변경
ipcMain.handle('rename-file', async (_, { folderPath, oldName, newName }) => {
  if (oldName === newName) return { success: true }
  try {
    fs.renameSync(
      path.join(folderPath, oldName),
      path.join(folderPath, newName)
    )
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})
