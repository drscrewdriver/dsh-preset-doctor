import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply, DEFAULT_SETTINGS, Config } from '../src/index.js'
import { normalizeFindings, summarize, renderText, renderJson } from '../src/report.js'

function tmpHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshpm-plug-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  return home
}

function writeBrokenPatch(home) {
  const file = path.join(home, 'cordis.patch.yml')
  fs.writeFileSync(
    file,
    [
      '- insert:',
      '    - id: preset-x',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: x',
      '        plugins:',
      '          - id: workflow-worker-thread',
      "            name: '@deepseek-ai/dsh-workflow-worker-thread'",
    ].join('\n'),
  )
  return file
}

function mockCtx() {
  const effects = []
  const logs = []
  const injections = []
  const ctx = {
    effect(fn, name) {
      effects.push({ fn, name })
    },
    // settings waist / 设置桥的 scoped inject：桩只登记不触发（本套件无 settings 服务）
    inject(deps, fn) {
      injections.push({ deps, fn })
    },
    // cordis ctx 的服务解析面：registerPresetDoctorCommand 走 ctx.get('commands')
    // 探测（严格代理下直接读 ctx.commands 属性会 throw），桩必须同构
    get(name) {
      return ctx[name]
    },
    logger(name) {
      return { info: (...a) => logs.push(`[${name}] ${a.join(' ')}`) }
    },
  }
  return { ctx, effects, logs, injections }
}

test('插件 apply：启动扫描恒只报告（2026-10-08 定案：即使 autoFix=true 也不自动修）', async (t) => {
  const home = tmpHome(t)
  const file = writeBrokenPatch(home)
  const before = fs.readFileSync(file, 'utf8')
  const { ctx, effects, logs } = mockCtx()
  apply(ctx, { autoFix: true, homeOverride: home, scanProfiles: false, migrateLegacy: false })
  assert.equal(effects.length, 2, '应注册启动扫描 + 命令两个 effect')
  // 触发启动 effect（含 1s 定时器），等它跑完
  for (const e of effects) e.fn()
  await new Promise((r) => setTimeout(r, 1400))
  assert.equal(fs.readFileSync(file, 'utf8'), before, '启动扫描绝不写盘（共用预设防误改）')
  assert.ok(!fs.readdirSync(home).some((f) => f.startsWith('cordis.patch.yml.bak-')), '不应有备份（没写盘）')
  assert.ok(logs.some((l) => l.includes('dsh-preset-doctor 扫描报告')), 'logger 应输出报告')
})

test('插件 apply：autoFix=false 时只报告不写盘', async (t) => {
  const home = tmpHome(t)
  const file = writeBrokenPatch(home)
  const before = fs.readFileSync(file, 'utf8')
  const { ctx, effects } = mockCtx()
  apply(ctx, { ...DEFAULT_SETTINGS, autoFix: false, homeOverride: home, scanProfiles: false, migrateLegacy: false })
  for (const e of effects) e.fn()
  await new Promise((r) => setTimeout(r, 1400))
  assert.equal(fs.readFileSync(file, 'utf8'), before)
})

test('runScanFix scan 模式（经 /preset-doctor 命令 handler）', async (t) => {
  const home = tmpHome(t)
  const file = writeBrokenPatch(home)
  const before = fs.readFileSync(file, 'utf8')
  const { ctx, effects } = mockCtx()
  let registered
  ctx.commands = { register: (def) => (registered = def) }
  apply(ctx, { ...DEFAULT_SETTINGS, homeOverride: home, scanProfiles: false, migrateLegacy: false })
  for (const e of effects) e.fn()
  assert.ok(registered, '命令应已注册')
  assert.equal(registered.name, 'preset-doctor')
  const result = registered.handler({ rawInput: 'scan' })
  assert.equal(result.kind, 'text')
  assert.ok(result.text.includes('R-PKG-RENAMED'))
  // scan 不写盘
  assert.equal(fs.readFileSync(file, 'utf8'), before)

  // 2026-10-09「取消自动闸 全手动确认」：显式 fix 命令即手动确认，写盘 + .bak
  const fixedResult = registered.handler({ rawInput: 'fix' })
  assert.equal(fixedResult.kind, 'text')
  assert.ok(fs.readFileSync(file, 'utf8').includes('workflow-ptc'), '显式 fix 命令应写盘修复')
  assert.ok(fs.readdirSync(home).some((f) => f.startsWith('cordis.patch.yml.bak-')), '写盘前应有 .bak 备份')
})

test('autoFix=true 时 /preset-doctor fix 手动写盘修复（手动确认路径）', async (t) => {
  const home = tmpHome(t)
  const file = writeBrokenPatch(home)
  const { ctx, effects } = mockCtx()
  let registered
  ctx.commands = { register: (def) => (registered = def) }
  apply(ctx, { ...DEFAULT_SETTINGS, autoFix: true, homeOverride: home, scanProfiles: false, migrateLegacy: false })
  for (const e of effects) e.fn()
  const fixResult = registered.handler({ rawInput: 'fix' })
  assert.equal(fixResult.kind, 'text')
  assert.ok(fs.readFileSync(file, 'utf8').includes('workflow-ptc'), '总闸开启后显式 fix 应写盘')
  assert.ok(fs.readdirSync(home).some((f) => f.startsWith('cordis.patch.yml.bak-')), '写盘前应有 .bak 备份')
})

test('report：normalizeFindings 排序编号 + renderText/renderJson 关键内容', () => {
  const fakeScan = {
    home: '/tmp/h',
    findings: [
      { rule: 'R-ZZZ', level: 'report', file: 'b.yml', line: 2, rowId: '', reason: 'r2', suggestion: 's2' },
      { rule: 'R-AAA', level: 'auto', file: 'a.yml', line: 9, rowId: 'x', reason: 'r1', suggestion: 's1' },
    ],
  }
  const n = normalizeFindings(fakeScan.findings)
  assert.equal(n[0].no, 1)
  assert.equal(n[0].rule, 'R-AAA') // a.yml 排前
  const text = renderText(summarize(fakeScan, null))
  assert.ok(text.startsWith('注意：'))
  assert.ok(text.includes('R-PKG') === false && text.includes('R-AAA'))
  assert.ok(text.includes('a.yml:9'))
  const json = JSON.parse(renderJson(summarize(fakeScan, null)))
  assert.equal(json.behaviorEquivalent, false)
  assert.equal(json.total, 2)
})

test('Config 是 schemastery 对象（volatile 字段自动表单）', () => {
  // schemastery 对象可被引用即可；具体表单渲染由 DSH settings 服务负责
  assert.ok(Config)
  assert.equal(typeof DEFAULT_SETTINGS.scanProfiles, 'boolean')
})
