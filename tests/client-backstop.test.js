/**
 * 家族兜底探针回归（lib/client.js 的三格真值表）。
 *
 * 钉住 0.2.2 线现网故障的那一格：**别人占住了 dsh-family 容器，而本插件的
 * `dsh-family.tab` inject 从未派发**。旧探针查的是「容器在不在」，于是直接
 * return —— 既不进家族也不自立，设置面静默消失。新探针查「我自己有没有座位」，
 * 该格必须落到「本插件专属 settings.section」。
 *
 * 三格：
 *   A 容器被别人占住、我的 tab inject 没派发   → 自立 preset-manager-standalone
 *   B 容器在、我的 tab 注册成功                 → 什么都不加（唯一入口）
 *   C 无人建容器                                → 自建 dsh-family 且声明 children，
 *                                                账本为空时节体直接内联本卡
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const SOURCE = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const require_ = createRequire(import.meta.url)

/** 极简 slots 门面：区分「槽已声明」与「有注册」，这正是本插件的判据来源。 */
function makeSlots() {
  /** @type {Map<string, Array<{options: any, component: any}>>} */
  const entries = new Map()
  /** @type {Map<string, Array<() => any>>} */
  const pending = new Map()
  const declared = new Set()
  const watched = new Map()
  let version = 0
  const bump = (slot) => {
    version += 1
    for (const fn of (watched.get(slot) || []).slice()) fn()
  }
  return {
    entriesFor: (slot) => (entries.get(slot) || []).slice(),
    declaredSlots: () => [...declared],
    pendingFor: (slot) => (pending.get(slot) || []).length,
    /** 模拟「别人声明了子槽」：flush 该槽挂起的 inject 工厂。 */
    declareFromOwner(slot) {
      if (declared.has(slot)) return
      declared.add(slot)
      const factories = (pending.get(slot) || []).splice(0)
      for (const factory of factories) factory()
    },
    /** 模拟「别人占了 settings.section 的某个 id」。 */
    seatByOwner(slot, id) {
      if (!declared.has(slot)) declared.add(slot)
      entries.get(slot) || entries.set(slot, [])
      entries.get(slot).push({ options: { name: slot, id }, component: () => null })
      bump(slot)
    },
    register(options, component) {
      const slot = options.name
      entries.get(slot) || entries.set(slot, [])
      const row = { options, component }
      entries.get(slot).push(row)
      if (options.children) {
        for (const child of Object.keys(options.children)) {
          if (!declared.has(child)) {
            declared.add(child)
            const factories = (pending.get(child) || []).splice(0)
            for (const factory of factories) factory()
          }
        }
      }
      bump(slot)
      return () => {
        const list = entries.get(slot) || []
        const at = list.indexOf(row)
        if (at >= 0) list.splice(at, 1)
        bump(slot)
      }
    },
    inject(slot, factory) {
      if (declared.has(slot)) {
        factory()
        return () => {}
      }
      pending.get(slot) || pending.set(slot, [])
      pending.get(slot).push(factory)
      return () => {}
    },
    entries(slot) {
      return (entries.get(slot) || []).slice()
    },
    subscribe(slot, fn) {
      watched.get(slot) || watched.set(slot, [])
      watched.get(slot).push(fn)
      return () => {
        const list = watched.get(slot) || []
        const at = list.indexOf(fn)
        if (at >= 0) list.splice(at, 1)
      }
    },
    getVersion() {
      return version
    },
  }
}

/** 极简 react：只够节体跑出一条元素树。 */
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => undefined,
  useRef: (v) => ({ current: v }),
  Fragment: Symbol('Fragment'),
}

function makeDocument() {
  const head = { append() {} }
  return {
    head,
    createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
    body: {},
    querySelector: () => null,
  }
}

/**
 * 装载 client 半边并执行 apply，返回可手动推进的时钟。
 * @returns {{ ctx: any, slots: any, advance: () => void, warnings: string[] }}
 */
function boot() {
  const warnings = []
  const timers = []
  const realSetTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  const realDateNow = Date.now
  const realWarn = console.warn
  let clock = realDateNow.call(Date)
  const slots = makeSlots()
  const ctx = {
    slots,
    effect: () => undefined,
    inject: () => undefined,
    get: () => undefined,
  }
  const stubRequire = (specifier) => (specifier === 'react' ? react : require_(specifier))
  const win = { __ModuleLoader__: { load: ({ factory }) => { booted = factory(stubRequire) } } }
  const doc = makeDocument()
  const nav = { languages: ['zh-CN'], language: 'zh-CN' }
  let booted
  // window/document/navigator 走形参注入（bundle 是 `(require, window, document,
  // navigator) => …` 的工厂），不碰 globalThis 上的只读 getter。
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms: Number(ms) || 0 }); return timers.length }
  globalThis.clearTimeout = () => {}
  Date.now = () => clock
  console.warn = (...args) => { warnings.push(args.join(' ')) }
  try {
    new Function('require', 'window', 'document', 'navigator', SOURCE)(stubRequire, win, doc, nav)
    booted.apply(ctx)
  } finally {
    globalThis.setTimeout = realSetTimeout
    globalThis.clearTimeout = realClearTimeout
    Date.now = realDateNow
    console.warn = realWarn
  }
  return {
    ctx,
    slots,
    warnings,
    /** 推进到兜底判据过点并跑完所有挂起的定时器。 */
    advance() {
      clock += 10000
      runAll(timers, () => clock, warnings)
    },
    /**
     * 只跑「订阅触发的那一发」（ms=0 的重估），不推进时钟。
     * 用来看 due 闸有没有把过点前的重估挡住；主定时器（6500）留着给 advance。
     */
    flushWithoutClock() {
      const dueNow = timers.filter((timer) => timer.ms === 0)
      for (const timer of dueNow) {
        const at = timers.indexOf(timer)
        if (at >= 0) timers.splice(at, 1)
      }
      runAll(dueNow, () => clock, warnings)
    },
  }
}

/** 跑完指定定时器：跑的时候临时接管 Date.now / console.warn（boot 已还给真实现）。 */
function runAll(queue, now, warnings) {
  const realNow = Date.now
  const realWarn = console.warn
  Date.now = now
  console.warn = (...args) => { warnings.push(args.join(' ')) }
  try {
    while (queue.length) {
      const timer = queue.shift()
      timer.fn()
    }
  } finally {
    Date.now = realNow
    console.warn = realWarn
  }
}

const sectionIds = (slots) => slots.entriesFor('settings.section').map((row) => row.options.id)
const tabIds = (slots) => slots.entriesFor('dsh-family.tab').map((row) => row.options.id)

test('A 容器被别人占住、本人 inject 未派发 → 自立专属 section（现网故障格）', () => {
  const h = boot()
  // 别人先占了 dsh-family（TL/guard 都这么做），但子槽没派发到本插件。
  h.slots.seatByOwner('settings.section', 'dsh-family')
  assert.equal(h.slots.pendingFor('dsh-family.tab'), 1, '本插件的 tab inject 应挂起等待')
  h.advance()
  assert.ok(sectionIds(h.slots).includes('preset-manager-standalone'), '必须自立专属 section，不能静默消失')
  assert.ok(
    h.warnings.some((text) => text.includes('never registered')),
    '这一格必须留下告警，不能静默',
  )
  // 抢 id 会顶掉别人整节：绝不能注册第二个 dsh-family。
  assert.equal(sectionIds(h.slots).filter((id) => id === 'dsh-family').length, 1)
})

test('B 容器在且 tab 注册成功 → 不再加任何入口（唯一入口）', () => {
  const h = boot()
  h.slots.seatByOwner('settings.section', 'dsh-family')
  h.slots.declareFromOwner('dsh-family.tab')
  assert.deepEqual(tabIds(h.slots), ['preset-manager'])
  h.advance()
  assert.deepEqual(sectionIds(h.slots), ['dsh-family'], '有座位时不得再自立')
  assert.deepEqual(tabIds(h.slots), ['preset-manager'])
})

test('C 无人建容器 → 自建 dsh-family 并声明 children，账本为空时内联本卡', () => {
  const h = boot()
  h.advance()
  assert.ok(sectionIds(h.slots).includes('dsh-family'), '必须自己上位建容器')
  const section = h.slots.entriesFor('settings.section').find((row) => row.options.id === 'dsh-family')
  assert.ok(section.options.children && section.options.children['dsh-family.tab'], '必须声明子槽，否则后来者全落空')
  // 自建容器声明 children 后，本插件的 tab 应自重注册进账本。
  assert.deepEqual(tabIds(h.slots), ['preset-manager'])
  assert.ok(!sectionIds(h.slots).includes('preset-manager-standalone'), '自建容器时不该再叠自立节')
})

test('C-空账本：容器在但没有任何 tab → 节体直挂本卡，不渲染空白节', () => {
  const h = boot()
  // 走插件自己的兜底建容器，再拿它的节体喂一份「空账本」注入面，
  // 模拟「容器起来了但一个 tab 都没到」的中间态。
  h.advance()
  const section = h.slots.entriesFor('settings.section').find((row) => row.options.id === 'dsh-family')
  assert.ok(section, '兜底应先建出 dsh-family 节')
  const injected = section.options.inject ? section.options.inject() : {}
  const hooks = injected.hooks
  assert.equal(typeof hooks.tabs.getSnapshot, 'function', '注入面必须带账本快照')
  const emptyHooks = { tabs: { getSnapshot: () => [], subscribe: () => () => {} } }
  const tree = section.component({ hooks: emptyHooks })
  assert.ok(tree, '账本为空时节体必须直挂本卡，不能空白')
  assert.equal(tree.props.role, 'tabpanel', '空账本走内联本卡分支')
})

test('due 闸：时钟未过点前收到 slot 变更通知，不得提前自立', () => {
  const h = boot()
  h.slots.seatByOwner('settings.section', 'dsh-family')
  // subscribe 回调排了 evaluate(0)，但时钟没动 → due 闸必须挡住。
  h.flushWithoutClock()
  assert.ok(!sectionIds(h.slots).includes('preset-manager-standalone'), '过点前不得自立')
  h.advance()
  assert.ok(sectionIds(h.slots).includes('preset-manager-standalone'))
})
