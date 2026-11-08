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
import { collectBundleDisabledIds } from '../src/pkg-resolve.js'
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

test('planAlign：真实基线 0.2.1-rc.3 + 死包 resolver → 不可解析行退避停用；可解析的官方 true 行不动', (t) => {
  const file = tmpPatch(t)
  const src = parsePatchFile(file, 'profile', 'desktop')
  const preset = src.presetRows.find((r) => r.presetId === 'standard')
  const plan = planAlignForPreset(src, preset, {
    baseline: baselineForVersion('0.2.1-rc.3'), allBaselines: loadBaseline(),
    resolvePkg: makeDshResolve({ dead: [DEAD, 'some-third-party-tool'] }),
  })
  assert.deepEqual(plan.removedHostMissing.sort(), ['my-custom-tool', 'tool-subagent-control', 'tool-subagent-list-agents'],
    '三行的包都不可解析→安档退避（my-custom-tool 同时也不在参照默认集）')
  assert.deepEqual(plan.disabledOfficialOff, [], '已被 unavailable 档吃进，不重复计入官方停用档')
  assert.ok(!plan.removed.includes('persona'), '官方 true 且可解析的行不动')
})

test('runAlign：写盘停用宿主不提供行（不删行）+ 注释/自定义行原样保留 + 幂等', (t) => {
  const file = tmpPatch(t)
  const resolvePkg = makeDshResolve({ dead: [DEAD, 'some-third-party-tool'] })
  const src = parsePatchFile(file, 'profile', 'desktop')
  const scanResult = { home: path.dirname(file), sources: [src], findings: [], detectedVersion: '0.2.1-rc.3' }
  const r1 = runAlign(scanResult, { file, presetId: 'standard', ts: 'T1', resolvePkg })
  assert.equal(r1.status, 'written')
  assert.ok(r1.removed.includes('tool-subagent-control'), 'control 行被停用')
  assert.ok(r1.removed.includes('tool-subagent-list-agents'), 'list-agents 行被停用')
  assert.deepEqual(r1.removedHostMissing.sort(), ['my-custom-tool', 'tool-subagent-control', 'tool-subagent-list-agents'])
  assert.deepEqual(r1.disabledOfficialOff, [], 'my-custom-tool 在本 fixture 同时是死包→计入 unavailable 档')
  const after = fs.readFileSync(file, 'utf8')
  assert.match(after, /- id: tool-subagent-control\r?\n\s+disabled: true/, 'control 行本体保留 + 写 disabled')
  assert.match(after, /- id: tool-subagent-list-agents\r?\n\s+disabled: true/, 'list-agents 行本体保留 + 写 disabled')
  assert.ok(after.includes('# 用户注释保留'), '注释不动')
  assert.match(after, /- id: my-custom-tool\r?\n\s+disabled: true/, '不在参照默认集的行保留本体仅退避停用')
  assert.ok(after.includes('persona'), '可解析官方行不动')
  // 幂等：重扫后无可停用 → noop
  const src2 = parsePatchFile(file, 'profile', 'desktop')
  const r2 = runAlign({ ...scanResult, sources: [src2] }, { file, presetId: 'standard', ts: 'T2', resolvePkg })
  assert.equal(r2.status, 'noop')
  assert.deepEqual(r2.removed, [])
})

test('runAlign：不注入 resolvePkg → 包死行保留（保守旧行为），但不在参照默认集的行照样退避', (t) => {
  const file = tmpPatch(t)
  const src = parsePatchFile(file, 'profile', 'desktop')
  const scanResult = { home: path.dirname(file), sources: [src], findings: [], detectedVersion: '0.2.1-rc.3' }
  const r = runAlign(scanResult, { file, presetId: 'standard', ts: 'T1' })
  assert.deepEqual(r.removedHostMissing, [], '无 resolver → 不可解析档不启用')
  assert.deepEqual(r.disabledOfficialOff, ['my-custom-tool'], '退避档不依赖 resolver，照样停用')
  assert.equal(r.status, 'written')
  assert.ok(fs.readFileSync(file, 'utf8').includes('tool-subagent-control'), '包死行本体与启用态都不动')
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

// ---- bundle 层定向禁用（desktop 实证形态：包可解析但 agent-team-profile 把行全局关掉）----

test('classify：包可解析但 id 在 hostDisabled 集→不再基准·启用，标 off + hostDisabled', () => {
  const B = baselineForVersion('0.2.1-rc.3')
  const src = srcWithRows([
    { id: 'tool-subagent-control', name: DEAD },
    { id: 'tool-subagent-list-agents', name: DEAD + '/list-agents' },
    { id: 'persona', name: '@deepseek-ai/dsh-persona' },
  ])
  const c = classifyComposition(src, src.presetRows[0], {
    baseline: B, allBaselines: loadBaseline(), currentVersion: '0.2.1-rc.3',
    resolvePkg: makeDshResolve(), // 全活：只能靠 hostDisabled 集触发
    hostDisabled: new Set(['tool-subagent-control', 'tool-subagent-list-agents']),
  })
  const byId = Object.fromEntries(c.rows.map((r) => [r.id, r]))
  assert.equal(byId['tool-subagent-control'].pkgMissing, false, '包本身可解析')
  assert.equal(byId['tool-subagent-control'].hostDisabled, true)
  assert.equal(byId['tool-subagent-control'].unavailable, true)
  assert.equal(byId['tool-subagent-control'].defaultOn, false)
  assert.equal(byId['tool-subagent-control'].triState, 'off')
  assert.equal(byId['persona'].hostDisabled, false, '集外行不受影响')
  assert.equal(byId['persona'].defaultOn, true)
})

test('collectBundleDisabledIds：从 profile bundles 自带 patch 收集定向禁用行 id', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bundis-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const pkgDir = path.join(dir, 'node_modules', '@scope', 'team-profile')
  fs.mkdirSync(pkgDir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@scope/team-profile', 'not-installed-pkg'] } } }), 'utf8')
  fs.writeFileSync(path.join(pkgDir, 'cordis.patch.yml'), `- id: tool-subagent-control
  disabled: true

- id: tool-subagent-list-agents
  disabled: true

- insert:
    - id: agent-team
      name: '@scope/team'
`, 'utf8')
  const set = collectBundleDisabledIds(dir)
  assert.deepEqual([...set].sort(), ['tool-subagent-control', 'tool-subagent-list-agents'])
  assert.ok(!set.has('agent-team'), 'insert 条目不入集')
  assert.deepEqual([...collectBundleDisabledIds(path.join(dir, 'nope'))], [], '目录不存在→空集 fail-open')
})

test('runAlign：包全活但 bundle 禁用→仍停用两行（removedHostMissing，行本体保留）', (t) => {
  const file = tmpPatch(t)
  const scanResult = { home: path.dirname(file), sources: [parsePatchFile(file, 'profile', 'desktop')], findings: [], detectedVersion: '0.2.1-rc.3' }
  const r = runAlign(scanResult, {
    file, presetId: 'standard', ts: 'T1',
    resolvePkg: makeDshResolve(), hostDisabled: new Set(['tool-subagent-control', 'tool-subagent-list-agents']),
  })
  assert.equal(r.status, 'written')
  assert.deepEqual(r.removedHostMissing.sort(), ['tool-subagent-control', 'tool-subagent-list-agents'])
  const after = fs.readFileSync(file, 'utf8')
  assert.ok(after.includes('tool-subagent-list-agents'), '行本体不被删除')
  assert.match(after, /- id: tool-subagent-list-agents\r?\n\s+disabled: true/, '改为写 disabled: true')
})

test('toggle：bundle 禁用行——on 硬拒（开了整条预设会从可用列表消失），follow 退避写 disabled', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-toggle-bd-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'cordis.patch.yml')
  fs.writeFileSync(file, TOGGLE_PATCH, 'utf8')
  const scan = () => ({ sources: [parsePatchFile(file, 'profile', 'desktop')], findings: [], detectedVersion: '0.2.1-rc.3' })
  const opts = { resolvePkg: makeDshResolve(), hostDisabled: new Set(['tool-subagent-control']) }
  // 1) 开启被 bundle 全局禁用的行 → 硬拒不写盘（旧版在此删键/写 false，直接把整条预设弄死）
  const rOn = runToggle(scan(), {
    file, presetId: 'standard', rowId: 'tool-subagent-control', mode: 'on',
    confirm: true, ts: 'T0', ...opts,
  })
  assert.equal(rOn.status, 'host-unavailable')
  assert.equal(rOn.unavailableReason, 'bundle', '成因回报：bundle 层定向禁用')
  assert.match(rOn.errors[0].message, /不能开启/)
  assert.ok(!fs.existsSync(`${file}.bak-T0`), '拒绝时不备份不写盘')
  // 2) follow 对这类行不再“删键交回宿主”，而是退避为 disabled:true
  const r = runToggle(scan(), {
    file, presetId: 'standard', rowId: 'tool-subagent-control', mode: 'follow',
    confirm: true, ts: 'T1', ...opts,
  })
  assert.equal(r.status, 'written', '宿主不提供→follow 退避落盘')
  assert.equal(r.defaultOn, false)
  assert.match(fs.readFileSync(file, 'utf8'), /- id: tool-subagent-control\r?\n\s+disabled: true/)
  // 3) 已停用后再 follow → 无改动（幂等）
  const r2 = runToggle(scan(), {
    file, presetId: 'standard', rowId: 'tool-subagent-control', mode: 'follow',
    confirm: true, ts: 'T2', ...opts,
  })
  assert.equal(r2.status, 'already-disabled')
})

test('toggle 三档载体：可用行 follow=删键；不可解析行 on 硬拒、follow/off 退避写 true', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-toggle-hm-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'cordis.patch.yml')
  fs.writeFileSync(file, TOGGLE_PATCH, 'utf8')
  const scan = () => ({ sources: [parsePatchFile(file, 'profile', 'desktop')], findings: [], detectedVersion: '0.2.1-rc.3' })
  const deadOpts = { resolvePkg: makeDshResolve({ dead: [DEAD] }) }
  // 1) 包不可解析 + on → 硬拒（强行启用=整条预设 never started）
  const rOn = runToggle(scan(), {
    file, presetId: 'standard', rowId: 'tool-subagent-control', mode: 'on',
    confirm: true, ts: 'T0', ...deadOpts,
  })
  assert.equal(rOn.status, 'host-unavailable')
  assert.equal(rOn.unavailableReason, 'pkg')
  assert.ok(!fs.existsSync(`${file}.bak-T0`))
  // 2) 包不可解析 + follow → 退避写 disabled:true（旧版在此不写盘，把死行留成启用态）
  const r = runToggle(scan(), {
    file, presetId: 'standard', rowId: 'tool-subagent-control', mode: 'follow',
    confirm: true, ts: 'T1', ...deadOpts,
  })
  assert.equal(r.status, 'written')
  assert.equal(r.declared, 'absent')
  assert.equal(r.defaultOn, false, '包不可解析→跟随解析为停用')
  assert.match(fs.readFileSync(file, 'utf8'), /- id: tool-subagent-control\r?\n\s+disabled: true/)
  // 3) off 对已停用行 → 无改动
  const r2 = runToggle(scan(), {
    file, presetId: 'standard', rowId: 'tool-subagent-control', mode: 'off',
    confirm: true, ts: 'T2', ...deadOpts,
  })
  assert.equal(r2.status, 'already-disabled')
  // 4) 包可解析时：上一步已写入 disabled:true → follow 删键回到跟随态
  const r3 = runToggle(scan(), {
    file, presetId: 'standard', rowId: 'tool-subagent-control', mode: 'follow',
    confirm: true, ts: 'T3',
  })
  assert.equal(r3.status, 'written')
  assert.ok(!/disabled:/.test(fs.readFileSync(file, 'utf8')), '可用行 follow → 删键')
})
