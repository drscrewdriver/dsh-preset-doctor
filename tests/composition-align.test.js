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

test('planAlignForPreset：disable 退避——不在参照默认集的行一律写 disabled，报缺失', () => {
  const { file } = tmpPatch(t0())
  const src = parsePatchFile(file, 'profile', 'web')
  const preset = src.presetRows.find((r) => r.presetId === 'standard')
  const plan = planAlignForPreset(src, preset, { baseline: baselineForVersion('0.2.0-rc.2'), allBaselines: loadBaseline() })
  assert.ok(plan.disabledOfficialOff.includes('time-context'), 'time-context 不在 0.2.0 参照默认集→退避停用')
  assert.ok(plan.disabledOfficialOff.includes('my-custom-tool'), '任何基线都无的自定义行→同样退避停用')
  assert.ok(!plan.removed.includes('persona') && !plan.removed.includes('tool-bash'), '参照默认集里的行不动')
  assert.ok(plan.missing.includes('tool-subagent-codex'), '0.2.0 标准有而用户无 → 报缺失（不自动加）')
  const newText = spliceEdits(src.text, plan.edits)
  assert.match(newText, /- id: time-context\r?\n\s+disabled: true/, '漂移行也退避为 disabled: true')
  assert.match(newText, /- id: my-custom-tool\r?\n\s+disabled: true/, '官方空行退避为 disabled: true')
  assert.ok(newText.includes('# 用户的注释：必须原样保留'), '注释保留')
  assert.ok(newText.includes('my-custom-tool'), '行本体保留（不删行）')
})

test('runAlign：写盘退避停用非默认集行 + .bak + 幂等（二次 noop）', (t) => {
  const { file } = tmpPatch(t)
  const src = parsePatchFile(file, 'profile', 'web')
  const scanResult = { home: path.dirname(file), sources: [src], findings: [], detectedVersion: '0.2.0-rc.2' }
  const r1 = runAlign(scanResult, { file, presetId: 'standard', ts: 'T1' })
  assert.equal(r1.status, 'written')
  assert.deepEqual(r1.disabledOfficialOff, ['time-context', 'my-custom-tool'])
  assert.deepEqual(r1.removed, ['time-context', 'my-custom-tool'])
  assert.deepEqual(r1.guarded, [], '无表达式行、无基线未收录行')
  assert.ok(fs.existsSync(`${file}.bak-T1`), '写前有 .bak')
  const after = fs.readFileSync(file, 'utf8')
  assert.match(after, /- id: time-context\r?\n\s+disabled: true/, '退避写 disabled: true')
  assert.ok(after.includes('persona'), '官方 true 行本体与启用态都不动')

  // 幂等：重扫已对齐的文件 → 无需落盘的行 → noop
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

test('runAlign：自定义 id 预设按推断参照退避（已移出的官方行也停用）', (t) => {
  const text = `- insert:
    - id: preset-winbash
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: winbash
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
          - id: tool-subagent-codex
            name: '@deepseek-ai/dsh-tool-subagent-codex'
`
  const { file } = tmpPatch(t, text)
  const src = parsePatchFile(file, 'profile', 'web')
  const scanResult = { home: path.dirname(file), sources: [src], findings: [], detectedVersion: '0.2.1-rc.3' }
  const r = runAlign(scanResult, { file, presetId: 'winbash', ts: 'T1' })
  assert.equal(r.status, 'written', 'codex 不在推断参照的默认集→退避停用')
  assert.deepEqual(r.removed, ['tool-subagent-codex'])
  assert.equal(r.missingRef, 'standard', '行集与 standard 重叠最多→参照推断为 standard')
  assert.ok(r.missing.includes('command-goal'), 'standard 有而本预设无→报缺')
  const after = fs.readFileSync(file, 'utf8')
  assert.ok(after.includes('tool-subagent-codex'), '行本体保留')
  assert.match(after, /- id: tool-subagent-codex\r?\n\s+disabled: true/)
  assert.ok(!/persona\r?\n\s+disabled:/.test(after), '官方 true 行不动')
})

test('runAlign：disable 退避不给强制开例外（disabled:false 也被覆写）', (t) => {
  const text = `- insert:
    - id: preset-winbash
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: winbash
        plugins:
          - id: my-tool-a
            name: '@me/dsh-my-tool-a'
          - id: my-tool-b
            name: '@me/dsh-my-tool-b'
            disabled: false
`
  const { file } = tmpPatch(t, text)
  const src = parsePatchFile(file, 'profile', 'web')
  const scanResult = { home: path.dirname(file), sources: [src], findings: [], detectedVersion: '0.2.1-rc.3' }
  const r = runAlign(scanResult, { file, presetId: 'winbash', ts: 'T1' })
  assert.deepEqual(r.removed.sort(), ['my-tool-a', 'my-tool-b'], '两行都不在参照默认集→一律退避')
  const after = fs.readFileSync(file, 'utf8')
  assert.match(after, /- id: my-tool-a\r?\n\s+disabled: true/)
  assert.match(after, /- id: my-tool-b[\s\S]{0,80}disabled: true/, '显式强制开也被覆写（用户定案：不给例外）')
})

// 供第一个 test 用的临时 t.after（非 test 回调内）——用极简 stub
function t0() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshalign-'))
  const file = path.join(dir, 'cordis.patch.yml')
  fs.writeFileSync(file, PATCH, 'utf8')
  return { after() {}, dir, file }
}
