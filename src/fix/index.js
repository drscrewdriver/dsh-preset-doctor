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
import { planAlignForPreset, planAlignForCustomPreset } from './composition-align.js'
import { makeEnableEdit, makeStateEdit, deleteItemEdit } from './row-edit.js'
import { rowUnavailable, rowNoBaseline, rowDeclaredState, rowUnavailableReason, inferRefPid } from '../rules/composition-drift.js'
import { runResolveLegacy } from './resolve-legacy.js'
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
 * composition 对齐（显式确认动作，非 auto-scan）：disable 退避——对「官方停用/已移出/官方空」
 * 与「宿主不提供」的行写 `disabled: true`（连显式强制开也覆写，不给例外）；绝不删行。
 * 护栏：`!!js` 表达式行与基线未收录的官方包行只报不动（回传 guarded）。
 * 内置预设走自身基线参照，自定义 id 预设走 planAlignForCustomPreset（参照官方 standard）。
 * @param {{home,sources,findings,detectedVersion}} scanResult
 * @param {{file:string, presetId:string, dryRun?:boolean, ts?:string, resolvePkg?:Function, hostDisabled?:Set<string>}} opts
 */
export function runAlign(scanResult, { file, presetId, dryRun = false, ts = defaultTimestamp(), resolvePkg, hostDisabled } = {}) {
  const out = { dryRun, ts, file: file ? displayPath(file) : undefined, removed: [], removedHostMissing: [], disabledOfficialOff: [], guarded: [], missing: [], missingRef: '', status: 'noop', backup: undefined, errors: [] }
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
  const alignCtx = {
    baseline, allBaselines: loadBaseline(),
    ...(resolvePkg ? { resolvePkg } : {}),
    ...(hostDisabled instanceof Set ? { hostDisabled } : {}),
  }
  // 路由：presetId 命中内置基线→自身基线对齐；否则→自定义预设对齐（官方行集参照）。
  // 早先此处无条件走 planAlignForPreset，自定义预设 baseRows 为空→直接 return empty，
  // 「对齐」与「已同步当前」双双失真，整行丢掉的官方行无从发现（2026-11-08 修正）。
  const plan = baseline.presets?.[presetId]
    ? planAlignForPreset(src, presetRow, alignCtx)
    : planAlignForCustomPreset(src, presetRow, alignCtx)
  out.removed = plan.removed
  out.removedHostMissing = plan.removedHostMissing ?? []
  out.disabledOfficialOff = plan.disabledOfficialOff ?? []
  out.guarded = plan.guarded ?? []
  out.missing = plan.missing
  out.missingRef = plan.missingRef
  if (plan.edits.length === 0) return out // 无需落盘的行 → noop（仍回报 missing/guarded）
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
 * 行级三档 toggle（显式确认）——三档均用 `disabled` 子键的不同形态作载体（2026-11-08 定案）：
 *  - mode 'follow' → 删除 `disabled` 键（回到解析默认：仅官方 true 行→启用；官方停用/已移出/官方空→停用）
 *  - mode 'on'     → 强制开启：若「跟随即启用」（参照默认集成员且宿主提供）→ 删键；
 *                    否则（官方空/宿主不提供）→ 写显式 `disabled: false`（无键会被解析成停用，光删键开不了）
 *  - mode 'off'    → 强制关闭：写 `disabled: true`
 * 真值表（官方 × 预设，与 classifyComposition 同源）：官方 false 而预设 true → true（保留启用，
 * 不强制关）；官方空 → false（除非显式 disabled:false 强制开）；官方 true → 跟随预设。
 * 行不存在于该预设（如它只在内置 shipped standard、用户无覆盖预设）→ row-not-in-preset。
 * 向后兼容：未传 mode 而传 `disabled`（旧布尔）时：false → follow，true → off。
 */
export function runToggle(scanResult, { file, presetId, rowId, mode, disabled, confirm = false, dryRun = false, ts = defaultTimestamp(), resolvePkg, hostDisabled } = {}) {
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
  let effMode = mode
  if (effMode === undefined) effMode = disabled === false ? 'follow' : 'off' // 旧布尔入参
  out.mode = effMode
  const baseline = baselineForVersion(scanResult?.detectedVersion)
  const allBaselines = loadBaseline()
  const noBaseline = !baseline ? true : rowNoBaseline(row, allBaselines)
  const unavailable = rowUnavailable(row, resolvePkg, hostDisabled)
  const unavailableReason = rowUnavailableReason(row, resolvePkg, hostDisabled)
  // 参照集与 classifyComposition / 对齐完全同式：内置→自身基线；自定义→按行集相似度推断。
  const declaredIds = (src.rows || [])
    .filter((r) => r !== presetRow && r.range && r.id
      && r.range[0] >= presetRow.range[0] && r.range[1] <= presetRow.range[1])
    .map((r) => r.id)
  const refPid = baseline?.presets?.[presetId] ? presetId : inferRefPid(declaredIds, baseline)
  const inRefSet = Boolean(baseline?.presets?.[refPid]?.includes(rowId))
  const followOn = inRefSet && !unavailable // 真值表：仅官方 true 行跟随才启用（与 classify defaultOn 同式）
  out.defaultOn = followOn
  out.inRefSet = inRefSet
  out.refPid = refPid
  out.noBaseline = noBaseline
  out.declared = rowDeclaredState(row)
  if (out.declared === 'dynamic') {
    // `disabled: !!js <expr>` 这类跨平台条件表达式：任何档位写盘都会抹掉它（或造重复键）——全拒。
    out.status = 'dynamic-value'
    out.errors.push({ message: `行 ${rowId} 的 disabled 是条件表达式（!!js），本工具不改写它；要手工置固定值请直接编辑该 patch 文件` })
    return out
  }
  let edit
  if (effMode === 'follow') {
    out.disabled = null
    // 宿主不提供的行：删键等于把行交回宿主加载，而它根本起不来（bundle 禁用/子路径无导出）——
    // 反而会把整条预设弄进 never started，所以 follow 对这类行退避为写 disabled:true。
    if (unavailable) {
      out.unavailableReason = unavailableReason
      edit = makeStateEdit(src.text, row.node, true)
      if (edit == null) { out.status = 'already-disabled'; return out }
    } else {
      edit = makeEnableEdit(src.text, row.node)
      if (edit == null) { out.status = 'already-follow'; return out }
    }
  } else if (effMode === 'on') {
    if (unavailable) {
      // 启用一个根本起不来的行 = 整条预设从可用预设里消失（装机实证）——硬拒，不写盘。
      out.status = 'host-unavailable'
      out.unavailableReason = unavailableReason
      const why = unavailableReason === 'bundle'
        ? '该 id 被已安装 bundle 的顶层覆盖全局 disabled:true（如 agent-team-profile 接管 delegation）'
        : unavailableReason === 'subpath'
          ? '包本体在，但当前宿主版本无此子路径导出（exports 表逐版本变过）'
          : '引用包/本地文件在当前安装不可解析'
      out.errors.push({ message: `不能开启 ${rowId}：${why}。强行启用会让整条预设 never started（从可用预设列表消失），保持停用即可。` })
      return out
    }
    out.disabled = false
    edit = followOn ? makeEnableEdit(src.text, row.node) : makeStateEdit(src.text, row.node, false)
    if (edit == null) { out.status = 'already-enabled'; return out }
  } else if (effMode === 'off') {
    out.disabled = true
    edit = makeStateEdit(src.text, row.node, true)
    if (edit == null) { out.status = 'already-disabled'; return out }
  } else {
    out.status = 'bad-mode'
    out.errors.push({ message: `未知档位 ${effMode}（应为 follow|on|off）` })
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

/**
 * 行级删除（桥 delete 路由）：把某预设内的一条自定义插件声明行整块移除。
 * 与 runToggle 同一安全模型：confirm 硬门 + .bak 备份 + 原子写；仅自定义行可删
 * （该行在当前版本基线里存在 = 内置/官方行，拒绝，防误删官方配置）。
 */
export function runDelete(scanResult, { file, presetId, rowId, confirm = false, dryRun = false, ts = defaultTimestamp() } = {}) {
  const out = { dryRun, ts, file: file ? displayPath(file) : undefined, presetId, rowId, status: 'noop', backup: undefined, errors: [] }
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
    out.errors.push({ message: `预设 ${presetId} 内未找到行 ${rowId}` })
    return out
  }
  // 仅自定义行可删：若该行在当前版本基线（本预设或 standard 参照）里存在，视为内置/官方行，拒绝。
  const baseline = baselineForVersion(scanResult?.detectedVersion)
  if (baseline) {
    const baseRows = new Set([...(baseline.presets?.[presetId] || []), ...(baseline.presets?.standard || [])])
    if (baseRows.has(rowId)) {
      out.status = 'not-custom'
      out.errors.push({ message: `${rowId} 是当前版本内置基线行，仅自定义行可删（防误删官方配置）` })
      return out
    }
  }
  const edit = deleteItemEdit(src.text, row.node)
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

/**
 * 读各层 patch 里 `agent-preset-registry` 的默认选择（`default` / `selectedDefault`），
 * 供删预设护栏：正在被当作默认选中的预设不能直接删（删后新建会话会 not-found）。
 * @param {{sources:Array}} scanResult
 * @returns {Map<string,{file:string,key:string}>} presetId → 出处
 */
export function registryDefaults(scanResult) {
  const out = new Map()
  for (const src of (scanResult?.sources) || []) {
    // 顶层 id 定向覆盖行（overrideRows）里才带着 registry 的 default/selectedDefault；
    // 声明式预设行一并扫上，兼容把 registry 写在 insert 块内的形态。
    const pool = [...(src.overrideRows || []), ...(src.rows || [])]
    for (const row of pool) {
      if (!/dsh-agent-preset-registry$/.test(String(row.name ?? ''))) continue
      let cfg
      try { cfg = row.node?.get?.('config', true) } catch { continue }
      if (!cfg || typeof cfg.get !== 'function') continue
      for (const key of ['selectedDefault', 'default']) {
        const v = cfg.get(key)
        const id = v !== null && typeof v === 'object' && typeof v.get === 'function' ? v.get() : v
        if (typeof id === 'string' && id && !out.has(id)) out.set(id, { file: src.file, key })
      }
    }
  }
  return out
}

/**
 * 预设级删除（桥 delete-preset 路由）：整块移除一条预设声明（含其全部插件子行）。
 * 与行级删除同一安全模型：confirm 硬门 + .bak 备份 + 原子写；区间外字节（注释/!!js）不动。
 * 护栏：被 `agent-preset-registry` 的 default/selectedDefault 指着的预设默认拒删（需 allowDefault:true）。
 * @param {{sources:Array, detectedVersion?:string}} scanResult
 * @param {{file:string, presetId:string, confirm?:boolean, allowDefault?:boolean, dryRun?:boolean, ts?:string}} opts
 */
export function runDeletePreset(scanResult, { file, presetId, confirm = false, allowDefault = false, dryRun = false, ts = defaultTimestamp() } = {}) {
  const out = { dryRun, ts, file: file ? displayPath(file) : undefined, presetId, status: 'noop', backup: undefined, errors: [] }
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
  if (presetRow.node == null) {
    out.status = 'no-node'
    out.errors.push({ message: `预设声明 ${presetId} 缺 AST 节点，无法整块删除` })
    return out
  }
  const defaults = registryDefaults(scanResult)
  if (!allowDefault && defaults.has(presetId)) {
    const at = defaults.get(presetId)
    out.status = 'is-default'
    out.errors.push({ message: `${presetId} 正被 ${at.key} 指着（${at.file}）；先换默认预设再删，或明确传 allowDefault:true` })
    return out
  }
  const edit = deleteItemEdit(src.text, presetRow.node, 'R-DELETE-PRESET')
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
