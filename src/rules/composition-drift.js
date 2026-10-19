import { compareSemver } from '../tables/load.js'

/** 取某预设行 range 范围内全部后代行的 id → 首个行号（preset 自身除外）。 */
function descendantRows(src, preset) {
  const out = new Map()
  if (!preset.range) return out
  const [lo, hi] = preset.range
  for (const row of src.rows) {
    if (row === preset || !row.range || !row.id) continue
    if (row.range[0] >= lo && row.range[1] <= hi && !out.has(row.id)) out.set(row.id, row.line)
  }
  return out
}

/**
 * R-COMPOSITION-DRIFT：用户「覆盖内置预设」的行集 vs 运行版本内置基线。
 *
 * 仅对 presetId ∈ 基线预设（standard/cordis/ptc/minimal）生效——自定义 id 预设无基线，跳过。
 * 分类（均 report 级，交用户裁决 / 一键对齐）：
 *  - introduced：该行在更晚版本才进入本预设标准组合（当前版本标准无、未来版本有）
 *                例：0.2.0 上引用 time-context（0.2.1-alpha.1 才进 standard）
 *  - removed：该行已在更早版本被移出本预设标准组合（过去版本有、当前无）
 *                例：0.2.1 上引用 tool-subagent-codex（0.2.1-alpha.2 已移出）
 *  - 任何版本基线都没有的 id（用户自定义/第三方行）→ 不报（无从判定）
 *
 * @param {Array<{file:string,presetRows:Array,rows:Array}>} sources
 * @param {{baseline?:{version:string,presets:Record<string,string[]>}, allBaselines?:Array, currentVersion?:string}} opts
 */
export function checkCompositionDrift(sources, { baseline, allBaselines, currentVersion } = {}) {
  if (!baseline || !currentVersion || !Array.isArray(allBaselines)) return []
  const shipped = new Set(Object.keys(baseline.presets || {}))
  const findings = []
  for (const src of Array.isArray(sources) ? sources : []) {
    for (const preset of Array.isArray(src.presetRows) ? src.presetRows : []) {
      const pid = preset.presetId
      if (!pid || !shipped.has(pid)) continue
      const baseRows = new Set(baseline.presets[pid] || [])
      for (const [rid, line] of descendantRows(src, preset)) {
        if (baseRows.has(rid)) continue
        const versionsWith = allBaselines
          .filter((s) => Array.isArray(s.presets?.[pid]) && s.presets[pid].includes(rid))
          .map((s) => s.version)
        if (versionsWith.length === 0) continue // 用户自定义/第三方行 → 跳过
        const firstVer = versionsWith[0]
        const lastVer = versionsWith[versionsWith.length - 1]
        const introduced = compareSemver(currentVersion, firstVer) < 0
        const kind = introduced ? 'introduced' : 'removed'
        findings.push({
          rule: 'R-COMPOSITION-DRIFT',
          level: 'report',
          file: src.file,
          line: line ?? preset.line,
          rowId: rid,
          presetId: pid,
          reason: introduced
            ? `预设 ${pid} 引用了「${rid}」，但该行自 ${firstVer} 起才进入内置标准组合；当前宿主 ${currentVersion} 的标准 ${pid} 不含它（跨版本引入）`
            : `预设 ${pid} 引用了「${rid}」，但该行在 ${lastVer} 后已从内置标准组合移除；当前宿主 ${currentVersion} 的标准 ${pid} 不再包含它（版本已移除）`,
          suggestion: '确认是否有意跨版本引用；如需对齐当前版本，用「对齐到当前版本基线」（移除漂移行 / 补齐缺失标准行）',
          data: { presetId: pid, rowId: rid, kind, currentVersion, baselineVersion: baseline.version, firstVer, lastVer },
        })
      }
    }
  }
  return findings
}

/** 某行在某预设里的历史版本（升序），用于 introduced/removed 判定。 */
function versionsWith(allBaselines, pid, rid) {
  return allBaselines.filter((s) => Array.isArray(s.presets?.[pid]) && s.presets[pid].includes(rid)).map((s) => s.version)
}

/**
 * 行分类（供卡面分组标注 + 三档滑块）：对一个用户预设声明，逐行标状态。
 * @returns {{presetId, baselineVersion, rows:[{id,line,disabled,defaultOn,triState,state,driftKind,firstVer,lastVer}], missing:string[]}}
 *   state: 'shipped'（当前基线有）| 'drift'（他版本成员）| 'custom'（任何基线都无）
 *   defaultOn: 该行在「当前版本参照预设」默认组合里（自定义 id 预设→参照 standard；命中内置 id→参照自身）
 *   noBaseline: 该行在**任何版本任何内置预设**都未出现过（基准项逻辑上不存在）——
 *     用户定案（2026-10-19）：逻辑上不存在对应项→默认按关闭解析（defaultOn=false），
 *     UI 诚实标「无基准·默认停用」；兜底失效手段保留：置 disabled / 手工改名失效。
 *   triState: 三档派生态 'follow'（状态==默认）| 'on'（强制开，默认本关）| 'off'（强制关，默认本开）
 */
export function classifyComposition(src, presetRow, { baseline, allBaselines, currentVersion } = {}) {
  const pid = presetRow.presetId
  const baseRows = new Set(baseline?.presets?.[pid] || [])
  const union = new Set((allBaselines || []).flatMap((s) => s.presets?.[pid] || []))
  // 全局基准项存在性：跨全部快照、全部内置预设的并集（区别于上面按 pid 的 union）
  const anyBaselineUnion = new Set(
    (allBaselines || []).flatMap((s) => Object.values(s.presets ?? {}).flatMap((v) => (Array.isArray(v) ? v : []))),
  )
  // 三档「跟随」的默认值参照：命中内置预设→用自身基线；自定义 id→回退 standard。
  const refPid = baseline?.presets?.[pid] ? pid : 'standard'
  const defaultSet = new Set(baseline?.presets?.[refPid] || [])
  const rows = []
  // 无基线（自定义 id 预设）也照常列行：行级 toggle 不依赖基线；仅漂移/缺失判定需基线。
  if (!pid) return { presetId: pid, baselineVersion: baseline?.version ?? '', rows, missing: [] }
  for (const row of src.rows) {
    if (row === presetRow || !row.range || !row.id) continue
    if (!(row.range[0] >= presetRow.range[0] && row.range[1] <= presetRow.range[1])) continue
    if (row.id === `preset-${pid}`) continue
    const vw = versionsWith(allBaselines, pid, row.id)
    let state = 'custom'
    let driftKind = null
    let firstVer
    let lastVer
    if (baseRows.has(row.id)) state = 'shipped'
    else if (vw.length) {
      state = 'drift'
      firstVer = vw[0]
      lastVer = vw[vw.length - 1]
      driftKind = currentVersion && compareSemver(currentVersion, firstVer) < 0 ? 'introduced' : 'removed'
    }
    let disabled = false
    try {
      const d = row.node && typeof row.node.get === 'function' ? row.node.get('disabled') : undefined
      disabled = d === true || d === 'true'
    } catch { /* 保守：读不到当未禁用 */ }
    const defaultOn = defaultSet.has(row.id)
    const noBaseline = !anyBaselineUnion.has(row.id)
    const enabled = !disabled
    const triState = enabled === defaultOn ? 'follow' : (enabled ? 'on' : 'off')
    rows.push({ id: row.id, line: row.line, disabled, defaultOn, noBaseline, triState, state, driftKind, firstVer, lastVer })
  }
  const userSet = new Set(rows.map((r) => r.id))
  const missing = [...baseRows].filter((id) => id !== `preset-${pid}` && !userSet.has(id))
  return { presetId: pid, baselineVersion: baseline?.version ?? '', rows, missing, union: [...union] }
}
