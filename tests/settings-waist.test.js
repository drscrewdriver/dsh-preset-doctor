import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installSettingsWaist } from '../src/settings-waist.js'
import { makeSettingsBridge, toView, BRIDGE_KEYS, isLoopbackRequest } from '../src/bridge.js'
import { apply, Config, DEFAULT_SETTINGS, resolveConfig } from '../src/index.js'

/** 记录型 inject 桩：登记 deps 与回调，由测试手动触发。 */
function injectableCtx() {
  const injections = []
  const ctx = {
    inject(deps, fn) {
      injections.push({ deps, fn })
    },
    effect(fn) {
      fn()
    },
    get(name) {
      return ctx[name]
    },
    logger() {
      return { info: () => {} }
    },
  }
  return { ctx, injections }
}

/** 模拟三代 settings 服务之一。 */
function makeSettingsSvc(shape) {
  const calls = { installSection: [], register: [] }
  const svc = {
    describe() {
      return []
    },
  }
  if (shape.installSection) {
    svc.installSection = (ctx, ns, config, base, hooks) => {
      calls.installSection.push({ ns, config, base, hooks })
      // 宿主语义：注册后立即回 setSource（0.1.5 lib/index.js:327-343 实测）
      if (shape.setSourceAfterRegister !== false) hooks.setSource(() => ({ ...base, autoFix: false }))
    }
  }
  if (shape.register) {
    svc.register = (ns, config, opts) => {
      calls.register.push({ ns, config, opts })
    }
  }
  return { svc, calls }
}

test('waist：0.1.2/0.1.5 线（服务带 installSection）→ installSection 注册 + setSource 换绑', () => {
  const { ctx, injections } = injectableCtx()
  const { svc, calls } = makeSettingsSvc({ installSection: true })
  ctx.settings = svc

  const sources = []
  installSettingsWaist(ctx, {
    ns: 'preset-manager',
    Config,
    base: () => ({ ...DEFAULT_SETTINGS }),
    onSource: (s) => sources.push(s),
  })

  assert.equal(injections.length, 1)
  assert.deepEqual(injections[0].deps, ['settings'])
  injections[0].fn({ settings: svc })

  assert.equal(calls.installSection.length, 1)
  assert.equal(calls.installSection[0].ns, 'preset-manager')
  assert.equal(calls.installSection[0].config, Config, 'schema 原样传入')
  assert.equal(calls.installSection[0].base.autoFix, true, 'base 必须是解包后的普通值')
  // 宿主注册后立即回 setSource → onSource 收到新源
  assert.equal(sources.length, 1)
  const cfg = sources[0]()
  assert.equal(cfg.autoFix, false, 'setSource 换绑后读取到宿主侧新值')
  assert.equal(calls.register.length, 0)
})

test('waist：0.1.0/0.1.1 线（服务只有 register）→ register(ns, Config, {base})', () => {
  const { ctx, injections } = injectableCtx()
  const { svc, calls } = makeSettingsSvc({ register: true })
  ctx.settings = svc

  const sources = []
  installSettingsWaist(ctx, {
    ns: 'preset-manager',
    Config,
    base: () => ({ ...DEFAULT_SETTINGS, homeOverride: '/x' }),
    onSource: (s) => sources.push(s),
  })
  injections[0].fn({ settings: svc })

  assert.equal(calls.register.length, 1)
  assert.equal(calls.register[0].ns, 'preset-manager')
  assert.equal(calls.register[0].opts.base.homeOverride, '/x')
  assert.equal(calls.installSection.length, 0)
  assert.equal(sources.length, 0, 'register 线无 setSource，不换绑')
})

test('waist：rc.1+ 线（两 API 皆无）→ 不注册任何东西', () => {
  const { ctx, injections } = injectableCtx()
  ctx.settings = { describe: () => [] }
  const sources = []
  installSettingsWaist(ctx, { ns: 'preset-manager', Config, base: () => ({}), onSource: (s) => sources.push(s) })
  injections[0].fn({ settings: ctx.settings })
  assert.equal(sources.length, 0)
})

test('waist：installSection 抛错 → 吞掉降级，不外泄（fail-open）', () => {
  const { ctx, injections } = injectableCtx()
  const svc = {
    installSection: () => {
      throw new Error('boom')
    },
  }
  ctx.settings = svc
  assert.doesNotThrow(() => {
    installSettingsWaist(ctx, { ns: 'preset-manager', Config, base: () => ({}), onSource: () => {} })
    injections[0].fn({ settings: svc })
  })
})

test('index apply：wire 三代 waist + 桥；setSource 后扫描读到宿主侧新值', async (t) => {
  // 真实宿主时序：installSection 注册后 setSource 换绑 autoFix=false →
  // 启动扫描不得写盘（autoFix 已被换绑为 false）。
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshpm-waist-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  fs.writeFileSync(
    path.join(home, 'cordis.patch.yml'),
    ['- insert:', '    - id: preset-x', "      name: '@deepseek-ai/dsh-agent-preset'"].join('\n'),
  )

  const effects = []
  const injections = []
  const ctx = {
    inject(deps, fn) {
      injections.push({ deps, fn })
    },
    effect(fn) {
      effects.push({ fn })
    },
    get(name) {
      return ctx[name]
    },
    logger() {
      return { info: () => {} }
    },
  }
  let hooks = null
  ctx.settings = {
    describe: () => [],
    installSection: (c, ns, config, base, h) => {
      hooks = h
    },
  }
  ctx.webServer = { register: () => () => {} }

  apply(ctx, { homeOverride: home, scanProfiles: false, migrateLegacy: false })

  // settings waist + 桥两个 inject 均已登记
  const waistInj = injections.find((i) => i.deps.length === 1 && i.deps[0] === 'settings')
  const bridgeInj = injections.find((i) => i.deps.includes('webServer') && i.deps.includes('settings'))
  assert.ok(waistInj, 'settings waist inject 应登记')
  assert.ok(bridgeInj, 'settings bridge inject 应登记')

  waistInj.fn({ settings: ctx.settings })
  assert.ok(hooks, 'installSection 应被调用')
  // 模拟宿主回 setSource：autoFix=false
  hooks.setSource({ autoFix: false })

  bridgeInj.fn(ctx)
  // 触发启动扫描 effect（含 1s 定时器）
  for (const e of effects) e.fn()
  await new Promise((r) => setTimeout(r, 1400))
  assert.ok(
    fs.readdirSync(home).some((f) => f.startsWith('cordis.patch.yml.bak-')) === false,
    'setSource 换绑 autoFix=false 后启动扫描不得写盘',
  )
})

// ── bridge handlers ──────────────────────────────────────────────

function fakeSettings(descriptors) {
  const calls = { mutate: [] }
  return {
    calls,
    writable: true,
    describe() {
      return descriptors
    },
    async mutate(ns, ops, expectedRevision) {
      calls.mutate.push({ ns, ops, expectedRevision })
    },
  }
}

const LIVE_REF = { autoFix: { get: () => true }, homeOverride: { get: () => '' } }

test('bridge describe：解包活引用 + ns 过滤 + 不可服务时报 settings-not-exposed', async () => {
  const settings = fakeSettings([{ ns: 'preset-manager', value: LIVE_REF, revision: 3 }])
  const routes = makeSettingsBridge({ settings, ns: 'preset-manager', resolveConfig })
  const describeRoute = routes.find((r) => r.path.endsWith('/describe'))
  let body
  const res = { writeHead() {}, end(b) { body = JSON.parse(b) } }
  await describeRoute.handler({ method: 'POST', headers: { host: '127.0.0.1:1' }, socket: { remoteAddress: '127.0.0.1' } }, res)
  assert.equal(body.ok, true)
  assert.equal(body.value.namespaces[0].value.autoFix, true, '活引用应解包为普通值')
  assert.equal(body.value.namespaces[0].revision, 3)

  const settings2 = fakeSettings([{ ns: 'other-plugin', value: {}, revision: 1 }])
  const routes2 = makeSettingsBridge({ settings: settings2, ns: 'preset-manager', resolveConfig })
  let body2
  await routes2.find((r) => r.path.endsWith('/describe')).handler(
    { method: 'POST', headers: { host: '127.0.0.1:1' }, socket: { remoteAddress: '127.0.0.1' } },
    { writeHead() {}, end(b) { body2 = JSON.parse(b) } },
  )
  assert.equal(body2.ok, false)
  assert.equal(body2.code, 'settings-not-exposed')
})

test('bridge mutate：白名单外键拒绝 + 合法 op 透传 + ns 不符拒绝', async () => {
  const settings = fakeSettings([{ ns: 'preset-manager', value: { autoFix: true }, revision: 5 }])
  const routes = makeSettingsBridge({ settings, ns: 'preset-manager', resolveConfig })
  const mutateRoute = routes.find((r) => r.path.endsWith('/mutate'))
  const mkReq = (payload) => ({
    method: 'POST',
    headers: { host: '127.0.0.1:1' },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(payload))
    },
  })

  let body
  await mutateRoute.handler(mkReq({ ns: 'preset-manager', ops: [{ op: 'set', path: ['evil'], value: 1 }] }),
    { writeHead() {}, end(b) { body = JSON.parse(b) } })
  assert.equal(body.code, 'settings-not-exposed', '白名单外键必须拒绝')

  await mutateRoute.handler(mkReq({ ns: 'other', ops: [] }),
    { writeHead() {}, end(b) { body = JSON.parse(b) } })
  assert.equal(body.code, 'settings-rejected', 'ns 不符必须拒绝')

  await mutateRoute.handler(
    mkReq({ ns: 'preset-manager', ops: [{ op: 'set', path: ['autoFix'], value: false }], expectedRevision: 5 }),
    { writeHead() {}, end(b) { body = JSON.parse(b) } },
  )
  assert.equal(body.ok, true)
  assert.equal(settings.calls.mutate.length, 1)
  assert.deepEqual(settings.calls.mutate[0].ops, [{ op: 'set', path: ['autoFix'], value: false }])
  assert.equal(settings.calls.mutate[0].expectedRevision, 5)
})

test('bridge guard：非 loopback / 非 POST 拒绝', async () => {
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: '8.8.8.8' }, headers: {} }), false)
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'evil.com' } }), false)
  assert.equal(
    isLoopbackRequest({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3085', origin: 'http://127.0.0.1:3085' } }),
    true,
  )
})

test('toView：writable 透传 + resolveConfig 解包', () => {
  const settings = { writable: true }
  const view = toView(settings, { ns: 'preset-manager', value: LIVE_REF, revision: 1 }, resolveConfig)
  assert.equal(view.ns, 'preset-manager')
  assert.equal(view.writable, true)
  assert.equal(view.value.autoFix, true)
  assert.equal(BRIDGE_KEYS.length, 4)
})
