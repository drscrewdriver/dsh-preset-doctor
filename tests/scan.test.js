import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanAll } from '../src/scan.js'
import { splitPersonaText } from '../src/rules/persona.js'
import { makeDshResolve } from './_stub-resolve.js'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))

function tmpHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshpm-scan-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  return home
}

function writePatch(home, rel, text) {
  const file = path.join(home, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  return file
}

// 真实感桩（默认名单：workflow-worker-thread 已死，其余存活）——绝大多数用例用这个
const alwaysOkResolve = makeDshResolve()

test('合法的最小 patch：0 findings', (t) => {
  const home = tmpHome(t)
  writePatch(
    home,
    'cordis.patch.yml',
    [
      '- insert:',
      '    - id: preset-ok',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: ok',
      '        plugins:',
      '          - id: persona',
      "            name: '@deepseek-ai/dsh-persona'",
      '            config:',
      '              prefix: hi',
    ].join('\n'),
  )
  const { findings } = scanAll({ home, branch: 'main', resolvePkg: alwaysOkResolve })
  assert.deepEqual(findings, [])
})

test('R-PKG-RENAMED：命中迁移表（含真实旧包名），报告改名并带行号', (t) => {
  const home = tmpHome(t)
  writePatch(
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
      '          - id: tool-fs',
      "            name: '@deepseek-ai/dsh-tool-fs'",
    ].join('\n'),
  )
  const { findings } = scanAll({ home, branch: 'main', resolvePkg: alwaysOkResolve })
  const f = findings.filter((x) => x.rule === 'R-PKG-RENAMED')
  assert.equal(f.length, 1)
  assert.equal(f[0].level, 'auto')
  assert.equal(f[0].line, 8) // name 所在行
  assert.equal(f[0].data.from, '@deepseek-ai/dsh-workflow-worker-thread')
  assert.equal(f[0].data.to, '@deepseek-ai/dsh-workflow-ptc')
  assert.equal(f[0].data.renameRowId, true)
})

test('R-PKG-MISSING：不在迁移表且解析失败 → report 级，带建议', (t) => {
  const home = tmpHome(t)
  writePatch(
    home,
    'cordis.patch.yml',
    [
      '- insert:',
      '    - id: preset-x',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: x',
      '        plugins:',
      '          - id: ghost',
      "            name: '@deepseek-ai/dsh-ghost-xyz'",
    ].join('\n'),
  )
  // 桩：除 agent-preset 本体外全部判死 → ghost 必然 MISSING
  const onlyPresetAlive = (name) => (name === '@deepseek-ai/dsh-agent-preset' ? { ok: true, resolvedVia: 't', resolvedPath: '' } : { ok: false, resolvedVia: '', resolvedPath: '' })
  const { findings } = scanAll({ home, branch: 'main', resolvePkg: onlyPresetAlive })
  const f = findings.filter((x) => x.rule === 'R-PKG-MISSING')
  assert.equal(f.length, 1)
  assert.equal(f[0].level, 'report')
  assert.match(f[0].suggestion, /a\)/)
})

test('R-KEY-RENAMED：persona 用了 text（嵌套在 group 里也能找到）', (t) => {
  const home = tmpHome(t)
  writePatch(
    home,
    'cordis.patch.yml',
    [
      '- insert:',
      '    - id: preset-x',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: x',
      '        plugins:',
      '          - id: grp',
      '            name: cordis:group',
      '            group: true',
      '            config:',
      '              - id: persona',
      "                name: '@deepseek-ai/dsh-persona'",
      '                config:',
      '                  text: |',
      '                    line one',
    ].join('\n'),
  )
  const { findings } = scanAll({ home, branch: 'main', resolvePkg: alwaysOkResolve })
  const f = findings.filter((x) => x.rule === 'R-KEY-RENAMED')
  assert.equal(f.length, 1)
  assert.equal(f[0].level, 'auto')
  assert.equal(f[0].line, 14) // text 键所在行
})

test('R-LOCAL-PATH：./ 开头的本地插件行', (t) => {
  const home = tmpHome(t)
  writePatch(
    home,
    'cordis.patch.yml',
    [
      '- insert:',
      '    - id: preset-x',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: x',
      '        plugins:',
      '          - id: custom-bash',
      '            name: ./custom-bash.mjs',
    ].join('\n'),
  )
  const { findings } = scanAll({ home, branch: 'main', resolvePkg: alwaysOkResolve })
  const f = findings.filter((x) => x.rule === 'R-LOCAL-PATH')
  assert.equal(f.length, 1)
  assert.equal(f[0].level, 'auto')
  assert.equal(f[0].data.name, './custom-bash.mjs')
})

test('R-DUP-ID：文件内行 id 重复 + 跨层预设 id 重复', (t) => {
  // 文件内：两行声明行 id 同为 preset-a（config.id 不同，不算跨层重复）
  const home = tmpHome(t)
  const internalDup = [
    '- insert:',
    '    - id: preset-a',
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    '        id: a1',
    '        plugins: []',
    '    - id: preset-a',
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    '        id: a2',
    '        plugins: []',
  ].join('\n')
  writePatch(home, 'cordis.patch.yml', internalDup)
  const { findings } = scanAll({ home, branch: 'main', resolvePkg: alwaysOkResolve })
  const dup = findings.filter((x) => x.rule === 'R-DUP-ID')
  assert.equal(dup.length, 1)
  assert.match(dup[0].reason, /出现 2 次/)

  // 跨层：home 与 profile 声明同一 config.id（行 id 不同）
  const home2 = tmpHome(t)
  writePatch(
    home2,
    'cordis.patch.yml',
    internalDup.split('\n').slice(0, 6).join('\n'),
  )
  writePatch(
    home2,
    'profiles/web/cordis.patch.yml',
    [
      '- insert:',
      '    - id: preset-b',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: a1',
      '        plugins: []',
    ].join('\n'),
  )
  const r2 = scanAll({ home: home2, resolvePkg: alwaysOkResolve })
  const cross = r2.findings.filter((x) => x.rule === 'R-DUP-ID' && /多个层级/.test(x.reason))
  assert.equal(cross.length, 1)
  assert.match(cross[0].reason, /预设 id a1/)
})

test('R-STRUCT：缺 config.plugins / 非 insert 条目', (t) => {
  const home = tmpHome(t)
  writePatch(
    home,
    'cordis.patch.yml',
    [
      '- insert:',
      '    - id: preset-x',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: x',
      '    - id: preset-y',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: y',
      '        plugins: []',
    ].join('\n'),
  )
  const { findings } = scanAll({ home, branch: 'main', resolvePkg: alwaysOkResolve })
  const f = findings.filter((x) => x.rule === 'R-STRUCT')
  assert.equal(f.length, 1)
  assert.match(f[0].reason, /config\.plugins/)
})

test('R-LEGACY：旧目录未声明 → auto；已声明 → conflict', (t) => {
  const home = tmpHome(t)
  fs.mkdirSync(path.join(home, '.agent-presets', 'lp'), { recursive: true })
  fs.writeFileSync(path.join(home, '.agent-presets', 'lp', 'preset.yml'), "name: 旧预设\norder: 3\n")
  fs.writeFileSync(path.join(home, '.agent-presets', 'lp', 'agent.cordis.yml'), "- id: tool-fs\n  name: '@deepseek-ai/dsh-tool-fs'\n")
  const { findings } = scanAll({ home, resolvePkg: alwaysOkResolve, branch: 'main' })
  const legacy = findings.filter((x) => x.rule === 'R-LEGACY')
  assert.equal(legacy.length, 1)
  assert.equal(legacy[0].level, 'auto')
  assert.equal(legacy[0].rowId, 'preset-lp')
  assert.equal(legacy[0].data.metadata.name, '旧预设')

  // 已声明 → conflict
  writePatch(
    home,
    'cordis.patch.yml',
    [
      '- insert:',
      '    - id: preset-lp',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: lp',
      '        plugins: []',
    ].join('\n'),
  )
  const r2 = scanAll({ home, resolvePkg: alwaysOkResolve, branch: 'main' })
  assert.ok(r2.findings.some((x) => x.rule === 'R-LEGACY-CONFLICT'))
  assert.ok(!r2.findings.some((x) => x.rule === 'R-LEGACY'))
})

test('R-YAML：语法错误文件 → report，不抛错', (t) => {
  const home = tmpHome(t)
  writePatch(home, 'cordis.patch.yml', 'insert: [unclosed\n  badIndent: {')
  const { findings } = scanAll({ home, branch: 'main', resolvePkg: alwaysOkResolve })
  assert.ok(findings.some((x) => x.rule === 'R-YAML'))
})

test('真实 fixtures 全量扫描：6 个旧目录 + 5 个 patch 全部识别', (t) => {
  // 把 fixtures 布成一个 home：original/* 当旧目录，converted 拷为 home patch 内容
  const home = tmpHome(t)
  const origDir = path.join(FIXTURES, 'original')
  for (const id of fs.readdirSync(origDir)) {
    const src = path.join(origDir, id)
    if (!fs.statSync(src).isDirectory()) continue
    fs.cpSync(src, path.join(home, '.agent-presets', id), { recursive: true })
  }
  // converted 的 5 个 patch 合成一个 home patch（顺序追加）
  const convDir = path.join(FIXTURES, 'converted')
  const parts = []
  for (const f of fs.readdirSync(convDir).sort()) {
    parts.push(fs.readFileSync(path.join(convDir, f), 'utf8').trimEnd())
  }
  writePatch(home, 'cordis.patch.yml', parts.join('\n') + '\n')

  const { findings } = scanAll({ home, branch: 'main', resolvePkg: alwaysOkResolve })
  const legacy = findings.filter((x) => x.rule === 'R-LEGACY-CONFLICT')
  // converted 含 liangshen/simple-reply/3 个 standard-win 变体 = 5 个声明；
  // 旧目录有 6 个（多一个 standard-win 本体，converted 里没有）→ 恰好 standard-win 是纯 R-LEGACY
  assert.equal(legacy.length, 5)
  const pure = findings.filter((x) => x.rule === 'R-LEGACY')
  assert.equal(pure.length, 1)
  assert.equal(pure[0].rowId, 'preset-standard-win')
  // converted 基线里仍有 workflow-worker-thread（人工转换的历史遗漏）→ 必须被检出
  const renamed = findings.filter((x) => x.rule === 'R-PKG-RENAMED')
  assert.ok(renamed.length >= 4, `应检出至少 4 处旧包名，实际 ${renamed.length}`)
})

test('splitPersonaText：独立 cwd 行进 suffix，其余进 prefix', () => {
  const r = splitPersonaText('You are an agent.\nYour working directory is {{cwd}}.\nBe nice.')
  assert.equal(r.prefix, 'You are an agent.\nBe nice.')
  assert.equal(r.suffix, 'Your working directory is {{cwd}}.')
})

test('splitPersonaText：无独立 cwd 行 → 整体进 prefix', () => {
  const r = splitPersonaText('You are powered by {{model}}. Your working directory is {{cwd}}.')
  assert.equal(r.prefix, 'You are powered by {{model}}. Your working directory is {{cwd}}.')
  assert.equal(r.suffix, undefined)
})

test('splitPersonaText：CRLF 行尾也命中', () => {
  const r = splitPersonaText('a\r\nYour working directory is {{cwd}}.\r\nb')
  assert.equal(r.prefix, 'a\nb')
  assert.equal(r.suffix, 'Your working directory is {{cwd}}.')
})
