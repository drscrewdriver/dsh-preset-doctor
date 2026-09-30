import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scanAll } from '../src/scan.js'
import { makeDshResolve } from './_stub-resolve.js'

function tmpHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshpm-shadow-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  return home
}

function writePatch(home, rel, text) {
  const file = path.join(home, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  return file
}

/** 假安装：node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml（id: standard）。 */
function fakeInstall(t) {
  const pkgDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dshpm-install-')), 'node_modules', '@deepseek-ai', 'dsh-web-app')
  fs.mkdirSync(path.join(pkgDir, 'presets'), { recursive: true })
  fs.writeFileSync(
    path.join(pkgDir, 'presets', 'standard.patch.yml'),
    [
      '- insert:',
      '    - id: preset-standard',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: standard',
      '        plugins: []',
    ].join('\n'),
  )
  t.after(() => fs.rmSync(path.dirname(path.dirname(path.dirname(pkgDir))), { recursive: true, force: true }))
  return pkgDir
}

const shadowResolve = (pkgDir) => (name) =>
  name === '@deepseek-ai/dsh-web-app'
    ? { ok: true, resolvedVia: 'stub', resolvedPath: pkgDir }
    : makeDshResolve()(name)

test('R-ID-SHADOWED：用户声明 id 与内置同名 → report 级 finding', (t) => {
  const home = tmpHome(t)
  const pkgDir = fakeInstall(t)
  writePatch(
    home,
    'cordis.patch.yml',
    [
      '- insert:',
      '    - id: preset-standard',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: standard',
      '        plugins: []',
      '    - id: preset-custom',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: custom',
      '        plugins: []',
    ].join('\n'),
  )
  const { findings } = scanAll({ home, branch: 'main', resolvePkg: shadowResolve(pkgDir), migrateLegacy: false })
  const shadowed = findings.filter((f) => f.rule === 'R-ID-SHADOWED')
  assert.equal(shadowed.length, 1, '只有同 id 的那条命中')
  assert.equal(shadowed[0].level, 'report')
  assert.equal(shadowed[0].presetId, 'standard')
  assert.match(shadowed[0].reason, /f94495e527/)
  assert.match(shadowed[0].reason, /不会生效/)
  // 自定义 id 无影子，无其它误报
  assert.ok(!findings.some((f) => f.rowId === 'preset-custom' && f.rule === 'R-ID-SHADOWED'))
})

test('R-ID-SHADOWED fail-soft：dsh-web-app 不可解析 → 静默跳过，其它规则照常', (t) => {
  const home = tmpHome(t)
  writePatch(
    home,
    'cordis.patch.yml',
    [
      '- insert:',
      '    - id: preset-standard',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: standard',
      '        plugins:',
      '          - id: workflow-worker-thread',
      "            name: '@deepseek-ai/dsh-workflow-worker-thread'",
    ].join('\n'),
  )
  const noWebApp = (name) => (name === '@deepseek-ai/dsh-web-app' ? { ok: false, resolvedVia: '', resolvedPath: '' } : makeDshResolve()(name))
  const { findings } = scanAll({ home, branch: 'main', resolvePkg: noWebApp, migrateLegacy: false })
  assert.ok(!findings.some((f) => f.rule === 'R-ID-SHADOWED'))
  assert.ok(findings.some((f) => f.rule === 'R-PKG-RENAMED'), '其它规则不受影响')
})
