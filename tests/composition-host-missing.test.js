/**
 * 宿主不提供行（pkgMissing）识别机制（2026-11-06）：
 * 基线成员但引用包不可解析 → 默认按停用解析、对齐时删除、follow 写 disabled。
 * 依据：桌面宿主实证 agent-preset/invalid: tool-subagent-list-agents
 * (@deepseek-ai/dsh-tool-subagent-control/list-agents): never started。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { classifyComposition } from '../src/rules/composition-drift.js'
import { parsePatchFile } from '../src/scan.js'
import { planAlignForPreset } from '../src/fix/composition-align.js'
import { runAlign, runToggle } from '../src/fix/index.js'
import { baselineForVersion, loadBaseline } from '../src/tables/load.js'
import { makeDshResolve } from './_stub-resolve.js'

const DEAD = '@deepseek-ai/dsh-tool-subagent-control'

// ---- classifyComposition：纯结构行（node.get 桩）----

function srcWithRows(rows) {
  const presetRow = { presetId: 'standard', id: 'preset-standard', range: [0, 1000], line: 1 }
  const list = rows.map((r, i) => ({
    id: r.id,
    name: r.name,
    range: [(i + 1) * 10, (i + 1) * 10 + 5],
    line: i + 2,
    node: { get: (k) => (k === 'disabled' && r.disabled ? true : undefined) },
  }))
  return { file: 'x', presetRows: [presetRow], rows: [presetRow, ...list] }
}

test('classify：基线成员但包不可解析→pkgMissing，defaultOn 翻转、未显式关也标 off', () => {
  const B = baselineForVersion('0.2.1-rc.3')
  const src = srcWithRows([
    { id: 'persona', name: '@deepseek-ai/dsh-persona' },
    { id: 'tool-subagent-control', name: DEAD },
    { id: 'tool-subagent-list-agents', name: DEAD + '/list-agents', disabled: true },
  ])
  const c = classifyComposition(src, src.presetRows[0], {
    baseline: B, allBaselines: loadBaseline(), currentVersion: '0.2.1-rc.3',
    resolvePkg: makeDshResolve({ dead: [DEAD] }),
  })
  const byId = Object.fromEntries(c.rows.map((r) => [r.id, r]))
  assert.equal(byId['persona'].pkgMissing, false, '可解析行不受影响')
  assert.equal(byId['persona'].defaultOn, true)
  assert.equal(byId['tool-subagent-control'].pkgMissing, true)
  assert.equal(byId['tool-subagent-control'].defaultOn, false, '基线有但包死→不再「基准·启用」')
  assert.equal(byId['tool-subagent-control'].triState, 'off', '盘面未关但包不可解析→诚实标强制关')
  assert.equal(byId['tool-subagent-list-agents'].pkgMissing, true, '子路径名按包本体判定')
  assert.equal(byId['tool-subagent-list-agents'].triState, 'follow', '已显式关→与停用默认一致')
})

test('classify：不注入 resolver → 旧行为（pkgMissing=false，基准·启用不变）', () => {
  const B = baselineForVersion('0.2.1-rc.3')
  const src = srcWithRows([{ id: 'tool-subagent-control', name: DEAD }])
  const c = classifyComposition(src, src.presetRows[0], {
    baseline: B, allBaselines: loadBaseline(), currentVersion: '0.2.1-rc.3',
  })
  assert.equal(c.rows[0].pkgMissing, false)
  assert.equal(c.rows[0].defaultOn, true)
  assert.equal(c.rows[0].triState, 'follow')
})

test('classify：cordis:group 不做存在判定；绝对 file:// 行按磁盘存在性判定', () => {
  const B = baselineForVersion('0.2.1-rc.3')
  const here = import.meta.url.slice('file:'.length) // 本测试文件必在
  const src = srcWithRows([
    { id: 'delegation', name: 'cordis:group' },
    { id: 'tool-bootstrap', name: 'file:///C:/definitely/not/here/tool-bootstrap.mjs' },
    { id: 'real-local', name: 'file:///' + here.replace(/^\/+/, '').replace(/\\/g, '/') },
  ])
  const resolver = () => { throw new Error('虚拟/本地名不应触发 npm 包解析') }
  const c = classifyComposition(src, src.presetRows[0], {
    baseline: B, allBaselines: loadBaseline(), currentVersion: '0.2.1-rc.3', resolvePkg: resolver,
  })
  const byId = Object.fromEntries(c.rows.map((r) => [r.id, r]))
  assert.equal(byId['delegation'].pkgMissing, false, '虚拟行不判')
  assert.equal(byId['tool-bootstrap'].pkgMissing, true, '不存在的 file:// 行→宿主不提供')
  assert.equal(byId['real-local'].pkgMissing, false, '存在的本地文件不误伤')
})

// ---- planAlignForPreset / runAlign：宿主不提供行删除 ----

const PATCH = `- insert:
    - id: preset-standard
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: standard
        plugins:
          # 用户注释保留
          - id: persona
            name: '@deepseek-ai/dsh-persona'
          - id: tool-subagent-control
            name: '@deepseek-ai/dsh-tool-subagent-control'
          - id: tool-subagent-list-agents
            name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'
          - id: my-custom-tool
            name: 'some-third-party-tool'
`

function tmpPatch(t, text = PATCH) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-hostmissing-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'cordis.patch.yml')
  fs.writeFileSync(file, text, 'utf8')
  return file
}

test('planAlign：真实基线 0.2.1-rc.3 + 死包 resolver → 删两行进 removedHostMissing；可解析行/自定义行保留', (t) => {
  const file = tmpPatch(t)
  const src = parsePatchFile(file, 'profile', 'desktop')
  const preset = src.presetRows.find((r) => r.presetId === 'standard')
  const plan = planAlignForPreset(src, preset, {
    baseline: baselineForVersion('0.2.1-rc.3'), allBaselines: loadBaseline(),
    resolvePkg: makeDshResolve({ dead: [DEAD, 'some-third-party-tool'] }),
  })
  assert.deepEqual(plan.removedHostMissing.sort(), ['tool-subagent-control', 'tool-subagent-list-agents'])
  assert.ok(plan.removed.includes('tool-subagent-control') && plan.removed.includes('tool-subagent-list-agents'))
  assert.ok(!plan.removed.includes('persona') && !plan.removed.includes('my-custom-tool'), '可解析基线行/自定义行不删')
})

test('runAlign：写盘删除宿主不提供行 + 注释/自定义行原样保留 + 幂等', (t) => {
  const file = tmpPatch(t)
  const resolvePkg = makeDshResolve({ dead: [DEAD, 'some-third-party-tool'] })
  const src = parsePatchFile(file, 'profile', 'desktop')
  const scanResult = { home: path.dirname(file), sources: [src], findings: [], detectedVersion: '0.2.1-rc.3' }
  const r1 = runAlign(scanResult, { file, presetId: 'standard', ts: 'T1', resolvePkg })
  assert.equal(r1.status, 'written')
  assert.ok(r1.removed.includes('tool-subagent-control'), 'control 行删除')
  assert.ok(r1.removed.includes('tool-subagent-list-agents'), 'list-agents 行删除')
  assert.deepEqual(r1.removedHostMissing.sort(), ['tool-subagent-control', 'tool-subagent-list-agents'])
  const after = fs.readFileSync(file, 'utf8')
  assert.ok(!/id:\s*tool-subagent-control/.test(after))
  assert.ok(!/id:\s*tool-subagent-list-agents/.test(after))
  assert.ok(after.includes('# 用户注释保留'), '注释不动')
  assert.ok(after.includes('my-custom-tool'), '自定义行保留')
  assert.ok(after.includes('persona'), '可解析基线行保留')
  // 幂等：重扫后无可删 → noop
  const src2 = parsePatchFile(file, 'profile', 'desktop')
  const r2 = runAlign({ ...scanResult, sources: [src2] }, { file, presetId: 'standard', ts: 'T2', resolvePkg })
  assert.equal(r2.status, 'noop')
  assert.deepEqual(r2.removed, [])
})

test('runAlign：不注入 resolvePkg → 旧行为，包死行保留（保守）', (t) => {
  const file = tmpPatch(t)
  const src = parsePatchFile(file, 'profile', 'desktop')
  const scanResult = { home: path.dirname(file), sources: [src], findings: [], detectedVersion: '0.2.1-rc.3' }
  const r = runAlign(scanResult, { file, presetId: 'standard', ts: 'T1' })
  assert.equal(r.status, 'noop', '无漂移、无 resolver → 什么都不删')
  assert.ok(fs.readFileSync(file, 'utf8').includes('tool-subagent-control'))
})

// ---- runToggle follow：宿主不提供 → 按停用解析 ----

const TOGGLE_PATCH = `- insert:
    - id: preset-standard
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: standard
        plugins:
          - id: tool-subagent-control
            name: '@deepseek-ai/dsh-tool-subagent-control'
`

test('toggle follow：基线成员但包不可解析→写 disabled（defaultOn=false）', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-toggle-hm-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'cordis.patch.yml')
  fs.writeFileSync(file, TOGGLE_PATCH, 'utf8')
  const scan = () => ({ sources: [parsePatchFile(file, 'profile', 'desktop')], findings: [], detectedVersion: '0.2.1-rc.3' })
  const r = runToggle(scan(), {
    file, presetId: 'standard', rowId: 'tool-subagent-control', mode: 'follow',
    confirm: true, ts: 'T1', resolvePkg: makeDshResolve({ dead: [DEAD] }),
  })
  assert.equal(r.status, 'written')
  assert.equal(r.defaultOn, false)
  assert.equal(r.disabled, true)
  assert.match(fs.readFileSync(file, 'utf8'), /disabled:\s*true/)
  // 不注入 resolver 时旧行为：行已带 disabled，follow 按基线默认（启用）→ 把 disabled 删回去
  const r2 = runToggle(scan(), {
    file, presetId: 'standard', rowId: 'tool-subagent-control', mode: 'follow',
    confirm: true, ts: 'T2',
  })
  assert.equal(r2.status, 'written')
  assert.equal(r2.defaultOn, true)
  assert.equal(r2.disabled, false)
  assert.ok(!/disabled:\s*true/.test(fs.readFileSync(file, 'utf8')), '旧语义回到启用、盘面复原')
  // 再 follow（仍无 resolver）：已启用+默认启用 → not-disabled 幂等
  const r3 = runToggle(scan(), {
    file, presetId: 'standard', rowId: 'tool-subagent-control', mode: 'follow',
    confirm: true, ts: 'T3',
  })
  assert.equal(r3.status, 'not-disabled')
})
