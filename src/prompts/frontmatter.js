/**
 * dsh-preset-doctor — 注入类提示词（`注入/*.md`）的 frontmatter 读取。
 *
 * 语义逐字段对齐 dsh-preset-studio 的投递器（`dsh-preset-studio/inject` 的
 * frontmatter.js）：只认 `---` 围栏、只认顶层单行标量、布尔只认一组拼写、
 * 读不出的一律**静默**丢弃或降级。这里如实复现该读取行为，doctor 才能把
 * 投递器沉默吞掉的东西报出来（BOM 失配、未闭合围栏、role 降级、order 归零）。
 *
 * 只读不写：本文件不重新序列化任何 YAML，原文一个字节也不动。
 */

/** UTF-8 BOM —— 它会顶在文件首字符，让 `^---` 匹配失败。 */
export const BOM = '\uFEFF'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n)?/

/** 去掉文件头 BOM（其余字节原样保留）。 */
export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

export function hasBom(text) {
  return text.charCodeAt(0) === 0xfeff
}

/**
 * 切出 frontmatter 头与正文；无围栏返回 null（投递器同样返回 null → 跳过该文件）。
 * 附带偏移：headStart（head 在全文的起点）、bodyStart（正文起点），供行号定位。
 */
export function splitFrontmatter(text) {
  const match = FRONTMATTER_RE.exec(text)
  if (!match) return null
  return {
    head: match[1],
    rest: text.slice(match[0].length),
    eol: text.includes('\r\n') ? '\r\n' : '\n',
    headStart: text.indexOf('\n') + 1,
    bodyStart: match[0].length,
  }
}

/** 取一个顶层单行标量（引号成对则剥引号；与投递器同一条正则）。 */
export function readField(head, key) {
  const re = new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*(.*)$', 'm')
  const match = re.exec(head)
  if (!match) return undefined
  let value = match[1].trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  return value
}

/** 投递器接受的布尔拼写；其它一律 undefined（调用方按「未写」处理）。 */
export function readBoolean(value) {
  if (value === undefined) return undefined
  const text = String(value).trim().toLowerCase()
  if (['true', 'yes', 'on', '1'].includes(text)) return true
  if (['false', 'no', 'off', '0'].includes(text)) return false
  return undefined
}

/** 取一个顶层数字；非数字/空 → undefined（投递器按 0 处理）。 */
export function readNumber(head, key) {
  const raw = readField(head, key)
  if (raw === undefined || raw === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

/** 全文偏移 → 1-based 行号。 */
export function lineAt(text, index) {
  let line = 1
  const end = Math.max(0, Math.min(index, text.length))
  for (let i = 0; i < end; i += 1) if (text.charCodeAt(i) === 10) line += 1
  return line
}

/** 某个 frontmatter 键所在行（键不存在 → head 首行）。 */
export function fieldLine(text, split, key) {
  if (!split) return 1
  const re = new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:', 'm')
  const match = re.exec(split.head)
  if (!match) return lineAt(text, split.headStart)
  return lineAt(text, split.headStart + match.index)
}

/** 正文内偏移 → 行号。 */
export function bodyLine(text, split, offset = 0) {
  if (!split) return lineAt(text, offset)
  return lineAt(text, split.bodyStart + offset)
}
