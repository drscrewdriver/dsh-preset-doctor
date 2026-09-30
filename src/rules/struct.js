/**
 * dsh-preset-manager — R-STRUCT：结构合规检查。
 *
 * 合法的预设声明行（PRD verify §10.1.2）：是 `- insert:` 条目下的一个映射，
 * 含 `id`、`name`（预设行 = dsh-agent-preset 包）、`config.id`、`config.plugins`。
 * 结构违规无法机械修复（无法替用户猜测意图），一律报告。
 */

/** 判断一行是否为「预设声明行」（区别于 patch 里挂的普通插件行）。 */
export function isPresetRow(name) {
  return name === '@deepseek-ai/dsh-agent-preset' || name === 'dsh-agent-preset'
}

/**
 * 顶层条目的合法操作键。真实 patch（如 profiles/<name>/cordis.patch.yml）除
 * `- insert:` 外还有 id 定向的覆盖/禁用行（直接写 id+name+config），均为合法。
 * 只有「既无任何操作键也不是 id 行」的条目才报 R-STRUCT。
 */
const PATCH_OPERATION_KEYS = ['insert', 'remove', 'modify', 'replace', 'id', 'name']

export function isLegalTopEntry(itemNode) {
  if (itemNode?.items == null) return false
  return itemNode.items.some((p) => PATCH_OPERATION_KEYS.includes(String(p.key?.value)))
}

/** 顶层预设行的结构检查。返回 findings（全部 report 级）。 */
export function checkStruct(row) {
  const findings = []
  const at = `${row.file}:${row.line}`
  if (!row.id) {
    findings.push({
      rule: 'R-STRUCT',
      level: 'report',
      file: row.file,
      line: row.line,
      rowId: '',
      reason: `预设声明行缺少 id（${at}）`,
      suggestion: '为该行补 id（约定前缀 preset-），或删除该残缺行',
    })
  }
  if (row.configNode == null) {
    findings.push({
      rule: 'R-STRUCT',
      level: 'report',
      file: row.file,
      line: row.line,
      rowId: row.id,
      reason: `预设声明行缺少 config（${at}）`,
      suggestion: '补 config: { id, name?, description?, order?, plugins: [...] }',
    })
    return findings
  }
  if (!row.presetId) {
    findings.push({
      rule: 'R-STRUCT',
      level: 'report',
      file: row.file,
      line: row.line,
      rowId: row.id,
      reason: `预设声明行缺少 config.id（${at}）`,
      suggestion: 'config.id 是预设标识（旧机制下为目录名），必须存在',
    })
  }
  if (row.pluginsNode == null) {
    findings.push({
      rule: 'R-STRUCT',
      level: 'report',
      file: row.file,
      line: row.line,
      rowId: row.id,
      reason: `预设声明行缺少 config.plugins（${at}）`,
      suggestion: 'config.plugins 应为该预设挂载的插件行列表',
    })
  } else if (row.pluginsNode.items == null) {
    findings.push({
      rule: 'R-STRUCT',
      level: 'report',
      file: row.file,
      line: row.line,
      rowId: row.id,
      reason: `config.plugins 不是列表（${at}）`,
      suggestion: 'config.plugins 应为 YAML 列表，每项含 id/name',
    })
  }
  return findings
}
