/**
 * 真值表 + disable 退避（2026-11-08 定案修订）：
 *  官方 true（在参照默认集）→ 跟随预设声明；
 *  官方 false（不在默认集/已移出）→ 解析 false，对齐退避为 disabled:true；
 *  官方空（任何内置预设任何版本都无此 id）→ false，同样退避；
 *  宿主不提供 → false，退避（安全档优先）。
 * 退避**不给强制开例外**：连 `disabled:false` 也覆写。
 * 两条护栏：`!!js` 表达式行绝不改写；基线未收录的官方包行只报不关。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyComposition, rowDeclaredState, rowNoBaseline, evalPlatformDisabled, inferRefPid,
} from '../src/rules/composition-drift.js'
import { rowOffDisposition } from '../src/fix/composition-align.js'
import { makeStateEdit } from '../src/fix/row-edit.js'
import { runToggle } from '../src/fix/index.js'
import { parsePatchFile } from '../src/scan.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ALL = [
  { version: '0.1.7-alpha.1', presets: { standard: ['preset-standard', 'persona', 'tool-bash', 'tool-subagent-codex'] } },
  { version: '0.2.1-rc.1', presets: { standard: ['preset-standard', 'persona', 'tool-bash'] } },
]
const BASE = ALL[1]
const REF = new Set(BASE.presets.standard)

/** 造一行：node.get('disabled') 返回声明值（undefined=无键，字符串=!!js 表达式）。 */
function mkRow(id, name, disabledValue) {
  return {
    id,
    name,
    node: { get: (k) => (k === 'disabled' ? disabledValue : undefined) },
    range: [10, 15],
    line: 2,
  }
}

function srcWith(rows, presetId = 'standard') {
  const presetRow = { presetId, id: `preset-${presetId}`, range: [0, 1000], line: 1 }
  const list = rows.map((r, i) => ({ ...r, range: [(i + 1) * 10, (i + 1) * 10 + 5], line: i + 2 }))
  return { file: 'x', presetRows: [presetRow], rows: [presetRow, ...list] }
}

function classify(src) {
  return classifyComposition(src, src.presetRows[0], {
    baseline: BASE, allBaselines: ALL, currentVersion: '0.2.1-rc.1',
  })
}

const disp = (row, refRows = REF) => rowOffDisposition(row, { refRows, allBaselines: ALL })

test('declared 四态：absent / false / true / dynamic（!!js 表达式）', () => {
  assert.equal(rowDeclaredState(mkRow('a', '@deepseek-ai/x', undefined)), 'absent')
  assert.equal(rowDeclaredState(mkRow('a', '@deepseek-ai/x', false)), 'false')
  assert.equal(rowDeclaredState(mkRow('a', '@deepseek-ai/x', true)), 'true')
  assert.equal(rowDeclaredState(mkRow('a', '@deepseek-ai/x', "process.platform !== 'win32'")), 'dynamic')
})

test('真值表①：官方 true 行 → 跟随预设声明，对齐不动', () => {
  const r = classify(srcWith([mkRow('persona', '@deepseek-ai/dsh-persona', undefined)])).rows[0]
  assert.equal(r.inRefSet, true)
  assert.equal(r.defaultOn, true)
  assert.equal(r.effective, true)
  assert.equal(r.alignable, false)
  assert.equal(disp(mkRow('persona', '@deepseek-ai/dsh-persona', undefined)), null)
})

test('真值表②：官方 false（已移出默认集）而预设声明启用 → 解析 false，对齐退避停用', () => {
  const row = mkRow('tool-subagent-codex', '@deepseek-ai/dsh-tool-subagent-codex', undefined)
  const r = classify(srcWith([row])).rows[0]
  assert.equal(r.inRefSet, false, '0.2.1 参照默认集已无它')
  assert.equal(r.defaultOn, false, '官方停用→解析 false（无值即停用）')
  assert.equal(r.effective, false)
  assert.equal(r.state, 'drift', '仍标漂移供比较')
  assert.equal(r.alignable, true, '退避：对齐要写 disabled:true')
  assert.equal(disp(row), 'official-off')
})

test('真值表③：官方空（任何基线都无）→ 解析 false，退避停用', () => {
  const row = mkRow('my-own-tool', '@me/dsh-my-own-tool', undefined)
  const r = classify(srcWith([row])).rows[0]
  assert.equal(r.noBaseline, true)
  assert.equal(r.defaultOn, false)
  assert.equal(r.effective, false)
  assert.equal(r.alignable, true)
  assert.equal(disp(row), 'official-off')
})

test('真值表④：退避不给强制开例外——官方空行写 disabled:false 也照样覆写', () => {
  const row = mkRow('my-own-tool', '@me/dsh-my-own-tool', false)
  const r = classify(srcWith([row])).rows[0]
  assert.equal(r.effective, true, '盘面显式强制开，解析如实给 true')
  assert.equal(r.alignable, true, '但用户定案：不给例外，对齐仍退避')
  assert.equal(disp(row), 'official-off')
})

test('护栏①：官方包 name 而基线未收录 id（fs-local 形态）→ 不算官方空，也不退避', () => {
  const row = mkRow('fs-local', '@deepseek-ai/dsh-fs-local', undefined)
  assert.equal(rowNoBaseline(row, ALL), false, 'id 不在基线但 name 属官方包 → 非官方空')
  const r = classify(srcWith([row])).rows[0]
  assert.equal(r.noBaseline, false)
  assert.equal(r.baselineUncovered, true, '改判「基线未收录」供比较')
  assert.equal(r.alignable, false, '护栏：不退避')
  assert.equal(disp(row), 'guarded-uncovered')
})

test('护栏②：官方 true 行已显式 disabled:true → 无改动（保持二次 noop）', () => {
  const row = mkRow('persona', '@deepseek-ai/dsh-persona', true)
  assert.equal(disp(row), null)
})

test('evalPlatformDisabled：单一平台比较可求值，其余一律 null', () => {
  assert.equal(evalPlatformDisabled("process.platform === 'win32'", 'win32'), true)
  assert.equal(evalPlatformDisabled("process.platform === 'win32'", 'linux'), false)
  assert.equal(evalPlatformDisabled("process.platform !== 'win32'", 'win32'), false)
  assert.equal(evalPlatformDisabled("process.platform !== 'darwin'", 'win32'), true)
  assert.equal(evalPlatformDisabled("process.platform === 'win32' || foo", 'win32'), null, '复合表达式不求值')
  assert.equal(evalPlatformDisabled("env.DSH_X === '1'", 'win32'), null)
  assert.equal(evalPlatformDisabled(true, 'win32'), null, '非字符串不求值')
})

test('护栏③：!!js 平台表达式行——算完 true/false 提交解析值，但任何处置都不改写', () => {
  const bash = mkRow('tool-bash', '@deepseek-ai/dsh-tool-bash', "process.platform === 'win32'")
  const pwsh = mkRow('tool-pwsh', '@deepseek-ai/dsh-tool-pwsh', "process.platform !== 'win32'")
  const byId = Object.fromEntries(classify(srcWith([bash, pwsh])).rows.map((r) => [r.id, r]))
  const win = process.platform === 'win32'
  assert.equal(byId['tool-bash'].declared, 'dynamic')
  // dynamicResolved 的语义是「表达式能否求出」（platformDisabled !== null），与平台无关；
  // 求出来的值本身走 effective。原先断言 == win 只在 win32 上碰巧成立。
  assert.equal(byId['tool-bash'].dynamicResolved, true, '平台表达式能求出（platformDisabled 非 null）')
  assert.equal(byId['tool-bash'].platformDisabled, win, '仅 win32 下能判为禁用')
  assert.equal(byId['tool-bash'].effective, !win, '算完的值提交进解析结果')
  assert.equal(byId['tool-pwsh'].effective, win)
  assert.equal(byId['tool-bash'].platform, process.platform, '回报求值用的运行平台')
  assert.equal(byId['tool-bash'].alignable, false, '表达式行绝不覆写')
  assert.equal(disp(bash), 'guarded-dynamic')
  const node = { range: [12, 55], get: () => "process.platform === 'win32'" }
  const text = `- id: tool-bash\n  disabled: !!js process.platform === 'win32'\n`
  assert.equal(makeStateEdit(text, node, true), null)
  assert.equal(makeStateEdit(text, node, false), null)
})

test('inferRefPid：按共有行数选参照，小子集不误中 minimal', () => {
  const B = {
    presets: {
      standard: ['preset-standard', 'persona', 'tool-bash', 'tool-fs', 'tool-goal'],
      minimal: ['preset-minimal', 'persona', 'persistent-shell'],
    },
  }
  assert.equal(inferRefPid(['persona', 'tool-bash', 'tool-fs'], B), 'standard')
  assert.equal(inferRefPid(['persona', 'persistent-shell'], B), 'minimal')
  assert.equal(inferRefPid(['totally-own'], B), 'standard', '零重叠回退 standard')
})

test('护栏④：runToggle 对 !!js 动态行三档全拒（dynamic-value）且零写盘', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-dyn-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'cordis.patch.yml')
  const text = `- insert:
    - id: preset-standard
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: standard
        plugins:
          - id: custom-bash
            name: '@me/dsh-winbash'
            disabled: !!js process.platform !== 'win32'
`
  fs.writeFileSync(file, text, 'utf8')
  const scan = () => ({ sources: [parsePatchFile(file, 'profile', 'web')], findings: [], detectedVersion: '0.2.1-rc.3' })
  for (const mode of ['follow', 'on', 'off']) {
    const r = runToggle(scan(), { file, presetId: 'standard', rowId: 'custom-bash', mode, confirm: true, ts: 'T' + mode })
    assert.equal(r.status, 'dynamic-value', mode + ' 档必须拒绝改写表达式')
    assert.match(r.errors[0].message, /表达式/)
    assert.ok(!fs.existsSync(`${file}.bak-T${mode}`), '拒绝时不备份不写盘')
  }
  assert.equal(fs.readFileSync(file, 'utf8'), text, '表达式原样不动')
})
