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

test('toggle 开（旧布尔 disabled:false → follow）：删 disabled 行，回到原结构', (t) => {
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

test('toggle mode=off 与旧 disabled:true 等价；on 为显式强制开', (t) => {
  const file = tmpPatch(t)
  const r = runToggle(scan(file), { file, presetId: 'standard', rowId: 'time-context', mode: 'off', confirm: true, ts: 'T1' })
  assert.equal(r.status, 'written')
  assert.match(fs.readFileSync(file, 'utf8'), /- id: time-context\n\s+disabled: true/)
  const r2 = runToggle(scan(file), { file, presetId: 'standard', rowId: 'time-context', mode: 'on', confirm: true, ts: 'T2' })
  assert.equal(r2.status, 'written')
  assert.ok(!/disabled:\s*true/.test(fs.readFileSync(file, 'utf8')), 'time-context 属参照默认集→on 即删键')
})

test('toggle 真值表：follow=删键；官方 false 行解析停用；官方空行 on 写 disabled:false', (t) => {
  const file = tmpPatch(t)
  // time-context ∈ 0.2.1 standard：先 off 再 follow → 删键回到启用
  runToggle(scan(file), { file, presetId: 'standard', rowId: 'time-context', mode: 'off', confirm: true, ts: 'T1' })
  const r = runToggle(scan(file), { file, presetId: 'standard', rowId: 'time-context', mode: 'follow', confirm: true, ts: 'T2' })
  assert.equal(r.status, 'written')
  assert.equal(r.defaultOn, true)
  assert.ok(!/disabled:\s*true/.test(fs.readFileSync(file, 'utf8')), 'follow = 删键')
  // tool-subagent-codex ∉ 0.2.1 参照默认集 → 官方停用 → 无值即解析 false；
  // 无键已是跟随态，所以 follow 不写盘（落盘停用是对齐/关闭档的事）
  const r2 = runToggle(scan(file), { file, presetId: 'standard', rowId: 'tool-subagent-codex', mode: 'follow', confirm: true, ts: 'T3' })
  assert.equal(r2.status, 'already-follow', '无键已是跟随态')
  assert.equal(r2.defaultOn, false, '官方 false → 解析 false')
  assert.equal(r2.inRefSet, false, '回报：不在参照默认集')
  assert.ok(!/tool-subagent-codex[\s\S]{0,40}disabled:/.test(fs.readFileSync(file, 'utf8')), 'follow 不写盘')
  // 要强制保留它，用 on 写显式 disabled:false（对齐会再退避，但手动意图可表达）
  const r3 = runToggle(scan(file), { file, presetId: 'standard', rowId: 'tool-subagent-codex', mode: 'on', confirm: true, ts: 'T4' })
  assert.equal(r3.status, 'written')
  assert.match(fs.readFileSync(file, 'utf8'), /- id: tool-subagent-codex\r?\n\s+disabled: false/)
})

test('toggle 官方空行（任何基线都无）：on 写 disabled:false，follow 删键', (t) => {
  const text = PATCH.replace(
    "          - id: tool-subagent-codex\n            name: '@deepseek-ai/dsh-tool-subagent-codex'\n",
    "          - id: my-third-party-tool\n            name: 'some-third-party-tool'\n",
  )
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-toggle-abs-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'cordis.patch.yml')
  fs.writeFileSync(file, text, 'utf8')
  const r = runToggle(scan(file), { file, presetId: 'standard', rowId: 'my-third-party-tool', mode: 'on', confirm: true, ts: 'T1' })
  assert.equal(r.status, 'written')
  assert.equal(r.defaultOn, false, '官方空→跟随解析为停用')
  assert.match(fs.readFileSync(file, 'utf8'), /- id: my-third-party-tool\r?\n\s+disabled: false/, '强制开要显式载体')
  const r2 = runToggle(scan(file), { file, presetId: 'standard', rowId: 'my-third-party-tool', mode: 'follow', confirm: true, ts: 'T2' })
  assert.equal(r2.status, 'written')
  assert.ok(!/my-third-party-tool[\s\S]{0,40}disabled:/.test(fs.readFileSync(file, 'utf8')), 'follow 删键')
})
