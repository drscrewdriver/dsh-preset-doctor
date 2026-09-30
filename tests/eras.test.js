/**
 * 四时代真实官方预设验证（用户要求：0.1.2 / 0.1.5 / 0.1.7 / 0.2.0 都要有真实分支数据）。
 *
 * fixtures 来源（tests/fixtures/eras/，均为 deepseek-harness 仓库真实快照）：
 * - v0.1.2/  ← tag dsh-v0.1.2-rc.1（旧目录机制，persona 用 `text: >-` 折叠标量 + 旧包名）
 * - v0.1.5/  ← tag dsh-v0.1.5-rc.3（prefix 时代；4/4 用 prefix、3 个引用旧 workflow 包名——
 *   text 时代滞后的场景由 branches.test.js 用 v0.1.2 快照在该分支上覆盖）
 * - v0.1.7/  ← tag dsh-v0.1.7-rc.2（声明式 patch）
 * - v0.2.0/  ← origin/master（= dsh-v0.2.0-rc.2 同一提交；「0.2.0 对应 main」）
 *
 * 刷新方式：在 deepseek-harness 仓库执行相同的 git show 提取命令（见本目录 README）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanAll } from '../src/scan.js'
import { applyFixes } from '../src/fix/index.js'
import { loadPatch } from '../src/yaml-doc.js'

const ERAS = fileURLToPath(new URL('./fixtures/eras/', import.meta.url))

function tmpHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshpm-era-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  return home
}

function collectPluginStats(patchFile) {
  const rows = loadPatch(fs.readFileSync(patchFile, 'utf8'))[0].insert
  let persona = 0
  let personaTextLeft = 0
  let personaPrefix = 0
  let oldWorkflow = 0
  let newWorkflow = 0
  // 递归：workflow 等行嵌在 group（cordis:group 的 config 列表）里，只数顶层会漏
  function* iterRows(plugins) {
    for (const p of plugins ?? []) {
      yield p
      for (const key of ['config', 'plugins']) {
        const child = p?.[key]
        if (Array.isArray(child)) yield* iterRows(child)
      }
    }
  }
  for (const row of rows) {
    for (const p of iterRows(row.config?.plugins)) {
      if (p.id === 'persona' || p.name === '@deepseek-ai/dsh-persona') {
        persona++
        if (p.config?.text !== undefined) personaTextLeft++
        if (p.config?.prefix !== undefined) personaPrefix++
      }
      if (p.name === '@deepseek-ai/dsh-workflow-worker-thread') oldWorkflow++
      if (p.name === '@deepseek-ai/dsh-workflow-ptc') newWorkflow++
    }
  }
  return { rows, persona, personaTextLeft, personaPrefix, oldWorkflow, newWorkflow }
}

test('0.1.2 时代真实官方预设：text（>- 折叠标量）+ 旧包名全链收敛', (t) => {
  const home = tmpHome(t)
  const ids = fs.readdirSync(path.join(ERAS, 'v0.1.2'))
  assert.equal(ids.length, 4)
  for (const id of ids) fs.cpSync(path.join(ERAS, 'v0.1.2', id), path.join(home, '.agent-presets', id), { recursive: true })

  const scan = scanAll({ home, branch: 'main' })
  assert.equal(scan.findings.filter((f) => f.rule === 'R-LEGACY').length, 4)

  const r = applyFixes(scan, { ts: '20260930T000000' })
  assert.equal(r.migrated.filter((m) => m.status === 'written').length, 4)
  assert.equal(r.errors.length, 0)

  const stats = collectPluginStats(path.join(home, 'cordis.patch.yml'))
  assert.equal(stats.rows.length, 4)
  assert.equal(stats.persona, 4, '4 个官方预设各有 persona')
  assert.equal(stats.personaTextLeft, 0, 'text（含 >- 折叠标量）应全部拆为 prefix')
  assert.equal(stats.personaPrefix, 4)
  assert.equal(stats.oldWorkflow, 0)
  assert.ok(stats.newWorkflow >= 3, `3 个预设引用旧 workflow 名应已改名，实际 ${stats.newWorkflow}`)

  // 幂等 + 迁移后残留状态正确（目录仍在 → conflict 报告，不再 auto）
  const rescan = scanAll({ home, branch: 'main' })
  assert.equal(rescan.findings.filter((f) => f.level === 'auto').length, 0)
  assert.equal(rescan.findings.filter((f) => f.rule === 'R-LEGACY-CONFLICT').length, 4)
})

test('0.1.5 时代真实官方预设：prefix 主流 + 1 个 text 滞后样本都被令牌驱动修复', (t) => {
  const home = tmpHome(t)
  for (const id of fs.readdirSync(path.join(ERAS, 'v0.1.5'))) {
    fs.cpSync(path.join(ERAS, 'v0.1.5', id), path.join(home, '.agent-presets', id), { recursive: true })
  }
  // 真实分布（提取时核对）：4/4 用 prefix（3 个带 suffix cwd 行），3 个引用旧 workflow 包名；
  // 无 text 残留——text 时代场景由 branches.test.js（dsh-0.1.5 分支 × v0.1.2 快照）覆盖
  const scan = scanAll({ home, branch: 'main' })
  assert.equal(scan.findings.filter((f) => f.rule === 'R-LEGACY').length, 4)

  const r = applyFixes(scan, { ts: '20260930T000000' })
  assert.equal(r.migrated.filter((m) => m.status === 'written').length, 4)
  assert.equal(r.errors.length, 0)

  const stats = collectPluginStats(path.join(home, 'cordis.patch.yml'))
  assert.equal(stats.personaTextLeft, 0, '滞后样本的 text 也应被修复（令牌驱动，不看时代标签）')
  assert.ok(stats.personaPrefix >= 4)
  assert.equal(stats.oldWorkflow, 0)
  assert.ok(stats.newWorkflow >= 3)

  const rescan = scanAll({ home, branch: 'main' })
  assert.equal(rescan.findings.filter((f) => f.level === 'auto').length, 0)
})

/** 现行格式的负对照：官方 patch 逐个扫描 → 0 auto findings（shadow 自指命中属预期）。 */
function assertCurrentEraClean(t, eraDir, label) {
  for (const f of fs.readdirSync(eraDir).sort()) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `dshpm-era-${label}-`))
    t.after(() => fs.rmSync(home, { recursive: true, force: true }))
    fs.copyFileSync(path.join(eraDir, f), path.join(home, 'cordis.patch.yml'))
    const { findings } = scanAll({ home, scanProfiles: false, migrateLegacy: false, branch: 'main' })
    const auto = findings.filter((x) => x.level === 'auto')
    assert.deepEqual(auto.map((x) => x.rule), [], `${label}/${f} 应无机械可修问题`)
    assert.ok(findings.some((x) => x.rule === 'R-ID-SHADOWED'), `${label}/${f} 就是内置预设本体，shadow 自指命中才对`)
  }
}

test('0.1.7 真实官方 patch（dsh-v0.1.7-rc.2）：现行格式负对照', (t) => {
  assertCurrentEraClean(t, path.join(ERAS, 'v0.1.7'), 'v0.1.7')
})

test('0.2.0 真实官方 patch（origin/master）：负对照 + 与 0.1.7 字节一致（稳定窗口到 main）', (t) => {
  const dir = path.join(ERAS, 'v0.2.0')
  for (const f of fs.readdirSync(dir).sort()) {
    assert.ok(
      fs.readFileSync(path.join(ERAS, 'v0.1.7', f)).equals(fs.readFileSync(path.join(dir, f))),
      `${f} 在 v0.1.7-rc.2 与 master 间应字节一致`,
    )
  }
  assertCurrentEraClean(t, dir, 'v0.2.0')
})
