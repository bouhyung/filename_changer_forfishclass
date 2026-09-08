const { invoke } = window.__TAURI__.core
const { convertFileSrc } = window.__TAURI__.core

const VIDEO_EXT = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v']
const BROWSER_IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
const RAW_EXT = ['.heic', '.heif', '.orf', '.ori', '.cr2', '.cr3', '.arw', '.arw2', '.srf', '.sr2', '.nef', '.nrw', '.nr2', '.dng', '.rw2', '.raf', '.pef', '.ptx']

function getExt(fileName) {
  return fileName.includes('.') ? fileName.substring(fileName.lastIndexOf('.')).toLowerCase() : ''
}

function isVideoFile(fileName) {
  return VIDEO_EXT.includes(getExt(fileName))
}

function isRawFile(fileName) {
  return RAW_EXT.includes(getExt(fileName))
}

function isJpegFile(fileName) {
  const ext = getExt(fileName)
  return ext === '.jpg' || ext === '.jpeg'
}

function joinPath(folder, name) {
  const sep = folder.includes('\\') ? '\\' : '/'
  return folder.endsWith(sep) ? folder + name : folder + sep + name
}

function makePlaceholderSvg(ext) {
  const upper = ext.replace('.', '').toUpperCase()
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect fill="#1c2530" width="400" height="300"/><text x="200" y="140" text-anchor="middle" fill="#8b9cb3" font-size="14" font-family="sans-serif">미리보기 불가</text><text x="200" y="165" text-anchor="middle" fill="#5c6f87" font-size="12" font-family="sans-serif">${upper} (이름 변경 가능)</text></svg>`
  return 'data:image/svg+xml,' + encodeURIComponent(svg)
}

let currentFolder = null
let imageFiles = []
let currentIndex = 0
let fishInputCache = {}
let parsedCache = {}
// 회전 후 웹뷰 이미지 캐시를 우회하기 위한 파일별 버전 카운터 (?v=N)
let imageVersionMap = {}
let renameCount = 0
let skipCount = 0
let ollamaEndpoint = ''
let ollamaModel = ''
let isSuggesting = false
// 사용자가 직접 입력한 공유 기본값. 이미 리네임된 파일을 열람할 때 파싱값이
// 폼에 표시되더라도 이 값은 오염되지 않고, 미처리 파일로 돌아오면 복원된다.
let savedDefaults = { pointPrefix: '', pointName: '', photographerName: '', shootDate: '', nightMode: false }

const folderPathEl      = document.getElementById('folderPath')
const headerStatsEl     = document.getElementById('headerStats')
const emptyStateEl     = document.getElementById('emptyState')
const imagePreviewEl   = document.getElementById('imagePreview')
const videoPreviewEl   = document.getElementById('videoPreview')
const inputFishName    = document.getElementById('inputFishName')
const chkJuvenile      = document.getElementById('chkJuvenile')
const chkUncertain     = document.getElementById('chkUncertain')
const filenamePreviewEl = document.getElementById('filenamePreview')
const viewerIndexEl    = document.getElementById('viewerIndex')
const inputPointPrefix = document.getElementById('inputPointPrefix')
const inputPointName   = document.getElementById('inputPointName')
const pointPrefixHistoryEl = document.getElementById('pointPrefixHistory')
const pointNameHistoryEl   = document.getElementById('pointNameHistory')
const inputPhotographer = document.getElementById('inputPhotographer')
const inputShootDate   = document.getElementById('inputShootDate')
const chkNight         = document.getElementById('chkNight')
const btnSelect       = document.getElementById('btnSelectFolder')
const btnReload       = document.getElementById('btnReload')
const btnPrev         = document.getElementById('btnPrev')
const btnNext         = document.getElementById('btnNext')
const btnSkip         = document.getElementById('btnSkip')
const btnRotate       = document.getElementById('btnRotate')
const btnSuggest      = document.getElementById('btnSuggest')
const suggestionRowEl = document.getElementById('suggestionRow')
const lblFishName     = document.getElementById('lblFishName')
const btnToday        = document.getElementById('btnToday')
const statusbarEl     = document.querySelector('.statusbar')
const statusLeftEl    = document.getElementById('statusLeft')
const statusRightEl   = document.getElementById('statusRight')

// Status is shown as a transient bottom toast (only while there is a message),
// so it no longer reserves permanent layout space. The total count lives in the header.
let statusHideTimer = null
function showStatusToast() {
  if (statusHideTimer) clearTimeout(statusHideTimer)
  const hasMsg = !!statusLeftEl.textContent && statusLeftEl.textContent !== '준비'
  statusbarEl.classList.toggle('visible', hasMsg)
  if (hasMsg) {
    statusHideTimer = setTimeout(() => statusbarEl.classList.remove('visible'), 3000)
  }
}
const statusLeft = {
  set textContent(v) { statusLeftEl.textContent = v; showStatusToast() },
  get textContent() { return statusLeftEl.textContent },
}
const statusRight = {
  set textContent(v) { statusRightEl.textContent = v },
  get textContent() { return statusRightEl.textContent },
}
const lightboxEl       = document.getElementById('lightbox')
const lightboxImageEl  = document.getElementById('lightboxImage')
const lightboxVideoEl  = document.getElementById('lightboxVideo')
const lightboxZoomWrap = document.getElementById('lightboxZoomWrap')
const lightboxBackdrop = document.querySelector('.lightbox-backdrop')
const lightboxZoomIn   = document.getElementById('lightboxZoomIn')
const lightboxZoomOut  = document.getElementById('lightboxZoomOut')
const lightboxZoomValue = document.getElementById('lightboxZoomValue')

// ── 초기화 ────────────────────────────────────────────────

;(async function initOnLoad() {
  const defaults = await invoke('load_defaults')
  if (defaults) {
    if (defaults.pointPrefix != null) inputPointPrefix.value = defaults.pointPrefix
    if (defaults.pointName != null) inputPointName.value = defaults.pointName
    if (defaults.photographerName != null) inputPhotographer.value = defaults.photographerName
    if (defaults.shootDate != null) inputShootDate.value = defaults.shootDate
    if (defaults.nightMode != null) chkNight.checked = defaults.nightMode
    if (defaults.ollamaEndpoint != null) ollamaEndpoint = defaults.ollamaEndpoint
    if (defaults.ollamaModel != null) ollamaModel = defaults.ollamaModel
  }
  captureDefaultsFromForm()
  await loadHistory()
  const formPrefix = inputPointPrefix.value.trim()
  if (formPrefix && !history.prefixes.includes(formPrefix)) {
    history.prefixes = [formPrefix, ...history.prefixes].slice(0, HISTORY_PREFIX_MAX)
    refreshPrefixDatalist()
  }
})()

// ── 이벤트 ────────────────────────────────────────────────

document.getElementById('btnHelp').addEventListener('click', async (e) => {
  e.preventDefault()
  try {
    await invoke('open_help')
  } catch (_) {
    // 도움말 창이 이미 열려 있으면 무시
  }
})

btnSelect.addEventListener('click', async (e) => {
  e.preventDefault()
  try {
    const openDialog = window.__TAURI__?.dialog?.open
    if (!openDialog) {
      alert('폴더 선택 기능을 사용할 수 없습니다. 앱을 다시 빌드해보세요.')
      return
    }
    const folder = await openDialog({ directory: true, multiple: false })
    if (!folder) return
    currentFolder = folder
    folderPathEl.textContent = folder
    await loadImages()
  } catch (err) {
    console.error('[폴더 선택]', err)
    alert(`폴더 선택 중 오류: ${err.message}`)
  }
})

btnReload.addEventListener('click', loadImages)

btnPrev.addEventListener('click', () => goToIndex(currentIndex - 1))
btnNext.addEventListener('click', () => goToIndex(currentIndex + 1))

btnSkip.addEventListener('click', skipCurrent)

let isRotating = false
btnRotate.addEventListener('click', async () => {
  if (isRotating || !imageFiles.length || !currentFolder) return
  const fileName = imageFiles[currentIndex]
  if (!isJpegFile(fileName)) return
  isRotating = true
  try {
    const result = await invoke('rotate_image', { folderPath: currentFolder, fileName })
    if (result.success) {
      imageVersionMap[fileName] = (imageVersionMap[fileName] || 0) + 1
      imagePreviewEl.src = mediaSrc(fileName)
      statusLeft.textContent = `회전 완료: ${fileName}`
    } else {
      statusLeft.textContent = `회전 실패: ${result.error}`
    }
  } catch (err) {
    statusLeft.textContent = `회전 실패: ${err.message || err}`
  } finally {
    isRotating = false
  }
})

btnSuggest.addEventListener('click', suggestCurrent)

const SUGGEST_VISIBLE_KEY = 'suggestVisible'
function applySuggestVisibility() {
  const visible = localStorage.getItem(SUGGEST_VISIBLE_KEY) === '1'
  btnSuggest.classList.toggle('hidden', !visible)
  if (!visible) {
    suggestionRowEl.innerHTML = ''
    suggestionRowEl.classList.add('hidden')
  }
}
lblFishName.addEventListener('click', (e) => {
  if (!e.shiftKey) return
  const next = localStorage.getItem(SUGGEST_VISIBLE_KEY) !== '1'
  localStorage.setItem(SUGGEST_VISIBLE_KEY, next ? '1' : '0')
  applySuggestVisibility()
})
applySuggestVisibility()

btnToday.addEventListener('click', () => {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  inputShootDate.value = `${y}${m}${d}`
  savedDefaults.shootDate = inputShootDate.value
  saveDefaults()
  updateFilenamePreview()
})

function onDefaultInputChange() {
  captureDefaultsFromForm()
  debouncedSaveDefaults()
  updateFilenamePreview()
}
for (const el of [inputPointPrefix, inputPointName, inputPhotographer, inputShootDate]) {
  el.addEventListener('input', onDefaultInputChange)
}
inputPointPrefix.addEventListener('input', refreshPointNameDatalist)
chkNight.addEventListener('change', onDefaultInputChange)

emptyStateEl.addEventListener('click', () => btnSelect.click())

imagePreviewEl.addEventListener('click', () => {
  if (imagePreviewEl.src && !imagePreviewEl.classList.contains('hidden')) {
    lightboxVideoEl.classList.add('hidden')
    lightboxVideoEl.pause()
    lightboxVideoEl.removeAttribute('src')
    lightboxImageEl.src = imagePreviewEl.src
    lightboxImageEl.classList.remove('hidden')
    lightboxZoom = 1
    lightboxX = 0
    lightboxY = 0
    applyLightboxTransform()
    lightboxEl.classList.add('active')
  }
})

videoPreviewEl.addEventListener('click', () => {
  if (videoPreviewEl.src && !videoPreviewEl.classList.contains('hidden')) {
    lightboxImageEl.removeAttribute('src')
    lightboxImageEl.classList.add('hidden')
    lightboxVideoEl.src = videoPreviewEl.src
    lightboxVideoEl.classList.remove('hidden')
    lightboxVideoEl.play()
    lightboxZoom = 1
    lightboxX = 0
    lightboxY = 0
    applyLightboxTransform()
    lightboxEl.classList.add('active')
  }
})

lightboxBackdrop.addEventListener('click', closeLightbox)
lightboxZoomWrap.addEventListener('click', (e) => e.stopPropagation())

let lightboxZoom = 1
let lightboxX = 0
let lightboxY = 0

function applyLightboxTransform() {
  lightboxZoomWrap.style.transform = `translate(${lightboxX}px, ${lightboxY}px) scale(${lightboxZoom})`
  lightboxZoomValue.textContent = Math.round(lightboxZoom * 100) + '%'
}

lightboxZoomIn.addEventListener('click', (e) => {
  e.stopPropagation()
  lightboxZoom = Math.min(5, lightboxZoom * 1.25)
  applyLightboxTransform()
})

lightboxZoomOut.addEventListener('click', (e) => {
  e.stopPropagation()
  lightboxZoom = Math.max(0.25, lightboxZoom / 1.25)
  applyLightboxTransform()
})

lightboxZoomWrap.addEventListener('dblclick', (e) => {
  e.stopPropagation()
  if (lightboxZoom < 1.5) {
    lightboxZoom = 2
  } else {
    lightboxZoom = 1
    lightboxX = 0
    lightboxY = 0
  }
  applyLightboxTransform()
})

lightboxEl.addEventListener('wheel', (e) => {
  if (!lightboxEl.classList.contains('active')) return
  if (e.ctrlKey) {
    e.preventDefault()
    const delta = -e.deltaY * 0.002
    lightboxZoom = Math.max(0.25, Math.min(5, lightboxZoom + delta))
    applyLightboxTransform()
  }
}, { passive: false })

let touchStartDist = 0
let touchStartZoom = 1

lightboxZoomWrap.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    touchStartDist = Math.hypot(
      e.touches[1].clientX - e.touches[0].clientX,
      e.touches[1].clientY - e.touches[0].clientY
    )
    touchStartZoom = lightboxZoom
  }
}, { passive: true })

lightboxZoomWrap.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2) {
    e.preventDefault()
    const dist = Math.hypot(
      e.touches[1].clientX - e.touches[0].clientX,
      e.touches[1].clientY - e.touches[0].clientY
    )
    lightboxZoom = Math.max(0.25, Math.min(5, touchStartZoom * (dist / touchStartDist)))
    applyLightboxTransform()
  }
}, { passive: false })

let isDragging = false
let dragStartX = 0
let dragStartY = 0

lightboxZoomWrap.addEventListener('mousedown', (e) => {
  if (e.button === 0 && lightboxZoom > 1) {
    isDragging = true
    dragStartX = e.clientX - lightboxX
    dragStartY = e.clientY - lightboxY
  }
})

document.addEventListener('mousemove', (e) => {
  if (isDragging) {
    lightboxX = e.clientX - dragStartX
    lightboxY = e.clientY - dragStartY
    applyLightboxTransform()
  }
})

document.addEventListener('mouseup', () => {
  isDragging = false
})

inputFishName.addEventListener('input', updateFilenamePreview)

document.addEventListener('keydown', (e) => {
  // MyBox 설정 창이 열려 있으면 파일 작업 단축키가 동작하면 안 된다
  if (myboxModal.classList.contains('active')) {
    if (e.key === 'Escape') closeMyboxModal()
    else if (e.key === 'Enter' && e.target.matches('#myboxToken, #myboxApiBase')) {
      e.preventDefault()
      myboxSaveBtn.click()
    }
    return
  }
  if (e.key === 'Escape') {
    closeLightbox()
    return
  }
  if (lightboxEl.classList.contains('active')) return
  if (!imageFiles.length) return
  const inInput = e.target.matches('input, textarea')
  if (e.key === 'Enter' && !e.target.matches('textarea')) {
    e.preventDefault()
    if (!inInput) {
      inputFishName.focus()
    } else {
      applyAndNext()
    }
  } else if (!inInput && e.key === 'ArrowLeft') {
    e.preventDefault()
    if (!btnPrev.disabled) goToIndex(currentIndex - 1)
  } else if (!inInput && e.key === 'ArrowRight') {
    e.preventDefault()
    if (!btnNext.disabled) goToIndex(currentIndex + 1)
  }
})
chkJuvenile.addEventListener('change', updateFilenamePreview)
chkUncertain.addEventListener('change', updateFilenamePreview)

// ── 핵심 로직 ────────────────────────────────────────────

// 회전된 파일은 URL 버전을 올려 웹뷰가 캐시된 이전 방향의 이미지를 쓰지 않게 한다
function mediaSrc(fileName) {
  let src = convertFileSrc(joinPath(currentFolder, fileName))
  if (imageVersionMap[fileName]) src += '?v=' + imageVersionMap[fileName]
  return src
}

async function loadImages() {
  if (!currentFolder) return
  imageFiles = await invoke('read_files', { folderPath: currentFolder })
  currentIndex = 0
  fishInputCache = {}
  parsedCache = {}
  imageVersionMap = {}
  renameCount = 0
  skipCount = 0
  btnReload.disabled = false
  btnPrev.disabled = false
  btnNext.disabled = false
  btnSkip.disabled = !imageFiles.length
  headerStatsEl.textContent = imageFiles.length ? `${imageFiles.length}개 미디어` : '미디어 없음'
  await showCurrentImage({ focusInput: true })
}

function saveCurrentFishInput() {
  if (!imageFiles.length || currentIndex < 0 || currentIndex >= imageFiles.length) return
  const fileName = imageFiles[currentIndex]
  fishInputCache[fileName] = {
    fishName: inputFishName.value,
    chkJuvenile: chkJuvenile.checked,
    chkUncertain: chkUncertain.checked
  }
}

// rename 성공 처리의 단일 경로: 캐시 정리, 목록 갱신, 카운트, 이력, 상태 표시.
// Enter(applyAndNext)와 화살표 이동(renameCurrentIfReady) 모두 이 함수를 거친다.
async function performRename(oldName, newName) {
  const result = await invoke('rename_file', { folderPath: currentFolder, oldName, newName })
  if (result.success) {
    delete parsedCache[oldName]
    delete fishInputCache[oldName]
    if (imageVersionMap[oldName]) {
      imageVersionMap[newName] = imageVersionMap[oldName]
      delete imageVersionMap[oldName]
    }
    imageFiles[currentIndex] = newName
    renameCount++
    pushHistoryFromCurrent()
    statusLeft.textContent = `변경 완료: ${newName}`
  }
  return result
}

async function renameCurrentIfReady() {
  const missing = getMissingBasicInfo()
  if (missing.length > 0) return true
  const newName = buildNewFilename()
  if (!newName || !currentFolder) return true
  const oldName = imageFiles[currentIndex]
  if (oldName === newName) return true
  try {
    const result = await performRename(oldName, newName)
    if (result.success) return true
    statusLeft.textContent = `오류: ${result.error}`
    alert(`파일 이름 변경 실패:\n${result.error}`)
    return false
  } catch (err) {
    console.error('[renameCurrentIfReady]', err)
    statusLeft.textContent = `오류: ${err.message}`
    return false
  }
}

async function goToIndex(idx, { focusInput = false } = {}) {
  if (isApplying) return
  if (idx < 0 || idx >= imageFiles.length) return
  saveCurrentFishInput()
  isApplying = true
  let renamed = false
  try {
    renamed = await renameCurrentIfReady()
  } finally {
    isApplying = false
  }
  if (!renamed) return
  currentIndex = idx
  await showCurrentImage({ focusInput })
}

async function showCurrentImage({ focusInput = false } = {}) {
  clearSuggestions()
  if (!imageFiles.length) {
    emptyStateEl.classList.remove('hidden')
    imagePreviewEl.classList.add('hidden')
    imagePreviewEl.src = ''
    videoPreviewEl.classList.add('hidden')
    videoPreviewEl.pause()
    videoPreviewEl.removeAttribute('src')
    filenamePreviewEl.textContent = ''
    viewerIndexEl.textContent = '0 / 0'
    btnPrev.disabled = true
    btnNext.disabled = true
    btnSkip.disabled = true
    btnSuggest.disabled = true
    btnRotate.classList.add('hidden')
    return
  }

  btnSkip.disabled = false
  emptyStateEl.classList.add('hidden')

  const fileName = imageFiles[currentIndex]
  const isVideo = isVideoFile(fileName)
  btnSuggest.disabled = isVideo || isRawFile(fileName)
  btnRotate.classList.toggle('hidden', !isJpegFile(fileName))

  if (isVideo) {
    videoPreviewEl.pause()
    videoPreviewEl.src = mediaSrc(fileName)
    videoPreviewEl.classList.remove('hidden')
    imagePreviewEl.src = ''
    imagePreviewEl.classList.add('hidden')
  } else {
    const ext = getExt(fileName)
    imagePreviewEl.src = isRawFile(fileName)
      ? makePlaceholderSvg(ext)
      : mediaSrc(fileName)
    imagePreviewEl.alt = fileName
    imagePreviewEl.classList.remove('hidden')
    videoPreviewEl.pause()
    videoPreviewEl.removeAttribute('src')
    videoPreviewEl.classList.add('hidden')
  }

  const nameWithoutExt = fileName.includes('.') ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName
  let parsed = parsedCache[fileName]
  if (!parsed) {
    parsed = parseExistingFilename(nameWithoutExt)
    if (!parsed) {
      parsed = { originalBase: nameWithoutExt, fishName: null, pointPrefix: '', pointName: '', pointNameEndsWithN: false, photographer: null, shootDate: null }
    }
    parsedCache[fileName] = parsed
  }

  const cached = fishInputCache[fileName]
  if (cached) {
    inputFishName.value = cached.fishName
    chkJuvenile.checked = cached.chkJuvenile
    chkUncertain.checked = cached.chkUncertain
  } else if (parsed && parsed.fishName) {
    let displayName = parsed.fishName
    chkUncertain.checked = /^\(.+\)$/.test(displayName)
    if (chkUncertain.checked) displayName = displayName.replace(/^\(|\)$/g, '')
    chkJuvenile.checked = displayName.endsWith('J')
    if (chkJuvenile.checked) displayName = displayName.slice(0, -1)
    inputFishName.value = displayName === '물고기' ? '' : displayName
  } else {
    inputFishName.value = ''
    chkJuvenile.checked = false
    chkUncertain.checked = false
  }

  if (parsed && parsed.pointPrefix && parsed.pointName) {
    // 이미 리네임된 파일: 그 파일의 파싱값을 폼에 표시 (savedDefaults는 건드리지 않음)
    inputPointPrefix.value = parsed.pointPrefix
    inputPointName.value = parsed.pointName
    chkNight.checked = parsed.pointNameEndsWithN
    inputPhotographer.value = parsed.photographer || savedDefaults.photographerName
    inputShootDate.value = parsed.shootDate || savedDefaults.shootDate
  } else {
    // 미처리 파일: 사용자가 입력해 둔 기본값으로 복원 (파싱값 잔류로 인한 오염 방지)
    inputPointPrefix.value = savedDefaults.pointPrefix
    inputPointName.value = savedDefaults.pointName
    chkNight.checked = savedDefaults.nightMode
    inputPhotographer.value = savedDefaults.photographerName
    inputShootDate.value = savedDefaults.shootDate
  }
  refreshPointNameDatalist()

  updateFilenamePreview()
  updateNavState()
  if (focusInput) {
    inputFishName.focus()
  } else if (document.activeElement === inputFishName) {
    inputFishName.blur()
  }
}

function getEffectivePointName() {
  const base = inputPointName.value.trim()
  return chkNight.checked ? base + 'N' : base
}

function buildNewFilename() {
  if (!imageFiles.length || currentIndex < 0 || currentIndex >= imageFiles.length) return null

  const fishRaw = inputFishName.value.trim()
  let fishName
  if (chkUncertain.checked) {
    fishName = fishRaw ? `(${fishRaw})` : '(물고기)'
  } else if (fishRaw && chkJuvenile.checked) {
    fishName = fishRaw + 'J'
  } else if (fishRaw) {
    fishName = fishRaw
  } else {
    return null
  }

  const oldName = imageFiles[currentIndex]
  const ext = oldName.includes('.') ? oldName.substring(oldName.lastIndexOf('.')) : '.jpg'

  const parsed = parsedCache[oldName]
  const originalBase = parsed ? parsed.originalBase : extractOriginalBase(oldName)

  const parts = [originalBase, fishName]
  const pointBase = inputPointName.value.trim()
  const prefix = inputPointPrefix.value.trim()
  if (pointBase) {
    parts.push(prefix + getEffectivePointName())
  }
  const photographer = inputPhotographer.value.trim()
  if (photographer) parts.push(photographer)
  const shootDate = inputShootDate.value.trim()
  if (shootDate) parts.push(shootDate)

  return parts.join('_') + ext
}

const SEED_PREFIXES = ['남애', '북애', '동애', '서애', '속초', '고성']

function getRecognizedPrefixes() {
  const seen = new Set()
  const result = []
  for (const p of [...history.prefixes, ...SEED_PREFIXES]) {
    if (p && !seen.has(p)) {
      seen.add(p)
      result.push(p)
    }
  }
  return result
}

function is8DigitDate(s) {
  return /^\d{8}$/.test(s)
}

function isPhotographer(s) {
  return /^[가-힣]{2,4}$/.test(s) && !s.includes('물') && !s.includes('고기')
}

function isPointPart(s) {
  if (!s || /^\d+$/.test(s)) return false
  for (const p of getRecognizedPrefixes()) {
    if (s.startsWith(p)) return true
  }
  return false
}

function isFishPart(s) {
  if (!s) return false
  if (/^\(.+\)$/.test(s)) return true
  if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(s)) return true
  return false
}

function isCameraCode(s) {
  return /^[A-Za-z0-9\-]+$/.test(s)
}

function parseExistingFilename(nameWithoutExt) {
  const parts = nameWithoutExt.split('_').filter(Boolean)
  if (parts.length === 0) return null

  const result = {
    originalBase: '',
    fishName: null,
    pointPrefix: '',
    pointName: '',
    pointNameEndsWithN: false,
    photographer: null,
    shootDate: null
  }

  let front = 0
  while (front < parts.length && isCameraCode(parts[front]) && !is8DigitDate(parts[front])) {
    front++
  }
  if (front === 0) front = 1

  result.originalBase = parts.slice(0, front).join('_')

  let i = parts.length - 1

  if (i >= front && is8DigitDate(parts[i])) {
    result.shootDate = parts[i]
    i--
  }

  if (i >= front && isPhotographer(parts[i]) && !getRecognizedPrefixes().some(p => parts[i].startsWith(p))) {
    result.photographer = parts[i]
    i--
  }

  if (i >= front && isPointPart(parts[i])) {
    const pointFull = parts[i]
    result.pointNameEndsWithN = pointFull.endsWith('N')
    let pointBase = pointFull.replace(/N$/, '')
    let detectedPrefix = ''
    for (const p of getRecognizedPrefixes()) {
      if (pointBase.startsWith(p)) {
        detectedPrefix = p
        pointBase = pointBase.slice(p.length)
        break
      }
    }
    result.pointPrefix = detectedPrefix
    result.pointName = pointBase
    i--
  }

  if (i >= front && isFishPart(parts[i])) {
    result.fishName = parts[i]
    i--
  }

  return result
}

function extractOriginalBase(fileName) {
  const nameWithoutExt = fileName.includes('.') ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName
  const parsed = parseExistingFilename(nameWithoutExt)
  return parsed ? parsed.originalBase : nameWithoutExt.split('_')[0] || nameWithoutExt
}

function updateFilenamePreview() {
  const newName = buildNewFilename()
  const missing = getMissingBasicInfo()
  if (newName && missing.length === 0) {
    filenamePreviewEl.textContent = '→ ' + newName
    filenamePreviewEl.classList.remove('filename-preview-muted')
    filenamePreviewEl.classList.add('filename-preview-ok')
  } else {
    // 필수값이 하나라도 비면 실제로 Enter가 거부되므로, 미리보기도 준비 상태로 표시하지 않는다
    const current = imageFiles[currentIndex]
    const hint = missing.length > 0 ? `(필요: ${missing.join(', ')})` : '(물고기 이름을 입력하세요)'
    filenamePreviewEl.textContent = newName
      ? `→ ${newName} ${hint}`
      : (current ? `현재: ${current} ${hint}` : '')
    filenamePreviewEl.classList.remove('filename-preview-ok')
    filenamePreviewEl.classList.add('filename-preview-muted')
  }
}

function updateNavState() {
  viewerIndexEl.textContent = `${currentIndex + 1} / ${imageFiles.length}`
  btnPrev.disabled = currentIndex <= 0
  btnNext.disabled = currentIndex >= imageFiles.length - 1
}

function clearSuggestions() {
  suggestionRowEl.innerHTML = ''
  suggestionRowEl.classList.add('hidden')
}

function renderSuggestionMessage(text, klass) {
  suggestionRowEl.innerHTML = ''
  const span = document.createElement('span')
  span.className = klass
  span.textContent = text
  suggestionRowEl.appendChild(span)
  suggestionRowEl.classList.remove('hidden')
}

function renderSuggestionChips(candidates) {
  suggestionRowEl.innerHTML = ''
  const label = document.createElement('span')
  label.className = 'suggestion-label'
  label.textContent = '추천:'
  suggestionRowEl.appendChild(label)
  for (const c of candidates) {
    const chip = document.createElement('span')
    chip.className = 'suggestion-chip'
    chip.title = '클릭하면 입력칸에 채워집니다'
    const name = document.createElement('span')
    name.textContent = c.name
    chip.appendChild(name)
    if (typeof c.confidence === 'number' && c.confidence > 0) {
      const conf = document.createElement('span')
      conf.className = 'suggestion-chip-confidence'
      conf.textContent = `${Math.round(c.confidence * 100)}%`
      chip.appendChild(conf)
    }
    chip.addEventListener('click', () => {
      inputFishName.value = c.name
      chkUncertain.checked = false
      updateFilenamePreview()
      inputFishName.focus()
    })
    suggestionRowEl.appendChild(chip)
  }
  suggestionRowEl.classList.remove('hidden')
}

async function suggestCurrent() {
  if (isSuggesting) return
  if (!imageFiles.length || !currentFolder) return
  const fileName = imageFiles[currentIndex]
  if (isRawFile(fileName) || isVideoFile(fileName)) {
    renderSuggestionMessage('이 형식은 동정 미지원입니다.', 'suggestion-error')
    return
  }
  isSuggesting = true
  btnSuggest.disabled = true
  renderSuggestionMessage('추천 중... (Ollama 응답 대기)', 'suggestion-loading')
  try {
    const candidates = await invoke('suggest_species', {
      folderPath: currentFolder,
      fileName,
      ollamaEndpoint: ollamaEndpoint || null,
      ollamaModel: ollamaModel || null,
    })
    if (Array.isArray(candidates) && candidates.length > 0) {
      renderSuggestionChips(candidates)
    } else {
      renderSuggestionMessage('후보를 받지 못했습니다.', 'suggestion-error')
    }
  } catch (err) {
    const msg = typeof err === 'string' ? err : (err && err.message) || String(err)
    renderSuggestionMessage(msg, 'suggestion-error')
  } finally {
    isSuggesting = false
    btnSuggest.disabled = isRawFile(fileName) || isVideoFile(fileName)
  }
}

async function skipCurrent() {
  if (!imageFiles.length || !currentFolder) return
  const fileName = imageFiles[currentIndex]
  const result = await invoke('move_to_skip', { folderPath: currentFolder, fileName })
  if (result.success) {
    skipCount++
    delete fishInputCache[fileName]
    delete parsedCache[fileName]
    imageFiles.splice(currentIndex, 1)
    currentIndex = Math.min(currentIndex, Math.max(0, imageFiles.length - 1))
    statusLeft.textContent = `스킵: ${fileName} → Skip 폴더`
    await showCurrentImage({ focusInput: true })
  } else {
    statusLeft.textContent = `오류: ${result.error}`
  }
}

function getMissingBasicInfo() {
  const missing = []
  const fishRaw = inputFishName.value.trim()
  if (!chkUncertain.checked && !fishRaw) missing.push('물고기 이름')
  if (!inputPointName.value.trim()) missing.push('포인트이름')
  if (!inputPhotographer.value.trim()) missing.push('촬영자이름')
  if (!inputShootDate.value.trim()) missing.push('촬영일자')
  return missing
}

let isApplying = false
async function applyAndNext() {
  if (isApplying) return
  const missing = getMissingBasicInfo()
  if (missing.length > 0) {
    alert(`다음 항목을 입력해주세요:\n\n• ${missing.join('\n• ')}`)
    return
  }

  const newName = buildNewFilename()
  if (!newName || !currentFolder) return

  const oldName = imageFiles[currentIndex]
  if (oldName === newName) {
    statusLeft.textContent = '변경사항 없음 (동일한 파일명)'
    if (currentIndex < imageFiles.length - 1) {
      currentIndex++
      await showCurrentImage({ focusInput: true })
    }
    return
  }

  isApplying = true
  try {
    const result = await performRename(oldName, newName)

    if (result.success) {
      if (currentIndex < imageFiles.length - 1) {
        currentIndex++
        await showCurrentImage({ focusInput: true })
      } else {
        updateFilenamePreview()
        updateNavState()
        alert(`마지막 사진입니다.\n\n이름 변경: ${renameCount}개 / 스킵: ${skipCount}개`)
      }
    } else {
      statusLeft.textContent = `오류: ${result.error}`
      alert(`파일 이름 변경 실패:\n${result.error}`)
    }
  } catch (err) {
    console.error('[applyAndNext] exception:', err)
    statusLeft.textContent = `오류: ${err.message}`
    alert(`파일 이름 변경 중 예외 발생:\n${err.message}`)
  } finally {
    isApplying = false
  }
}

// ── 유틸 ─────────────────────────────────────────────────

function closeLightbox() {
  lightboxEl.classList.remove('active')
  lightboxVideoEl.pause()
  lightboxVideoEl.removeAttribute('src')
  lightboxVideoEl.classList.add('hidden')
  lightboxZoom = 1
  lightboxX = 0
  lightboxY = 0
}

function captureDefaultsFromForm() {
  savedDefaults = {
    pointPrefix: inputPointPrefix.value,
    pointName: inputPointName.value,
    photographerName: inputPhotographer.value,
    shootDate: inputShootDate.value,
    nightMode: chkNight.checked
  }
}

function saveDefaults() {
  invoke('save_defaults', {
    defaults: {
      ...savedDefaults,
      // 폼에 없는 설정(defaults.json 직접 편집)이 저장 시 유실되지 않도록 함께 기록
      ollamaEndpoint,
      ollamaModel
    }
  })
}

let saveDefaultsTimer = null
function debouncedSaveDefaults() {
  clearTimeout(saveDefaultsTimer)
  saveDefaultsTimer = setTimeout(saveDefaults, 300)
}

// ── 입력 이력 (지역/포인트) ───────────────────────────────
const HISTORY_PREFIX_MAX = 30
const HISTORY_POINT_MAX = 100
let history = { prefixes: [], points: [] }

async function loadHistory() {
  const h = await invoke('load_history')
  if (h && typeof h === 'object') {
    history.prefixes = Array.isArray(h.prefixes) ? h.prefixes.filter(s => typeof s === 'string') : []
    history.points = Array.isArray(h.points)
      ? h.points.filter(e => e && typeof e.name === 'string')
      : []
  }
  refreshPrefixDatalist()
  refreshPointNameDatalist()
}

function refreshPrefixDatalist() {
  pointPrefixHistoryEl.innerHTML = ''
  const seen = new Set()
  for (const p of history.prefixes) {
    if (p && !seen.has(p)) {
      seen.add(p)
      const opt = document.createElement('option')
      opt.value = p
      pointPrefixHistoryEl.appendChild(opt)
    }
  }
}

function refreshPointNameDatalist() {
  pointNameHistoryEl.innerHTML = ''
  const currentPrefix = inputPointPrefix.value.trim()
  const sorted = [...history.points].sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0))
  const matched = []
  const others = []
  const seen = new Set()
  for (const e of sorted) {
    if (!e.name || seen.has(e.name)) continue
    seen.add(e.name)
    if (currentPrefix && e.prefix === currentPrefix) {
      matched.push(e)
    } else {
      others.push(e)
    }
  }
  const ordered = currentPrefix ? [...matched, ...others] : others.concat(matched)
  for (const e of ordered) {
    const opt = document.createElement('option')
    opt.value = e.name
    if (e.prefix) opt.label = e.prefix
    pointNameHistoryEl.appendChild(opt)
  }
}

let saveHistoryTimer = null
function pushHistoryFromCurrent() {
  const prefix = inputPointPrefix.value.trim()
  const name = inputPointName.value.trim()
  const ts = Date.now()
  let changed = false

  if (prefix) {
    history.prefixes = [prefix, ...history.prefixes.filter(p => p !== prefix)].slice(0, HISTORY_PREFIX_MAX)
    changed = true
  }
  if (name) {
    history.points = [
      { prefix, name, lastUsed: ts },
      ...history.points.filter(e => !(e.name === name && (e.prefix || '') === prefix))
    ].slice(0, HISTORY_POINT_MAX)
    changed = true
  }
  if (!changed) return

  refreshPrefixDatalist()
  refreshPointNameDatalist()
  clearTimeout(saveHistoryTimer)
  saveHistoryTimer = setTimeout(() => {
    invoke('save_history', { history }).catch(() => {})
  }, 200)
}

// ── MyBox 연결 (1단계: 토큰 저장/검증 + 용량 조회) ─────────
// 설계: docs/mybox-upload-design.md
// 토큰 원문은 Rust 쪽 OS 키체인에만 있고 여기로 내려오지 않는다.
// 입력 필드에 잠깐 머무르는 값도 저장 직후 지운다.

const myboxModal     = document.getElementById('myboxModal')
const myboxStatusEl  = document.getElementById('myboxStatus')
const myboxTokenEl   = document.getElementById('myboxToken')
const myboxApiBaseEl = document.getElementById('myboxApiBase')
const myboxResultEl  = document.getElementById('myboxResult')
const myboxQuotaEl   = document.getElementById('myboxQuota')
const myboxRawWrap   = document.getElementById('myboxRawWrap')
const myboxRawEl     = document.getElementById('myboxRaw')
const myboxSaveBtn   = document.getElementById('myboxSave')
const myboxRefreshBtn = document.getElementById('myboxRefresh')
const myboxClearBtn  = document.getElementById('myboxClear')

let myboxStatus = null

function formatBytes(n) {
  if (n == null) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return (i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)) + ' ' + units[i]
}

function formatTimestamp(ms) {
  if (!ms) return null
  return new Date(ms).toLocaleString('ko-KR')
}

function setMyboxResult(text, kind) {
  if (!text) {
    myboxResultEl.classList.add('hidden')
    myboxResultEl.textContent = ''
    return
  }
  myboxResultEl.textContent = text
  myboxResultEl.className = 'mybox-result ' + kind
}

function setMyboxRaw(text) {
  if (!text) {
    myboxRawWrap.classList.add('hidden')
    myboxRawEl.textContent = ''
    return
  }
  myboxRawEl.textContent = text
  myboxRawWrap.classList.remove('hidden')
}

// Rust 쪽 CommandError { message, status, body } 또는 평문 문자열이 온다
function describeMyboxError(err) {
  if (typeof err === 'string') return { message: err, body: null }
  if (err && typeof err === 'object') {
    const status = err.status ? ` (HTTP ${err.status})` : ''
    return { message: (err.message || '알 수 없는 오류') + status, body: err.body || null }
  }
  return { message: String(err), body: null }
}

function renderMyboxStatus(status) {
  myboxStatus = status
  if (document.activeElement !== myboxApiBaseEl) {
    myboxApiBaseEl.value = status.apiBase || status.defaultApiBase
  }
  myboxApiBaseEl.placeholder = status.defaultApiBase

  myboxRefreshBtn.disabled = !status.configured
  myboxClearBtn.disabled = !status.configured

  if (status.keychainError) {
    myboxStatusEl.className = 'mybox-status warn'
    myboxStatusEl.textContent = '키체인에 접근할 수 없습니다 — ' + status.keychainError
    return
  }
  if (!status.configured) {
    myboxStatusEl.className = 'mybox-status'
    myboxStatusEl.textContent = '토큰이 설정되지 않았습니다.'
    return
  }
  if (status.invalid) {
    myboxStatusEl.className = 'mybox-status warn'
    myboxStatusEl.textContent =
      `토큰 ${status.maskedTail || ''} 이(가) 거부되었습니다. 만료되었을 수 있으니 새로 발급받아 주세요.`
    return
  }
  myboxStatusEl.className = 'mybox-status ok'
  const verified = formatTimestamp(status.lastVerifiedAtMs)
  myboxStatusEl.textContent =
    `연결됨 · ${status.maskedTail || ''}` + (verified ? ` · 마지막 확인 ${verified}` : '')
}

function renderMyboxQuota(quota) {
  const { usedBytes, quotaBytes, maxFileBytes } = quota
  if (usedBytes == null && quotaBytes == null) {
    // 스펙과 응답 구조가 다르다는 신호. 원문을 봐야 한다.
    myboxQuotaEl.classList.add('hidden')
    setMyboxResult(
      '응답은 성공했지만 usedBytes/quotaBytes 를 찾지 못했습니다. 아래 응답 원문을 보고 필드명을 확인해주세요.',
      'info'
    )
    return
  }
  myboxQuotaEl.textContent = ''
  const pct = (usedBytes != null && quotaBytes) ? Math.min(100, (usedBytes / quotaBytes) * 100) : null

  if (pct != null) {
    const bar = document.createElement('div')
    bar.className = 'mybox-quota-bar'
    const fill = document.createElement('span')
    fill.style.width = pct.toFixed(1) + '%'
    bar.appendChild(fill)
    myboxQuotaEl.appendChild(bar)
  }

  const rows = [
    ['사용 중', `${formatBytes(usedBytes)} / ${formatBytes(quotaBytes)}` + (pct != null ? ` (${pct.toFixed(1)}%)` : '')],
    ['파일 1개 최대', formatBytes(maxFileBytes)],
  ]
  for (const [label, value] of rows) {
    const row = document.createElement('div')
    row.className = 'mybox-quota-row'
    const l = document.createElement('span')
    l.textContent = label
    const v = document.createElement('strong')
    v.textContent = value
    row.append(l, v)
    myboxQuotaEl.appendChild(row)
  }
  myboxQuotaEl.classList.remove('hidden')
}

function setMyboxBusy(busy) {
  for (const btn of [myboxSaveBtn, myboxRefreshBtn, myboxClearBtn]) {
    btn.disabled = busy
  }
  if (!busy && myboxStatus) renderMyboxStatus(myboxStatus)
}

async function refreshMyboxStatus() {
  try {
    renderMyboxStatus(await invoke('mybox_token_status'))
  } catch (err) {
    const { message } = describeMyboxError(err)
    myboxStatusEl.className = 'mybox-status warn'
    myboxStatusEl.textContent = message
  }
}

async function openMyboxModal() {
  myboxTokenEl.value = ''
  setMyboxResult('')
  setMyboxRaw('')
  myboxQuotaEl.classList.add('hidden')
  myboxModal.classList.add('active')
  await refreshMyboxStatus()
  myboxTokenEl.focus()
}

function closeMyboxModal() {
  // 입력 중이던 토큰이 DOM에 남지 않게 한다
  myboxTokenEl.value = ''
  myboxModal.classList.remove('active')
}

document.getElementById('btnMybox').addEventListener('click', openMyboxModal)
document.getElementById('myboxClose').addEventListener('click', closeMyboxModal)
document.getElementById('myboxBackdrop').addEventListener('click', closeMyboxModal)

document.getElementById('myboxResetBase').addEventListener('click', () => {
  myboxApiBaseEl.value = myboxStatus ? myboxStatus.defaultApiBase : ''
  myboxApiBaseEl.focus()
})

myboxSaveBtn.addEventListener('click', async () => {
  const tokenValue = myboxTokenEl.value.trim()
  const apiBase = myboxApiBaseEl.value.trim()

  if (!tokenValue && !(myboxStatus && myboxStatus.configured)) {
    setMyboxResult('토큰을 입력해주세요.', 'error')
    return
  }

  setMyboxBusy(true)
  setMyboxResult('MyBox 서버에 확인하는 중…', 'info')
  setMyboxRaw('')
  myboxQuotaEl.classList.add('hidden')
  try {
    // 토큰을 새로 입력했으면 저장 후 검증, 아니면 주소만 바꾸고 재검증
    const status = tokenValue
      ? await invoke('mybox_set_token', { tokenValue, apiBase: apiBase || null })
      : await invoke('mybox_set_api_base', { apiBase: apiBase || null })
    myboxTokenEl.value = ''
    renderMyboxStatus(status)
    setMyboxResult(tokenValue ? '토큰을 확인하고 저장했습니다.' : 'API 주소를 저장했습니다.', 'ok')
    await loadMyboxQuota({ quiet: true })
  } catch (err) {
    const { message, body } = describeMyboxError(err)
    setMyboxResult(message, 'error')
    setMyboxRaw(body)
    await refreshMyboxStatus()
  } finally {
    setMyboxBusy(false)
  }
})

async function loadMyboxQuota({ quiet = false } = {}) {
  if (!quiet) {
    setMyboxBusy(true)
    setMyboxResult('용량을 불러오는 중…', 'info')
    setMyboxRaw('')
  }
  try {
    const quota = await invoke('mybox_get_quota')
    renderMyboxQuota(quota)
    // 1단계에서는 응답 구조 확인이 목적이므로 성공해도 원문을 남겨둔다
    setMyboxRaw(JSON.stringify(quota.raw, null, 2))
    if (!quiet && quota.usedBytes != null) setMyboxResult('')
    await refreshMyboxStatus()
  } catch (err) {
    const { message, body } = describeMyboxError(err)
    setMyboxResult(message, 'error')
    setMyboxRaw(body)
    await refreshMyboxStatus()
  } finally {
    if (!quiet) setMyboxBusy(false)
  }
}

myboxRefreshBtn.addEventListener('click', () => loadMyboxQuota())

myboxClearBtn.addEventListener('click', async () => {
  if (!confirm('저장된 MyBox 토큰을 삭제할까요?')) return
  setMyboxBusy(true)
  try {
    renderMyboxStatus(await invoke('mybox_clear_token'))
    myboxQuotaEl.classList.add('hidden')
    setMyboxRaw('')
    setMyboxResult('토큰을 삭제했습니다.', 'ok')
  } catch (err) {
    setMyboxResult(describeMyboxError(err).message, 'error')
  } finally {
    setMyboxBusy(false)
  }
})

// ── 업로드 대상 폴더 확인 ──────────────────────────────────
// 공유 받은 폴더/암호 폴더는 Open API 로 보이지 않는다.
// 업로드 대상으로 쓸 수 있는 폴더인지 눈으로 확인하기 위한 읽기 전용 조회.

const myboxFolderPathEl   = document.getElementById('myboxFolderPath')
const myboxFolderCheckBtn = document.getElementById('myboxFolderCheck')
const myboxFolderResultEl = document.getElementById('myboxFolderResult')

function renderFolderProbe(probe) {
  myboxFolderResultEl.textContent = ''
  const atRoot = !probe.queryPath
  const folders = probe.entries.filter(e => (e.itemType || '').toLowerCase() !== 'file')

  const summary = document.createElement('strong')
  summary.className = 'folder-summary'
  if (atRoot) {
    summary.textContent = probe.entries.length
      ? `최상위 ${probe.entries.length}개 (폴더 ${folders.length}개)`
      : '최상위가 비어 있습니다.'
    myboxFolderResultEl.className = 'mybox-folder-result'
  } else if (probe.found) {
    summary.textContent = `${probe.queryPath} — Open API 로 보입니다. 업로드 대상으로 쓸 수 있습니다.`
    myboxFolderResultEl.className = 'mybox-folder-result ok'
  } else {
    summary.textContent =
      `${probe.queryPath} — Open API 로 보이지 않습니다. 경로가 틀렸거나, 공유 받은 폴더 또는 암호 폴더일 수 있습니다.`
    myboxFolderResultEl.className = 'mybox-folder-result warn'
  }
  myboxFolderResultEl.appendChild(summary)

  if (!probe.entries.length) {
    myboxFolderResultEl.classList.remove('hidden')
    return
  }

  const list = document.createElement('ul')
  list.className = 'mybox-folder-list'

  const rows = probe.entries.map(entry => {
    const li = document.createElement('li')
    const name = document.createElement('span')
    name.textContent = entry.path || entry.name
    const type = document.createElement('span')
    type.className = 'entry-type'
    type.textContent = entry.itemType || (atRoot ? '' : '폴더')
    li.append(name, type)
    list.appendChild(li)
    return { li, text: (entry.path || entry.name).toLowerCase() }
  })

  // 최상위에 항목이 많으면 스크롤만으로는 찾기 어렵다. 이름으로 걸러낸다.
  if (probe.entries.length > 8) {
    const filter = document.createElement('input')
    filter.type = 'text'
    filter.className = 'mybox-folder-filter'
    filter.placeholder = '이름으로 거르기'
    filter.autocomplete = 'off'
    const count = document.createElement('span')
    count.className = 'entry-type'
    filter.addEventListener('input', () => {
      const q = filter.value.trim().toLowerCase()
      let shown = 0
      for (const row of rows) {
        const hit = !q || row.text.includes(q)
        row.li.classList.toggle('hidden', !hit)
        if (hit) shown++
      }
      count.textContent = q ? `${shown}개 일치` : ''
    })
    const bar = document.createElement('div')
    bar.className = 'mybox-folder-filterbar'
    bar.append(filter, count)
    myboxFolderResultEl.appendChild(bar)
  }

  myboxFolderResultEl.appendChild(list)

  if (probe.truncated) {
    const more = document.createElement('p')
    more.className = 'form-hint'
    more.textContent = '항목이 많아 일부만 표시했습니다.'
    myboxFolderResultEl.appendChild(more)
  }
  myboxFolderResultEl.classList.remove('hidden')
}

myboxFolderCheckBtn.addEventListener('click', async () => {
  myboxFolderCheckBtn.disabled = true
  setMyboxResult('폴더를 확인하는 중…', 'info')
  setMyboxRaw('')
  try {
    const probe = await invoke('mybox_probe_folder', { path: myboxFolderPathEl.value || null })
    renderFolderProbe(probe)
    setMyboxRaw(JSON.stringify(probe.raw, null, 2))
    setMyboxResult('')
  } catch (err) {
    const { message, body } = describeMyboxError(err)
    myboxFolderResultEl.classList.add('hidden')
    setMyboxResult(message, 'error')
    setMyboxRaw(body)
  } finally {
    myboxFolderCheckBtn.disabled = false
  }
})

myboxFolderPathEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    myboxFolderCheckBtn.click()
  }
})
