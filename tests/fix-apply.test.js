import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanAll } from '../src/scan.js'
import { applyFixes } from '../src/fix/index.js'
import { loadPatch, parsePatchDoc } from '../src/yaml-doc.js'
import { makeDshResolve } from './_stub-resolve.js'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const okResolve = makeDshResolve()

function tmpHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshpm-e2e-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  return home
}

function writePatch(home, rel, text) {
  const file = path.join(home, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  return file
}

test('E2E：包改名 + 行 id 同步 + !!js 保真 + 中文无损', (t) => {
  const home = tmpHome(t)
  const file = writePatch(
    home,
    'cordis.patch.yml',
    [
      '# 头部注释必须原样保留',
      '- insert:',
      '    - id: preset-x',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: x',
      '        name: 标准模式（中文）',
      '        plugins:',
      '          - id: tool-bash',
      "            name: '@deepseek-ai/dsh-tool-bash'",
      '            disabled: !!js process.platform === \'win32\'',
      '          - id: workflow-worker-thread',
      "            name: '@deepseek-ai/dsh-workflow-worker-thread'",
      '          - id: workflow-worker-thread-inner',
      "            name: '@deepseek-ai/dsh-workflow-worker-thread'",
      '            config:',
      '              note: 内层行 id 不含 dsh- 前缀之外的差异',
    ].join('\n'),
  )
  const scan = scanAll({ home, branch: 'main', resolvePkg: okResolve, migrateLegacy: false })
  const renamed = scan.findings.filter((f) => f.rule === 'R-PKG-RENAMED')
  assert.equal(renamed.length, 2)

  const r = applyFixes(scan, { ts: '20260930T000000' })
  assert.equal(r.files.length, 1)
  assert.equal(r.files[0].status, 'written')
  assert.equal(r.errors.length, 0)

  const after = fs.readFileSync(file, 'utf8')
  // 头部注释字节不动
  assert.ok(after.startsWith('# 头部注释必须原样保留\n'))
  // !!js 字节不动
  assert.ok(after.includes('disabled: !!js process.platform === \'win32\''))
  // 包名全部替换；行 id 仅精确匹配的同步改名
  assert.ok(!after.includes('dsh-workflow-worker-thread'), '旧包名应被全部替换')
  assert.ok(after.includes("- id: workflow-ptc\n            name: '@deepseek-ai/dsh-workflow-ptc'"))
  // 内层行 id workflow-worker-thread-inner 是用户自定 id（仅含旧名子串）→ 保守保留，不误改
  assert.ok(after.includes('workflow-worker-thread-inner'))
  // 中文无损
  assert.ok(after.includes('标准模式（中文）'))
  // 语义校验：解析后值正确
  const val = loadPatch(after)
  const rows = val[0].insert
  const wf = rows[0].config.plugins.find((p) => p.id === 'workflow-ptc')
  assert.equal(wf.name, '@deepseek-ai/dsh-workflow-ptc')
  // 备份存在
  assert.equal(fs.readFileSync(`${file}.bak-20260930T000000`, 'utf8'), fs.readFileSync(`${file}.bak-20260930T000000`, 'utf8'))
  // 幂等：重扫 0 findings，重修 0 写盘
  const rescan = scanAll({ home, branch: 'main', resolvePkg: okResolve, migrateLegacy: false })
  assert.equal(rescan.findings.filter((f) => f.level === 'auto').length, 0)
  const r2 = applyFixes(rescan, { ts: '20260930T000000' })
  assert.equal(r2.files.length, 0)
})

test('E2E：persona text 拆分（含独立 cwd 行）', (t) => {
  const home = tmpHome(t)
  const file = writePatch(
    home,
    'cordis.patch.yml',
    [
      '- insert:',
      '    - id: preset-p',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: p',
      '        plugins:',
      '          - id: persona',
      "            name: '@deepseek-ai/dsh-persona'",
      '            config:',
      '              text: |-',
      '                You are a coding agent.',
      '                Your working directory is {{cwd}}.',
      '                Be nice.',
      '              includeRuntimeContext: false',
    ].join('\n'),
  )
  const scan = scanAll({ home, branch: 'main', resolvePkg: okResolve, migrateLegacy: false })
  assert.ok(scan.findings.some((f) => f.rule === 'R-KEY-RENAMED'))
  applyFixes(scan, { ts: '20260930T000000' })

  const after = fs.readFileSync(file, 'utf8')
  assert.ok(!/[ \t]text:[ \t]/.test(after), 'text 键应被移除')
  const val = loadPatch(after)
  const persona = val[0].insert[0].config.plugins[0]
  assert.equal(persona.config.prefix, 'You are a coding agent.\nBe nice.')
  assert.equal(persona.config.suffix, 'Your working directory is {{cwd}}.')
  assert.equal(persona.config.includeRuntimeContext, false)
  // 缩进正确性：解析即证明；再查形态
  assert.ok(after.includes('              prefix: |-'))
  assert.ok(after.includes('                You are a coding agent.'))
})

test('E2E：persona text 无独立 cwd 行 → 全部进 prefix，suffix 不写', (t) => {
  const home = tmpHome(t)
  const file = writePatch(
    home,
    'cordis.patch.yml',
    [
      '- insert:',
      '    - id: preset-p',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: p',
      '        plugins:',
      '          - id: persona',
      "            name: '@deepseek-ai/dsh-persona'",
      '            config:',
      '              text: Single line with {{cwd}} inline.',
    ].join('\n'),
  )
  const scan = scanAll({ home, branch: 'main', resolvePkg: okResolve, migrateLegacy: false })
  applyFixes(scan, { ts: '20260930T000000' })
  const after = fs.readFileSync(file, 'utf8')
  const persona = loadPatch(after)[0].insert[0].config.plugins[0]
  assert.equal(persona.config.prefix, 'Single line with {{cwd}} inline.')
  assert.equal(persona.config.suffix, undefined)
})

test('E2E：本地路径改写为绝对 file:// URL（原文件不动）', (t) => {
  const home = tmpHome(t)
  const custom = path.join(home, 'custom-bash.mjs')
  fs.writeFileSync(custom, 'export default () => {}\n')
  const file = writePatch(
    home,
    'cordis.patch.yml',
    [
      '- insert:',
      '    - id: preset-c',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: c',
      '        plugins:',
      '          - id: custom-bash',
      '            name: ./custom-bash.mjs',
    ].join('\n'),
  )
  const scan = scanAll({ home, branch: 'main', resolvePkg: okResolve, migrateLegacy: false })
  applyFixes(scan, { ts: '20260930T000000' })
  const after = fs.readFileSync(file, 'utf8')
  const expectedUrl = `file:///${custom.split(path.sep).join('/')}`
  assert.ok(after.includes(`name: ${expectedUrl}`), after)
  assert.ok(!after.includes('name: ./custom-bash.mjs'))
  // 原 .mjs 未移动
  assert.equal(fs.readFileSync(custom, 'utf8'), 'export default () => {}\n')
})

test('E2E：autoFix=false（dryRun）时 0 写盘', (t) => {
  const home = tmpHome(t)
  const file = writePatch(
    home,
    'cordis.patch.yml',
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
  const before = fs.readFileSync(file, 'utf8')
  const scan = scanAll({ home, branch: 'main', resolvePkg: okResolve, migrateLegacy: false })
  const r = applyFixes(scan, { dryRun: true, ts: '20260930T000000' })
  assert.equal(r.files[0].status, 'would-write')
  assert.equal(fs.readFileSync(file, 'utf8'), before)
  assert.ok(!fs.existsSync(`${file}.bak-20260930T000000`))
})

test('E2E：真实旧格式 6 预设全迁移 + 与 converted 基线结构一致（归一化后）', (t) => {
  const home = tmpHome(t)
  fs.cpSync(path.join(FIXTURES, 'original'), path.join(home, '.agent-presets'), { recursive: true })
  const scan = scanAll({ home, resolvePkg: okResolve, branch: 'main' })
  const legacy = scan.findings.filter((f) => f.rule === 'R-LEGACY')
  assert.equal(legacy.length, 6)

  const r = applyFixes(scan, { ts: '20260930T000000' })
  assert.equal(r.migrated.filter((m) => m.status === 'written').length, 6)
  assert.equal(r.errors.length, 0)

  const patchFile = path.join(home, 'cordis.patch.yml')
  const text = fs.readFileSync(patchFile, 'utf8')
  // 排序：order 升序（liangshen 有 order:4；其余缺失排后按 id 序）
  const val = loadPatch(text)
  const rows = val[0].insert
  const ids = rows.map((x) => x.config.id)
  assert.deepEqual(ids, [
    'liangshen',
    'simple-reply',
    'standard-win',
    'standard-win-gitbash',
    'standard-win-msys2',
    'standard-win-wsl2',
  ])

  // 与人工转换基线结构比对（standard-win-gitbash）：两侧都按迁移表归一化旧包名后应一致
  const baseline = loadPatch(fs.readFileSync(path.join(FIXTURES, 'converted', 'standard-win-gitbash.patch.yml'), 'utf8'))
  const norm = (rows) =>
    JSON.stringify(rows[0].config.plugins, (k, v) => (typeof v === 'string' ? v.replaceAll('workflow-worker-thread', 'workflow-ptc') : v))
  const ours = rows.find((x) => x.config.id === 'standard-win-gitbash')
  assert.equal(norm([ours]), norm([baseline[0].insert[0]]))

  // 行 id 同步：迁移产物中不应再有任何旧包名 / 旧行 id
  assert.ok(!text.includes('workflow-worker-thread'), '迁移产物不应残留旧包名')

  // 幂等：再跑一遍 → 全部 skipped，文件不变
  const before = fs.readFileSync(patchFile, 'utf8')
  const rescan = scanAll({ home, resolvePkg: okResolve, branch: 'main' })
  assert.equal(rescan.findings.filter((f) => f.rule === 'R-LEGACY').length, 0, '迁移后旧目录不再报 R-LEGACY？——目录仍在，但 patch 已声明 → conflict')
  const r2 = applyFixes(rescan, { ts: '20260930T000001' })
  assert.equal(r2.migrated.filter((m) => m.status === 'written').length, 0)
  assert.equal(fs.readFileSync(patchFile, 'utf8'), before)
})

test('E2E：CRLF 文件修复后未触碰区间仍是 CRLF', (t) => {
  const home = tmpHome(t)
  const file = writePatch(
    home,
    'cordis.patch.yml',
    [
      '- insert:',
      '    - id: preset-x',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: x',
      '        plugins:',
      '          - id: workflow-worker-thread',
      "            name: '@deepseek-ai/dsh-workflow-worker-thread'",
    ].join('\r\n'),
  )
  const scan = scanAll({ home, branch: 'main', resolvePkg: okResolve, migrateLegacy: false })
  applyFixes(scan, { ts: '20260930T000000' })
  const after = fs.readFileSync(file, 'utf8')
  assert.ok(after.includes('workflow-ptc'))
  assert.ok(after.includes('\r\n'), '应保持 CRLF')
  assert.ok(!/(?<!\r)\n/.test(after.replace(/\r\n/g, '')), '不应出现裸 LF')
})

test('E2E：向既有 patch 追加迁移块，既有字节不动 + 结果可解析', (t) => {
  const home = tmpHome(t)
  const existing = [
    '# existing',
    '- insert:',
    '    - id: preset-manager',
    '      name: "dsh-preset-doctor"',
    '',
  ].join('\n')
  const file = writePatch(home, 'cordis.patch.yml', existing)
  fs.mkdirSync(path.join(home, '.agent-presets', 'mini'), { recursive: true })
  fs.writeFileSync(path.join(home, '.agent-presets', 'mini', 'preset.yml'), 'name: Mini\norder: 9\n')
  fs.writeFileSync(
    path.join(home, '.agent-presets', 'mini', 'agent.cordis.yml'),
    [
      '# 组合注释',
      '- id: tool-fs',
      "  name: '@deepseek-ai/dsh-tool-fs'",
      '- id: tool-bash',
      "  name: '@deepseek-ai/dsh-tool-bash'",
      '  disabled: !!js process.platform === \'win32\'',
    ].join('\n'),
  )
  const scan = scanAll({ home, resolvePkg: okResolve, branch: 'main' })
  applyFixes(scan, { ts: '20260930T000000' })
  const after = fs.readFileSync(file, 'utf8')
  // 既有头部 4 行字节不动
  assert.ok(after.startsWith(existing))
  // 组合注释也保留、!!js 保真
  assert.ok(after.includes('# 组合注释'))
  assert.ok(after.includes('disabled: !!js process.platform === \'win32\''))
  // 可解析且结构正确
  const { doc } = parsePatchDoc(after)
  assert.equal(doc.errors.length, 0)
  const val = loadPatch(after)
  assert.equal(val[0].insert.length, 2, '应追加进同一个 insert 列表')
  assert.equal(val[0].insert[1].config.id, 'mini')
  assert.equal(val[0].insert[1].config.order, 9)
  assert.equal(val[0].insert[1].config.plugins[0].id, 'tool-fs')
})
