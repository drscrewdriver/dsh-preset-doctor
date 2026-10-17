import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parsePatchFile } from '../src/scan.js'
import { runToggle } from '../src/fix/index.js'

const PATCH = `- insert:
    - id: preset-standard
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: standard
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
          - id: time-context
            name: '@deepseek-ai/dsh-time-context'
          - id: tool-subagent-codex
            name: '@deepseek-ai/dsh-tool-subagent-codex'
`

function tmpPatch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-toggle-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'cordis.patch.yml')
  fs.writeFileSync(file, PATCH, 'utf8')
  return file
}

function scan(file) {
  return { sources: [parsePatchFile(file, 'profile', 'web')], findings: [], detectedVersion: '0.2.1-rc.1' }
}

test('toggle 关 time-context：插入 disabled:true，其余字节不动', (t) => {
  const file = tmpPatch(t)
  const r = runToggle(scan(file), { file, presetId: 'standard', rowId: 'time-context', disabled: true, confirm: true, ts: 'T1' })
  assert.equal(r.status, 'written')
  const after = fs.readFileSync(file, 'utf8')
  assert.match(after, /- id: time-context\n\s+disabled: true/, 'time-context 下应有 disabled: true')
  assert.ok(after.includes('persona'), 'persona 保留')
  assert.ok(fs.existsSync(`${file}.bak-T1`), '写前 .bak')
})

test('toggle 幂等：已 disabled 再关 → already-disabled', (t) => {
  const file = tmpPatch(t)
  runToggle(scan(file), { file, presetId: 'standard', rowId: 'time-context', disabled: true, confirm: true, ts: 'T1' })
  const before = fs.readFileSync(file, 'utf8')
  const r2 = runToggle(scan(file), { file, presetId: 'standard', rowId: 'time-context', disabled: true, confirm: true, ts: 'T2' })
  assert.equal(r2.status, 'already-disabled')
  assert.equal(fs.readFileSync(file, 'utf8'), before, '不重复插入')
})

test('toggle 开：删除 disabled 行，回到原结构', (t) => {
  const file = tmpPatch(t)
  runToggle(scan(file), { file, presetId: 'standard', rowId: 'time-context', disabled: true, confirm: true, ts: 'T1' })
  const r = runToggle(scan(file), { file, presetId: 'standard', rowId: 'time-context', disabled: false, confirm: true, ts: 'T2' })
  assert.equal(r.status, 'written')
  const after = fs.readFileSync(file, 'utf8')
  assert.ok(!/disabled:\s*true/.test(after), 'disabled 行已移除')
  assert.match(after, /- id: time-context\n\s+name:/, 'time-context 结构复原')
})

test('toggle 缺 confirm → 拒绝且不写盘', (t) => {
  const file = tmpPatch(t)
  const before = fs.readFileSync(file, 'utf8')
  const r = runToggle(scan(file), { file, presetId: 'standard', rowId: 'time-context', disabled: true, ts: 'T1' })
  assert.equal(r.status, 'rejected')
  assert.equal(fs.readFileSync(file, 'utf8'), before, '未确认不写盘')
})

test('toggle 行不在预设内 → row-not-in-preset（提示物化）', (t) => {
  const file = tmpPatch(t)
  const r = runToggle(scan(file), { file, presetId: 'standard', rowId: 'tool-schedule', disabled: true, confirm: true })
  assert.equal(r.status, 'row-not-in-preset')
  assert.match(r.errors[0].message, /物化/)
})

test('toggle mode=off/on 与旧 disabled 布尔等价', (t) => {
  const file = tmpPatch(t)
  const r = runToggle(scan(file), { file, presetId: 'standard', rowId: 'time-context', mode: 'off', confirm: true, ts: 'T1' })
  assert.equal(r.status, 'written')
  assert.match(fs.readFileSync(file, 'utf8'), /- id: time-context\n\s+disabled: true/)
  const r2 = runToggle(scan(file), { file, presetId: 'standard', rowId: 'time-context', mode: 'on', confirm: true, ts: 'T2' })
  assert.equal(r2.status, 'written')
  assert.ok(!/disabled:\s*true/.test(fs.readFileSync(file, 'utf8')))
})

test('toggle mode=follow 按当前版本 standard 默认解析（在→启用 / 不在→禁用）', (t) => {
  const file = tmpPatch(t)
  // time-context ∈ 0.2.1 standard → 先关再 follow 应回到启用
  runToggle(scan(file), { file, presetId: 'standard', rowId: 'time-context', mode: 'off', confirm: true, ts: 'T1' })
  const r = runToggle(scan(file), { file, presetId: 'standard', rowId: 'time-context', mode: 'follow', confirm: true, ts: 'T2' })
  assert.equal(r.status, 'written')
  assert.equal(r.defaultOn, true)
  assert.equal(r.disabled, false)
  assert.ok(!/disabled:\s*true/.test(fs.readFileSync(file, 'utf8')), 'follow 默认启用→去 disabled')
  // tool-subagent-codex ∉ 0.2.1 standard → follow 应写 disabled:true
  const r2 = runToggle(scan(file), { file, presetId: 'standard', rowId: 'tool-subagent-codex', mode: 'follow', confirm: true, ts: 'T3' })
  assert.equal(r2.status, 'written')
  assert.equal(r2.defaultOn, false)
  assert.equal(r2.disabled, true)
  assert.match(fs.readFileSync(file, 'utf8'), /- id: tool-subagent-codex\n\s+disabled: true/)
})
