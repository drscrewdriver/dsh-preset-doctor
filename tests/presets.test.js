/**
 * 卡片化 UI 数据层测试：collectPresets 三路 union/去重/健康预设 + 桥 list/sync 路由。
 * 2026-10-09「取消自动闸 全手动确认」纪律：sync 无 confirm 即拒绝；只写 auto 级。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scanAll } from '../src/scan.js'
import { collectPresets, summarize, eraCatalogFor } from '../src/report.js'
import { makeSettingsBridge } from '../src/bridge.js'
import { resolveConfig } from '../src/index.js'

function tmpHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshpm-presets-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  return home
}

const DECLARED = [
  '- insert:',
  '    - id: preset-alpha',
  "      name: '@deepseek-ai/dsh-agent-preset'",
  '      config:',
  '        id: alpha',
  '        name: 我的预设甲',
  '        description: 描述甲',
  '        plugins:',
  '          - id: workflow-worker-thread',
  "            name: '@deepseek-ai/dsh-workflow-ptc'",
  '    - id: preset-beta',
  "      name: '@deepseek-ai/dsh-agent-preset'",
  '      config:',
  '        id: beta',
  '        plugins:',
  '          - id: workflow-worker-thread',
  "            name: '@deepseek-ai/dsh-workflow-ptc'",
].join('\n')

test('collectPresets：声明行成卡、name/description 提取、健康预设 current', (t) => {
  const home = tmpHome(t)
  fs.writeFileSync(path.join(home, 'cordis.patch.yml'), DECLARED)
  const scan = scanAll({ home, scanProfiles: false, migrateLegacy: false })
  const presets = collectPresets(scan)
  const alpha = presets.find((p) => p.id === 'alpha')
  const beta = presets.find((p) => p.id === 'beta')
  assert.ok(alpha && beta, '两个声明预设都应成卡')
  assert.equal(alpha.name, '我的预设甲')
  assert.equal(alpha.description, '描述甲')
  assert.equal(alpha.source, 'home')
  assert.equal(beta.name, undefined, 'config 无 name 时留空（UI 层兜底未命名）')
  assert.equal(alpha.current, true, '健康预设应标 current')
  assert.equal(alpha.syncable, false)
  assert.equal(alpha.era, undefined, '健康预设无 era 条目')
})

test('collectPresets：遗留目录（声明式分支）经 R-LEGACY 成卡且 syncable', (t) => {
  const home = tmpHome(t)
  fs.writeFileSync(path.join(home, 'cordis.patch.yml'), DECLARED)
  const dir = path.join(home, '.agent-presets', 'gamma')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'agent.cordis.yml'), '[]')
  fs.writeFileSync(path.join(dir, 'preset.yml'), 'name: 伽马\ndescription: 目录预设')
  const scan = scanAll({ home, scanProfiles: false, migrateLegacy: false })
  const presets = collectPresets(scan)
  const gamma = presets.find((p) => p.id === 'gamma')
  assert.ok(gamma, '遗留目录应成卡')
  assert.equal(gamma.source, 'legacy')
  assert.equal(gamma.name, '伽马')
  assert.equal(gamma.current, false)
  assert.equal(gamma.syncable, true, 'R-LEGACY 是 auto 级，可同步')
  assert.equal(gamma.era.baseEra, '≤0.1.7-alpha.1')
})

test('collectPresets：空安全（旧 scanResult 无 sources/findings 不炸）', () => {
  assert.deepEqual(collectPresets({ home: '/h', findings: [] }), [])
  assert.deepEqual(collectPresets(undefined), [])
  const s = summarize({ home: '/h', findings: [] }, null)
  assert.deepEqual(s.presets, [])
})

test('summarize.presets 进报告 + eraCatalogFor 当前高亮', () => {
  const catalog = eraCatalogFor({ presetFormat: 'legacy-dir' })
  assert.equal(catalog.length, 2)
  assert.equal(catalog.find((e) => e.current).name, '目录预设期')
  const catalog2 = eraCatalogFor({ presetFormat: 'declarative-patch' })
  assert.equal(catalog2.find((e) => e.current).name, '声明 Patch 期')
})

// ── 桥 list / sync ──────────────────────────────────────────────────────────

function mkReq(payload) {
  return {
    method: 'POST',
    headers: { host: '127.0.0.1:1' },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(payload))
    },
  }
}

function mkRes() {
  let body
  return {
    res: { writeHead() {}, end(b) { body = JSON.parse(b) } },
    get body() { return body },
  }
}

test('bridge list：context 未接线返 unavailable，接线后返回 presets/eras/version', async () => {
  const settings = { describe: () => [], writable: true }
  const routes = makeSettingsBridge({ settings, ns: 'preset-manager', resolveConfig })
  assert.equal(routes.filter((r) => r.path.endsWith('/list') || r.path.endsWith('/sync')).length, 2, '新路由存在')

  let r = mkRes()
  await routes.find((x) => x.path.endsWith('/list')).handler(mkReq({}), r.res)
  assert.equal(r.body.ok, false)
  assert.equal(r.body.code, 'unavailable', '未接线 context 时 list 不可用')

  const calls = []
  const routes2 = makeSettingsBridge({
    settings, ns: 'preset-manager', resolveConfig,
    context: { getSummary: ({ fresh } = {}) => { calls.push({ fresh }); return { version: '0.1.7-rc.2', presets: [], eras: [] } } },
  })
  r = mkRes()
  await routes2.find((x) => x.path.endsWith('/list')).handler(mkReq({}), r.res)
  assert.equal(r.body.ok, true)
  assert.equal(r.body.value.version, '0.1.7-rc.2')
  assert.deepEqual(calls, [{ fresh: false }])
  r = mkRes()
  await routes2.find((x) => x.path.endsWith('/list')).handler(mkReq({ fresh: true }), r.res)
  assert.deepEqual(calls[1], { fresh: true }, 'fresh 走 body 不走 query')
})

test('bridge sync：confirm 缺失拒绝 + 透传 runSync 结果 + 非法 body 拒绝', async () => {
  const calls = []
  const routes = makeSettingsBridge({
    settings: { describe: () => [] },
    ns: 'preset-manager',
    resolveConfig,
    context: { runSync: (req) => { calls.push(req); return { ok: true, applied: 1, skipped: 0 } } },
  })
  const syncRoute = routes.find((x) => x.path.endsWith('/sync'))

  let r = mkRes()
  await syncRoute.handler(mkReq({ key: 'k' }), r.res)
  assert.deepEqual(calls[0], { key: 'k' }, '桥应把原始 body 透传 runSync（confirm 闸在 index 侧）')

  r = mkRes()
  await syncRoute.handler(mkReq({ key: 'k', confirm: true }), r.res)
  assert.equal(r.body.ok, true)
  assert.equal(r.body.applied, 1)

  r = mkRes()
  await syncRoute.handler(mkReq({ confirm: true }), r.res)
  assert.equal(r.body.code, 'sync-rejected', '无 key 拒绝')
})

test('index.runSync 全链：确认闸 + 只动目标预设 + .bak 写盘', async (t) => {
  const { apply } = await import('../src/index.js')
  const home = tmpHome(t)
  fs.writeFileSync(path.join(home, 'cordis.patch.yml'), DECLARED)
  // 第二个预设带可修失效（旧包名），验证 sync 只动目标
  fs.writeFileSync(
    path.join(home, 'cordis.patch.yml'),
    DECLARED + '\n' + [
      '    - id: preset-delta',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: delta',
      '        plugins:',
      '          - id: workflow-worker-thread',
      "            name: '@deepseek-ai/dsh-workflow-worker-thread'",
    ].join('\n'),
  )
  const ctx = {
    get: () => undefined,
    inject: () => {},
    effect: (fn) => fn(),
    logger: () => ({ info() {} }),
  }
  const api = apply(ctx, { scanProfiles: false, migrateLegacy: false, homeOverride: home })
  assert.equal(typeof api.runSync, 'function', 'apply 应返回 { getSummary, runSync }')

  // 确认闸：无 confirm 拒绝且零写盘
  const gate = api.runSync({ key: 'home|delta|' + home + '\\cordis.patch.yml' })
  assert.equal(gate.ok, false)
  assert.equal(gate.code, 'confirm-required')

  const { scanAll: scan } = await import('../src/scan.js')
  const { collectPresets: collect } = await import('../src/report.js')
  const scanResult = scan({ home, scanProfiles: false, migrateLegacy: false })
  const presets = collect(scanResult)
  const delta = presets.find((p) => p.id === 'delta')
  const alpha = presets.find((p) => p.id === 'alpha')
  assert.equal(delta.syncable, true, 'delta 有旧包名，可同步')
  assert.equal(alpha.syncable, false, 'alpha 健康')
  const before = fs.readFileSync(path.join(home, 'cordis.patch.yml'), 'utf8')

  const result = api.runSync({ key: delta.key, confirm: true })
  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 200))
  assert.ok(result.applied >= 1, '至少写一个文件')
  const after = fs.readFileSync(path.join(home, 'cordis.patch.yml'), 'utf8')
  assert.notEqual(after, before, 'delta 同步应写盘')
  assert.ok(after.includes("name: '@deepseek-ai/dsh-workflow-worker-thread'") === false, '旧包名应被修复')
  assert.ok(after.includes('preset-alpha'), 'alpha 行不受影响（只动目标预设）')
  assert.ok(fs.readdirSync(home).some((f) => f.startsWith('cordis.patch.yml.bak-')), '应有 .bak 备份')

  // 已同步后重跑：alreadySynced
  const second = api.runSync({ key: delta.key, confirm: true })
  assert.equal(second.ok, true)
  assert.equal(second.alreadySynced, true)

  // 未知 key
  const missing = api.runSync({ key: 'nope', confirm: true })
  assert.equal(missing.code, 'preset-not-found')
})
