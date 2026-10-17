/**
 * dsh-preset-doctor — composition 对齐规划（B：行级删除漂移行）。
 *
 * 参考 = 当前运行版本的「标准模式」预设组合（baselineForVersion(currentVersion).presets[presetId]）。
 * 仅处理覆盖内置预设（standard/cordis/ptc/minimal）的用户声明；自定义 id 预设无基线，跳过。
 *
 * 处置：
 *  - 删除「漂移行」：用户有、当前基线无、但曾/将于其它版本基线出现的标准成员行（introduced/removed）。
 *  - 保留「用户自定义行」：任何版本基线都没有的 id（无从判定，绝不删）。
 *  - 「缺失标准行」：当前基线有、用户无 —— 仅**报告**（自动补齐需基线存 id→包名映射，列为后续）。
 *
 * 行级删除经 row-edit.deleteItemEdit，区间外字节（注释/!!js/缩进）不动；嵌套去重防重叠。
 */
import { deleteItemEdit } from './row-edit.js'

/** row 是否落在 preset 行范围内（含自身排除由调用方处理）。 */
function within(row, preset) {
  return row.range && preset.range && row.range[0] >= preset.range[0] && row.range[1] <= preset.range[1]
}

/** 丢弃被另一编辑完全包含的嵌套编辑（只删最外层，防 spliceEdits 重叠抛错）。 */
function dedupNested(edits) {
  return edits.filter(
    (e) => !edits.some((o) => o !== e && o.start <= e.start && e.end <= o.end && (o.start < e.start || e.end < o.end)),
  )
}

/**
 * 计算某覆盖预设的对齐编辑与统计。
 * @param {{text:string,presetRows:Array,rows:Array}} src
 * @param {{presetId:string,range:[number,number]}} presetRow
 * @param {{baseline:{version:string,presets:Record<string,string[]>}, allBaselines:Array}} ctx
 * @returns {{edits:Array, removed:string[], missing:string[], baselineVersion:string}}
 */
export function planAlignForPreset(src, presetRow, { baseline, allBaselines } = {}) {
  const pid = presetRow.presetId
  const empty = { edits: [], removed: [], missing: [], baselineVersion: baseline?.version ?? '' }
  if (!pid || !baseline || !Array.isArray(allBaselines)) return empty
  const baseRows = new Set(baseline.presets?.[pid] || [])
  if (baseRows.size === 0) return empty // 该预设无基线（非内置）→ 不动
  const union = new Set(allBaselines.flatMap((s) => s.presets?.[pid] || []))

  const userRows = src.rows.filter((r) => r !== presetRow && within(r, presetRow) && r.id)
  const userSet = new Set(userRows.map((r) => r.id))

  const rawEdits = []
  const removed = []
  for (const row of userRows) {
    if (baseRows.has(row.id)) continue // 当前基线有 → 保留
    if (!union.has(row.id)) continue // 任何基线都没有 → 用户自定义，保留
    rawEdits.push(deleteItemEdit(src.text, row))
    removed.push(row.id)
  }

  const wrapper = `preset-${pid}`
  const missing = [...baseRows].filter((id) => !userSet.has(id) && id !== wrapper)

  return { edits: dedupNested(rawEdits), removed, missing, baselineVersion: baseline.version }
}
