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

async function loadImages() {
  if (!currentFolder) return
  imageFiles = await invoke('read_files', { folderPath: currentFolder })
  currentIndex = 0
  fishInputCache = {}
  parsedCache = {}
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
    return
  }

  btnSkip.disabled = false
  emptyStateEl.classList.add('hidden')

  const fileName = imageFiles[currentIndex]
  const isVideo = isVideoFile(fileName)
  btnSuggest.disabled = isVideo || isRawFile(fileName)

  if (isVideo) {
    videoPreviewEl.pause()
    videoPreviewEl.src = convertFileSrc(joinPath(currentFolder, fileName))
    videoPreviewEl.classList.remove('hidden')
    imagePreviewEl.src = ''
    imagePreviewEl.classList.add('hidden')
  } else {
    const ext = getExt(fileName)
    imagePreviewEl.src = isRawFile(fileName)
      ? makePlaceholderSvg(ext)
      : convertFileSrc(joinPath(currentFolder, fileName))
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
