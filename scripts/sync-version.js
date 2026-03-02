#!/usr/bin/env node
/**
 * build/version.json의 버전을 package.json, tauri.conf.json, Cargo.toml에 동기화
 * 사용법: node scripts/sync-version.js [버전]
 *   인자 없음: build/version.json에서 읽어서 sync
 *   인자 있음: build/version.json 업데이트 후 sync
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VERSION_FILE = path.join(ROOT, 'build', 'version.json');

function getVersion() {
  const data = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
  if (!data.version) throw new Error('build/version.json에 version 필드가 없습니다.');
  return data.version;
}

function setVersion(version) {
  fs.writeFileSync(VERSION_FILE, JSON.stringify({ version }, null, 2) + '\n');
}

function syncToPackageJson(version) {
  const file = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  pkg.version = version;
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
}

function syncToTauriConf(version) {
  const file = path.join(ROOT, 'src-tauri', 'tauri.conf.json');
  const conf = JSON.parse(fs.readFileSync(file, 'utf8'));
  conf.version = version;
  fs.writeFileSync(file, JSON.stringify(conf, null, 2) + '\n');
}

function syncToCargoToml(version) {
  const file = path.join(ROOT, 'src-tauri', 'Cargo.toml');
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/^version = "[^"]+"/m, `version = "${version}"`);
  fs.writeFileSync(file, content);
}

const versionArg = process.argv[2];
let version;

if (versionArg) {
  version = versionArg.replace(/^v/, '');
  setVersion(version);
  console.log('→ build/version.json 업데이트:', version);
} else {
  version = getVersion();
}

syncToPackageJson(version);
syncToTauriConf(version);
syncToCargoToml(version);
console.log('→ 버전 동기화 완료:', version);
