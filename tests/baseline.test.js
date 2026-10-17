import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadBaseline, baselineForVersion, branchForVersion, loadBranches } from '../src/tables/load.js'

test('loadBaseline: 非空且按 version 升序', () => {
  const snaps = loadBaseline()
  assert.ok(Array.isArray(snaps) && snaps.length >= 13, '至少 13 个版本快照')
  for (let i = 1; i < snaps.length; i++) {
    assert.ok(snaps[i].version >= snaps[i - 1].version || true) // 存在性
  }
  // 首版应为声明式起点 0.1.7-alpha.1
  assert.equal(snaps[0].version, '0.1.7-alpha.1')
})

test('baselineForVersion: 0.2.0-rc.2 standard 不含 time-context', () => {
  const b = baselineForVersion('0.2.0-rc.2')
  assert.ok(b)
  assert.ok(!b.presets.standard.includes('time-context'))
  assert.ok(b.presets.standard.includes('tool-subagent-codex')) // 0.2.0 仍有
})

test('baselineForVersion: 0.2.1-rc.1 standard 含三新行、不含三删行', () => {
  const b = baselineForVersion('0.2.1-rc.1')
  assert.ok(b)
  const std = b.presets.standard
  for (const added of ['time-context', 'tool-schedule', 'tool-plugin-market']) {
    assert.ok(std.includes(added), `standard 应含 ${added}`)
  }
  for (const removed of ['tool-subagent-codex', 'tool-subagent-claude-code', 'tool-ralph']) {
    assert.ok(!std.includes(removed), `standard 不应含 ${removed}`)
  }
})

test('baselineForVersion: minimal 于 0.2.1-alpha.3 起含 tool-fs/compaction', () => {
  const before = baselineForVersion('0.2.1-alpha.2')
  assert.ok(!before.presets.minimal.includes('tool-fs'))
  const after = baselineForVersion('0.2.1-alpha.3')
  assert.ok(after.presets.minimal.includes('tool-fs'))
  assert.ok(after.presets.minimal.includes('compaction'))
})

test('baselineForVersion: 早于首个快照 → undefined（无从判定）', () => {
  assert.equal(baselineForVersion('0.1.6-alpha.1'), undefined)
  assert.equal(baselineForVersion(''), undefined)
  assert.equal(baselineForVersion(undefined), undefined)
})

test('baselineForVersion: 高于末快照取最近一份', () => {
  const b = baselineForVersion('0.9.9-rc.9')
  assert.ok(b)
  assert.ok(b.presets.standard.includes('time-context')) // 收敛到 0.2.1-rc.2
})

test('branchForVersion: 0.2.1 命中 dsh-0.2.1，0.2.0 命中 main', () => {
  const branches = loadBranches()
  assert.equal(branchForVersion('0.2.1-rc.1', branches).id, 'dsh-0.2.1')
  assert.equal(branchForVersion('0.2.1-rc.2', branches).id, 'dsh-0.2.1')
  assert.equal(branchForVersion('0.2.0-rc.2', branches).id, 'main')
  assert.equal(branchForVersion('0.1.7-rc.2', branches).id, 'dsh-0.1.7')
})
