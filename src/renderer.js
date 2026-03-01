let currentFolder = null
let imageFiles = []      // 이미지 파일명 배열
let currentIndex = 0     // 현재 보고 있는 이미지 인덱스
const fishInputCache = {}  // 파일명별 물고기 입력 저장 (이전/다음 이동 시 복원)
const parsedCache = {}  // 파일명별 파싱 결과 캐시 (originalBase, fishName 등)

const folderPathEl      = document.getElementById('folderPath')
const headerStatsEl     = document.getElementById('headerStats')
const emptyStateEl     = document.getElementById('emptyState')
const imagePreviewEl   = document.getElementById('imagePreview')
const inputFishName    = document.getElementById('inputFishName')
const chkJuvenile      = document.getElementById('chkJuvenile')
const chkUncertain     = document.getElementById('chkUncertain')
const filenamePreviewEl = document.getElementById('filenamePreview')
const viewerIndexEl    = document.getElementById('viewerIndex')
const inputPointPrefix = document.getElementById('inputPointPrefix')
const inputPointName   = document.getElementById('inputPointName')
const inputPhotographer = document.getElementById('inputPhotographer')
const inputShootDate   = document.getElementById('inputShootDate')
const chkNight         = document.getElementById('chkNight')
const btnSelect       = document.getElementById('btnSelectFolder')
const btnReload       = document.getElementById('btnReload')
const btnPrev         = document.getElementById('btnPrev')
const btnNext         = document.getElementById('btnNext')
const btnSkip         = document.getElementById('btnSkip')
const btnToday        = document.getElementById('btnToday')
const statusLeft      = document.getElementById('statusLeft')
const statusRight     = document.getElementById('statusRight')
const lightboxEl       = document.getElementById('lightbox')
const lightboxImageEl  = document.getElementById('lightboxImage')
const lightboxZoomWrap = document.getElementById('lightboxZoomWrap')
const lightboxBackdrop = document.querySelector('.lightbox-backdrop')
const lightboxZoomIn   = document.getElementById('lightboxZoomIn')
const lightboxZoomOut  = document.getElementById('lightboxZoomOut')
const lightboxZoomValue = document.getElementById('lightboxZoomValue')

// ── 초기화: 기본값 로드 ────────────────────────────────────

;(async function loadDefaultsOnInit() {
  const defaults = await window.api.loadDefaults()
  if (defaults) {
    inputPointPrefix.value = defaults.pointPrefix != null ? defaults.pointPrefix : '남애'
    if (defaults.pointName != null) inputPointName.value = defaults.pointName
    if (defaults.photographerName != null) inputPhotographer.value = defaults.photographerName
    if (defaults.shootDate != null) inputShootDate.value = defaults.shootDate
    if (defaults.nightMode != null) chkNight.checked = defaults.nightMode
  } else {
    inputPointPrefix.value = '남애'
  }
})()

// ── 이벤트 ────────────────────────────────────────────────

btnSelect.addEventListener('click', async () => {
  const folder = await window.api.selectFolder()
  if (!folder) return
  currentFolder = folder
  folderPathEl.textContent = folder
  await loadImages()
})

btnReload.addEventListener('click', loadImages)

btnPrev.addEventListener('click', () => goToIndex(currentIndex - 1))
btnNext.addEventListener('click', () => goToIndex(currentIndex + 1))

btnSkip.addEventListener('click', skipCurrent)

btnToday.addEventListener('click', () => {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  inputShootDate.value = `${y}${m}${d}`
  saveDefaults()
  updateFilenamePreview()
})

// 기본값 변경 시 저장 및 파일명 미리보기 갱신
inputPointPrefix.addEventListener('input', debouncedSaveDefaults)
inputPointPrefix.addEventListener('input', updateFilenamePreview)
inputPointName.addEventListener('input', debouncedSaveDefaults)
inputPointName.addEventListener('input', updateFilenamePreview)
inputPhotographer.addEventListener('input', debouncedSaveDefaults)
inputPhotographer.addEventListener('input', updateFilenamePreview)
inputShootDate.addEventListener('input', debouncedSaveDefaults)
inputShootDate.addEventListener('input', updateFilenamePreview)
chkNight.addEventListener('change', debouncedSaveDefaults)
chkNight.addEventListener('change', updateFilenamePreview)

// 이미지 클릭 시 확대 뷰어
imagePreviewEl.addEventListener('click', () => {
  if (imagePreviewEl.src && !imagePreviewEl.classList.contains('hidden')) {
    lightboxImageEl.src = imagePreviewEl.src
    lightboxZoom = 1
    lightboxX = 0
    lightboxY = 0
    applyLightboxTransform()
    lightboxEl.classList.add('active')
  }
})

lightboxBackdrop.addEventListener('click', closeLightbox)
lightboxZoomWrap.addEventListener('click', (e) => e.stopPropagation())

// 확대 뷰어 줌 상태
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

// 더블클릭 확대 (1x ↔ 2x 토글)
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

// 트랙패드 두손가락 스퀴즈 (wheel + ctrlKey)
lightboxEl.addEventListener('wheel', (e) => {
  if (!lightboxEl.classList.contains('active')) return
  if (e.ctrlKey) {
    e.preventDefault()
    const delta = -e.deltaY * 0.002
    lightboxZoom = Math.max(0.25, Math.min(5, lightboxZoom + delta))
    applyLightboxTransform()
  }
}, { passive: false })

// 터치 두손가락 스퀴즈
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

// 드래그로 패닝 (줌된 상태에서)
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

// 물고기 이름/체크박스 변경 시 미리보기 갱신
inputFishName.addEventListener('input', updateFilenamePreview)
inputFishName.addEventListener('input', debouncedSaveDefaults)

// 키보드: Enter로 파일명 변경 + 다음 이미지, 화살표로 이전/다음, ESC로 확대 뷰어 닫기
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeLightbox()
    return
  }
  if (lightboxEl.classList.contains('active')) return
  if (!imageFiles.length) return
  if (e.key === 'Enter' && !e.target.matches('textarea')) {
    e.preventDefault()
    applyAndNext()
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    if (!btnPrev.disabled) goToIndex(currentIndex - 1)
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    if (!btnNext.disabled) goToIndex(currentIndex + 1)
  }
})
chkJuvenile.addEventListener('change', updateFilenamePreview)
chkUncertain.addEventListener('change', updateFilenamePreview)

// ── 핵심 로직 ────────────────────────────────────────────

async function loadImages() {
  if (!currentFolder) return
  imageFiles = await window.api.readFiles(currentFolder)
  currentIndex = 0
  for (const k of Object.keys(fishInputCache)) delete fishInputCache[k]
  for (const k of Object.keys(parsedCache)) delete parsedCache[k]
  btnReload.disabled = false
  btnPrev.disabled = false
  btnNext.disabled = false
  btnSkip.disabled = !imageFiles.length
  headerStatsEl.textContent = imageFiles.length ? `${imageFiles.length}개 이미지` : '이미지 없음'
  statusLeft.textContent = imageFiles.length ? `총 ${imageFiles.length}개` : '준비'
  await showCurrentImage()
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

async function renameCurrentIfReady() {
  const newName = buildNewFilename()
  if (!newName || !currentFolder) return
  const oldName = imageFiles[currentIndex]
  if (oldName === newName) return
  try {
    const result = await window.api.renameFile({ folderPath: currentFolder, oldName, newName })
    if (result.success) {
      if (parsedCache[oldName]) {
        parsedCache[newName] = parsedCache[oldName]
        delete parsedCache[oldName]
      }
      if (fishInputCache[oldName]) delete fishInputCache[oldName]
      imageFiles[currentIndex] = newName
      statusLeft.textContent = `변경 완료: ${newName}`
    }
  } catch (err) {
    console.error('[renameCurrentIfReady]', err)
  }
}

async function goToIndex(idx) {
  if (idx < 0 || idx >= imageFiles.length) return
  saveCurrentFishInput()
  await renameCurrentIfReady()
  currentIndex = idx
  await showCurrentImage()
}

async function showCurrentImage() {
  if (!imageFiles.length) {
    emptyStateEl.classList.remove('hidden')
    imagePreviewEl.classList.add('hidden')
    imagePreviewEl.src = ''
    filenamePreviewEl.textContent = ''
    viewerIndexEl.textContent = '0 / 0'
    btnPrev.disabled = true
    btnNext.disabled = true
    btnSkip.disabled = true
    return
  }

  btnSkip.disabled = false

  emptyStateEl.classList.add('hidden')
  imagePreviewEl.classList.remove('hidden')

  const fileName = imageFiles[currentIndex]
  const dataUrl = await window.api.getImageData(currentFolder, fileName)
  imagePreviewEl.src = dataUrl
  imagePreviewEl.alt = fileName

  const nameWithoutExt = fileName.includes('.') ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName
  let parsed = parsedCache[fileName]
  if (!parsed) {
    parsed = parseExistingFilename(nameWithoutExt)
    if (!parsed) {
      parsed = { originalBase: nameWithoutExt, fishName: null, pointPrefix: '', pointName: '', pointNameEndsWithN: false, photographer: null, shootDate: null }
    }
    parsedCache[fileName] = parsed
  }

  // 물고기 입력: 저장된 값이 있으면 복원, 없으면 파싱 또는 빈값
  const cached = fishInputCache[fileName]
  if (cached) {
    inputFishName.value = cached.fishName
    chkJuvenile.checked = cached.chkJuvenile
    chkUncertain.checked = cached.chkUncertain
  } else if (parsed && parsed.fishName) {
    let displayName = parsed.fishName
    chkJuvenile.checked = displayName.endsWith('J')
    chkUncertain.checked = /^\(.+\)$/.test(displayName)
    if (chkJuvenile.checked) displayName = displayName.slice(0, -1)
    if (chkUncertain.checked) displayName = displayName.replace(/^\(|\)$/g, '')
    inputFishName.value = displayName === '물고기' ? '' : displayName
  } else {
    inputFishName.value = ''
    chkJuvenile.checked = false
    chkUncertain.checked = false
  }

  // 기본정보는 파싱된 파일에서 유의미한 값이 있을 때만 채움
  if (parsed && (parsed.pointName || parsed.photographer || parsed.shootDate)) {
    if (parsed.pointPrefix != null) inputPointPrefix.value = parsed.pointPrefix
    inputPointName.value = parsed.pointName || ''
    chkNight.checked = parsed.pointNameEndsWithN
    inputPhotographer.value = parsed.photographer || ''
    inputShootDate.value = parsed.shootDate || ''
  }

  updateFilenamePreview()
  updateNavState()
  inputFishName.focus()
}

function getEffectivePointName() {
  const base = inputPointName.value.trim()
  return chkNight.checked ? base + 'N' : base
}

/** 파일명 생성: 에디터 값으로 round-trip. {원본}_{물고기}_[포인트]_[촬영자]_[날짜].확장자 */
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
    return null  // 물고기 이름은 필수
  }

  const oldName = imageFiles[currentIndex]
  const ext = oldName.includes('.') ? oldName.substring(oldName.lastIndexOf('.')) : '.jpg'

  const parsed = parsedCache[oldName]
  const originalBase = parsed ? parsed.originalBase : (
    oldName.includes('.') ? oldName.substring(0, oldName.lastIndexOf('.')) : oldName
  )

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

/** 유연 파서: 끝에서부터 역순으로 날짜/촬영자/지역/물고기 추출 */
const KNOWN_PREFIXES = ['남애', '북애', '동애', '서애', '속초', '고성']

function is8DigitDate(s) {
  return /^\d{8}$/.test(s)
}

function isPhotographer(s) {
  return /^[가-힣]{2,4}$/.test(s) && !s.includes('물') && !s.includes('고기')
}

function isPointPart(s) {
  if (!s || /^\d+$/.test(s)) return false
  for (const p of KNOWN_PREFIXES) {
    if (s.startsWith(p)) return true
  }
  return false
}

function isFishPart(s) {
  if (!s) return false
  if (/^\(.+\)$/.test(s)) return true  // (물고기), (노래미)
  if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(s)) return true
  return false
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

  let i = parts.length - 1

  // 1. 끝이 8자리 날짜?
  if (i >= 0 && is8DigitDate(parts[i])) {
    result.shootDate = parts[i]
    i--
  }

  // 2. 그 앞이 촬영자?(한글 2~4자)
  if (i >= 0 && isPhotographer(parts[i]) && !KNOWN_PREFIXES.some(p => parts[i].startsWith(p))) {
    result.photographer = parts[i]
    i--
  }

  // 3. 그 앞이 지역/포인트?
  if (i >= 0 && isPointPart(parts[i])) {
    const pointFull = parts[i]
    result.pointNameEndsWithN = pointFull.endsWith('N')
    let pointBase = pointFull.replace(/N$/, '')
    let detectedPrefix = ''
    for (const p of KNOWN_PREFIXES) {
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

  // 4. 그 앞이 물고기?
  if (i >= 0 && isFishPart(parts[i])) {
    result.fishName = parts[i]
    i--
  }

  // 5. 남은 앞부분 = originalBase
  result.originalBase = i >= 0 ? parts.slice(0, i + 1).join('_') : parts[0] || ''

  return result
}

function updateFilenamePreview() {
  const newName = buildNewFilename()
  if (newName) {
    filenamePreviewEl.textContent = '→ ' + newName
    filenamePreviewEl.classList.remove('filename-preview-muted')
    filenamePreviewEl.classList.add('filename-preview-ok')
  } else {
    const current = imageFiles[currentIndex]
    const missing = getMissingBasicInfo()
    const hint = missing.length > 0 ? `(필요: ${missing.join(', ')})` : '(물고기 이름을 입력하세요)'
    filenamePreviewEl.textContent = current ? `현재: ${current} ${hint}` : ''
    filenamePreviewEl.classList.remove('filename-preview-ok')
    filenamePreviewEl.classList.add('filename-preview-muted')
  }
}

function updateNavState() {
  viewerIndexEl.textContent = `${currentIndex + 1} / ${imageFiles.length}`
  btnPrev.disabled = currentIndex <= 0
  btnNext.disabled = currentIndex >= imageFiles.length - 1
}

async function skipCurrent() {
  if (!imageFiles.length || !currentFolder) return
  const fileName = imageFiles[currentIndex]
  const result = await window.api.moveToSkip({ folderPath: currentFolder, fileName })
  if (result.success) {
    imageFiles = await window.api.readFiles(currentFolder)
    currentIndex = Math.min(currentIndex, Math.max(0, imageFiles.length - 1))
    statusLeft.textContent = `스킵: ${fileName} → Skip 폴더`
    await showCurrentImage()
  } else {
    statusLeft.textContent = `오류: ${result.error}`
  }
}

/** 기본정보 미입력 항목 반환 (물고기만 필수, 나머지는 선택) */
function getMissingBasicInfo() {
  const missing = []
  const fishRaw = inputFishName.value.trim()
  if (!chkUncertain.checked && !fishRaw) missing.push('물고기 이름')
  return missing
}

async function applyAndNext() {
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
      await showCurrentImage()
    }
    return
  }

  try {
    const result = await window.api.renameFile({ folderPath: currentFolder, oldName, newName })

    if (result.success) {
      if (parsedCache[oldName]) {
        parsedCache[newName] = parsedCache[oldName]
        delete parsedCache[oldName]
      }
      if (fishInputCache[oldName]) {
        delete fishInputCache[oldName]
      }
      imageFiles[currentIndex] = newName
      statusLeft.textContent = `변경 완료: ${newName}`
      // 다음 이미지로 이동
      if (currentIndex < imageFiles.length - 1) {
        currentIndex++
        await showCurrentImage()
      } else {
        inputFishName.value = ''
        updateFilenamePreview()
        updateNavState()
      }
    } else {
      statusLeft.textContent = `오류: ${result.error}`
      alert(`파일 이름 변경 실패:\n${result.error}`)
    }
  } catch (err) {
    console.error('[applyAndNext] exception:', err)
    statusLeft.textContent = `오류: ${err.message}`
    alert(`파일 이름 변경 중 예외 발생:\n${err.message}`)
  }
}

// ── 유틸 ─────────────────────────────────────────────────

function closeLightbox() {
  lightboxEl.classList.remove('active')
  lightboxZoom = 1
  lightboxX = 0
  lightboxY = 0
}

function saveDefaults() {
  window.api.saveDefaults({
    pointPrefix: inputPointPrefix.value,
    pointName: inputPointName.value,
    photographerName: inputPhotographer.value,
    shootDate: inputShootDate.value,
    nightMode: chkNight.checked
  })
}

let saveDefaultsTimer = null
function debouncedSaveDefaults() {
  clearTimeout(saveDefaultsTimer)
  saveDefaultsTimer = setTimeout(saveDefaults, 300)
}
