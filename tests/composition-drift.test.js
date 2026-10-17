import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkCompositionDrift } from '../src/rules/composition-drift.js'

// 构造三条内置基线快照（升序）：codex 早期有、0.2.1-alpha.2 移除；time-context 0.2.1-alpha.1 才加入。
const ALL = [
  { version: '0.1.7-alpha.1', presets: { standard: ['preset-standard', 'persona', 'tool-bash', 'tool-subagent-codex'] } },
  { version: '0.2.0-rc.2', presets: { standard: ['preset-standard', 'persona', 'tool-bash', 'tool-subagent-codex'] } },
  { version: '0.2.1-rc.1', presets: { standard: ['preset-standard', 'persona', 'tool-bash', 'time-context'] } },
]
const BASE_020 = ALL[1]
const BASE_021 = ALL[2]

/** 造一个覆盖 standard 的 source，plugin 行 = rows 参数。 */
function srcWith(rows) {
  const presetRows = [{ presetId: 'standard', id: 'preset-standard', range: [0, 1000], line: 1 }]
  const rowList = rows.map((id, i) => ({ id, range: [(i + 1) * 10, (i + 1) * 10 + 5], line: i + 2 }))
  return { file: 'cordis.patch.yml', presetRows, rows: [...presetRows, ...rowList] }
}

test('introduced：0.2.0 覆盖 standard 里引用 time-context → 报跨版本引入', () => {
  const f = checkCompositionDrift([srcWith(['persona', 'tool-bash', 'time-context'])], {
    baseline: BASE_020, allBaselines: ALL, currentVersion: '0.2.0-rc.2',
  })
  assert.equal(f.length, 1)
  assert.equal(f[0].rule, 'R-COMPOSITION-DRIFT')
  assert.equal(f[0].rowId, 'time-context')
  assert.equal(f[0].data.kind, 'introduced')
  assert.equal(f[0].level, 'report')
})

test('removed：0.2.1 覆盖 standard 里引用 tool-subagent-codex → 报版本已移除', () => {
  const f = checkCompositionDrift([srcWith(['persona', 'tool-bash', 'tool-subagent-codex'])], {
    baseline: BASE_021, allBaselines: ALL, currentVersion: '0.2.1-rc.1',
  })
  assert.equal(f.length, 1)
  assert.equal(f[0].rowId, 'tool-subagent-codex')
  assert.equal(f[0].data.kind, 'removed')
})

test('用户自定义行（任何基线都没有）→ 不报', () => {
  const f = checkCompositionDrift([srcWith(['persona', 'tool-bash', 'my-third-party-tool'])], {
    baseline: BASE_020, allBaselines: ALL, currentVersion: '0.2.0-rc.2',
  })
  assert.deepEqual(f, [])
})

test('合法当前版本行（persona/tool-bash）→ 不报', () => {
  const f = checkCompositionDrift([srcWith(['persona', 'tool-bash'])], {
    baseline: BASE_020, allBaselines: ALL, currentVersion: '0.2.0-rc.2',
  })
  assert.deepEqual(f, [])
})

test('自定义 preset id（非 standard/cordis/ptc/minimal）→ 整体跳过', () => {
  const src = { file: 'x', presetRows: [{ presetId: 'standard-win-gitbash', range: [0, 1000], line: 1 }], rows: [{ id: 'time-context', range: [10, 15], line: 2 }] }
  const f = checkCompositionDrift([src], { baseline: BASE_020, allBaselines: ALL, currentVersion: '0.2.0-rc.2' })
  assert.deepEqual(f, [])
})

test('无基线（<0.1.7 声明式前）或无版本 → 返回空', () => {
  assert.deepEqual(checkCompositionDrift([srcWith(['time-context'])], { baseline: undefined, allBaselines: ALL, currentVersion: '0.2.0-rc.2' }), [])
  assert.deepEqual(checkCompositionDrift([srcWith(['time-context'])], { baseline: BASE_020, allBaselines: ALL, currentVersion: undefined }), [])
})
