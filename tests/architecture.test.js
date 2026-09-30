import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scanAll } from '../src/scan.js'
import { applyFixes } from '../src/fix/index.js'
import { loadTables, resolveRenameChain, compareSemver, BUILTIN_CHANGES } from '../src/tables/load.js'
import { eraAnalysis, renderText, summarize } from '../src/report.js'
import { loadPatch } from '../src/yaml-doc.js'
import { makeDshResolve } from './_stub-resolve.js'

function tmpHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshpm-arch-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  return home
}

function writePatch(home, rel, text) {
  const file = path.join(home, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  return file
}

const rowsWith = (pkg, id) =>
  [
    '- insert:',
    '    - id: preset-x',
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    '        id: x',
    '        plugins:',
    `          - id: ${id}`,
    `            name: '${pkg}'`,
  ].join('\n')

test('compareSemver：语义化版本比较（含 alpha/rc 后缀）', () => {
  assert.equal(compareSemver('0.1.3-alpha.2', '0.1.3-alpha.1'), 1)
  assert.equal(compareSemver('0.1.7-alpha.1', '0.1.6-alpha.2'), 1)
  assert.equal(compareSemver('0.2.0-rc.2', '0.2.0-rc.2'), 0)
  assert.equal(compareSemver('0.1.10', '0.1.9'), 1)
  assert.equal(compareSemver('0.1.3-alpha.2', '0.1.3'), -1)
})

test('链式收敛：A→B、B→C ⇒ A 解析为 C，并收集链上最早 brokenIn', () => {
  const resolved = resolveRenameChain([
    { kind: 'package-rename', brokenIn: '0.2.1-alpha.1', from: '@x/b', to: '@x/c' },
    { kind: 'package-rename', brokenIn: '0.1.6-alpha.1', from: '@x/a', to: '@x/b' },
  ])
  assert.deepEqual(resolved.get('@x/a'), { to: '@x/c', renameRowId: true, brokenIn: '0.1.6-alpha.1' })
  assert.deepEqual(resolved.get('@x/b'), { to: '@x/c', renameRowId: true, brokenIn: '0.2.1-alpha.1' })
})

test('链式收敛：环检测丢弃环边不死循环', () => {
  const warnings = []
  const resolved = resolveRenameChain(
    [
      { kind: 'package-rename', brokenIn: '1.0.0', from: '@x/a', to: '@x/b' },
      { kind: 'package-rename', brokenIn: '1.0.0', from: '@x/b', to: '@x/a' },
    ],
    (m) => warnings.push(m),
  )
  assert.equal(resolved.size, 0)
  assert.ok(warnings.some((w) => w.includes('成环')))
})

test('门禁：旧名在运行安装仍活着 → 不产生任何 finding（老安装不误伤）', (t) => {
  const home = tmpHome(t)
  writePatch(home, 'cordis.patch.yml', rowsWith('@deepseek-ai/dsh-workflow-worker-thread', 'workflow-worker-thread'))
  const aliveResolve = makeDshResolve({ dead: [] }) // 模拟老安装：旧名仍存在
  const { findings } = scanAll({ home, branch: 'main', resolvePkg: aliveResolve, migrateLegacy: false })
  assert.deepEqual(findings.filter((f) => ['R-PKG-RENAMED', 'R-PKG-MISSING'].includes(f.rule)), [])
})

test('门禁：旧名已死 + 新名也死 → R-PKG-MISSING 且带改名候选提示', (t) => {
  const home = tmpHome(t)
  writePatch(home, 'cordis.patch.yml', rowsWith('@deepseek-ai/dsh-workflow-worker-thread', 'workflow-worker-thread'))
  const brokenInstallResolve = makeDshResolve({ dead: ['@deepseek-ai/dsh-workflow-worker-thread', '@deepseek-ai/dsh-workflow-ptc'] })
  const { findings } = scanAll({ home, branch: 'main', resolvePkg: brokenInstallResolve, migrateLegacy: false })
  const missing = findings.filter((f) => f.rule === 'R-PKG-MISSING')
  assert.equal(missing.length, 1)
  assert.equal(missing[0].data.renameCandidate, '@deepseek-ai/dsh-workflow-ptc')
})

test('用户覆盖表：同名 from 覆盖内置；新条目追加生效', (t) => {
  const home = tmpHome(t)
  const userTable = path.join(home, 'preset-manager', 'tables.user.json')
  fs.mkdirSync(path.dirname(userTable), { recursive: true })
  fs.writeFileSync(
    userTable,
    JSON.stringify({
      changes: [
        // 覆盖内置：workflow-worker-thread 的继任者改成别的（模拟用户特殊环境）
        { kind: 'package-rename', brokenIn: '0.1.6-alpha.1', from: '@deepseek-ai/dsh-workflow-worker-thread', to: '@deepseek-ai/dsh-workflow-ptc-custom' },
        // 全新条目：DSH 新版本把 tool-web 改名了（内置表不知道）
        { kind: 'package-rename', brokenIn: '0.2.1-alpha.1', from: '@deepseek-ai/dsh-tool-web', to: '@deepseek-ai/dsh-tool-webfetch' },
      ],
    }),
  )
  const { tables, warnings } = loadTables({ home })
  assert.equal(tables.packageRenames.size, 2, '同名覆盖不重复：' + warnings.join(';'))
  assert.equal(tables.packageRenames.get('@deepseek-ai/dsh-tool-web').to, '@deepseek-ai/dsh-tool-webfetch')
  assert.equal(tables.packageRenames.get('@deepseek-ai/dsh-workflow-worker-thread').to, '@deepseek-ai/dsh-workflow-ptc-custom')

  // 新条目驱动自动修复（用户不等插件发版即可自救）
  const file = writePatch(home, 'cordis.patch.yml', rowsWith('@deepseek-ai/dsh-tool-web', 'tool-web'))
  const resolve = makeDshResolve({ dead: ['@deepseek-ai/dsh-tool-web'], alive: ['@deepseek-ai/dsh-tool-webfetch', '@deepseek-ai/dsh-workflow-ptc'] })
  const scan = scanAll({ home, branch: 'main', resolvePkg: resolve, migrateLegacy: false })
  const renamed = scan.findings.filter((f) => f.rule === 'R-PKG-RENAMED')
  assert.equal(renamed.length, 1)
  assert.equal(renamed[0].data.to, '@deepseek-ai/dsh-tool-webfetch')
  applyFixes(scan, { ts: '20260930T000000' })
  assert.ok(fs.readFileSync(file, 'utf8').includes('dsh-tool-webfetch'))
})

test('用户覆盖表损坏 → 警告并回退内置表，不崩', (t) => {
  const home = tmpHome(t)
  const userTable = path.join(home, 'preset-manager', 'tables.user.json')
  fs.mkdirSync(path.dirname(userTable), { recursive: true })
  fs.writeFileSync(userTable, '{ broken json')
  const { tables, warnings } = loadTables({ home })
  assert.equal(tables.packageRenames.size, 1)
  assert.ok(warnings.some((w) => w.includes('用户迁移表解析失败')))
})

test('时代判定：0.1.0 时代的预设显示最早起点与跨越节点', () => {
  const findings = [
    { rule: 'R-KEY-RENAMED', level: 'auto', file: 'p.yml', line: 5, rowId: 'preset-old', data: { brokenIn: '0.1.3-alpha.2' } },
    { rule: 'R-PKG-RENAMED', level: 'auto', file: 'p.yml', line: 9, rowId: 'preset-old', data: { brokenIn: '0.1.6-alpha.1' } },
  ]
  const eras = eraAnalysis(findings)
  assert.equal(eras.length, 1)
  assert.equal(eras[0].baseEra, '≤0.1.3-alpha.2') // 最早失效点 = 预设写于它之前
  assert.deepEqual(eras[0].hops, ['0.1.3-alpha.2', '0.1.6-alpha.1'])
  const text = renderText(summarize({ home: '/h', findings }, null))
  assert.ok(text.includes('写于 ≤0.1.3-alpha.2'))
})

/**
 * 核心场景：四个时代（0.1.0 / 0.1.2 / 0.1.5 / 0.1.7）写下的预设，
 * 同一张追加式变更表，全部收敛到当前安装的合法语法。
 * —— 「每个分支的版本终点都不一样」的架构解：终点统一为当前安装，
 *    分支差异只体现为命中的失效令牌不同。
 */
test('四代预设同表收敛：0.1.0 / 0.1.2 / 0.1.5 / 0.1.7 → 当前安装', (t) => {
  const home = tmpHome(t)
  // 0.1.0 时代：persona 用 text + workflow 用旧包名（两个失效令牌都有）
  writePatch(
    home,
    'cordis.patch.yml',
    [
      '- insert:',
      '    - id: preset-era010',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: era010',
      '        plugins:',
      '          - id: persona',
      "            name: '@deepseek-ai/dsh-persona'",
      '            config:',
      '              text: |-',
      '                You are an agent.',
      '                Your working directory is {{cwd}}.',
      '          - id: workflow-worker-thread',
      "            name: '@deepseek-ai/dsh-workflow-worker-thread'",
    ].join('\n'),
  )
  // 0.1.2 时代：persona 用 text，workflow 还不存在于该预设（单令牌）
  writePatch(
    home,
    'profiles/web/cordis.patch.yml',
    [
      '- insert:',
      '    - id: preset-era012',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: era012',
      '        plugins:',
      '          - id: persona',
      "            name: '@deepseek-ai/dsh-persona'",
      '            config:',
      '              text: Just text, no cwd line.',
    ].join('\n'),
  )
  // 0.1.5 时代：persona 已用 prefix（D 不命中），workflow 用旧包名（F 命中）
  writePatch(
    home,
    'profiles/cli/cordis.patch.yml',
    [
      '- insert:',
      '    - id: preset-era015',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: era015',
      '        plugins:',
      '          - id: persona',
      "            name: '@deepseek-ai/dsh-persona'",
      '            config:',
      '              prefix: Already using prefix.',
      '          - id: workflow-worker-thread',
      "            name: '@deepseek-ai/dsh-workflow-worker-thread'",
    ].join('\n'),
  )
  // 0.1.7 时代：全部新语法（无失效令牌）→ 0 findings
  writePatch(
    home,
    'profiles/api/cordis.patch.yml',
    [
      '- insert:',
      '    - id: preset-era017',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: era017',
      '        plugins:',
      '          - id: persona',
      "            name: '@deepseek-ai/dsh-persona'",
      '            config:',
      '              prefix: Current syntax.',
      '          - id: workflow-ptc',
      "            name: '@deepseek-ai/dsh-workflow-ptc'",
    ].join('\n'),
  )

  const resolve = makeDshResolve({
    dead: ['@deepseek-ai/dsh-workflow-worker-thread'],
    alive: ['@deepseek-ai/dsh-workflow-ptc', '@deepseek-ai/dsh-agent-preset', '@deepseek-ai/dsh-persona'],
  })
  const scan = scanAll({ home, branch: 'main', resolvePkg: resolve, migrateLegacy: false })
  const renamed = scan.findings.filter((f) => f.rule === 'R-PKG-RENAMED')
  const keyRenamed = scan.findings.filter((f) => f.rule === 'R-KEY-RENAMED')
  assert.equal(renamed.length, 2, '两个时代的旧包名都命中')
  assert.equal(keyRenamed.length, 2, '两个时代的 persona text 都命中')

  // 时代判定：起点不同、终点相同
  const eras = scan.findings.length ? eraAnalysis(scan.findings) : []
  const eraOf = (id) => eras.find((e) => e.preset === id)
  assert.equal(eraOf('era010').baseEra, '≤0.1.3-alpha.2', '0.1.0 时代：起点=两个失效令牌的较早者')
  assert.equal(eraOf('era012').baseEra, '≤0.1.3-alpha.2')
  assert.equal(eraOf('era015').baseEra, '≤0.1.6-alpha.1', '0.1.5 时代：只跨包改名一个节点')
  assert.equal(eraOf('era017'), undefined, '0.1.7 时代：无失效令牌，无时代条目')

  const r = applyFixes(scan, { ts: '20260930T000000' })
  assert.equal(r.errors.length, 0)
  assert.equal(r.files.length, 3, 'home + web + cli 三个文件被修')

  // 全部收敛到当前语法
  const val = loadPatch(fs.readFileSync(path.join(home, 'cordis.patch.yml'), 'utf8'))
  const p010 = val[0].insert[0].config.plugins
  assert.equal(p010.find((x) => x.id === 'persona').config.prefix, 'You are an agent.')
  assert.equal(p010.find((x) => x.id === 'persona').config.suffix, 'Your working directory is {{cwd}}.')
  assert.equal(p010.find((x) => x.id === 'workflow-ptc').name, '@deepseek-ai/dsh-workflow-ptc')

  const web = loadPatch(fs.readFileSync(path.join(home, 'profiles/web/cordis.patch.yml'), 'utf8'))
  assert.equal(web[0].insert[0].config.plugins[0].config.prefix, 'Just text, no cwd line.')
  assert.equal(web[0].insert[0].config.plugins[0].config.suffix, undefined)

  const cli = loadPatch(fs.readFileSync(path.join(home, 'profiles/cli/cordis.patch.yml'), 'utf8'))
  assert.equal(cli[0].insert[0].config.plugins.find((x) => x.id === 'workflow-ptc').name, '@deepseek-ai/dsh-workflow-ptc')

  // 幂等：重扫 0 auto findings
  const rescan = scanAll({ home, branch: 'main', resolvePkg: resolve, migrateLegacy: false })
  assert.equal(rescan.findings.filter((f) => f.level === 'auto').length, 0)
})

test('内置变更日志只增不改：两条已知事件齐全', () => {
  const kinds = BUILTIN_CHANGES.changes.map((c) => `${c.kind}@${c.brokenIn}`)
  assert.ok(kinds.includes('package-rename@0.1.6-alpha.1'))
  assert.ok(kinds.includes('config-key-rename@0.1.3-alpha.2'))
})

test('ptc 时代（0.1.6：旧格式 + 已用新包名）迁移：仅 L1 结构变换，无改名', (t) => {
  const home = tmpHome(t)
  fs.mkdirSync(path.join(home, '.agent-presets', 'ptc-era'), { recursive: true })
  fs.writeFileSync(path.join(home, '.agent-presets', 'ptc-era', 'preset.yml'), 'name: PTC 时代\norder: 1\n')
  fs.writeFileSync(
    path.join(home, '.agent-presets', 'ptc-era', 'agent.cordis.yml'),
    [
      '- id: persona',
      "  name: '@deepseek-ai/dsh-persona'",
      '  config:',
      '    prefix: New syntax already.',
      '- id: workflow-ptc',
      "  name: '@deepseek-ai/dsh-workflow-ptc'",
    ].join('\n'),
  )
  // 0.1.6 安装语境：新包名存在（活），旧包名不存在（死了也不该被触发——预设里没有它）
  const resolve = makeDshResolve({ dead: ['@deepseek-ai/dsh-workflow-worker-thread'] })
  const scan = scanAll({ home, branch: 'main', resolvePkg: resolve })
  assert.ok(scan.findings.some((f) => f.rule === 'R-LEGACY'))
  assert.ok(!scan.findings.some((f) => f.rule === 'R-PKG-RENAMED'), '已用新包名不应触发改名')
  assert.ok(!scan.findings.some((f) => f.rule === 'R-PKG-MISSING'), 'ptc 时代的包在 0.1.7+ 全部存活')
  const r = applyFixes(scan, { ts: '20260930T000000' })
  assert.equal(r.migrated.filter((m) => m.status === 'written').length, 1)
  const val = loadPatch(fs.readFileSync(path.join(home, 'cordis.patch.yml'), 'utf8'))
  const plugins = val[0].insert[0].config.plugins
  assert.equal(plugins.find((x) => x.id === 'workflow-ptc').name, '@deepseek-ai/dsh-workflow-ptc')
  assert.equal(plugins.find((x) => x.id === 'persona').config.prefix, 'New syntax already.')
})
