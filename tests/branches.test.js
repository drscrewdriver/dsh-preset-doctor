/**
 * 适配分支：按宿主主线分 branch（peer / 处理终点 / 算法档位 各不相同）。
 *
 * 数据源 tests/fixtures/eras/（deepseek-harness 真实快照）：
 * - dsh-0.1.5 分支 ← v0.1.5/（本线原生预设干净）+ v0.1.2/（更老的 text 时代预设
 *   跑在 0.1.5 宿主：就地修 persona，不迁移，不生成 patch）
 * - dsh-0.1.2 分支 ← v0.1.2/ 真实目录预设：终点前无断裂事件 → 算法空转，0 findings
 * - main 分支行为回归由 eras.test.js / fix-apply.test.js 覆盖（钉 branch:'main'）
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
import { branchForVersion, branchById, loadTables, loadBranches, semverSatisfies } from '../src/tables/load.js'

const ERAS = fileURLToPath(new URL('./fixtures/eras/', import.meta.url))

function tmpHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshpm-branch-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  return home
}

function copyLegacyEra(home, era) {
  for (const id of fs.readdirSync(path.join(ERAS, era))) {
    fs.cpSync(path.join(ERAS, era, id), path.join(home, '.agent-presets', id), { recursive: true })
  }
}

/** 0.1.x 宿主上全部官方包都活着（本地机器装的是新版，测试须显式注入旧线语义）。 */
const oldLineResolve = () => ({ ok: true, resolvedVia: 'stub', resolvedPath: '' })

test('分支解析：宿主版本 → 分支（范围连续拼接，无洞）', () => {
  const cases = [
    ['0.2.0-rc.2', 'main'],
    ['0.1.7-rc.2', 'dsh-0.1.7'],
    ['0.1.7-alpha.1', 'dsh-0.1.7'],
    ['0.1.5-rc.3', 'dsh-0.1.5'],
    ['0.1.6-alpha.2', 'dsh-0.1.5'],
    ['0.1.2-rc.1', 'dsh-0.1.2'],
    ['0.1.3-alpha.2', 'dsh-0.1.2'],
    ['0.1.1-rc.2', 'dsh-0.1.1'],
    ['0.1.0-rc.7', 'dsh-0.1.1'],
  ]
  for (const [version, id] of cases) {
    assert.equal(branchForVersion(version)?.id, id, `${version} → ${id}`)
  }
  assert.equal(branchForVersion(undefined), undefined, '检不出版本 → 调用方回退 main')
  assert.equal(branchById('main').endpoint, '0.2.0-rc.2')
  assert.equal(branchById('dsh-0.1.5').peer.version, '4.0.2')
  assert.equal(loadBranches().length, 5)
})

test('semverSatisfies：预发布边界（0.1.7-alpha.1 归 0.1.7 线）', () => {
  assert.ok(semverSatisfies('0.1.7-alpha.1', '>=0.1.7-alpha.1 <0.2.0-rc.1'))
  assert.ok(!semverSatisfies('0.1.6-alpha.2', '>=0.1.7-alpha.1 <0.2.0-rc.1'))
  assert.ok(!semverSatisfies('0.2.0-rc.1', '>=0.1.7-alpha.1 <0.2.0-rc.1'))
  assert.ok(semverSatisfies('0.3.0', '>=0.2.0-rc.1'))
})

test('事件表按分支终点截断（算法档位的表基础）', () => {
  const main = loadTables({}).tables
  assert.ok(main.packageRenames.has('@deepseek-ai/dsh-workflow-worker-thread'))
  assert.equal(main.configKeyRenames.length, 1)

  const b15 = loadTables({ eventsUpTo: '0.1.5-rc.3' }).tables
  assert.ok(!b15.packageRenames.has('@deepseek-ai/dsh-workflow-worker-thread'), 'rename F 断裂于 0.1.6-alpha.1，晚于 0.1.5 终点，不进表')
  assert.equal(b15.configKeyRenames.length, 1, 'persona 键断裂于 0.1.3-alpha.2，早于终点，在表')

  const b12 = loadTables({ eventsUpTo: '0.1.2-rc.1' }).tables
  assert.equal(b12.configKeyRenames.length, 0, 'text 在 0.1.2 线仍合法：persona 事件被截断')
  assert.equal(b12.packageRenames.size, 0)
})

test('dsh-0.1.5 分支：本线原生预设干净——v0.1.5 真实目录 0 findings、0 写盘', (t) => {
  const home = tmpHome(t)
  copyLegacyEra(home, 'v0.1.5')

  const scan = scanAll({ home, branch: 'dsh-0.1.5', resolvePkg: oldLineResolve })
  assert.equal(scan.branch.id, 'dsh-0.1.5')
  assert.equal(scan.findings.filter((f) => f.rule === 'R-LEGACY').length, 0, '目录在本线是原生格式，不是失效形态')
  assert.equal(scan.findings.length, 0, '本线自己的预设（全 prefix）在本线终点语义下无失效')
  assert.ok(!fs.existsSync(path.join(home, 'cordis.patch.yml')), '不得生成 patch：目录分支没有声明式机制')
})

test('dsh-0.1.5 分支收留更老的 text 时代预设：就地修 persona、不迁移、!!js 保真', (t) => {
  // 0.1.2 时代写的目录预设（text + 旧包名）跑在 0.1.5 宿主上：
  // persona text 断裂于 0.1.3-alpha.2（≤终点）→ 就地拆分；rename F 断裂于
  // 0.1.6-alpha.1（>终点）→ 不进表，worker-thread 在 0.1.5 仍是活名（stub 全活）。
  const home = tmpHome(t)
  copyLegacyEra(home, 'v0.1.2')

  const scan = scanAll({ home, branch: 'dsh-0.1.5', resolvePkg: oldLineResolve })
  assert.equal(scan.branch.id, 'dsh-0.1.5')
  assert.equal(scan.findings.filter((f) => f.rule === 'R-LEGACY').length, 0)
  const keyFindings = scan.findings.filter((f) => f.rule === 'R-KEY-RENAMED')
  assert.ok(keyFindings.length >= 1, 'text 时代真实预设应命中就地修')
  assert.ok(keyFindings.every((f) => f.file.endsWith('agent.cordis.yml')))
  assert.ok(!scan.findings.some((f) => f.rule === 'R-PKG-RENAMED'), 'rename F 被终点截断，旧包名在本线不算失效')

  const r = applyFixes(scan, { ts: '20261001T000000' })
  assert.equal(r.errors.length, 0)
  assert.ok(r.files.some((f) => f.status === 'written'), '就地写盘（带 .bak）')
  assert.ok(!fs.existsSync(path.join(home, 'cordis.patch.yml')), '不迁移：目录分支没有声明式机制')

  // 就地修复语义：text 消失、prefix/suffix 就位、!!js 表达式字节保真
  let personaTextLeft = 0
  let sawJsTag = false
  for (const id of fs.readdirSync(path.join(home, '.agent-presets'))) {
    const file = path.join(home, '.agent-presets', id, 'agent.cordis.yml')
    if (!fs.existsSync(file)) continue
    sawJsTag ||= fs.readFileSync(file, 'utf8').includes("!!js process.platform === 'win32'")
    const rows = loadPatch(fs.readFileSync(file, 'utf8'))
    const walk = (list) => {
      for (const p of list ?? []) {
        if (p?.name === '@deepseek-ai/dsh-persona' && p?.config?.text !== undefined) personaTextLeft++
        for (const k of ['config', 'plugins']) if (Array.isArray(p?.[k])) walk(p[k])
      }
    }
    walk(rows)
  }
  assert.equal(personaTextLeft, 0, 'text 键应全部就地拆为 prefix/suffix')
  assert.ok(sawJsTag, '含 !!js 的目录文件应被处理过且表达式保真')

  const rescan = scanAll({ home, branch: 'dsh-0.1.5', resolvePkg: oldLineResolve })
  assert.equal(rescan.findings.filter((f) => f.level === 'auto').length, 0, '幂等：重扫 0 auto')
})

test('dsh-0.1.2 分支：终点前无事件——0 findings、0 写盘（text 在本线仍合法）', (t) => {
  const home = tmpHome(t)
  copyLegacyEra(home, 'v0.1.2')

  const scan = scanAll({ home, branch: 'dsh-0.1.2', resolvePkg: oldLineResolve })
  assert.equal(scan.branch.id, 'dsh-0.1.2')
  assert.deepEqual(scan.findings, [], 'text/旧包名在 0.1.2 终点前均未断裂，全表截断后 0 findings')

  const r = applyFixes(scan, { ts: '20261001T000000' })
  assert.equal(r.files.length, 0)
  assert.equal(r.migrated.length, 0)
  const untouched = fs.readFileSync(path.join(home, '.agent-presets', 'standard', 'agent.cordis.yml'), 'utf8')
  assert.match(untouched, /^\s+text:/m, 'text 键原样保留（不同终点 → 不同算法行为）')
})
