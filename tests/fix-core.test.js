import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeFileSafe, spliceEdits, defaultTimestamp, detectEol } from '../src/fix/core.js'

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshpm-fix-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('writeFileSafe: 内容相同 → skipped（幂等）', (t) => {
  const dir = tmp(t)
  const file = path.join(dir, 'a.yml')
  fs.writeFileSync(file, 'x: 1\n')
  const r = writeFileSafe(file, 'x: 1\n', 'x: 1\n')
  assert.equal(r.status, 'skipped')
  assert.equal(fs.readFileSync(file, 'utf8'), 'x: 1\n')
})

test('writeFileSafe: dryRun → would-write 且 0 写盘', (t) => {
  const dir = tmp(t)
  const file = path.join(dir, 'a.yml')
  fs.writeFileSync(file, 'old\n')
  const r = writeFileSafe(file, 'new\n', 'old\n', { dryRun: true, ts: '20260930T000000' })
  assert.equal(r.status, 'would-write')
  assert.equal(fs.readFileSync(file, 'utf8'), 'old\n')
  assert.ok(!fs.existsSync(path.join(dir, 'a.yml.bak-20260930T000000')))
})

test('writeFileSafe: 写前备份 + 原子替换 + 无 tmp 残留', (t) => {
  const dir = tmp(t)
  const file = path.join(dir, 'a.yml')
  fs.writeFileSync(file, 'original-content\n')
  const r = writeFileSafe(file, 'new-content\n', 'original-content\n', { ts: '20260930T010203' })
  assert.equal(r.status, 'written')
  assert.equal(fs.readFileSync(file, 'utf8'), 'new-content\n')
  const backup = path.join(dir, 'a.yml.bak-20260930T010203')
  assert.equal(fs.readFileSync(backup, 'utf8'), 'original-content\n')
  // 无 tmp 残留
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.tmp-preset-manager')), [])
})

test('writeFileSafe: 同 ts 二次写不覆盖首备（最初的原文优先）', (t) => {
  const dir = tmp(t)
  const file = path.join(dir, 'a.yml')
  fs.writeFileSync(file, 'v1\n')
  const ts = '20260930T010203'
  writeFileSafe(file, 'v2\n', 'v1\n', { ts })
  writeFileSafe(file, 'v3\n', 'v2\n', { ts })
  assert.equal(fs.readFileSync(path.join(dir, `a.yml.bak-${ts}`), 'utf8'), 'v1\n')
  assert.equal(fs.readFileSync(file, 'utf8'), 'v3\n')
})

test('spliceEdits: 从后往前替换 + 重叠检测', () => {
  const text = 'aaa bbb ccc'
  const out = spliceEdits(text, [
    { start: 0, end: 3, text: 'AAA' },
    { start: 8, end: 11, text: 'CCC' },
  ])
  assert.equal(out, 'AAA bbb CCC')
  assert.throws(() =>
    spliceEdits(text, [
      { start: 0, end: 5, text: 'x' },
      { start: 4, end: 8, text: 'y' },
    ]),
  )
  assert.throws(() => spliceEdits(text, [{ start: -1, end: 3, text: 'x' }]))
})

test('detectEol 与 defaultTimestamp', () => {
  assert.equal(detectEol('a\r\nb\r\n'), '\r\n')
  assert.equal(detectEol('a\nb'), '\n')
  const ts = defaultTimestamp(new Date(2026, 8, 30, 4, 5, 6))
  assert.equal(ts, '20260930T040506')
})
