import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyComposition } from '../src/rules/composition-drift.js'

const ALL = [
  { version: '0.1.7-alpha.1', presets: { standard: ['preset-standard', 'persona', 'tool-bash', 'tool-subagent-codex'] } },
  { version: '0.2.0-rc.2', presets: { standard: ['preset-standard', 'persona', 'tool-bash', 'tool-subagent-codex'] } },
  { version: '0.2.1-rc.1', presets: { standard: ['preset-standard', 'persona', 'tool-bash', 'time-context'] } },
]
const BASE_020 = ALL[1]

function srcWith(rows) {
  const presetRow = { presetId: 'standard', id: 'preset-standard', range: [0, 1000], line: 1 }
  const list = rows.map((id, i) => ({ id, range: [(i + 1) * 10, (i + 1) * 10 + 5], line: i + 2 }))
  return { file: 'x', presetRows: [presetRow], rows: [presetRow, ...list] }
}

test('classifyComposition：shipped / drift(introduced) / custom 三态 + missing', () => {
  const src = srcWith(['persona', 'tool-bash', 'time-context', 'my-custom-tool'])
  const c = classifyComposition(src, src.presetRows[0], { baseline: BASE_020, allBaselines: ALL, currentVersion: '0.2.0-rc.2' })
  const byId = Object.fromEntries(c.rows.map((r) => [r.id, r]))
  assert.equal(byId['persona'].state, 'shipped')
  assert.equal(byId['tool-bash'].state, 'shipped')
  assert.equal(byId['time-context'].state, 'drift')
  assert.equal(byId['time-context'].driftKind, 'introduced')
  assert.equal(byId['my-custom-tool'].state, 'custom')
  assert.ok(c.missing.includes('tool-subagent-codex'))
  assert.ok(!c.missing.includes('persona'))
})

test('classifyComposition：disabled 行标 disabled=true（node.get）', () => {
  const presetRow = { presetId: 'standard', id: 'preset-standard', range: [0, 1000], line: 1 }
  const row = { id: 'persona', range: [10, 15], line: 2, node: { get: (k) => (k === 'disabled' ? true : undefined) } }
  const src = { file: 'x', presetRows: [presetRow], rows: [presetRow, row] }
  const c = classifyComposition(src, presetRow, { baseline: BASE_020, allBaselines: ALL, currentVersion: '0.2.0-rc.2' })
  assert.equal(c.rows[0].disabled, true)
})

test('classifyComposition：无基线（自定义 id）预设仍列行为 custom（供行级 toggle），missing 空', () => {
  const src = srcWith(['persona'])
  src.presetRows[0].presetId = 'my-custom-preset'
  const c = classifyComposition(src, src.presetRows[0], { baseline: BASE_020, allBaselines: ALL, currentVersion: '0.2.0-rc.2' })
  assert.equal(c.rows.length, 1)
  assert.equal(c.rows[0].id, 'persona')
  assert.equal(c.rows[0].state, 'custom')
  assert.equal(c.rows[0].driftKind, null)
  assert.deepEqual(c.missing, [])
})

test('classifyComposition：三档 triState 派生（默认参照 standard）', () => {
  const B = ALL[2] // 0.2.1 standard = persona,tool-bash,time-context
  const presetRow = { presetId: 'standard', id: 'preset-standard', range: [0, 1000], line: 1 }
  const mk = (id, disabled) => ({ id, range: [10, 15], line: 2, node: { get: (k) => (k === 'disabled' && disabled ? true : undefined) } })
  const rows = [mk('persona', false), mk('tool-subagent-codex', false), mk('time-context', true)]
  const src = { file: 'x', presetRows: [presetRow], rows: [presetRow, ...rows] }
  const c = classifyComposition(src, presetRow, { baseline: B, allBaselines: ALL, currentVersion: '0.2.1-rc.1' })
  const byId = Object.fromEntries(c.rows.map((r) => [r.id, r]))
  assert.equal(byId['persona'].defaultOn, true); assert.equal(byId['persona'].triState, 'follow')
  assert.equal(byId['tool-subagent-codex'].defaultOn, false); assert.equal(byId['tool-subagent-codex'].triState, 'on')
  assert.equal(byId['time-context'].defaultOn, true); assert.equal(byId['time-context'].triState, 'off')
})

test('classifyComposition：自定义 id 预设的默认参照回退 standard', () => {
  const B = ALL[2]
  const presetRow = { presetId: 'my-preset', id: 'preset-my-preset', range: [0, 1000], line: 1 }
  const row = { id: 'persona', range: [10, 15], line: 2, node: { get: () => undefined } }
  const src = { file: 'x', presetRows: [presetRow], rows: [presetRow, row] }
  const c = classifyComposition(src, presetRow, { baseline: B, allBaselines: ALL, currentVersion: '0.2.1-rc.1' })
  assert.equal(c.rows[0].defaultOn, true)
  assert.equal(c.rows[0].triState, 'follow')
})
