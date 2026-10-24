import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripDeadVars, checkDeadVars } from '../src/rules/dead-var.js'
import { loadTables } from '../src/tables/load.js'
import { scanAll } from '../src/scan.js'
import { applyFixes } from '../src/fix/index.js'
import { makeDshResolve } from './_stub-resolve.js'

const okResolve = makeDshResolve()

function tmpHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshpm-dv-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  return home
}

// ── stripDeadVars 纯函数 ──

test('stripDeadVars: cwd 提示整行删除（含换行）', () => {
  const v = 'You are helpful.\nYour working directory is {{cwd}}.\nBe terse.'
  assert.equal(stripDeadVars(v, ['cwd']), 'You are helpful.\nBe terse.')
})

test('stripDeadVars: 末行无换行的 cwd 提示也删', () => {
  const v = 'You are helpful.\nYour working directory is {{cwd}}.'
  assert.equal(stripDeadVars(v, ['cwd']), 'You are helpful.')
})

test('stripDeadVars: 行内裸占位删除并收敛空格', () => {
  assert.equal(stripDeadVars('Work in  {{cwd}}  now.', ['cwd']), 'Work in now.')
})

test('stripDeadVars: 无占位的值原样返回', () => {
  assert.equal(stripDeadVars('plain text', ['cwd']), 'plain text')
})

// ── 规则门控 ──

test('checkDeadVars: rc.3 上报 cwd 残留、0.1.7 不上报（旧宿主仍合法）', () => {
  const { tables } = loadTables({})
  assert.ok(tables.deadPromptVars.some((e) => e.variable === 'cwd'))
  const mk = (value) => ({
    file: 'x.yml',
    line: 1,
    id: 'persona',
    range: [0, 1],
    configNode: { items: [{ key: { value: 'prefix' }, value: { value } }] },
  })
  const hit = checkDeadVars(mk('Your working directory is {{cwd}}.'), { tables, currentVersion: '0.2.1-rc.3' })
  assert.equal(hit.length, 1)
  assert.equal(hit[0].rule, 'R-DEAD-VAR')
  assert.equal(hit[0].level, 'auto')
  assert.deepEqual(hit[0].data.vars, ['cwd'])
  assert.equal(hit[0].data.key, 'prefix')
  const old = checkDeadVars(mk('Your working directory is {{cwd}}.'), { tables, currentVersion: '0.1.7-rc.2' })
  assert.equal(old.length, 0)
  // 未注册但非死表的变量不报（避免误伤自定义变量）
  const other = checkDeadVars(mk('hi {{custom}}'), { tables, currentVersion: '0.2.1-rc.3' })
  assert.equal(other.length, 0)
})

// ── E2E：scanAll → applyFixes 落盘 ──

function patchText() {
  return [
    '# 注释保真',
    '- insert:',
    '    - id: preset-deployment',
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    '        id: deployment',
    '        name: 部署模式',
    '        plugins:',
    '          - id: persona',
    "            name: '@deepseek-ai/dsh-persona'",
    '            config:',
    '              prefix: |',
    '                You are a deployment agent.',
    '                Your working directory is {{cwd}}.',
    '                Be terse.',
    '              suffix: ""',
  ].join('\n')
}

test('E2E rc.3：R-DEAD-VAR 被发现并机械修复（整行删除、其余字节不动）', (t) => {
  const home = tmpHome(t)
  const file = path.join(home, 'cordis.patch.yml')
  fs.writeFileSync(file, patchText())
  const scan = scanAll({ home, dshVersion: '0.2.1-rc.3', resolvePkg: okResolve, migrateLegacy: false })
  const hits = scan.findings.filter((f) => f.rule === 'R-DEAD-VAR')
  assert.equal(hits.length, 1, JSON.stringify(scan.findings.map((f) => f.rule)))
  assert.equal(hits[0].level, 'auto')

  const r = applyFixes(scan, { ts: '20261024T000000' })
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors))
  const after = fs.readFileSync(file, 'utf8')
  assert.ok(!after.includes('{{cwd}}'), '占位应被清除')
  assert.ok(!after.includes('Your working directory'), 'cwd 提示行应整行删除')
  assert.ok(after.startsWith('# 注释保真\n'), 'span 外注释不动')
  assert.ok(after.includes('You are a deployment agent.'))
  assert.ok(after.includes('Be terse.'))
  // 修复后再扫描归零
  const rescan = scanAll({ home, dshVersion: '0.2.1-rc.3', resolvePkg: okResolve, migrateLegacy: false })
  assert.equal(rescan.findings.filter((f) => f.rule === 'R-DEAD-VAR').length, 0)
})

test('E2E 0.1.7：同文件不报（旧宿主 {{cwd}} 合法）', (t) => {
  const home = tmpHome(t)
  fs.writeFileSync(path.join(home, 'cordis.patch.yml'), patchText())
  const scan = scanAll({ home, dshVersion: '0.1.7-rc.2', resolvePkg: okResolve, migrateLegacy: false })
  assert.equal(scan.findings.filter((f) => f.rule === 'R-DEAD-VAR').length, 0)
})
