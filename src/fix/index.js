/**
 * dsh-preset-doctor — 修复编排。
 *
 * 两阶段（先文本编辑后迁移，同一文件的追加读的是编辑后的最新盘上内容）：
 * 1. patch 文件内 span 编辑（R-PKG-RENAMED / R-KEY-RENAMED / R-LOCAL-PATH）：
 *    按文件分组 → 规划 span → splice → 备份 + 原子写
 * 2. 遗留目录迁移（R-LEGACY）：合并排序后一次性追加进 home patch
 *
 * report 级 finding 一律不写盘；例外：R-LEGACY-CONFLICT 的授权转写收尾
 * 走独立显式动作 runResolveLegacy（confirm 硬门），不经 applyFixes。
 */
import { planFileEdits } from './planner.js'
import { migrateLegacyDirs } from './migrate-legacy.js'
import { planAlignForPreset } from './composition-align.js'
import { runResolveLegacy } from './resolve-legacy.js'
import { makeDisabledEdit, makeEnableEdit } from './row-edit.js'
import { writeFileSafe, defaultTimestamp, displayPath, spliceEdits } from './core.js'
import { baselineForVersion, loadBaseline } from '../tables/load.js'

export { runResolveLegacy }

export function applyFixes({ home, sources, findings, tables }, { dryRun = false, ts = defaultTimestamp() } = {}) {
  const results = {
    dryRun,
    ts,
    files: [], // [{ file, status, backup, rules: [...]}]
    migrated: [], // [{ id, status, target, backup?, message? }]
    errors: [], // [{ file?, id?, rule?, message }]
  }

  // ── 阶段 1：patch 内 span 编辑 ──
  const byFile = new Map()
  for (const f of findings) {
    if (f.level !== 'auto' || f.rule === 'R-LEGACY') continue
    if (!byFile.has(f.file)) byFile.set(f.file, [])
    byFile.get(f.file).push(f)
  }
  const srcByFile = new Map(sources.map((s) => [s.file, s]))
  for (const [file, list] of byFile) {
    const src = srcByFile.get(file)
    if (!src) {
      results.errors.push({ file, rule: list[0].rule, message: '找不到已解析的源（内部错误）' })
      continue
    }
    try {
      const { edits, newText } = planFileEdits(list, src)
      const write = writeFileSafe(file, newText, src.text, { dryRun, ts })
      results.files.push({
        file: displayPath(file),
        status: write.status,
        backup: write.backup,
        rules: [...new Set(edits.map((e) => e.rule))],
        editCount: edits.length,
      })
    } catch (e) {
      results.errors.push({ file, rule: list.map((f) => f.rule).join(','), message: e.message })
    }
  }

  // ── 阶段 2：遗留目录迁移（用扫描时生效的迁移表）──
  const legacyFindings = findings.filter((f) => f.rule === 'R-LEGACY')
  results.migrated.push(...migrateLegacyDirs(legacyFindings, { home, dryRun, ts, tables }))

  return results
}

/**
 * composition 对齐（显式确认动作，非 auto-scan）：把某个覆盖内置预设的行集对齐到
 * **当前运行版本的标准模式预设**（baselineForVersion(detectedVersion)）——行级删除漂移行。
 * 缺失标准行仅回传供人工补齐（自动补齐需基线存 id→包名，后续）。
 * @param {{home,sources,findings,detectedVersion}} scanResult
 * @param {{file:string, presetId:string, dryRun?:boolean, ts?:string}} opts
 */
export function runAlign(scanResult, { file, presetId, dryRun = false, ts = defaultTimestamp() } = {}) {
  const out = { dryRun, ts, file: file ? displayPath(file) : undefined, removed: [], missing: [], status: 'noop', backup: undefined, errors: [] }
  const version = scanResult?.detectedVersion
  const baseline = baselineForVersion(version)
  if (!file || !presetId || !baseline) {
    out.errors.push({ message: '对齐需 file+presetId 且运行版本可判基线（<0.1.7-alpha.1 无声明式基线）' })
    return out
  }
  const src = (scanResult.sources || []).find((s) => s.file === file)
  const presetRow = src?.presetRows?.find((r) => r.presetId === presetId)
  if (!src || !presetRow) {
    out.errors.push({ message: `未找到预设声明 ${presetId} @ ${file}` })
    return out
  }
  const plan = planAlignForPreset(src, presetRow, { baseline, allBaselines: loadBaseline() })
  out.removed = plan.removed
  out.missing = plan.missing
  if (plan.edits.length === 0) return out // 无漂移行可删 → noop（仍回报 missing）
  try {
    const newText = spliceEdits(src.text, plan.edits)
    const write = writeFileSafe(file, newText, src.text, { dryRun, ts })
    out.status = write.status
    out.backup = write.backup
  } catch (e) {
    out.errors.push({ message: e.message })
  }
  return out
}

/**
 * 行级三档 toggle（显式确认）：对某预设内一行置为 跟随/开启/关闭。
 *  - mode 'on'  → 去 `disabled`（启用）
 *  - mode 'off' → 置 `disabled: true`（禁用）
 *  - mode 'follow' → 按「当前版本参照预设」默认解析：在默认集→启用，否则→禁用
 *    （参照预设：presetId 命中内置→自身；自定义 id→回退 standard）
 * 行不存在于该预设（如它只在内置 shipped standard、用户无覆盖预设）→ row-not-in-preset。
 * 向后兼容：未传 mode 而传 `disabled`（旧布尔）时按 off/on 映射。
 */
export function runToggle(scanResult, { file, presetId, rowId, mode, disabled, confirm = false, dryRun = false, ts = defaultTimestamp() } = {}) {
  const out = { dryRun, ts, file: file ? displayPath(file) : undefined, presetId, rowId, mode, status: 'noop', backup: undefined, errors: [] }
  if (confirm !== true) {
    out.status = 'rejected'
    out.errors.push({ message: '写盘需显式确认 confirm:true' })
    return out
  }
  const src = (scanResult.sources || []).find((s) => s.file === file)
  const presetRow = src?.presetRows?.find((r) => r.presetId === presetId)
  if (!src || !presetRow || !presetRow.range) {
    out.status = 'not-found'
    out.errors.push({ message: `未找到预设声明 ${presetId} @ ${file}` })
    return out
  }
  const row = (src.rows || []).find(
    (r) => r.id === rowId && r.range && r.range[0] >= presetRow.range[0] && r.range[1] <= presetRow.range[1],
  )
  if (!row?.node) {
    out.status = 'row-not-in-preset'
    out.errors.push({ message: `预设 ${presetId} 内未找到行 ${rowId}（若它只存在于内置 shipped 预设，需先物化覆盖预设）` })
    return out
  }
  // 解析目标 disabled（三档）
  let effMode = mode
  if (effMode === undefined) effMode = disabled === false ? 'on' : 'off' // 旧布尔入参
  out.mode = effMode
  let targetDisabled
  if (effMode === 'on') targetDisabled = false
  else if (effMode === 'off') targetDisabled = true
  else if (effMode === 'follow') {
    const baseline = baselineForVersion(scanResult?.detectedVersion)
    if (!baseline) {
      out.status = 'no-baseline'
      out.errors.push({ message: '跟随需可判基线的运行版本（<0.1.7-alpha.1 无声明式基线）；请改用开/关' })
      return out
    }
    const refPid = baseline.presets?.[presetId] ? presetId : 'standard'
    const defaultOn = new Set(baseline.presets?.[refPid] || []).has(rowId)
    targetDisabled = !defaultOn
    out.defaultOn = defaultOn
  } else {
    out.status = 'bad-mode'
    out.errors.push({ message: `未知档位 ${effMode}（应为 follow|on|off）` })
    return out
  }
  out.disabled = targetDisabled
  const edit = targetDisabled ? makeDisabledEdit(src.text, row.node) : makeEnableEdit(src.text, row.node)
  if (edit == null) {
    out.status = targetDisabled ? 'already-disabled' : 'not-disabled'
    return out
  }
  try {
    const newText = spliceEdits(src.text, [edit])
    const write = writeFileSafe(file, newText, src.text, { dryRun, ts })
    out.status = write.status
    out.backup = write.backup
  } catch (e) {
    out.errors.push({ message: e.message })
  }
  return out
}
