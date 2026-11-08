/**
 * dsh-preset-doctor — 行级 YAML 编辑原语（composition 对齐 / toggle 共用）。
 *
 * 铁律沿用 fix/core：文本级 span 编辑，区间外字节 100% 不动（注释 / !!js / 缩进保真）。
 * yaml v2 的 seq item 节点 range 从 `- ` 之后的首个 key 开始，故整行删除须回扩到
 * `- ` 项目符号所在行的行首，并吞掉 item 内容末尾的换行。
 */

/** 偏移所在行的行首字节下标。 */
export function lineStartOf(text, idx) {
  let i = idx
  while (i > 0 && text[i - 1] !== '\n') i--
  return i
}

/** 吞掉偏移之后（含）到行尾换行的字节下标（即下一行的行首）。 */
export function lineEndInclNewline(text, idx) {
  let i = idx
  while (i < text.length && text[i] !== '\n') i++
  return i < text.length ? i + 1 : i
}

/** 某行的前导缩进字符串（空格/制表符）。 */
function leadingWs(text, lineStart) {
  let i = lineStart
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++
  return text.slice(lineStart, i)
}

/** 检测文本主换行符（CRLF/LF）。 */
export function detectEolOf(text) {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

/**
 * item 内容末尾字节 e → 应删到的块尾字节。
 * yaml seq item 的 range[1] 常已吞掉尾换行（停在下一行行首，text[e-1]==='\n'）→
 * 此时不再外扩，否则会多吃下一 sibling 的首行；否则扩到本行换行之后。
 */
function blockEndOf(text, e) {
  if (e <= 0 || e >= text.length) return Math.min(e, text.length)
  return text[e - 1] === '\n' ? e : lineEndInclNewline(text, e)
}

/**
 * 删除一个 seq item 的整块（含 `- ` 项目符号与其所有子行、尾换行）。
 * @param {string} text 全文
 * @param {{range:[number,number]}} item AST 节点
 */
export function deleteItemEdit(text, item, rule = 'R-COMPOSITION-DRIFT') {
  const [s, e] = item.range
  const start = lineStartOf(text, s)
  const end = blockEndOf(text, e)
  return { start, end, text: '', rule }
}

/**
 * 给一个 item 追加 `disabled: true` 子键（零宽插入到其首行行尾之后）。
 * 若该 item 已有 disabled 键（含 !!js 表达式）则返回 null——写第二个同名键是非法 YAML。
 */
export function makeDisabledEdit(text, item) {
  if (typeof item.get === 'function' && item.get('disabled', true) != null) return null
  const [s] = item.range
  const anchor = lineEndInclNewline(text, s)
  const eol = detectEolOf(text)
  // 子键缩进 = `- ` 项目符号列 + 2（对齐 id/name 子键）
  const bulletLineStart = lineStartOf(text, s)
  const indent = leadingWs(text, bulletLineStart) + '  '
  return { start: anchor, end: anchor, text: `${indent}disabled: true${eol}`, rule: 'R-TOGGLE' }
}

/**
 * 删除一个 item 已有的 `disabled:` 子键行（toggle 开）。
 * @returns 编辑或 null（无 disabled 键）
 */
export function makeEnableEdit(text, item) {
  if (typeof item.get !== 'function') return null
  const valNode = item.get('disabled', true)
  if (!valNode || !valNode.range) return null
  // valNode 是值节点；其 key `disabled` 在同一行行首区。整行删除。
  const [vs] = valNode.range
  const start = lineStartOf(text, vs)
  const end = blockEndOf(text, valNode.range[1])
  return { start, end, text: '', rule: 'R-TOGGLE' }
}

/**
 * 把一行的 `disabled` 子键置为指定值而不删行（2026-11-08 三档载体定案）：
 *  - 无 `disabled` 键 → 追加 `disabled: <value>`
 *  - 有键且值已等于 value → null（幂等：调用方据此不计入本次改动）
 *  - 有键但值相反 → 就地把值节点改写
 *  - 值是 `!!js` 表达式等非布尔量（dynamic）→ null（改写会抹掉跨平台条件，补第二个键则非法 YAML）
 * 三档语义：无键=跟随（按解析默认）、`disabled: false`=强制开、`disabled: true`=强制关。
 * @param {string} text 全文
 * @param {object} item seq item 的 YAMLMap 节点
 * @param {boolean} value 目标值
 * @returns 编辑或 null
 */
export function makeStateEdit(text, item, value) {
  if (!item || typeof item.get !== 'function') return null
  const valNode = item.get('disabled', true)
  const want = value ? 'true' : 'false'
  if (valNode == null) {
    if (!value) {
      // 强制开且尚无键：插入 disabled: false（不能复用 makeDisabledEdit，它恒写 true）
      const [s] = item.range
      const anchor = lineEndInclNewline(text, s)
      const indent = leadingWs(text, lineStartOf(text, s)) + '  '
      return { start: anchor, end: anchor, text: `${indent}disabled: ${want}${detectEolOf(text)}`, rule: 'R-TOGGLE' }
    }
    return makeDisabledEdit(text, item)
  }
  const raw = typeof valNode === 'object' && 'value' in valNode ? valNode.value : valNode
  const cur = raw === true || raw === 'true'
  const isFalse = raw === false || raw === 'false'
  if (!cur && !isFalse) return null // dynamic（!!js 表达式等）：拒绝覆写
  if (cur === value) return null
  if (!valNode.range) return null
  const [vs, ve] = valNode.range
  return { start: vs, end: ve, text: want, rule: 'R-TOGGLE' }
}

/** 停用一行（写 `disabled: true`）——makeStateEdit 的 off 档薄封装。 */
export function makeOffEdit(text, item) {
  return makeStateEdit(text, item, true)
}

/** 强制开启一行（显式写 `disabled: false`，区别于「跟随」的删键）。 */
export function makeOnEdit(text, item) {
  return makeStateEdit(text, item, false)
}
