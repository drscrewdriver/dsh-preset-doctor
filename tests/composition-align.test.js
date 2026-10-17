import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parsePatchFile } from '../src/scan.js'
import { runAlign } from '../src/fix/index.js'
import { planAlignForPreset } from '../src/fix/composition-align.js'
import { spliceEdits } from '../src/fix/core.js'
import { baselineForVersion, loadBaseline } from '../src/tables/load.js'

const PATCH = `- insert:
    - id: preset-standard
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: standard
        plugins:
          # 用户的注释：必须原样保留
          - id: persona
            name: '@deepseek-ai/dsh-persona'
          - id: tool-bash
            name: '@deepseek-ai/dsh-tool-bash'
          - id: time-context
            name: '@deepseek-ai/dsh-time-context'
          - id: my-custom-tool
            name: 'some-third-party-tool'
`

function tmpPatch(t, text = PATCH) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshalign-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'cordis.patch.yml')
  fs.writeFileSync(file, text, 'utf8')
  return { dir, file }
}

test('planAlignForPreset：0.2.0 运行版删 time-context、留自定义、报缺失', () => {
  const { file } = tmpPatch(t0())
  const src = parsePatchFile(file, 'profile', 'web')
  const preset = src.presetRows.find((r) => r.presetId === 'standard')
  const plan = planAlignForPreset(src, preset, { baseline: baselineForVersion('0.2.0-rc.2'), allBaselines: loadBaseline() })
  assert.ok(plan.removed.includes('time-context'), 'time-context 是 0.2.1 才引入 → 在 0.2.0 上算漂移，应删')
  assert.ok(!plan.removed.includes('my-custom-tool'), '用户自定义行不删')
  assert.ok(!plan.removed.includes('persona') && !plan.removed.includes('tool-bash'), '当前基线有的行保留')
  assert.ok(plan.missing.includes('tool-subagent-codex'), '0.2.0 标准有而用户无 → 报缺失（不自动加）')
  const newText = spliceEdits(src.text, plan.edits)
  assert.ok(!/id:\s*time-context/.test(newText), 'time-context 行被删')
  assert.ok(newText.includes('# 用户的注释：必须原样保留'), '注释保留')
  assert.ok(newText.includes('my-custom-tool'), '自定义行保留')
})

test('runAlign：写盘 + .bak + 幂等（二次 noop）', (t) => {
  const { file } = tmpPatch(t)
  const src = parsePatchFile(file, 'profile', 'web')
  const scanResult = { home: path.dirname(file), sources: [src], findings: [], detectedVersion: '0.2.0-rc.2' }
  const r1 = runAlign(scanResult, { file, presetId: 'standard', ts: 'T1' })
  assert.equal(r1.status, 'written')
  assert.ok(r1.removed.includes('time-context'))
  assert.ok(fs.existsSync(`${file}.bak-T1`), '写前有 .bak')
  assert.ok(!/id:\s*time-context/.test(fs.readFileSync(file, 'utf8')))

  // 幂等：重解析已对齐的文件 → 无漂移可删 → noop
  const src2 = parsePatchFile(file, 'profile', 'web')
  const r2 = runAlign({ ...scanResult, sources: [src2] }, { file, presetId: 'standard', ts: 'T2' })
  assert.equal(r2.status, 'noop')
  assert.deepEqual(r2.removed, [])
})

test('runAlign：dryRun 不写盘', (t) => {
  const { file } = tmpPatch(t)
  const src = parsePatchFile(file, 'profile', 'web')
  const before = fs.readFileSync(file, 'utf8')
  const r = runAlign({ home: path.dirname(file), sources: [src], findings: [], detectedVersion: '0.2.0-rc.2' }, { file, presetId: 'standard', dryRun: true, ts: 'T1' })
  assert.equal(r.status, 'would-write')
  assert.ok(!fs.existsSync(`${file}.bak-T1`), 'dryRun 不备份')
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'dryRun 原文不动')
})

// 供第一个 test 用的临时 t.after（非 test 回调内）——用极简 stub
function t0() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshalign-'))
  const file = path.join(dir, 'cordis.patch.yml')
  fs.writeFileSync(file, PATCH, 'utf8')
  return { after() {}, dir, file }
}
