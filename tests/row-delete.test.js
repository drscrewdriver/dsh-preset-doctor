import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parsePatchFile } from '../src/scan.js'
import { runDelete } from '../src/fix/index.js'

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
          - id: my-extra-tool
            name: '@acme/dsh-my-extra-tool'
            config:
              foo: bar
`

function tmpPatch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-del-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'cordis.patch.yml')
  fs.writeFileSync(file, PATCH, 'utf8')
  return file
}

function scan(file) {
  return { sources: [parsePatchFile(file, 'profile', 'web')], findings: [], detectedVersion: '0.2.1-rc.1' }
}

test('delete 自定义行：整块移除（含子行），其余不动，写前 .bak', (t) => {
  const file = tmpPatch(t)
  const r = runDelete(scan(file), { file, presetId: 'standard', rowId: 'my-extra-tool', confirm: true, ts: 'T1' })
  assert.equal(r.status, 'written')
  const after = fs.readFileSync(file, 'utf8')
  assert.ok(!after.includes('my-extra-tool'), '自定义行整块移除')
  assert.ok(!after.includes('@acme/dsh-my-extra-tool'), '其 name 子行一并移除')
  assert.ok(!after.includes('foo: bar'), '其 config 子行一并移除')
  assert.ok(after.includes('persona'), 'persona 保留')
  assert.ok(after.includes('time-context'), 'time-context 保留')
  assert.ok(fs.existsSync(`${file}.bak-T1`), '写前 .bak')
})

test('delete 内置基线行（time-context ∈ 0.2.1 standard）→ not-custom 且不改盘', (t) => {
  const file = tmpPatch(t)
  const before = fs.readFileSync(file, 'utf8')
  const r = runDelete(scan(file), { file, presetId: 'standard', rowId: 'time-context', confirm: true, ts: 'T1' })
  assert.equal(r.status, 'not-custom')
  assert.match(r.errors[0].message, /仅自定义行可删/)
  assert.equal(fs.readFileSync(file, 'utf8'), before, '内置行拒绝后不改盘')
})

test('delete 缺 confirm → 拒绝且不写盘', (t) => {
  const file = tmpPatch(t)
  const before = fs.readFileSync(file, 'utf8')
  const r = runDelete(scan(file), { file, presetId: 'standard', rowId: 'my-extra-tool', ts: 'T1' })
  assert.equal(r.status, 'rejected')
  assert.equal(fs.readFileSync(file, 'utf8'), before, '未确认不写盘')
})

test('delete 行不在预设内 → row-not-in-preset', (t) => {
  const file = tmpPatch(t)
  const r = runDelete(scan(file), { file, presetId: 'standard', rowId: 'ghost-row', confirm: true })
  assert.equal(r.status, 'row-not-in-preset')
})

test('delete dryRun：返回计划但不写盘', (t) => {
  const file = tmpPatch(t)
  const before = fs.readFileSync(file, 'utf8')
  const r = runDelete(scan(file), { file, presetId: 'standard', rowId: 'my-extra-tool', confirm: true, dryRun: true, ts: 'T1' })
  assert.equal(r.dryRun, true)
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'dryRun 不改盘')
})
