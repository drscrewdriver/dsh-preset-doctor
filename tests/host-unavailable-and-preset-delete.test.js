/**
 * 两件事的回归面（2026-11-08 装机实证驱动）：
 *  ① 类型+版本适配：`@scope/pkg/sub` 这类子路径导出行——包体在但当前版本无该导出，
 *     必须判成「宿主不提供」（否则一开就 never started，整条预设从可用预设里消失）；
 *  ② 预设级删除：整块移除一条预设声明，confirm 硬门 + 被 default/selectedDefault
 *     指着的预设默认拒删 + .bak 备份 + 区间外注释不动。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolvePkg, subPathExported, subPathOf, pkgPart, candidateRoots, electronRoots } from '../src/pkg-resolve.js'
import { detectDshVersion } from '../src/host-version.js'
import { rowPkgMissing, rowUnavailableReason } from '../src/rules/composition-drift.js'
import { parsePatchFile } from '../src/scan.js'
import { runDeletePreset, registryDefaults } from '../src/fix/index.js'

function tmpPkg(t, pkgJson, files = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-subpath-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const dir = path.join(root, 'node_modules', '@a', 'b')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkgJson))
  for (const f of files) {
    const p = path.join(dir, ...f.split('/'))
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, 'export const x = 1\n')
  }
  return root
}

test('subPathOf / pkgPart：子路径段拆解', () => {
  assert.equal(pkgPart('@a/b/list-agents'), '@a/b')
  assert.equal(subPathOf('@a/b/list-agents'), 'list-agents')
  assert.equal(subPathOf('@a/b'), '')
  assert.equal(subPathOf('pkg/sub/deep'), 'sub/deep')
})

test('subPathExported：exports 命中精确键 / ./x/* 模式 / conditions；缺失返回 false；无 exports 回落文件', (t) => {
  const withExports = tmpPkg(t, { name: '@a/b', exports: { '.': './lib/index.js', './list-agents': './lib/la.js' } })
  const pkgDir = path.join(withExports, 'node_modules', '@a', 'b')
  assert.equal(subPathExported(pkgDir, 'list-agents'), true)
  assert.equal(subPathExported(pkgDir, 'nope'), false, 'exports 里没这个键 → 该版本无此导出')
  assert.equal(subPathExported(pkgDir, ''), true, '无子路径恒 ok')

  const star = tmpPkg(t, { name: '@a/b', exports: { '.': './i.js', './src/*': './src/*' } })
  assert.equal(subPathExported(path.join(star, 'node_modules', '@a', 'b'), 'src/anything.js'), true, './x/* 模式命中')

  const cond = tmpPkg(t, { name: '@a/b', exports: { '.': { import: './e.mjs', require: './cjs.js' }, './sub': { require: './s.js' } } })
  assert.equal(subPathExported(path.join(cond, 'node_modules', '@a', 'b'), 'sub'), true, 'conditions 层里的键也算命中')

  const legacy = tmpPkg(t, { name: '@a/b', main: 'index.js' }, ['index.js', 'sub/index.js'])
  const legacyDir = path.join(legacy, 'node_modules', '@a', 'b')
  assert.equal(subPathExported(legacyDir, 'sub'), true, '无 exports 字段回落文件存在性')
  assert.equal(subPathExported(legacyDir, 'ghost'), false)
})

test('resolvePkg：包体在、子路径导出缺失 → ok=false + subpathMissing=true', (t) => {
  const root = tmpPkg(t, { name: '@a/b', exports: { '.': './i.js' } })
  const r = resolvePkg('@a/b/list-agents', { roots: [root + '/node_modules'] })
  assert.equal(r.ok, false, '子路径不存在即不可用')
  assert.equal(r.subpathMissing, true)
  assert.equal(resolvePkg('@a/b', { roots: [root + '/node_modules'] }).ok, true, '包本体仍在')
})

test('rowPkgMissing / rowUnavailableReason：子路径行按完整名判，成因可回报', (t) => {
  const root = tmpPkg(t, { name: '@a/b', exports: { '.': './i.js' } })
  const resolver = (name) => resolvePkg(name, { roots: [path.join(root, 'node_modules')] })
  const subRow = { id: 'list-agents', name: '@a/b/list-agents' }
  assert.equal(rowPkgMissing(subRow, resolver), true, '旧判据只看包体会误判可用，现按完整名判')
  assert.equal(rowUnavailableReason(subRow, resolver), 'subpath')
  assert.equal(rowUnavailableReason({ id: 'body', name: '@a/b' }, resolver), null)
  assert.equal(rowUnavailableReason({ id: 'x', name: '@a/b' }, undefined, new Set(['x'])), 'bundle')
  assert.equal(rowPkgMissing({ id: 'g', name: 'cordis:group' }, resolver), false, '虚拟行不判')
})

const PRESET_PATCH = `- insert:
    - id: preset-keepme
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: keepme
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'

    # 待删预设的上方注释：必须原样保留
    - id: preset-gone
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: gone
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
          - id: tool-fs
            name: '@deepseek-ai/dsh-tool-fs'

- id: agent-preset-registry
  name: '@deepseek-ai/dsh-agent-preset-registry'
  config:
    default: standard
    selectedDefault: gone
`

function tmpPatchFile(t, text = PRESET_PATCH) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-delpreset-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'cordis.patch.yml')
  fs.writeFileSync(file, text, 'utf8')
  return file
}

const scanOf = (file) => ({ sources: [parsePatchFile(file, 'home', '')], findings: [], detectedVersion: '0.2.1-rc.3' })

test('electronRoots：桌面 asar 里宿主的包在 app.asar/dsh/node_modules，且优先于 asar 顶层', (t) => {
  const res = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-res-'))
  t.after(() => fs.rmSync(res, { recursive: true, force: true }))
  // 复刻实测布局：app.asar/dsh = @deepseek-ai/dsh-desktop-runtime（包全在它的 node_modules 里）
  const bundle = path.join(res, 'app.asar', 'dsh')
  const bundleMods = path.join(bundle, 'node_modules', '@deepseek-ai')
  fs.mkdirSync(bundleMods, { recursive: true })
  fs.writeFileSync(path.join(bundle, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-desktop-runtime', version: '0.2.2-rc.1' }))
  fs.mkdirSync(path.join(bundleMods, 'dsh-base'), { recursive: true })
  fs.writeFileSync(path.join(bundleMods, 'dsh-base', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-base', version: '0.2.2-rc.1' }))
  // 子路径只有 . / ./src/*，无 ./list-agents（真宿主 0.2.2-rc.1 的 exports）
  fs.mkdirSync(path.join(bundleMods, 'dsh-tool-subagent-control'), { recursive: true })
  fs.writeFileSync(
    path.join(bundleMods, 'dsh-tool-subagent-control', 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/dsh-tool-subagent-control', version: '0.2.2-rc.1', exports: { '.': './i.js', './src/*': './src/*', './package.json': './package.json' } }),
  )
  // asar 顶层也有一个 node_modules（不含宿主本体依赖），优先级应低于 dsh/ 内层
  fs.mkdirSync(path.join(res, 'app.asar', 'node_modules'), { recursive: true })

  const eroots = electronRoots(res)
  assert.equal(eroots[0], path.join(bundle, 'node_modules'), 'bundle 内层排第一（真宿主那份）')
  assert.equal(eroots[1], path.join(res, 'app.asar', 'node_modules'), 'asar 仓基座排第二')

  const roots = candidateRoots({ resourcesPath: res, execPath: path.join(res, 'bin', 'app.exe') })
  assert.ok(roots.indexOf(eroots[0]) < roots.indexOf(eroots[1]), 'candidateRoots 保持同一优先序')

  // 真值：包体在、list-agents 子路径在当前宿主版本不存在 → 不可用（成因为 subpath）
  const resolver = (name) => resolvePkg(name, { roots: eroots })
  assert.equal(resolver('@deepseek-ai/dsh-tool-subagent-control').ok, true, '包本体在')
  assert.equal(rowPkgMissing({ id: 'lat', name: '@deepseek-ai/dsh-tool-subagent-control/list-agents' }, resolver), true)
  assert.equal(rowUnavailableReason({ id: 'lat', name: '@deepseek-ai/dsh-tool-subagent-control/list-agents' }, resolver), 'subpath')
  assert.equal(rowUnavailableReason({ id: 'tsc', name: '@deepseek-ai/dsh-tool-subagent-control' }, resolver), null, '对照片本身仍可用')

  // 宿主版本探测也走同一套根（之前只扫 app.asar/node_modules 会漏掉真宿主那份）
  const det = detectDshVersion({ resourcesPath: res, roots: [] })
  assert.equal(det.version, '0.2.2-rc.1')
  assert.match(det.via, /^electron:/)

  // 非 Electron（无 resourcesPath）→ 不注入 asar 根
  assert.deepEqual(electronRoots(undefined), [])
  assert.ok(!candidateRoots({ resourcesPath: undefined, execPath: path.join(res, 'bin', 'app.exe') }).some((p) => p.includes('app.asar')))
})

test('registryDefaults：从 agent-preset-registry 行读出 default/selectedDefault', (t) => {
  const file = tmpPatchFile(t)
  const got = registryDefaults(scanOf(file))
  assert.deepEqual([...got.keys()].sort(), ['gone', 'standard'])
  assert.equal(got.get('gone').key, 'selectedDefault')
})

test('runDeletePreset：无 confirm 拒绝；默认指着拒删；allowDefault 才落盘', (t) => {
  const file = tmpPatchFile(t)
  const noConfirm = runDeletePreset(scanOf(file), { file, presetId: 'gone', ts: 'T0' })
  assert.equal(noConfirm.status, 'rejected')
  assert.ok(!fs.existsSync(file + '.bak-T0'), '未确认不写盘')

  const isDefault = runDeletePreset(scanOf(file), { file, presetId: 'gone', confirm: true, ts: 'T1' })
  assert.equal(isDefault.status, 'is-default', '被 selectedDefault 指着 → 默认拒删')
  assert.match(isDefault.errors[0].message, /selectedDefault/)

  const ok = runDeletePreset(scanOf(file), { file, presetId: 'gone', confirm: true, allowDefault: true, ts: 'T2' })
  assert.equal(ok.status, 'written')
  assert.ok(fs.existsSync(file + '.bak-T2'), '写前 .bak')
  const after = fs.readFileSync(file, 'utf8')
  assert.ok(!/id:\s*gone\b/.test(after), '预设本体已删')
  assert.ok(!/id:\s*tool-fs/.test(after), '其子行随预设一起消失')
  assert.ok(after.includes('id: keepme'), '另一条预设不受影响')
  assert.ok(after.includes('# 待删预设的上方注释'), '区间外注释不动')

  // 幂等：再删同一条 → not-found
  const again = runDeletePreset(scanOf(file), { file, presetId: 'gone', confirm: true, allowDefault: true, ts: 'T3' })
  assert.equal(again.status, 'not-found')
})

test('runDeletePreset：非默认预设可直接删；dryRun 不落盘', (t) => {
  const file = tmpPatchFile(t)
  const dry = runDeletePreset(scanOf(file), { file, presetId: 'keepme', confirm: true, dryRun: true, ts: 'T4' })
  assert.equal(dry.status, 'would-write')
  assert.equal(fs.readFileSync(file, 'utf8'), PRESET_PATCH, 'dryRun 原文不动')

  const real = runDeletePreset(scanOf(file), { file, presetId: 'keepme', confirm: true, ts: 'T5' })
  assert.equal(real.status, 'written')
  const after = fs.readFileSync(file, 'utf8')
  assert.ok(!/id:\s*keepme/.test(after))
  assert.ok(after.includes('id: gone'), '另一条保留')
})
