/**
 * 提示词就地编辑：只换该值的 span，块标量/引号/换行都能保形；
 * 拒写清空、非提示词键、!!js 表达式；.bak + 幂等。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scanAll } from '../src/scan.js'
import { runPromptWrite, planPromptEdit } from '../src/fix/prompt-edit.js'
import { parsePatchDoc, loadPatch } from '../src/yaml-doc.js'
import { makeDshResolve } from './_stub-resolve.js'

const resolve = makeDshResolve()

function tmpHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshpm-promptedit-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  return home
}

const PATCH = [
  '- insert:',
  '    - id: preset-a',
  "      name: '@deepseek-ai/dsh-agent-preset'",
  '      config:',
  '        id: a',
  '        plugins:',
  '          - id: persona',
  "            name: '@deepseek-ai/dsh-persona'",
  '            config:',
  '              prefix: |-',
  '                You are a coding agent.',
  '                Your shell is {{model}}-flavoured.',
  '              suffix: hi',
  '          - id: tool-web',
  "            name: '@deepseek-ai/dsh-tool-web'",
  '            config:',
  '              description: fetch pages',
  '              fetch: true',
].join('\n')

function setup(t, { eol = '\n' } = {}) {
  const home = tmpHome(t)
  const file = path.join(home, 'cordis.patch.yml')
  fs.writeFileSync(file, eol === '\n' ? PATCH : PATCH.replace(/\n/g, eol))
  const scan = () => scanAll({ home, branch: 'main', resolvePkg: resolve, migrateLegacy: false })
  return { home, file, scan }
}

const write = (scan, opts) => runPromptWrite(scan, { presetId: 'a', ts: '20260101T000000', ...opts })

test('块标量改写保形：沿用 |- 与缩进，其余字节不动，值 roundtrip 一致', (t) => {
  const { file, scan } = setup(t)
  const before = fs.readFileSync(file, 'utf8')
  const r = write(scan(), {
    file, rowId: 'persona', key: 'prefix', confirm: true,
    text: 'You are a coding agent.\nYour shell is {{model}}-flavoured.\nStay brief.',
  })
  assert.equal(r.status, 'written')
  assert.ok(r.backup && fs.existsSync(r.backup))

  const after = fs.readFileSync(file, 'utf8')
  // 只多了一行正文 + 保持不变的行
  assert.equal(after.split('\n').length, before.split('\n').length + 1)
  assert.ok(after.includes('              prefix: |-'))
  assert.ok(after.includes('                Stay brief.'))
  assert.ok(after.includes('              suffix: hi'), '同 config 的其它键原样保留')
  assert.ok(after.includes('              description: fetch pages'))

  const val = loadPatch(after)
  const plugins = val[0].insert[0].config.plugins
  assert.equal(
    plugins.find((x) => x.id === 'persona').config.prefix,
    'You are a coding agent.\nYour shell is {{model}}-flavoured.\nStay brief.',
  )

  // 幂等：同样内容再写一次 → skipped（0 写盘）
  const again = write(scan(), { file, rowId: 'persona', key: 'prefix', confirm: true, text: 'You are a coding agent.\nYour shell is {{model}}-flavoured.\nStay brief.' })
  assert.equal(again.status, 'skipped')
})

test('单行标量改写：保留单行形态（单引号转义）', (t) => {
  const { file, scan } = setup(t)
  const r = write(scan(), { file, rowId: 'tool-web', key: 'description', confirm: true, text: "it's a fetch tool" })
  assert.equal(r.status, 'written')
  const after = fs.readFileSync(file, 'utf8')
  assert.ok(after.includes("description: 'it''s a fetch tool'"))
  const val = loadPatch(after)
  assert.equal(val[0].insert[0].config.plugins.find((x) => x.id === 'tool-web').config.description, "it's a fetch tool")
})

test('单行 → 多行：自动转块标量（无尾换行用 |-）', (t) => {
  const { file, scan } = setup(t)
  const r = write(scan(), { file, rowId: 'tool-web', key: 'description', confirm: true, text: 'line one\nline two' })
  assert.equal(r.status, 'written')
  const after = fs.readFileSync(file, 'utf8')
  assert.ok(after.includes('description: |-'))
  assert.ok(after.includes('                line two'))
  const val = loadPatch(after)
  assert.equal(val[0].insert[0].config.plugins.find((x) => x.id === 'tool-web').config.description, 'line one\nline two')
})

test('CRLF 文件：写入换行跟随文件', (t) => {
  const { file, scan } = setup(t, { eol: '\r\n' })
  write(scan(), { file, rowId: 'tool-web', key: 'description', confirm: true, text: 'a\nb' })
  const after = fs.readFileSync(file, 'utf8')
  assert.ok(after.includes('description: |-\r\n'))
  assert.ok(!/[^\r]\n/.test(after), '不出现孤立的 LF')
})

test('拒写：缺确认 / 清空 / 非提示词键 / !!js 表达式', (t) => {
  const { home, file, scan } = setup(t)
  assert.equal(write(scan(), { file, rowId: 'persona', key: 'prefix', text: 'x' }).status, 'rejected')
  assert.equal(write(scan(), { file, rowId: 'persona', key: 'prefix', confirm: true, text: '   \n ' }).status, 'empty-text')
  assert.equal(write(scan(), { file, rowId: 'tool-web', key: 'fetch', confirm: true, text: 'false' }).status, 'not-prompt-key')

  // !!js 表达式：改写会抹掉条件 → 硬拒
  const jsFile = path.join(home, 'cordis.patch.yml')
  fs.writeFileSync(jsFile, PATCH.replace('              fetch: true', '              section: !!js process.platform'))
  const js = write(scan(), { file, rowId: 'tool-web', key: 'section', confirm: true, text: 'x' })
  assert.equal(js.status, 'js-expression')
})

test('planPromptEdit：区间覆盖整个值（含块标量指示符），不碰键名', () => {
  const { doc } = parsePatchDoc(PATCH)
  const node = doc.contents.items[0].get('insert').items[0].get('config').get('plugins').items[0].get('config').get('prefix', true)
  const edit = planPromptEdit(PATCH, node, 'ok')
  assert.equal(PATCH.slice(edit.start, edit.end), node.range[0] === edit.start ? PATCH.slice(node.range[0], node.range[1]) : '')
  assert.ok(PATCH.slice(0, edit.start).endsWith('prefix: '), '起点正好在键名与值之间')
  assert.ok(edit.text.startsWith('|-'), '沿用原指示符')
  assert.ok(!edit.text.includes('\r'), 'LF 文件写 LF')
})
