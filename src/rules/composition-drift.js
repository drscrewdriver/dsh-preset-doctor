import { compareSemver, componentNameOf, componentFor } from '../tables/load.js'
import { isLocalPath } from '../pkg-resolve.js'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 当前运行平台（用于求值 `!!js process.platform …` 表达式）。 */
const CURRENT_PLATFORM = globalThis.process?.platform ?? ''

/** cordis: 前缀是内建虚拟行——不做存在性判定；相对路径仅目录时代合法语义，不判。 */
function isVirtualOrRelative(name) {
  return typeof name !== 'string' || name === '' || /^cordis:/.test(name) || isLocalPath(name)
}

/** 绝对 file:// 声明的存在性：宿主加载器按 URL 取文件，不存在同样 never started。 */
function localFileMissing(name) {
  if (!/^file:/i.test(name)) return false
  try {
    return !fs.existsSync(fileURLToPath(name))
  } catch {
    return false // URL 解析不了：保守不判（交给 R-PKG-MISSING 报告层处置）
  }
}

/**
 * 行引用包/本地文件在当前安装是否可解析。判据与 R-PKG-MISSING 同源，但**传完整 name**：
 * 带子路径的行（`@scope/pkg/list-agents`）要连该导出一起判——包体在而子路径不存在（版本差异）
 * 同样 never started。未注入 resolver → 仅本地文件可判，包保守视为存在（旧行为）。
 */
export function rowPkgMissing(row, resolvePkg) {
  if (isVirtualOrRelative(row.name)) return false
  if (/^file:/i.test(row.name)) return localFileMissing(row.name) // 本地声明：只判存在性，不走 npm 解析
  if (typeof resolvePkg !== 'function') return false
  return !resolvePkg(row.name, {}).ok
}

/**
 * 不可用的具体成因（给 UI/拒绝文案用）：'subpath' | 'pkg' | 'bundle' | null。
 * 子路径不存在与包不存在都算「宿主不提供」，但文案必须区分：前者要告知“该版本无此导出”。
 */
export function rowUnavailableReason(row, resolvePkg, hostDisabled) {
  if (row.id && hostDisabled instanceof Set && hostDisabled.has(row.id)) return 'bundle'
  if (isVirtualOrRelative(row.name)) return null
  if (/^file:/i.test(row.name)) return localFileMissing(row.name) ? 'pkg' : null
  if (typeof resolvePkg !== 'function') return null
  let res
  try { res = resolvePkg(row.name, {}) } catch { return null }
  if (res?.ok) return null
  return res?.subpathMissing ? 'subpath' : 'pkg'
}

/**
 * 行在当前安装是否「不可用」：包/本地文件不可解析，或行 id 被 profile bundle 层
 * 定向禁用（2026-11-06 桌面实证：agent-team-profile 把 tool-subagent-control /
 * list-agents 等行 disabled:true——包在宿主 asar 里可解析，但 bundle 禁用后
 * 同样 never started，单靠可解析性判据在 desktop 形态不触发）。
 */
export function rowUnavailable(row, resolvePkg, hostDisabled) {
  if (row.id && hostDisabled instanceof Set && hostDisabled.has(row.id)) return true
  return rowPkgMissing(row, resolvePkg)
}

/** 盘面三态载体：'absent'（无 disabled 键=跟随）| 'false'（强制开）| 'true'（强制关）
 *  | 'dynamic'（值为 `!!js` 表达式等非布尔量，如 `disabled: !!js process.platform !== 'win32'`）。
 *  dynamic 必须单独成一态：它既不是“未声明”也不能被覆写（写第二个 disabled 键=非法 YAML，
 *  改写表达式则抹掉跨平台条件）。读不到当 absent。 */
export function rowDeclaredState(row) {
  try {
    const d = row?.node && typeof row.node.get === 'function' ? row.node.get('disabled') : undefined
    if (d === true || d === 'true') return 'true'
    if (d === false || d === 'false') return 'false'
    if (d === undefined || d === null) return 'absent'
    if (typeof d === 'boolean') return d ? 'true' : 'false'
    return 'dynamic' // 字符串/对象等非布尔值：!!js 表达式或引用，不当作声明态
  } catch {
    return 'absent'
  }
}

/**
 * 有限求值 `disabled: !!js process.platform === 'win32'` 这类平台表达式。
 * 只认单一平台比较这一种形态（宿主预设里的事实用法），其余一律返回 null（不猜）。
 * @returns {boolean|null} 该行在给定平台下是否被禁用；null = 求不出
 */
export function evalPlatformDisabled(value, platform = CURRENT_PLATFORM) {
  if (typeof value !== 'string') return null
  const m = /^\s*process\.platform\s*(===|!==|==|!=)\s*['"]([a-z0-9]+)['"]\s*$/.exec(value)
  if (!m || !platform) return null
  const eq = m[1] === '===' || m[1] === '=='
  return eq ? platform === m[2] : platform !== m[2]
}

/** 真·自定义行：name 不属官方命名空间（@deepseek-ai/）也不是 cordis: 虚拟容器行。 */
export function rowIsThirdParty(row) {
  const n = row?.name
  if (typeof n !== 'string' || n === '') return true
  if (n.startsWith('@deepseek-ai/')) return false
  if (n.startsWith('cordis:')) return false
  return true
}

/**
 * 自定义 id 预设的参照预设推断：主指标 = **覆盖率**（该预设有多少行能被这个官方预设解释），
 * 并列时比共有行数，再并列则优先 standard（它是宿主默认预设）。
 * 真值表把「不在参照默认集」的行一律退避停用，参照选错会直接关掉整条预设的能力行
 * （如从 minimal 迁移出的极简预设会被 standard 参照关掉 shell）——所以不能写死 standard。
 * 也不用纯 Jaccard：它奖励小集，只声明两三行的子集会误中 minimal。
 * @param {Iterable<string>} declaredIds 该预设声明的行 id
 * @param {{presets:Record<string,string[]>}} baseline 当前版本基线快照
 * @returns {string} 参照预设 id
 */
export function inferRefPid(declaredIds, baseline) {
  const mine = [...new Set([...(declaredIds || [])].filter((x) => typeof x === 'string' && x && !x.startsWith('preset-')))]
  if (mine.length === 0) return 'standard'
  const scored = []
  for (const [pid, ids] of Object.entries(baseline?.presets ?? {})) {
    const theirs = new Set((ids || []).filter((x) => !String(x).startsWith('preset-')))
    if (theirs.size === 0) continue
    let shared = 0
    for (const id of mine) if (theirs.has(id)) shared++
    scored.push({ pid, coverage: shared / mine.length, shared })
  }
  // 排序：覆盖率↓ → 共有行数↓ → 并列时优先 standard（宿主默认预设，不靠遍历顺序）
  scored.sort((a, b) => b.coverage - a.coverage || b.shared - a.shared
    || (a.pid === 'standard' ? -1 : 1) - (b.pid === 'standard' ? -1 : 1))
  const top = scored[0]
  return !top || top.coverage === 0 ? 'standard' : top.pid
}

/** 基线并集（全快照 × 全内置预设 × 全行 id）。 */
function baselineIdUnion(allBaselines) {
  return new Set(
    (allBaselines || []).flatMap((s) => Object.values(s.presets ?? {}).flatMap((v) => (Array.isArray(v) ? v : []))),
  )
}

/**
 * 该行是否「官方空」（真值表里→停用那一档）：id 未在任何版本任何内置预设出现过，
 * 且 name 也不是官方包/虚拟行——@deepseek-ai/dsh-fs-local 这类只是基线表（从 0.1.7 起）
 * 未收录的官方包不得误判为官方空，否则对齐会关掉 simple-reply 的核心工具。
 */
export function rowNoBaseline(row, allBaselines) {
  if (row?.id && baselineIdUnion(allBaselines).has(row.id)) return false
  return rowIsThirdParty(row)
}

/** 官方包/虚拟行但基线表未收录其 id：只报不关（区别于「官方空」）。 */
export function rowBaselineUncovered(row, allBaselines) {
  if (row?.id && baselineIdUnion(allBaselines).has(row.id)) return false
  return !rowIsThirdParty(row)
}

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

/** 某行作为「任一内置预设成员」出现过的历史版本（升序）——自定义 id 预设无自身基线，只能按官方行集整体判漂移。 */
function versionsAcrossAnyPreset(allBaselines, rid) {
  return (allBaselines || [])
    .filter((s) => Object.values(s.presets ?? {}).some((v) => Array.isArray(v) && v.includes(rid)))
    .map((s) => s.version)
}

/**
 * 行分类（供卡面分组标注 + 三档滑块）：对一个用户预设声明，逐行标状态。
 * @returns {{presetId, baselineVersion, rows:[{id,line,disabled,defaultOn,triState,state,driftKind,firstVer,lastVer}], missing:string[]}}
 *   state: 'shipped'（当前基线有）| 'drift'（他版本成员）| 'custom'（任何基线都无）
 *   自定义 id 预设（无自身基线）同样判 drift：参照改为「当前快照全部内置预设成员并集」
 *   ——曾是官方行、当前版本已彻底不活 → drift(removed)；仅更晚版本才活 → drift(introduced)。
 *   defaultOn: 「跟随」档的解析默认值——仅官方 true（在参照默认集）且可用→启用；
 *     官方停用（含已移出）、官方空、宿主不提供→停用（2026-11-08 定案修订）。
 *     参照集：内置预设→自身基线；自定义 id→`inferRefPid` 按行集相似度推断的官方预设。
 *   effective: 显式 `disabled:false` → 开；`disabled:true` → 关；无键（跟随）→ defaultOn；
 *     宿主不提供恒关；dynamic 则照平台表达式求值（求不出给 null）。
 *   declared: 盘面三态 'absent'（无 disabled 键=跟随）| 'false'（强制开）| 'true'（强制关）| 'dynamic'（!!js 表达式）
 *   dynamicValue: declared==='dynamic' 的便捷位；此时任何写盘一律拒绝。
 *   dynamicResolved / platformDisabled: `!!js process.platform === 'win32'` 这类单一平台比较
 *     可静态求出（按当前平台）→ effective 照它给值；求不出则 effective=null（不猜）。
 *   missing: 参照预设里有、本预设声明里没有的行——自定义 id 预设同样报（早先只按自身空基线算，
 *     恒为空，导致官方行整行丢失却显示「已同步当前」的盲区，2026-11-08 修正）
 *   missingRef: 缺失判定所参照的预设 id（内置→自身；自定义→standard）
 *   noBaseline: 该行在**任何版本任何内置预设**都未出现过（基准项逻辑上不存在）——
 *     用户定案（2026-10-19）：逻辑上不存在对应项→默认按关闭解析（defaultOn=false），
 *     UI 诚实标「无基准·默认停用」；兜底失效手段保留：置 disabled / 手工改名失效。
 *   triState: 三档派生态 'follow'（状态==默认）| 'on'（强制开，默认本关）| 'off'（强制关，默认本开）
 *   pkgMissing: 行引用包不可解析或本地文件不存在；hostDisabled: 行 id 被 profile
 *     bundle 层定向禁用（两者合称「宿主不提供」unavailable）。2026-11-06 定案：
 *     （defaultOn=false，UI 不再显示「基准·启用」误导）；triState 诚实派生：
 *     未显式关→'off'（强制关，因为默认本关且盘面未关≠它真能活），
 *     已显式关→'follow'（与停用默认一致）。依据：宿主 agent-preset/invalid
 *     … never started 实证——行装载失败即整条预设失败，声明在基线里≠跑得起来。
 */
export function classifyComposition(src, presetRow, { baseline, allBaselines, currentVersion, resolvePkg, hostDisabled } = {}) {
  const pid = presetRow.presetId
  const baseRows = new Set(baseline?.presets?.[pid] || [])
  const isBuiltin = baseRows.size > 0
  const union = new Set((allBaselines || []).flatMap((s) => s.presets?.[pid] || []))
  // 全局基准项存在性：跨全部快照、全部内置预设的并集（区别于上面按 pid 的 union）
  const anyBaselineUnion = new Set(
    (allBaselines || []).flatMap((s) => Object.values(s.presets ?? {}).flatMap((v) => (Array.isArray(v) ? v : []))),
  )
  // 三档「跟随」与缺失判定的参照预设：命中内置预设→用自身基线；自定义 id→按行集相似度推断
  // （写死 standard 会把从 minimal/ptc 迁移出的预设的能力行误判为“官方停用”而退避停用）。
  const refPid = isBuiltin ? pid : inferRefPid(src.rows
    .filter((r) => r !== presetRow && r.range && r.id
      && r.range[0] >= presetRow.range[0] && r.range[1] <= presetRow.range[1])
    .map((r) => r.id), baseline)
  const defaultSet = new Set(baseline?.presets?.[refPid] || []) // 参照默认集：官方 true 的唯一依据
  // 自定义 id 预设的「活的官方行」参照：当前快照全部内置预设成员并集。
  const currentOfficial = new Set(
    Object.values(baseline?.presets ?? {}).flatMap((v) => (Array.isArray(v) ? v : [])),
  )
  const rows = []
  // 无基线（自定义 id 预设）也照常列行：行级 toggle 不依赖基线；仅漂移/缺失判定需基线。
  if (!pid) return { presetId: pid, baselineVersion: baseline?.version ?? '', rows, missing: [], missingRef: refPid }
  for (const row of src.rows) {
    if (row === presetRow || !row.range || !row.id) continue
    if (!(row.range[0] >= presetRow.range[0] && row.range[1] <= presetRow.range[1])) continue
    if (row.id === `preset-${pid}`) continue
    const vw = isBuiltin ? versionsWith(allBaselines, pid, row.id) : versionsAcrossAnyPreset(allBaselines, row.id)
    let state = 'custom'
    let driftKind = null
    let firstVer
    let lastVer
    if (baseRows.has(row.id)) state = 'shipped'
    else if (isBuiltin && vw.length) {
      state = 'drift'
      firstVer = vw[0]
      lastVer = vw[vw.length - 1]
      driftKind = currentVersion && compareSemver(currentVersion, firstVer) < 0 ? 'introduced' : 'removed'
    } else if (!isBuiltin && vw.length && !currentOfficial.has(row.id)) {
      // 自定义预设：曾是官方行（任一内置预设、任一版本）而当前版本已彻底不活 → 漂移
      state = 'drift'
      firstVer = vw[0]
      lastVer = vw[vw.length - 1]
      driftKind = currentVersion && compareSemver(currentVersion, firstVer) < 0 ? 'introduced' : 'removed'
    }
    let disabled = false
    let declared = 'absent'
    let rawDisabled
    try {
      const d = row.node && typeof row.node.get === 'function' ? row.node.get('disabled') : undefined
      rawDisabled = d
      if (d === true || d === 'true') { disabled = true; declared = 'true' }
      else if (d === false || d === 'false') { declared = 'false' }
      else if (d !== undefined && d !== null) { declared = 'dynamic' } // !!js 表达式等非布尔值
    } catch { /* 保守：读不到当无键（跟随） */ }
    // 平台表达式能求出的就求（如 win32 下 tool-bash 实为禁用），求不出给 null，绝不猜。
    const platformDisabled = declared === 'dynamic' ? evalPlatformDisabled(rawDisabled) : null
    const dynamicResolved = platformDisabled !== null
    const pkgMissing = rowPkgMissing(row, resolvePkg)
    const hostRowDisabled = row.id && hostDisabled instanceof Set && hostDisabled.has(row.id) ? true : false
    const unavailable = pkgMissing || hostRowDisabled
    const noBaseline = !anyBaselineUnion.has(row.id) && rowIsThirdParty(row)
    const baselineUncovered = !anyBaselineUnion.has(row.id) && !rowIsThirdParty(row)
    const inRefSet = defaultSet.has(row.id)
    const dynamicValue = declared === 'dynamic'
    // 真值表（2026-11-08 定案修订）：解析默认值只看「官方 true」（在参照默认集）——
    // 官方停用（含已移出）与官方空一律 false；无值（无 disabled 键）跟此默认。
    const defaultOn = inRefSet && !unavailable
    const effective = unavailable
      ? false
      : dynamicValue ? (dynamicResolved ? !platformDisabled : null)
        : declared === 'true' ? false
          : declared === 'false' ? true
            : defaultOn
    // 宿主不提供的行：盘面无 disabled 标记时「跟随」并不能让它活——诚实标 'off'；
    // 已显式关的行反而与（按停用解析的）默认一致 → follow。dynamic 恒归 follow（不可写）。
    const triState = unavailable
      ? (disabled ? 'follow' : 'off')
      : dynamicValue ? 'follow'
        : effective === defaultOn ? 'follow' : (effective ? 'on' : 'off')
    // 对齐处置（disable 退避，2026-11-08 定案）：官方停用/已移出/官方空 与 宿主不提供，
    // 一律退避为 disabled:true——连显式强制开（disabled:false）也覆写（用户选定：不给强制开例外）；
    // 已关的行无改动，`!!js` 表达式行绝不改写，基线未收录的旧官方工具不动（护栏）。
    const alignable = !dynamicValue && declared !== 'true'
      && (unavailable || (!inRefSet && !baselineUncovered))
    const pkgName = row.name || componentNameOf(row.id) || ''
    rows.push({ id: row.id, line: row.line, name: pkgName, cat: componentFor(row.id)?.cat ?? '', disabled, declared, dynamicValue, dynamicResolved, platformDisabled, platform: dynamicResolved ? CURRENT_PLATFORM : '', defaultOn, effective, inRefSet, noBaseline, baselineUncovered, pkgMissing, hostDisabled: hostRowDisabled, unavailable, alignable, triState, state, driftKind, firstVer, lastVer })
  }
  const userSet = new Set(rows.map((r) => r.id))
  // 缺失判定按参照预设（内置→自身基线；自定义→standard）：早先只用 baseRows，
  // 自定义 id 预设 baseRows 为空 → missing 恒空，官方行丢失也报「已同步当前」。
  const missing = [...defaultSet].filter((id) => id !== `preset-${refPid}` && id !== `preset-${pid}` && !userSet.has(id))
  // 缺行的包名（组件地图）：运行时只能知基线里的 id，地图补上「这个 id 该写哪个包」，
  // 供 UI 提示与将来自动补齐用；未知 id（自定义行）→ name 为空。
  const missingNames = missing.map((id) => ({ id, name: componentNameOf(id) ?? '', cat: componentFor(id)?.cat ?? '' }))
  return { presetId: pid, baselineVersion: baseline?.version ?? '', rows, missing, missingNames, missingRef: refPid, union: [...union] }
}
