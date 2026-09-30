/**
 * dsh-preset-manager — R-KEY-RENAMED：配置键改名（表驱动）。
 *
 * 规则来自迁移表 configKeyRenames（含用户覆盖表），内置条目：
 * 0.1.3-alpha.2（commit 40792330c0）起 `persona` 的必填 `text` 被移除，
 * 改为必填 `prefix` + 默认空 `suffix`。含 `text` 的模板在新版本校验失败，
 * persona 行不启动，整条预设标红。
 *
 * 拆分规则（确定性，纯正则）：匹配
 *   /^\s*Your working directory is \{\{cwd\}\}\.?\s*$/m
 * 的行 → suffix，其余 → prefix；未命中 → 全部进 prefix，suffix 不写。
 */
export const CWD_LINE_RE = /^[ \t]*Your working directory is \{\{cwd\}\}\.?$/m

/**
 * @param {object} row 行描述
 * @param {object} tables 生效迁移表（configKeyRenames 列表）
 * @returns findings（level=auto）
 */
export function checkConfigKeys(row, tables) {
  const entries = tables.configKeyRenames ?? []
  const findings = []
  for (const entry of entries) {
    if (row.name !== entry.package) continue
    const fromKey = entry.from?.[0]
    if (!fromKey) continue
    const textNode = row.configNode?.get?.(fromKey, true)
    if (textNode === undefined || textNode === null) continue
    if ((entry.to ?? []).includes(fromKey)) continue // 目标仍含同名键：不是改名
    const line = row.textKeyLine ?? row.line
    findings.push({
      rule: 'R-KEY-RENAMED',
      level: 'auto',
      file: row.file,
      line,
      rowId: row.id,
      reason: `${entry.package} 的 config.${fromKey} 已在 ${entry.brokenIn ?? '较早版本'} 被移除（${row.file}:${line}），校验不过会导致整条预设加载失败`,
      suggestion: `按 ${entry.valueRule ?? '迁移表规则'} 拆分/改写为: ${(entry.to ?? []).join(' + ')}`,
      data: { rowRange: row.range, pkg: entry.package, fromKey, to: entry.to ?? [], valueRule: entry.valueRule, brokenIn: entry.brokenIn },
    })
  }
  return findings
}

/** 把旧 text 值拆成 { prefix, suffix }（suffix 可能不存在）。行尾 \r 归一为 \n（YAML 块标量语义本就不保留 \r）。 */
export function splitPersonaText(value) {
  const text = String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = text.split('\n')
  const keep = []
  const cwd = []
  let matched = false
  for (const line of lines) {
    // 只取第一个命中行进 suffix
    if (!matched && /^[ \t]*Your working directory is \{\{cwd\}\}\.?$/.test(line)) {
      cwd.push(line)
      matched = true
    } else {
      keep.push(line)
    }
  }
  if (!matched) return { prefix: text }
  return { prefix: trimTrailingBlank(keep.join('\n')), suffix: trimTrailingBlank(cwd.join('\n')) }
}

function trimTrailingBlank(s) {
  return s.replace(/\n+$/, '')
}
