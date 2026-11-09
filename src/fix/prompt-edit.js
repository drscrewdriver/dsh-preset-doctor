/**
 * dsh-preset-doctor — 提示词段的就地编辑（卡内「编辑」按钮的后端）。
 *
 * 写盘契约与其它修复一致：**文本级 span 替换**（只换掉该值的那一段字节）、
 * `.bak-<ts>` 备份、临时文件 + rename 原子写、幂等（同样内容 → skipped）。
 *
 * 保形规则：
 * - 原本是块标量（`|` / `|-` / `>`）→ 沿用同一个指示符与内容缩进；
 * - 原本是单行标量且新内容单行 → 写成单引号标量（`'` 转义为 `''`）；
 * - 原本单行、新内容多行 → 转成块标量（无尾换行用 `|-`，有尾换行用 `|`）；
 * - 行尾跟随文件（CRLF 文件写 CRLF）。
 *
 * 拒写：清空正文（空提示词几乎总是误操作，且 plan-mode 的 section 要求非空）、
 * 非提示词键（防误改 id/name/端口等）、`!!js` 表达式值（改写会抹掉条件）、
 * 找不到行/键。
 */
import { writeFileSafe, defaultTimestamp, displayPath, spliceEdits } from './core.js'
import { isPromptKey } from '../rules/prompt-text.js'

function eolOf(text) {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

/** 块标量正文的缩进（原样沿用；取不到则按键行缩进 + 2）。 */
function contentIndentOf(srcText, node) {
  const raw = srcText.slice(node.range[0], node.range[1])
  const lines = raw.split(/\r?\n/)
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() !== '') return /^[ \t]*/.exec(lines[i])[0]
  }
  const lineStart = srcText.lastIndexOf('\n', node.range[0] - 1) + 1
  return /^[ \t]*/.exec(srcText.slice(lineStart))[0] + '  '
}

/**
 * 规划一次「替换提示词值」的 span 编辑（纯函数，供测试）。
 * @param {string} srcText 整个 patch 文件文本
 * @param {object} node 该键的 YAML 值节点（需含 range/type）
 * @param {string} nextText 新提示词
 * @returns {{start:number,end:number,text:string,rule:string}}
 */
export function planPromptEdit(srcText, node, nextText) {
  if (!node?.range) throw new Error('该键没有可替换的取值区间')
  const eol = eolOf(srcText)
  const text = String(nextText)
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const isBlock = node.type === 'BLOCK_LITERAL' || node.type === 'BLOCK_FOLDED'
  let replacement
  if (lines.length === 1 && !isBlock) {
    replacement = "'" + text.replace(/'/g, "''") + "'"
  } else {
    const indent = contentIndentOf(srcText, node)
    const original = srcText.slice(node.range[0], node.range[1]).match(/^[|>][+-]?/)
    const indicator = original ? original[0] : (/\n$/.test(text) ? '|' : '|-')
    const body = lines.slice()
    if (body.length && body[body.length - 1] === '') body.pop()
    replacement = indicator + eol + body.map((line) => (line === '' ? '' : indent + line)).join(eol) + eol
  }
  return { start: node.range[0], end: node.range[1], text: replacement, rule: 'R-PROMPT-EDIT' }
}

/** 找预设内的某一行（与 runToggle/runDelete 同一定位口径）。 */
function locate(scanResult, { file, presetId, rowId }) {
  const src = (scanResult.sources || []).find((s) => s.file === file)
  const presetRow = src?.presetRows?.find((r) => r.presetId === presetId)
  if (!src || !presetRow || !presetRow.range) return { error: '未找到预设声明' }
  const row = (src.rows || []).find(
    (r) => r.id === rowId && r.range && r.range[0] >= presetRow.range[0] && r.range[1] <= presetRow.range[1],
  )
  if (!row?.node) return { error: `预设内未找到行 ${rowId}` }
  return { src, row }
}

/**
 * 把一段提示词写回 patch（卡内「编辑」）。
 * @param {{sources:Array}} scanResult
 * @param {{file:string,presetId:string,rowId:string,key:string,text:string,confirm?:boolean,dryRun?:boolean,ts?:string}} opts
 */
export function runPromptWrite(scanResult, {
  file,
  presetId,
  rowId,
  key,
  text,
  confirm = false,
  dryRun = false,
  ts = defaultTimestamp(),
} = {}) {
  const out = {
    dryRun,
    ts,
    file: file ? displayPath(file) : undefined,
    presetId,
    rowId,
    key,
    status: 'noop',
    backup: undefined,
    errors: [],
  }
  if (confirm !== true) {
    out.status = 'rejected'
    out.errors.push({ message: '写盘需显式确认 confirm:true' })
    return out
  }
  if (typeof text !== 'string') {
    out.status = 'bad-text'
    out.errors.push({ message: 'text 必须是字符串' })
    return out
  }
  if (!isPromptKey(key)) {
    out.status = 'not-prompt-key'
    out.errors.push({ message: `${key} 不是可编辑的提示词键（只开放 prefix/suffix/text/section/prompt/description 这类）` })
    return out
  }
  if (text.replace(/\uFEFF/g, '').trim() === '') {
    out.status = 'empty-text'
    out.errors.push({ message: '提示词不能清空：persona.prefix / plan-mode.section 等宿主字段要求非空，写空会让预设加载失败' })
    return out
  }
  const { src, row, error } = locate(scanResult, { file, presetId, rowId })
  if (error) {
    out.status = 'not-found'
    out.errors.push({ message: error })
    return out
  }
  const node = row.configNode?.get?.(key, true)
  if (!node?.range) {
    out.status = 'no-value'
    out.errors.push({ message: `行 ${rowId} 的 config.${key} 没有可编辑的标量值` })
    return out
  }
  // 非标准标签（`!!js <expr>` 等）：改写会抹掉表达式本身 —— 一律拒，不当文本处理
  if (node.tag) {
    out.status = 'js-expression'
    out.errors.push({ message: `config.${key} 带自定义标签（${String(node.tag)}，如 !!js 表达式），本工具不改写它（改写会抹掉条件）` })
    return out
  }
  let edit
  try {
    edit = planPromptEdit(src.text, node, text)
  } catch (e) {
    out.status = 'no-value'
    out.errors.push({ message: e.message })
    return out
  }
  out.chars = text.trim().length
  try {
    const newText = spliceEdits(src.text, [edit])
    const write = writeFileSafe(file, newText, src.text, { dryRun, ts })
    out.status = write.status
    out.backup = write.backup
  } catch (e) {
    out.status = 'error'
    out.errors.push({ message: e.message })
  }
  return out
}
