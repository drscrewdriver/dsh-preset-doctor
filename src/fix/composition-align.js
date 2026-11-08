/**
 * dsh-preset-doctor — composition 对齐规划（disable 退避版：只写 disabled，绝不删行）。
 *
 * 真值表（2026-11-08 定案修订）：解析默认值只看「官方 true」（id 在参照默认集里）——
 *  官方 true            → 跟随预设声明（无 disabled 键即启用；显式 disabled:true 即停用）
 *  官方停用 / 已移出     → false，对齐退避为 disabled:true
 *  官方空（无此 id 基准） → false，同上
 *  宿主不提供（包死/bundle 禁用）→ false，同上（安全档优先）
 * 一律退避，**不给强制开例外**：连 `disabled: false` 也覆写为 true（用户选定）。
 *
 * 三条不动的护栏：
 *  - `!!js` 条件表达式行（如 `disabled: !!js process.platform === 'win32'`）绝不改写；
 *  - 已显式 disabled:true 的行无改动（保持二次 noop 幂等）；
 *  - id 未见于任何基线、但 name 属官方包/虚拟行（baselineUncovered，如 fs-local）→ 只报不动，
 *    否则会把基线表（从 0.1.7 起）未收录的旧官方工具关掉。
 *
 * 参照集：内置预设→自身基线；自定义 id 预设→`inferRefPid` 按行集相似度推断的官方预设
 * （写死 standard 会把从 minimal/ptc 迁移出的预设的能力行误当“官方停用”一律退避掉）。写盘一律走 makeStateEdit。
 */
import { makeStateEdit } from './row-edit.js'
import { rowUnavailable, rowDeclaredState, rowIsThirdParty, inferRefPid } from '../rules/composition-drift.js'

/** row 是否落在 preset 行范围内（含自身排除由调用方处理）。 */
function within(row, preset) {
  return row.range && preset.range && row.range[0] >= preset.range[0] && row.range[1] <= preset.range[1]
}

/** id 是否在任何版本、任何内置预设的基线里出现过。 */
function seenInAnyBaseline(allBaselines, id) {
  if (!id) return false
  return (allBaselines || []).some((s) => Object.values(s.presets ?? {}).some((v) => Array.isArray(v) && v.includes(id)))
}

/**
 * disable 退避处置：该行是否需要落盘写 disabled: true（与 classifyComposition 的 alignable 同式）。
 * @param {object} row 声明行
 * @param {{refRows?:Set<string>, allBaselines?:Array, resolvePkg?:Function, hostDisabled?:Set<string>}} ctx
 *   refRows = 参照默认集（内置→自身基线；自定义→官方 standard）
 * @returns {null|'unavailable'|'official-off'|'guarded-dynamic'|'guarded-uncovered'} 理由；null = 官方 true 行，不动
 */
export function rowOffDisposition(row, { refRows, allBaselines, resolvePkg, hostDisabled } = {}) {
  const declared = rowDeclaredState(row)
  if (declared === 'dynamic') return 'guarded-dynamic'
  if (declared === 'true') return null // 已停用，无改动
  if (rowUnavailable(row, resolvePkg, hostDisabled)) return 'unavailable'
  const inRef = refRows instanceof Set ? refRows.has(row.id) : false
  if (inRef) return null // 官方 true → 跟随预设声明
  // 官方停用/已移出/官方空：退避为 disabled:true；基线未收录的官方包/虚拟行由护栏挡住
  if (!seenInAnyBaseline(allBaselines, row.id) && !rowIsThirdParty(row)) return 'guarded-uncovered'
  return 'official-off'
}

/**
 * 停用一行的编辑：取 AST 节点写 disabled: true。
 * @returns 编辑 | null（已停用，或拿不到节点时保守不动）
 */
function offEditFor(text, row) {
  const node = row?.node ?? row
  return makeStateEdit(text, node, true)
}

/** 丢弃被另一编辑完全包含的嵌套编辑（防 spliceEdits 重叠抛错）。 */
function dedupNested(edits) {
  return edits.filter(
    (e) => !edits.some((o) => o !== e && o.start <= e.start && e.end <= o.end && (o.start < e.start || e.end < o.end)),
  )
}

/** 统计分桶容器：removed=本次新落盘；removedHostMissing/disabledOfficialOff=理由细分；guarded=护栏不动。 */
function buckets(baselineVersion, missingRef) {
  return {
    edits: [], removed: [], removedHostMissing: [], disabledOfficialOff: [],
    guarded: [], missing: [], missingRef, baselineVersion,
  }
}

/** 逐行落盘：把 disposition 结果计入桶并生成编辑。 */
function collect(src, rows, ctx, out) {
  for (const row of rows) {
    const why = rowOffDisposition(row, ctx)
    if (why === null || why === 'guarded-dynamic' || why === 'guarded-uncovered') {
      if (why) out.guarded.push(row.id)
      continue
    }
    const edit = offEditFor(src.text, row)
    if (!edit) continue // 已处停用态：无实际改动（二次 noop 幂等靠此）
    out.edits.push(edit)
    out.removed.push(row.id)
    if (why === 'unavailable') out.removedHostMissing.push(row.id)
    else out.disabledOfficialOff.push(row.id)
  }
}

/**
 * 覆盖内置预设（standard/cordis/ptc/minimal）的对齐规划。
 * @param {{text:string,presetRows:Array,rows:Array}} src
 * @param {{presetId:string,range:[number,number]}} presetRow
 * @param {{baseline:{version:string,presets:Record<string,string[]>}, allBaselines:Array, resolvePkg?:Function, hostDisabled?:Set<string>}} ctx
 */
export function planAlignForPreset(src, presetRow, { baseline, allBaselines, resolvePkg, hostDisabled } = {}) {
  const pid = presetRow.presetId
  const out = buckets(baseline?.version ?? '', pid ?? '')
  if (!pid || !baseline || !Array.isArray(allBaselines)) return out
  const baseRows = new Set(baseline.presets?.[pid] || [])
  if (baseRows.size === 0) return out // 非内置 id → 走 planAlignForCustomPreset
  const userRows = src.rows.filter((r) => r !== presetRow && within(r, presetRow) && r.id)
  collect(src, userRows, { refRows: baseRows, allBaselines, resolvePkg, hostDisabled }, out)
  const wrapper = `preset-${pid}`
  const userSet = new Set(userRows.map((r) => r.id))
  out.missing = [...baseRows].filter((id) => !userSet.has(id) && id !== wrapper)
  out.edits = dedupNested(out.edits)
  return out
}

/**
 * 自定义 id 预设的对齐规划：参照集由 `inferRefPid` 推断（而不是写死 standard）；
 * 处置与内置预设同走 disable 退避；missing 以推断出的参照预设为报。同样只报不补。
 */
export function planAlignForCustomPreset(src, presetRow, { baseline, allBaselines, resolvePkg, hostDisabled } = {}) {
  const pid = presetRow.presetId
  const ids = src.rows.filter((r) => r !== presetRow && within(r, presetRow) && r.id).map((r) => r.id)
  const refPid = inferRefPid(ids, baseline)
  const out = buckets(baseline?.version ?? '', refPid)
  if (!pid || !baseline || !Array.isArray(allBaselines)) return out
  const refRows = new Set(baseline.presets?.[refPid] || [])
  const wrapper = `preset-${pid}`
  const userRows = src.rows.filter((r) => r !== presetRow && within(r, presetRow) && r.id && r.id !== wrapper)
  collect(src, userRows, { refRows, allBaselines, resolvePkg, hostDisabled }, out)
  const userSet = new Set(userRows.map((r) => r.id))
  out.missing = [...refRows].filter((id) => id !== `preset-${refPid}` && id !== wrapper && !userSet.has(id))
  out.edits = dedupNested(out.edits)
  return out
}
