/**
 * dsh-preset-doctor — R-DEAD-VAR：宿主已移除的 prompt 变量残留。
 *
 * 0.2.1-alpha.2 起宿主 system-prompt 不再注册 `{{cwd}}`（工作目录改由
 * ctx.workingDirectory 能力面提供），预设模板里残留的 `{{cwd}}` 在加载时
 * 抛 `unknown prompt variable "cwd" in section "…:persona-prefix"` 并
 * 拒载整条预设。变量清除事件由迁移表 changes.json 的 prompt-var-removed
 * 条目驱动（表截断已保证 ≤ 分支终点，这里再按「当前版本 ≥ brokenIn」门控：
 * 旧宿主上该变量仍合法，不得报）。
 *
 * 扫描面：行 config 的直接字符串值（persona 的 prefix/suffix/text 等均覆盖）。
 */
import { semverSatisfies } from '../tables/load.js'

const VAR_RE = /\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g

/**
 * @param {object} row 行描述（需含 configNode/file/line/id/range）
 * @param {{ tables: object, currentVersion?: string }} opts
 * @returns findings（level=auto，planner 消费做机械删占位）
 */
export function checkDeadVars(row, { tables, currentVersion } = {}) {
  const entries = tables?.deadPromptVars ?? []
  if (!entries.length || !currentVersion) return []
  const configNode = row.configNode
  if (!configNode?.items) return []
  const findings = []
  for (const pair of configNode.items) {
    const key = pair.key?.value
    const value = pair.value?.value ?? (typeof pair.value === 'string' ? pair.value : undefined)
    if (typeof value !== 'string' || !value.includes('{{')) continue
    const hitVars = []
    for (const m of value.matchAll(VAR_RE)) {
      const e = entries.find((x) => x.variable === m[1])
      if (!e?.brokenIn) continue
      if (!semverSatisfies(currentVersion, `>=${e.brokenIn}`)) continue // 旧宿主仍合法
      if (!hitVars.includes(m[1])) hitVars.push(m[1])
    }
    if (!hitVars.length) continue
    findings.push({
      rule: 'R-DEAD-VAR',
      level: 'auto',
      file: row.file,
      line: row.line,
      rowId: row.id,
      reason: `config.${key} 引用了宿主已移除的 prompt 变量 {{${hitVars.join('}, {{')}}}（自 ${entries.find((x) => x.variable === hitVars[0])?.brokenIn} 起不再注册），加载时抛 unknown prompt variable 并拒载整条预设`,
      suggestion: '机械修复删除占位（"Your working directory is {{cwd}}" 类整行一并删除）；工作目录信息现由宿主能力面注入，模板无需自带',
      data: { rowRange: row.range, key, vars: hitVars, brokenIn: entries.find((x) => x.variable === hitVars[0])?.brokenIn },
    })
  }
  return findings
}

/** 把一个值里的死变量清掉：cwd 提示整行删行，裸占位删 token 并收敛空白。纯函数供测试。 */
export function stripDeadVars(value, vars) {
  let next = value
  for (const v of vars) {
    const token = `\\{\\{\\s*${v}\\s*\\}\\}`
    // 整行形态（如 "Your working directory is {{cwd}}."）：连行带换行删
    next = next.replace(
      new RegExp(`^[ \\t]*Your working directory is ${token}\\.?[ \\t]*\\r?\\n|[ \\t]*Your working directory is ${token}\\.?[ \\t]*$`, 'gim'),
      '',
    )
    // 剩余裸占位：删 token，行内多余空格与行尾空白收敛
    next = next.replace(new RegExp(token, 'g'), '')
    next = next.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/gm, '')
  }
  // 删的是末行时，上一行行尾换行是拼接残留：原值无尾换行则补正
  if (!/\n$/.test(value) && /\n+$/.test(next)) next = next.replace(/\n+$/, '')
  return next
}
