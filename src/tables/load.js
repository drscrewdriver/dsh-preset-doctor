/**
 * dsh-preset-manager — 迁移表：追加式变更日志 + 链式收敛。
 *
 * 架构回应「每个分支的版本终点都不一样」：
 * - 表不存「版本对」，存「某版本起旧令牌失效」的**事件**（brokenIn + from/to）。
 *   新 DSH 版本改模板 → 只在 changes 末尾**追加**条目，历史条目永不改写，
 *   因此任意时代写的预设（任意起点分支）都用同一张表收敛到当前安装。
 * - 扫描时做**链式收敛**：A→B、B→C 两条事件使 A 直接解析为 C（fixpoint），
 *   不需要逐版本链式复合，也不存在 N×N 版本对表。
 * - 触发门禁相对**运行实例**（见 rules/pkg.js）：旧名在当前安装已死且新名存在
 *   才自动修——同一张表对老安装不误伤。
 *
 * 用户自救：`$DSH_HOME/preset-manager/tables.user.json` 与内置表同 schema，
 * 合并时用户条目按 from 键覆盖内置（不等插件发版即可响应新的模板变化）。
 */
import fs from 'node:fs'
import path from 'node:path'
import builtin from './changes.json' with { type: 'json' }
import branchesBuiltin from './branches.json' with { type: 'json' }

export const BUILTIN_CHANGES = builtin
export const BUILTIN_BRANCHES = branchesBuiltin.branches

/** 用户覆盖表位置。 */
export function userTablePath(home) {
  return path.join(home, 'preset-manager', 'tables.user.json')
}

/** 读用户覆盖表（缺失/损坏 → 空表 + 警告）。 */
export function readUserChanges(home, warn = () => {}) {
  const file = userTablePath(home)
  if (!fs.existsSync(file)) return { changes: [] }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!Array.isArray(parsed.changes)) throw new Error('缺少 changes 数组')
    return parsed
  } catch (e) {
    warn(`用户迁移表解析失败，已忽略: ${file}（${e.message}）`)
    return { changes: [] }
  }
}

/** 合并：用户条目在前（同名 from 覆盖内置）。 */
export function mergeChanges(builtinChanges, userChanges) {
  const keyOf = (c) => (c.kind === 'config-key-rename' ? `${c.kind}:${c.package}:${(c.from ?? []).join(',')}` : `${c.kind}:${c.from}`)
  const userKeys = new Set((userChanges ?? []).map(keyOf))
  return [...(userChanges ?? []), ...builtinChanges.filter((c) => !userKeys.has(keyOf(c)))].filter(
    (c, i, all) => all.findIndex((x) => keyOf(x) === keyOf(c)) === i,
  )
}

/**
 * 链式收敛包名改名为后继映射：A→B、B→C ⇒ A→C。
 * 同时收集链上最早的 brokenIn（供「起点时代判定」报告）。
 * 环检测：发现环时丢弃环边并记警告（避免死循环）。
 */
export function resolveRenameChain(changes, warn = () => {}) {
  const succ = new Map()
  const brokenAt = new Map()
  const originFlags = new Map()
  for (const c of changes) {
    if (c.kind !== 'package-rename' || !c.from || !c.to) continue
    if (succ.has(c.from) && succ.get(c.from) !== c.to) {
      warn(`包名改名冲突：${c.from} 同时映射到 ${succ.get(c.from)} 与 ${c.to}，保留后者`)
    }
    succ.set(c.from, c.to)
    brokenAt.set(c.from, c.brokenIn ?? '')
    originFlags.set(c.from, c.renameRowId !== false)
  }
  // fixpoint 解析 + 环检测
  const resolved = new Map()
  for (const from of succ.keys()) {
    const seen = new Set([from])
    let cur = from
    let era = brokenAt.get(from) ?? ''
    while (succ.has(cur)) {
      cur = succ.get(cur)
      if (seen.has(cur)) {
        warn(`包名改名链成环：${from} → ${cur}，丢弃环上后继边`)
        break
      }
      seen.add(cur)
      const b = brokenAt.get(cur) ?? ''
      if (b && (!era || compareSemver(b, era) < 0)) era = b
    }
    if (cur !== from) resolved.set(from, { to: cur, renameRowId: originFlags.get(from) !== false, brokenIn: era })
  }
  return resolved
}

/** 简易 semver 比较（支持 -alpha./-rc. 后缀）；返回 -1/0/1。 */
export function compareSemver(a, b) {
  const parse = (v) =>
    String(v)
      .replace(/^v/, '')
      .split(/[.-]+/)
      .filter(Boolean)
      .map((p) => (/^\d+$/.test(p) ? Number(p) : p))
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i]
    const y = pb[i]
    if (x === y) continue
    if (x === undefined) return -1
    if (y === undefined) {
      // 剩余段是预发布标签（0.1.3-alpha.2 vs 0.1.3）：预发布 < 正式版
      return typeof x === 'number' ? 1 : -1
    }
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1
    if (typeof x === 'number') return -1 // 数字段 < 字符串段（如 1 < alpha）
    if (typeof y === 'number') return 1
    return String(x) < String(y) ? -1 : 1
  }
  return 0
}

/**
 * 加载生效迁移表（内置 + 用户覆盖，链式收敛）。
 * @param {{ home?: string, warn?: (m:string)=>void, eventsUpTo?: string }} opts
 *   eventsUpTo：适配分支处理终点——**内置条目**只保留 brokenIn ≤ 终点者（终点后
 *   才断裂的令牌在本线仍合法，不得修）。用户条目不截断：自救表本就是「不等发版、
 *   显式覆盖运行环境判定」的通道，截断会废掉它。无 brokenIn 的内置条目保留并警告。
 * @returns {{ tables: { packageRenames: Map<string,{to,renameRowId}>, configKeyRenames: object[], changes: object[] }, warnings: string[] }}
 */
export function loadTables({ home, warn, eventsUpTo } = {}) {
  const warnings = []
  const w = (m) => {
    warnings.push(m)
    warn?.(m)
  }
  const user = home ? readUserChanges(home, w) : { changes: [] }
  let builtinChanges = BUILTIN_CHANGES.changes
  if (eventsUpTo) {
    builtinChanges = builtinChanges.filter((c) => {
      if (!c.brokenIn) {
        w(`内置变更条目缺少 brokenIn，无法按分支终点 ${eventsUpTo} 截断，已保留: ${JSON.stringify(c.from ?? c.kind ?? c)}`)
        return true
      }
      return compareSemver(c.brokenIn, eventsUpTo) <= 0
    })
  }
  const changes = mergeChanges(builtinChanges, user.changes)
  return {
    tables: {
      packageRenames: resolveRenameChain(changes, w),
      configKeyRenames: changes.filter((c) => c.kind === 'config-key-rename'),
      changes,
    },
    warnings,
  }
}

// ── 适配分支：按宿主主线分 branch，各自 peer / 处理终点 / 算法档位 ──

/** 分支表（内置只读；当前无用户覆盖机制——分支随插件发版走）。 */
export function loadBranches() {
  return BUILTIN_BRANCHES
}

/** 按分支 id 取分支。 */
export function branchById(id, branches = loadBranches()) {
  return branches.find((b) => b.id === id)
}

/** 判断 version 是否满足形如 `>=A <B` 的范围（空格分隔子句须全部满足；空范围为真）。 */
export function semverSatisfies(version, range) {
  const clauses = String(range ?? '')
    .split(/\s+/)
    .filter(Boolean)
  if (!clauses.length) return true
  return clauses.every((c) => {
    const m = /^(>=|<=|<|>|=)?\s*(.+)$/.exec(c)
    if (!m) return false
    const cmp = compareSemver(version, m[2])
    switch (m[1] ?? '>=') {
      case '>=': return cmp >= 0
      case '<=': return cmp <= 0
      case '<': return cmp < 0
      case '>': return cmp > 0
      default: return cmp === 0
    }
  })
}

/**
 * 宿主版本 → 适配分支。范围按数组序连续拼接，首个命中即返回；
 * 无命中（版本高于全部范围上限等表外情况）回退到终点最大的分支。
 * version 未知时返回 undefined（调用方回退 main，保持 0.3.x 行为）。
 */
export function branchForVersion(version, branches = loadBranches()) {
  if (!version) return undefined
  const hit = branches.find((b) => semverSatisfies(version, b.hostRange))
  if (hit) return hit
  return [...branches]
    .filter((b) => compareSemver(b.endpoint, version) < 0)
    .sort((a, b) => compareSemver(b.endpoint, a.endpoint))[0]
}
