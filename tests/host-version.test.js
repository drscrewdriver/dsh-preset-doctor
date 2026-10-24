import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { detectDshVersion } from '../src/host-version.js'

const failResolve = () => ({ ok: false, resolvedVia: '', resolvedPath: '' })

function mkRoot(t, name, pkgDir, version) {
  const root = path.join(dir0(t), name)
  const dir = path.join(root, ...pkgDir.split('/'))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: pkgDir.split('/').slice(-2).join('/'), version }))
  return root
}

function dir0(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dshpm-hv-'))
  t.after(() => fs.rmSync(d, { recursive: true, force: true }))
  return d
}

test('detectDshVersion: 多副本取最高 semver（残留旧副本不再劫持判定）', (t) => {
  const rootA = mkRoot(t, 'a', '@deepseek-ai/dsh', '0.1.2-alpha.1')
  const rootB = mkRoot(t, 'b', '@deepseek-ai/dsh', '0.2.1-rc.3')
  const r = detectDshVersion({ resolve: failResolve, roots: [rootA, rootB] })
  assert.equal(r.version, '0.2.1-rc.3')
  assert.equal(r.copies, 2)
  assert.ok(r.via.startsWith('fs:'))
  assert.ok(r.path.replace(/\\/g, '/').includes('/b/'))
})

test('detectDshVersion: rc 与 alpha 排序正确（0.2.1-rc.1 > 0.2.1-alpha.5）', (t) => {
  const rootA = mkRoot(t, 'a', '@deepseek-ai/dsh', '0.2.1-alpha.5')
  const rootB = mkRoot(t, 'b', '@deepseek-ai/dsh-base', '0.2.1-rc.1')
  const r = detectDshVersion({ resolve: failResolve, roots: [rootA, rootB] })
  assert.equal(r.version, '0.2.1-rc.1')
})

test('detectDshVersion: 同目录多包名去重（一处副本只计一次）', (t) => {
  const root = dir0(t)
  for (const [pkg, ver] of [
    ['@deepseek-ai/dsh', '0.2.0-rc.2'],
    ['@deepseek-ai/dsh-web-app', '0.2.0-rc.2'],
  ]) {
    const dir = path.join(root, ...pkg.split('/'))
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: pkg, version: ver }))
  }
  const r = detectDshVersion({ resolve: failResolve, roots: [root] })
  assert.equal(r.version, '0.2.0-rc.2')
  assert.equal(r.copies, 2) // 两个不同目录各计一次（本例就是两个目录）
})

test('detectDshVersion: 无任何副本 fail-soft 返回 undefined', (t) => {
  const empty = dir0(t)
  const r = detectDshVersion({ resolve: failResolve, roots: [empty] })
  assert.equal(r, undefined)
})

test('detectDshVersion: Node 解析链命中也进候选池', (t) => {
  const root = mkRoot(t, 'cli', '@deepseek-ai/dsh', '0.2.1-rc.3')
  const hitFile = path.join(root, '@deepseek-ai', 'dsh', 'dist', 'index.js')
  fs.mkdirSync(path.dirname(hitFile), { recursive: true })
  fs.writeFileSync(hitFile, '')
  const r = detectDshVersion({
    resolve: (name) => (name === '@deepseek-ai/dsh' ? { ok: true, resolvedPath: hitFile } : { ok: false }),
    roots: [],
  })
  assert.equal(r.version, '0.2.1-rc.3')
  assert.equal(r.via, 'resolve:@deepseek-ai/dsh')
})

test('detectDshVersion: Electron resourcesPath 通道胜过 node_modules 残留（desktop 真宿主在 app.asar）', (t) => {
  const residue = mkRoot(t, 'residue', '@deepseek-ai/dsh', '0.1.2-alpha.1')
  const resDir = path.join(dir0(t), 'resources')
  const asarPkg = path.join(resDir, 'app.asar', 'node_modules', '@deepseek-ai', 'dsh')
  fs.mkdirSync(asarPkg, { recursive: true })
  fs.writeFileSync(path.join(asarPkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.3' }))
  const r = detectDshVersion({ resolve: failResolve, roots: [residue], resourcesPath: resDir })
  assert.equal(r.version, '0.2.1-rc.3')
  assert.ok(r.via.startsWith('electron:'))
})
