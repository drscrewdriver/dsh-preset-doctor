/**
 * R-LEGACY-CONFLICT 授权转写收尾测试（resolve-legacy）。
 * 纪律：confirm 硬门（无 confirm 零写盘）；对齐以「当前版本默认预设」为参照
 * （死标准成员删、用户自定义行留）；遗留目录归档移动而非删除；.bak 备份；幂等。
 * 钉 dshVersion=0.2.1-rc.1 与运行宿主解耦。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scanAll } from '../src/scan.js'
import { collectPresets } from '../src/report.js'
import { runResolveLegacy, archiveLegacyDir } from '../src/fix/resolve-legacy.js'
import { makeSettingsBridge } from '../src/bridge.js'
import { resolveConfig } from '../src/index.js'

function tmpHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshpm-resolve-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  return home
}

/** 自定义 id 预设：persona（当前活）+ tool-subagent-codex（历史成员、现已死）+ 自定义行。 */
const CUSTOM_DECL = [
  '- insert:',
  '    - id: preset-winbash',
  "      name: '@deepseek-ai/dsh-agent-preset'",
  '      config:',
  '        id: winbash',
  '        name: Win Bash',
  '        plugins:',
  '          - id: persona',
  "            name: '@deepseek-ai/dsh-persona'",
  '          - id: tool-subagent-codex',
  "            name: '@deepseek-ai/dsh-tool-subagent-codex'",
  '          - id: my-custom-tool',
  "            name: '@me/dsh-my-custom-tool'",
].join('\n')

/** 覆盖内置 standard：tool-ralph 在 0.2.1 已移出（漂移行），tool-bash 保留。 */
const BUILTIN_DECL = [
  '- insert:',
  '    - id: preset-standard',
  "      name: '@deepseek-ai/dsh-agent-preset'",
  '      config:',
  '        id: standard',
  '        plugins:',
  '          - id: tool-bash',
  "            name: '@deepseek-ai/dsh-tool-bash'",
  '          - id: tool-ralph',
  "            name: '@deepseek-ai/dsh-tool-ralph'",
].join('\n')

function mkLegacyDir(home, id) {
  const dir = path.join(home, '.agent-presets', id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'agent.cordis.yml'), '- id: persona\n  name: dsh-persona\n')
  fs.writeFileSync(path.join(dir, 'preset.yml'), `name: 旧${id}\n`)
  return dir
}

function scan021(home) {
  return scanAll({ home, scanProfiles: false, migrateLegacy: true, dshVersion: '0.2.1-rc.1' })
}

test('runResolveLegacy：无 confirm 拒绝且零写盘', (t) => {
  const home = tmpHome(t)
  fs.writeFileSync(path.join(home, 'cordis.patch.yml'), CUSTOM_DECL)
  mkLegacyDir(home, 'winbash')
  const scan = scan021(home)
  const before = fs.readFileSync(path.join(home, 'cordis.patch.yml'), 'utf8')
  const out = runResolveLegacy(scan, { key: `legacy|winbash|${path.join(home, '.agent-presets', 'winbash')}` })
  assert.equal(out.status, 'rejected')
  assert.equal(fs.readFileSync(path.join(home, 'cordis.patch.yml'), 'utf8'), before)
  assert.ok(fs.existsSync(path.join(home, '.agent-presets', 'winbash')), '目录不应被动')
})

test('冲突卡 syncable=true（授权转写收尾入口打开）', (t) => {
  const home = tmpHome(t)
  fs.writeFileSync(path.join(home, 'cordis.patch.yml'), CUSTOM_DECL)
  mkLegacyDir(home, 'winbash')
  const card = collectPresets(scan021(home)).find((p) => p.source === 'legacy' && p.id === 'winbash')
  assert.ok(card, '应有遗留目录卡')
  assert.equal(card.current, false)
  assert.equal(card.syncable, true, 'R-LEGACY-CONFLICT 卡应可同步（收尾动作）')
})

test('runResolveLegacy 全链：声明对齐（死标准行删/自定义行留）+ 目录归档 + .bak', (t) => {
  const home = tmpHome(t)
  fs.writeFileSync(path.join(home, 'cordis.patch.yml'), CUSTOM_DECL)
  const dir = mkLegacyDir(home, 'winbash')
  const scan = scan021(home)
  const out = runResolveLegacy(scan, { key: `legacy|winbash|${dir}`, confirm: true, ts: 'TESTTS' })
  assert.equal(out.status, 'resolved', JSON.stringify(out))
  const r = out.results[0]
  assert.equal(r.id, 'winbash')
  assert.deepEqual(r.aligned.removed, ['tool-subagent-codex'], '只删已死的标准成员行')
  assert.equal(r.archive.status, 'archived')
  const after = fs.readFileSync(path.join(home, 'cordis.patch.yml'), 'utf8')
  assert.ok(!after.includes('tool-subagent-codex'), '漂移行应被移除')
  assert.ok(after.includes('my-custom-tool'), '用户自定义行绝不删')
  assert.ok(after.includes('persona'), '当前活行保留')
  assert.ok(after.includes('winbash'), '声明本体保留（转写结果不动）')
  assert.ok(fs.existsSync(path.join(home, 'cordis.patch.yml.bak-TESTTS')), '写前 .bak 备份')
  assert.ok(!fs.existsSync(dir), '原目录已移走')
  const archived = path.join(home, 'preset-doctor-archive', 'TESTTS', 'winbash')
  assert.ok(fs.existsSync(path.join(archived, 'agent.cordis.yml')), '归档目录内容完整（移动非删除）')
  // 幂等：再扫无冲突、再跑报 not-found
  const scan2 = scan021(home)
  assert.ok(!scan2.findings.some((f) => f.rule === 'R-LEGACY-CONFLICT'))
  const again = runResolveLegacy(scan2, { key: `legacy|winbash|${dir}`, confirm: true, ts: 'TESTTS2' })
  assert.equal(again.status, 'not-found')
})

test('内置 id 覆盖预设冲突收尾：走 planAlignForPreset 删漂移行', (t) => {
  const home = tmpHome(t)
  fs.writeFileSync(path.join(home, 'cordis.patch.yml'), BUILTIN_DECL)
  const dir = mkLegacyDir(home, 'standard')
  const scan = scan021(home)
  const out = runResolveLegacy(scan, { key: `legacy|standard|${dir}`, confirm: true, ts: 'T2' })
  assert.equal(out.status, 'resolved', JSON.stringify(out))
  const after = fs.readFileSync(path.join(home, 'cordis.patch.yml'), 'utf8')
  assert.ok(!after.includes('tool-ralph'), '0.2.1 已移出的标准成员应删')
  assert.ok(after.includes('tool-bash'), '当前标准成员保留')
  assert.ok(fs.existsSync(path.join(home, 'preset-doctor-archive', 'T2', 'standard')))
})

test('dryRun：would-resolve 且零写盘', (t) => {
  const home = tmpHome(t)
  fs.writeFileSync(path.join(home, 'cordis.patch.yml'), CUSTOM_DECL)
  const dir = mkLegacyDir(home, 'winbash')
  const scan = scan021(home)
  const out = runResolveLegacy(scan, { key: `legacy|winbash|${dir}`, confirm: true, dryRun: true, ts: 'DRY' })
  assert.equal(out.status, 'would-resolve')
  assert.equal(out.results[0].archive.status, 'would-archive')
  assert.equal(fs.readFileSync(path.join(home, 'cordis.patch.yml'), 'utf8'), CUSTOM_DECL, 'dry-run 不动文件')
  assert.ok(fs.existsSync(dir), 'dry-run 不动目录')
  assert.ok(!fs.existsSync(path.join(home, 'preset-doctor-archive')), 'dry-run 不建归档区')
})

test('archiveLegacyDir：同名归档冲突时加序号后缀，absent 如实报告', (t) => {
  const home = tmpHome(t)
  const dir = mkLegacyDir(home, 'dup')
  const destRoot = path.join(home, 'preset-doctor-archive', 'TS')
  fs.mkdirSync(path.join(destRoot, 'dup'), { recursive: true })
  const r = archiveLegacyDir(dir, { home, ts: 'TS' })
  assert.equal(r.status, 'archived')
  assert.ok(fs.existsSync(path.join(destRoot, 'dup-2', 'preset.yml')))
  const gone = archiveLegacyDir(dir, { home, ts: 'TS' })
  assert.equal(gone.status, 'absent')
})

test('桥 /resolve-legacy 路由：key 必填 + confirm 硬门 + 透传', async () => {
  const calls = []
  const routes = makeSettingsBridge({
    settings: { describe: () => [] },
    ns: 'preset-manager',
    resolveConfig,
    context: { runResolveLegacy: (req) => { calls.push(req); return { status: 'resolved', results: [], errors: [] } } },
  })
  const route = routes.find((x) => x.path.endsWith('/resolve-legacy'))
  assert.ok(route, '应有 resolve-legacy 路由')
  const mkReq = (body) => ({
    method: 'POST',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:1', 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body))
    },
  })
  const capture = async (body) => {
    let out
    const res = { writeHead() {}, end(s) { out = JSON.parse(s) } }
    await route.handler(mkReq(body), res)
    return out
  }
  const noKey = await capture({ confirm: true })
  assert.equal(noKey.code, 'resolve-legacy-rejected', '无 key 拒绝')
  const noConfirm = await capture({ key: 'legacy|a|/x' })
  assert.equal(noConfirm.code, 'resolve-legacy-rejected', '无 confirm 拒绝')
  assert.equal(calls.length, 0, '两道拒绝都不该触达 provider')
  const ok = await capture({ key: 'legacy|a|/x', confirm: true })
  assert.equal(ok.ok, true)
  assert.deepEqual(calls[0], { key: 'legacy|a|/x', confirm: true })
})
