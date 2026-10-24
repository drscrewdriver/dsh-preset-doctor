/**
 * dsh-preset-doctor — 修复规划器：finding → span 编辑（[{start, end, text}]）。
 *
 * 铁律：对既有 patch 的修复一律文本级替换，编辑区间限于该行自身，
 * 区间外的字节 100% 不动（!!js 标签 / 注释 / 缩进因此天然保真）。
 * 仅 persona 键拆分会重排该行内部——重排前解析、重排后按原缩进落位，
 * 其余区间仍不动。
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Scalar } from 'yaml'
import { spliceEdits } from './core.js'
import { splitPersonaText } from '../rules/persona.js'
import { stripDeadVars } from '../rules/dead-var.js'
import { colOf, stringifyNode } from '../yaml-doc.js'

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 替换行 span 内 name 值（保持原引号风格；未带引号时不加引号）。 */
function replaceNameValue(spanText, oldName, newName) {
  const re = new RegExp(`(name:[ \\t]*)(['"]?)${escapeRe(oldName)}\\2(?=[ \\t]*(\\r?\\n|$))`)
  if (!re.test(spanText)) return null
  return spanText.replace(re, (_m, pre, q) => `${pre}${q}${newName}${q}`)
}

/** 替换行 span 内第一个匹配的 id 值（行 id 与包短名同步改名）。 */
function replaceRowId(spanText, oldId, newId) {
  const re = new RegExp(`(id:[ \\t]*)(['"]?)${escapeRe(oldId)}\\2`)
  const m = spanText.match(re)
  if (!m) return null
  return spanText.slice(0, m.index) + `${m[1]}${m[2]}${newId}${m[2]}` + spanText.slice(m.index + m[0].length)
}

/** R-PKG-RENAMED：包名 + 行 id（可选）在行 span 内替换。 */
function planRename(finding, src) {
  const { from, to, renameRowId, fromRowId, toRowId, rowRange, rowId } = finding.data
  const [start, end] = rowRange
  let span = src.text.slice(start, end)
  const next = replaceNameValue(span, from, to)
  if (next == null) throw new Error(`span 内未找到 name: ${from}`)
  span = next
  if (renameRowId && (rowId === fromRowId || rowId === `dsh-${fromRowId}`)) {
    const withId = replaceRowId(span, rowId, toRowId)
    if (withId != null) span = withId
  }
  return [{ start, end, text: span, rule: finding.rule }]
}

/** R-LOCAL-PATH：相对路径 → 绝对 file:// URL（相对 patch 文件目录解析）。 */
function planLocalPath(finding, src) {
  const { name, baseDir, rowRange } = finding.data
  const [start, end] = rowRange
  let span = src.text.slice(start, end)
  const abs = path.resolve(baseDir, name)
  const url = pathToFileURL(abs).href
  const next = replaceNameValue(span, name, url)
  if (next == null) throw new Error(`span 内未找到本地路径 name: ${name}`)
  span = next
  return [{ start, end, text: span, rule: finding.rule }]
}

/**
 * R-KEY-RENAMED：配置键改名（表驱动）。persona 拆分走 valueRule 注册的
 * 确定性规则；无规则的键改名放弃机械修复（抛错转报告，绝不猜）。
 */
function planKeyRename(finding, src) {
  const { rowRange, fromKey, to, valueRule } = finding.data
  const [start, end] = rowRange
  const row = src.rows.find((r) => r.range && r.range[0] === start && r.range[1] === end)
  if (!row?.configNode) throw new Error('未找到目标行节点（文件可能已被外部修改），请重跑扫描')
  const oldValue = row.configNode.get(fromKey)
  if (oldValue === undefined || oldValue === null) throw new Error(`config.${fromKey} 已不存在（可能已修复）`)

  const configNode = row.configNode
  configNode.delete(fromKey)
  const setScalar = makeSetScalar(configNode)

  if (valueRule === 'persona.text.splitCwdSuffix' && to.includes('prefix') && to.includes('suffix')) {
    const parts = splitPersonaText(oldValue)
    setScalar('prefix', parts.prefix)
    if (parts.suffix !== undefined) setScalar('suffix', parts.suffix)
  } else if (to.length === 1) {
    setScalar(to[0], oldValue)
  } else {
    throw new Error(`配置键改名 ${fromKey}→${to.join('+')} 无确定性拆分规则（valueRule=${valueRule ?? '无'}），请人工处理`)
  }

  return rewriteRowSpan(row, src, finding.rule)
}

/** 向 config 节点写标量：多行字符串用块标量，与 planKeyRename 历史行为一致。 */
function makeSetScalar(configNode) {
  return (key, value) => {
    const s = new Scalar(value)
    if (typeof value === 'string' && value.includes('\n')) s.type = 'BLOCK_LITERAL'
    configNode.set(key, s)
  }
}

/**
 * R-DEAD-VAR：删除宿主已移除的 prompt 变量占位（cwd 提示整行删行，
 * 裸占位删 token），改写对应 config 键后整行重排。
 */
function planDeadVar(finding, src) {
  const { rowRange, key, vars } = finding.data
  const [start, end] = rowRange
  const row = src.rows.find((r) => r.range && r.range[0] === start && r.range[1] === end)
  if (!row?.configNode) throw new Error('未找到目标行节点（文件可能已被外部修改），请重跑扫描')
  const oldValue = row.configNode.get(key)
  if (typeof oldValue !== 'string') throw new Error(`config.${key} 不是字符串或已不存在（可能已修复）`)
  const next = stripDeadVars(oldValue, vars)
  if (next === oldValue) throw new Error(`config.${key} 内未找到占位（可能已修复），请重跑扫描`)
  makeSetScalar(row.configNode)(key, next)
  return rewriteRowSpan(row, src, finding.rule)
}

/** 把改后的行节点序列化回行 span（保留 span 外字节 100% 不动）。注意两点：
 * 1. yaml v2 的行节点 range 从第一个 key 开始（`- ` 在 span 之外）：
 *    首行 = body 首行（无前缀），后续行 = key 列缩进。
 * 2. range end 可能吞掉行尾换行：原 span 的尾部换行必须补回，
 *    否则与下一行拼接（多行测试用例才能暴露）。 */
function rewriteRowSpan(row, src, rule) {
  const [start, end] = row.range
  const original = src.text.slice(start, end)
  const trailing = /(?:\r?\n)+$/.exec(original)?.[0] ?? ''
  const body = stringifyNode(row.node).replace(/\n+$/, '')
  const pad = ' '.repeat(colOf(src.lineCounter, start) - 1)
  const lines = body.split('\n').map((l, i) => (i === 0 || l === '' ? l : `${pad}${l}`))
  return [{ start, end, text: lines.join('\n') + trailing, rule }]
}

/**
 * 把 auto 级 finding 规划为编辑。不支持自动修复的规则抛错（调用方计入 errors）。
 */
export function planEdit(finding, src) {
  switch (finding.rule) {
    case 'R-PKG-RENAMED':
      return planRename(finding, src)
    case 'R-LOCAL-PATH':
      return planLocalPath(finding, src)
    case 'R-KEY-RENAMED':
      return planKeyRename(finding, src)
    case 'R-DEAD-VAR':
      return planDeadVar(finding, src)
    default:
      throw new Error(`规则 ${finding.rule} 不支持自动修复`)
  }
}

/** 对单个源文件规划全部编辑并产出新文本。 */
export function planFileEdits(findingsForFile, src) {
  const edits = findingsForFile.flatMap((f) => planEdit(f, src))
  const newText = spliceEdits(src.text, edits)
  return { edits, newText }
}
