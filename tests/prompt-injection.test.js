/**
 * R-INJECT-*：预设里的提示词注入（dsh-preset-studio 的 `注入/*.md` 结构）。
 *
 * 这些用例的共同目标：投递器「沉默」的每一种情形，doctor 都要有话说——
 * 文件被丢弃、role 被降级、order 归零、enabled 拼错按启用、目录没接投递器行。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scanAll } from '../src/scan.js'
import { summarize, renderText, collectPresets } from '../src/report.js'
import { applyFixes } from '../src/fix/index.js'
import { splitFrontmatter, readField, readBoolean, readNumber } from '../src/prompts/frontmatter.js'
import { makeDshResolve } from './_stub-resolve.js'

const resolve = makeDshResolve()

function tmpHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshpm-prompt-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  return home
}

function writeFileAt(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  return file
}

/** 一条声明式预设 + 一行投递器（config.dir 指向注入目录）。 */
function writeStudioPatch(home, dir) {
  return writeFileAt(
    path.join(home, 'cordis.patch.yml'),
    [
      '- insert:',
      '    - id: preset-studio',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: studio',
      '        plugins:',
      '          - id: studio-inject',
      "            name: 'dsh-preset-studio/inject'",
      '            config:',
      `              dir: '${String(dir).replace(/\\/g, '/')}'`,
    ].join('\n'),
  )
}

function injection(dir, fileName, text) {
  return writeFileAt(path.join(dir, fileName), text)
}

function scan(home) {
  return scanAll({ home, branch: 'main', resolvePkg: resolve, migrateLegacy: false })
}

const inject = (result) => result.findings.filter((f) => String(f.rule).startsWith('R-INJECT-'))

test('frontmatter 读取与投递器逐字段一致（围栏/标量/布尔/数字）', () => {
  const text = ['---', 'name: "人设"', 'role: user', 'order: 20', 'enabled: no', '---', '', 'body'].join('\n')
  const split = splitFrontmatter(text)
  assert.ok(split)
  assert.equal(readField(split.head, 'name'), '人设')
  assert.equal(readBoolean(readField(split.head, 'enabled')), false)
  assert.equal(readNumber(split.head, 'order'), 20)
  assert.equal(readNumber(split.head, 'missing'), undefined)
  assert.equal(readBoolean('ture'), undefined, '拼错的布尔读不出来（投递器按启用）')
  assert.equal(splitFrontmatter('no fence\n'), null)
  assert.equal(splitFrontmatter('---\nname: x\n'), null, '未闭合围栏也读不出')
})

test('正常注入目录：0 条 R-INJECT-*，清单按 role/order 如实呈现', (t) => {
  const home = tmpHome(t)
  const dir = path.join(home, 'presets', 'studio', '注入')
  writeStudioPatch(home, dir)
  injection(dir, '10-人设.md', '---\nname: 人设\nrole: system\norder: 10\n---\n\n你是编码助手。')
  injection(dir, '20-风格.md', '---\nname: 风格\nrole: user\norder: 20\n---\n\n回答尽量短。')
  injection(dir, '30-补丁.md', '---\norder: 30\nenabled: false\n---\n\n临时补丁。')

  const result = scan(home)
  assert.deepEqual(inject(result), [])
  assert.equal(result.promptDirs.length, 1)
  const inv = result.promptDirs[0]
  assert.equal(inv.presetId, 'studio')
  assert.equal(inv.wired, true)
  assert.equal(inv.total, 3)
  assert.equal(inv.enabled, 2)
  assert.equal(inv.disabled, 1)
  // 清单按投递顺序（order → 名称）排列，关闭的也列出来
  assert.deepEqual(inv.entries.map((e) => [e.name, e.role, e.order, e.enabled]), [
    ['人设', 'system', 10, true],
    ['风格', 'user', 20, true],
    ['30-补丁', 'system', 30, false],
  ])
  // 文本报告里「读了什么」要能看到，而不是只报错
  const text = renderText(summarize(result, undefined))
  assert.ok(text.includes('预设提示词（注入）1 处'))
  assert.ok(text.includes('生效 2 · 关闭 1'))
})

test('BOM：投递器静默丢弃 → auto finding；机械修复去 BOM 且幂等', (t) => {
  const home = tmpHome(t)
  const dir = path.join(home, 'presets', 'studio', '注入')
  writeStudioPatch(home, dir)
  const file = injection(dir, '10-人设.md', '\uFEFF---\nname: 人设\n---\n\n你是编码助手。')

  const result = scan(home)
  const bom = inject(result).filter((f) => f.rule === 'R-INJECT-BOM')
  assert.equal(bom.length, 1)
  assert.equal(bom[0].level, 'auto')
  assert.equal(bom[0].data.presetId, 'studio')
  // 去掉 BOM 后文件立刻可读：只有一条问题，不会连带报「没围栏」
  assert.deepEqual(inject(result).map((f) => f.rule), ['R-INJECT-BOM'])
  assert.equal(result.promptDirs[0].enabled, 1)

  const first = applyFixes(result, { ts: '20260101T000000' })
  assert.equal(first.files.filter((f) => f.status === 'written').length, 1)
  assert.equal(fs.readFileSync(file, 'utf8').charCodeAt(0), 45, '首字符回到 -')
  assert.ok(fs.existsSync(file + '.bak-20260101T000000'), '写前有 .bak')

  // 幂等：BOM 没了之后不再有任何 auto 修复
  const rescan = scan(home)
  assert.equal(inject(rescan).filter((f) => f.level === 'auto').length, 0)
  const second = applyFixes(rescan, { ts: '20260101T000001' })
  assert.equal(second.files.length, 0)
})

test('无围栏 / 未闭合围栏 / 正文空：三种「文件在、提示词不生效」都要报', (t) => {
  const home = tmpHome(t)
  const dir = path.join(home, 'presets', 'studio', '注入')
  writeStudioPatch(home, dir)
  injection(dir, 'a-裸文本.md', '这段没有 frontmatter，投递器直接跳过。')
  injection(dir, 'b-未闭合.md', '---\nname: 未闭合\n')
  injection(dir, 'c-空正文.md', '---\nname: 空正文\n---\n\n   \n')

  const rules = inject(scan(home)).map((f) => f.rule)
  assert.equal(rules.filter((r) => r === 'R-INJECT-FORMAT').length, 2)
  assert.equal(rules.filter((r) => r === 'R-INJECT-EMPTY').length, 1)
})

test('字段写错：role 降级 / order 归零 / enabled 拼错 → 三条 R-INJECT-FIELD 且带行号', (t) => {
  const home = tmpHome(t)
  const dir = path.join(home, 'presets', 'studio', '注入')
  writeStudioPatch(home, dir)
  const file = injection(
    dir,
    '10-人设.md',
    ['---', 'name: 人设', 'role: 系统', 'order: 十', 'enabled: ture', '---', '', '正文'].join('\n'),
  )

  const fields = inject(scan(home)).filter((f) => f.rule === 'R-INJECT-FIELD')
  assert.equal(fields.length, 3)
  assert.equal(fields[0].file, file)
  const lines = fields.map((f) => f.line).sort((a, b) => a - b)
  assert.deepEqual(lines, [3, 4, 5], 'role/order/enabled 各自的行号')
  assert.ok(fields.some((f) => f.reason.includes('降级为 system')))
  assert.ok(fields.some((f) => f.reason.includes('不是数字')))
  assert.ok(fields.some((f) => f.reason.includes('按「启用」处理')))
})

test('块标量写法：投递器只读单行标量 → R-INJECT-FIELD', (t) => {
  const home = tmpHome(t)
  const dir = path.join(home, 'presets', 'studio', '注入')
  writeStudioPatch(home, dir)
  injection(dir, '10-人设.md', ['---', 'name: |-', '  很长的名字', 'role: system', '---', '', '正文'].join('\n'))

  const fields = inject(scan(home)).filter((f) => f.rule === 'R-INJECT-FIELD')
  assert.equal(fields.length, 1)
  assert.ok(fields[0].reason.includes('块标量'))
})

test('同名 / 同段位：重复注册与顺序不可控都要报', (t) => {
  const home = tmpHome(t)
  const dir = path.join(home, 'presets', 'studio', '注入')
  writeStudioPatch(home, dir)
  injection(dir, '10-a.md', '---\nname: 人设\norder: 10\n---\n\nA')
  injection(dir, '20-b.md', '---\nname: 人设\norder: 20\n---\n\nB')
  injection(dir, '20-c.md', '---\nname: 丙\norder: 20\n---\n\nC')

  const result = inject(scan(home))
  assert.equal(result.filter((f) => f.rule === 'R-INJECT-DUP').length, 2, '同名两条都标')
  assert.equal(result.filter((f) => f.rule === 'R-INJECT-ORDER').length, 2, '20 段位两条都标')
})

test('正文里的 {{cwd}}：投递器 interpolate:false → 占位符原样进提示词', (t) => {
  const home = tmpHome(t)
  const dir = path.join(home, 'presets', 'studio', '注入')
  writeStudioPatch(home, dir)
  injection(dir, '10-人设.md', '---\nname: 人设\n---\n\n你的工作目录是 {{cwd}}。')

  const vars = inject(scan(home)).filter((f) => f.rule === 'R-INJECT-VAR')
  assert.equal(vars.length, 1)
  assert.ok(vars[0].reason.includes('{{cwd}}'))
  // 自定义变量不报（可能是作者故意留的字面量），但清单里要能看到
  injection(dir, '20-自定义.md', '---\nname: 自定义\norder: 20\n---\n\n{{my_slot}}')
  const inv = scan(home).promptDirs[0]
  assert.deepEqual(inv.entries.find((e) => e.name === '自定义').vars, ['my_slot'])
})

test('config.dir 缺失 / 目录不存在：投递器挂成 0 条', (t) => {
  const home = tmpHome(t)
  writeFileAt(
    path.join(home, 'cordis.patch.yml'),
    [
      '- insert:',
      '    - id: preset-studio',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: studio',
      '        plugins:',
      '          - id: no-dir',
      "            name: 'dsh-preset-studio/inject'",
      '          - id: bad-dir',
      "            name: 'dsh-preset-studio/inject'",
      '            config:',
      "              dir: 'C:/definitely/not/here/注入'",
    ].join('\n'),
  )
  const dirs = inject(scan(home)).filter((f) => f.rule === 'R-INJECT-DIR')
  assert.equal(dirs.length, 2)
  assert.ok(dirs.some((f) => f.rowId === 'no-dir' && f.reason.includes('缺 config.dir')))
  assert.ok(dirs.some((f) => f.rowId === 'bad-dir' && f.reason.includes('目录不存在')))
})

test('空目录 / 全部关闭：行在，但实际投递 0 条', (t) => {
  const home = tmpHome(t)
  const dir = path.join(home, 'presets', 'studio', '注入')
  writeStudioPatch(home, dir)
  fs.mkdirSync(dir, { recursive: true })
  assert.equal(inject(scan(home)).filter((f) => f.rule === 'R-INJECT-EMPTY-DIR').length, 1)

  injection(dir, '10-人设.md', '---\nname: 人设\nenabled: false\n---\n\n正文')
  const allOff = inject(scan(home)).filter((f) => f.rule === 'R-INJECT-EMPTY-DIR')
  assert.equal(allOff.length, 1)
  assert.ok(allOff[0].reason.includes('全部 enabled:false'))
})

test('未接线：<home>/presets/<id>/注入 有提示词却没有任何投递器行', (t) => {
  const home = tmpHome(t)
  // 没有任何 patch 声明（预设还没装进 DSH）
  const dir = path.join(home, 'presets', 'my-preset', '注入')
  injection(dir, '10-人设.md', '---\nname: 人设\n---\n\n你是助手。')
  writeFileAt(path.join(home, 'presets', 'my-preset', 'cordis.patch.yml'), '- insert: []\n')

  const result = scan(home)
  const unwired = inject(result).filter((f) => f.rule === 'R-INJECT-UNWIRED')
  assert.equal(unwired.length, 1)
  assert.equal(unwired[0].data.presetId, 'my-preset')
  assert.equal(result.promptDirs[0].wired, false)
  const text = renderText(summarize(result, undefined))
  assert.ok(text.includes('未接投递器行'))
})

test('注入问题挂到所属预设卡：卡面不再显示「已同步」', (t) => {
  const home = tmpHome(t)
  const dir = path.join(home, 'presets', 'studio', '注入')
  writeStudioPatch(home, dir)
  injection(dir, 'a-裸文本.md', '没有 frontmatter')

  const result = scan(home)
  const preset = collectPresets(result).find((p) => p.id === 'studio')
  assert.ok(preset, '预设卡存在')
  assert.equal(preset.current, false)
  assert.ok(preset.broken.some((f) => f.rule === 'R-INJECT-FORMAT'))
  // 未接线目录（无声明行）不会凭空造出一张预设卡
  assert.equal(collectPresets(result).filter((p) => p.id === 'my-preset').length, 0)
})
