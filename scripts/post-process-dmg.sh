#!/bin/bash
# DMG 안의 .VolumeIcon.icns 등 숨김 파일에 macOS hidden flag(kIsInvisible)를 부여
# Tauri의 bundle_dmg.sh는 cp만 수행하고 chflags를 호출하지 않아서, Finder에서
# "숨김 파일 보기"(Cmd+Shift+.)가 켜진 사용자에게는 .VolumeIcon.icns가 노출됨.
#
# 사용법: post-process-dmg.sh <dmg-path>

set -e
DMG="$1"
if [ -z "$DMG" ] || [ ! -f "$DMG" ]; then
  echo "오류: DMG 파일을 찾을 수 없습니다. ($DMG)"
  exit 1
fi

WORK="$(mktemp -d -t dmg-postprocess)"
trap 'rm -rf "$WORK"' EXIT

echo ">>> [post-process-dmg] $(basename "$DMG")"
hdiutil convert "$DMG" -format UDRW -o "$WORK/rw.dmg" -quiet

MOUNT_INFO=$(hdiutil attach "$WORK/rw.dmg" -nobrowse -noverify -noautoopen)
MOUNT_DIR=$(echo "$MOUNT_INFO" | tail -1 | awk '{for(i=3;i<=NF;i++) printf "%s ", $i; print ""}' | sed 's/ *$//')

# 숨겨야 할 메타데이터 파일에 hidden flag 부여
for f in ".VolumeIcon.icns" ".DS_Store" ".background" ".fseventsd" ".Trashes"; do
  if [ -e "$MOUNT_DIR/$f" ]; then
    chflags hidden "$MOUNT_DIR/$f" 2>/dev/null || true
  fi
done

hdiutil detach "$MOUNT_DIR" -quiet
hdiutil convert "$WORK/rw.dmg" -format UDZO -imagekey zlib-level=9 -o "$WORK/final.dmg" -quiet
mv "$WORK/final.dmg" "$DMG"
echo "    → hidden flag 적용 완료"
