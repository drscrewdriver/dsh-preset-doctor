/**
 * 组件地图（src/tables/component-map.json）与其消费面回归。
 *
 * 地图是**知识表**：不当运行时判据用（判「行能不能起」靠 pkg-resolve 探真宿主），
 * 它补的是 id→包/子路径、组件分级、跨版本导出演进这三件运行时拿不到的事。
 * 这里的断言钉住「表结构与真值」以及「classifyComposition 把包名带出去」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponentMap, componentFor, componentNameOf } from '../src/tables/load.js'
import { classifyComposition } from '../src/rules/composition-drift.js'
import { summarize, renderText } from '../src/report.js'
import { parsePatchFile } from '../src/scan.js'
import { baselineForVersion, loadBaseline } from '../src/tables/load.js'
import { extractPresetRows, splitSpec, categorize, exportsHas } from '../tools/component-map.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MAP = loadComponentMap()

test('地图骨架：三源、包数、行数、分级齐全', () => {
  assert.equal(MAP.schemaVersion, 1)
  assert.equal(MAP.sources.length, 3, '三个来源：repo + CLI 安装 + Desktop asar')
  const versions = MAP.sources.map((s) => s.version)
  assert.ok(versions.every((v) => v && v !== 'cli' && v !== 'desktop'), `版本标签必须真实：${versions.join(',')}`)
  assert.ok(Object.keys(MAP.packages).length > 300, '包清单应覆盖整套官方包')
  assert.equal(Object.keys(MAP.rows).length, 44, '官方四预设行集并集 44 行')
  for (const [cat, n] of Object.entries(MAP.categories)) assert.ok(n > 0, `分级 ${cat} 计数应 > 0`)
})

test('行记录：每行都有包名与分级；子路径行能拆出 pkg/sub', () => {
  for (const [id, row] of Object.entries(MAP.rows)) {
    assert.ok(row.pkg, `${id} 缺 pkg`)
    assert.ok(row.cat, `${id} 缺 cat`)
    if (row.sub) assert.ok(row.pkg.startsWith('@') || row.pkg.startsWith('cordis:'), `${id} 的 pkg 形态异常：${row.pkg}`)
    // 声明的包（非虚拟行）必须在地图的包清单里，或至少在某个来源出现过
    if (!row.pkg.startsWith('cordis:')) {
      assert.ok(MAP.packages[row.pkg] || row.avail, `${id} 的包 ${row.pkg} 未见于地图`)
    }
  }
})

test('真值：tool-subagent-list-agents 是「子路径被某版本移除」的活例', () => {
  const row = componentFor('tool-subagent-list-agents')
  assert.ok(row, '该行应在地图里')
  assert.equal(row.pkg, '@deepseek-ai/dsh-tool-subagent-control')
  assert.equal(row.sub, 'list-agents')
  assert.equal(componentNameOf('tool-subagent-list-agents'), '@deepseek-ai/dsh-tool-subagent-control/list-agents')
  assert.equal(row.avail['0.2.1-rc.5'], true, 'rc.5 导出了 ./list-agents')
  assert.equal(row.avail['0.2.2-rc.1'], false, '0.2.2-rc.1 把 ./list-agents 从 exports 移除了')
  const pkg = MAP.packages['@deepseek-ai/dsh-tool-subagent-control']
  assert.ok(pkg.v['0.2.1-rc.5'].exports.includes('./list-agents'))
  assert.ok(!pkg.v['0.2.2-rc.1'].exports.includes('./list-agents'))
  // 同一包里其它行不受影响
  assert.equal(componentFor('tool-subagent-control').avail['0.2.2-rc.1'], true)
})

test('真值：tool-schedule 走了相反方向（新版本才有的组件）', () => {
  const row = componentFor('tool-schedule')
  assert.equal(row.avail['0.2.0-rc.2'], false, '0.2.0-rc.2 还没有 tool-schedule')
  assert.equal(row.avail['0.2.1-rc.5'], true)
  assert.equal(row.avail['0.2.2-rc.1'], true)
})

test('工具函数：splitSpec / exportsHas / categorize / extractPresetRows', () => {
  assert.deepEqual(splitSpec('@a/b/c/d'), { pkg: '@a/b', sub: 'c/d' })
  assert.deepEqual(splitSpec('@a/b'), { pkg: '@a/b', sub: '' })
  assert.deepEqual(splitSpec('cordis:group'), { pkg: 'cordis:group', sub: '' })
  assert.equal(exportsHas(['.', './x'], ''), true)
  assert.equal(exportsHas(['.', './x'], 'x'), true)
  assert.equal(exportsHas(['.', './src/*'], 'src/a.js'), true)
  assert.equal(exportsHas(['.', './src/*'], 'list-agents'), false)
  assert.equal(categorize('@deepseek-ai/dsh-tool-fs'), 'tool')
  assert.equal(categorize('@deepseek-ai/dsh-client-ui-goal'), 'client')
  assert.equal(categorize('@deepseek-ai/dsh-experimental-foo'), 'experimental')
  assert.equal(categorize('@deepseek-ai/dsh-desktop-runtime'), 'runtime')

  const patch = [
    '- insert:',
    '    - id: preset-x',
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    '        id: x',
    '        plugins:',
    '          - id: persona',
    "            name: '@deepseek-ai/dsh-persona'",
    '          - id: grp',
    '            name: cordis:group',
    '            group: true',
    '            config:',
    "              - id: inner-tool",
    "                name: '@deepseek-ai/dsh-tool-fs'",
    '',
  ].join('\n')
  const got = extractPresetRows(patch)
  assert.deepEqual([...got.keys()], ['x'])
  assert.deepEqual(got.get('x').map((r) => r.id), ['persona', 'grp', 'inner-tool'], '组行里的嵌套行也要扒到')
  assert.equal(got.get('x').find((r) => r.id === 'grp').group, true)
})

test('renderText：报告里列出扫描源（升级后观测「预设存哪」）', () => {
  const summary = summarize({
    home: '/h',
    findings: [],
    sources: [
      { file: '/h/cordis.patch.yml', layer: 'home', profile: '', rows: [{}, {}], presetRows: [{}] },
      { file: '/h/profiles/desktop/cordis.patch.yml', layer: 'profile', profile: 'desktop', rows: [], presetRows: [], overrideRows: [{}, {}] },
      { file: '/h/.agent-presets/x', layer: 'legacy-dir', profile: '', rows: [{}], presetRows: [] },
    ],
  })
  assert.deepEqual(summary.sources.map((s) => s.layer), ['home', 'profile', 'legacy-dir'])
  const text = renderText(summary, null)
  assert.match(text, /扫描源 3 处/)
  assert.match(text, /\[home\] \/h\/cordis\.patch\.yml（行 2 · 预设 1）/)
  assert.match(text, /\[profile\/desktop\] /, 'profile 层要带名字（改错 profile 就看这里）')
  assert.match(text, /覆盖 2/, '只有顶层覆盖行的 patch 不能被读成「无声明」')
  assert.match(text, /\[legacy-dir\] /, '旧目录残留必须可见')
  // 无 sources（旧 scanResult）→ 不输出该块，不破兼容
  assert.doesNotMatch(renderText(summarize({ home: '/h', findings: [] }), null), /扫描源/)
})

test('classifyComposition：缺行带出包名（missingNames）', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cmap-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'cordis.patch.yml')
  fs.writeFileSync(file, [
    '- insert:',
    '    - id: preset-standard',
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    '        id: standard',
    '        plugins:',
    '          - id: persona',
    "            name: '@deepseek-ai/dsh-persona'",
    '',
  ].join('\n'), 'utf8')
  const src = parsePatchFile(file, 'home', '')
  const presetRow = src.presetRows[0]
  const c = classifyComposition(src, presetRow, {
    baseline: baselineForVersion('0.2.1-rc.3'),
    allBaselines: loadBaseline(),
    currentVersion: '0.2.1-rc.3',
    resolvePkg: () => ({ ok: true }),
  })
  assert.ok(c.missing.length > 0, '应报缺行')
  assert.equal(c.missingNames.length, c.missing.length)
  const byId = new Map(c.missingNames.map((m) => [m.id, m]))
  assert.equal(byId.get('tool-goal').name, '@deepseek-ai/dsh-tool-goal', '缺行要带出包名')
  assert.equal(byId.get('command-goal').name, '@deepseek-ai/dsh-command-goal')
  assert.equal(byId.get('tool-goal').cat, 'tool')
  // 行侧也带出包名/分级，供 tooltip 用
  const persona = c.rows.find((r) => r.id === 'persona')
  assert.equal(persona.name, '@deepseek-ai/dsh-persona')
  assert.equal(persona.cat, 'core')
})
