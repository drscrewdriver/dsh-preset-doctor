/**
 * dsh-preset-manager — YAML 文档层。
 *
 * patch 文件是 Cordis YAML，含 DSH 生态自定义标签 `!!js <expr>`（如
 * `disabled: !!js process.platform === 'win32'`）。本工具不求值表达式，
 * 只要求**往返保真**：load 保留表达式原文（字符串），dump 按 `!!js <原文>`
 * 无引号输出。
 *
 * 写入策略（风险控制核心，见 spec）：修复既有 patch 一律文本级 span 替换，
 * 既有字节 100% 不动；只有「追加新块」（旧格式迁移）才序列化，序列化时
 * lineWidth=0 禁止折行、多行字符串用块字面量，保证值级往返无损。
 */
import { parseDocument, parse, stringify, LineCounter } from 'yaml'

/**
 * `!!js` 自定义标签：resolve 保留原文，序列化交回框架按 tag+原文输出。
 * 注意 yaml 库按展开形式匹配：`!!js` 短名 → `tag:yaml.org,2002:js`。
 * 注册短名不会命中（值靠未知标签兜底保留、但每次解析都刷警告）。
 */
export const jsTag = {
  tag: 'tag:yaml.org,2002:js',
  resolve: (value) => value,
}

const DOC_OPTIONS = {
  customTags: [jsTag],
  intAsBigInt: false,
  // 序列化选项（仅追加块时生效）：不折行；含换行的字符串由 yaml 库自动选块字面量
  lineWidth: 0,
}

/** 解析为文档（保留 AST 与行号）；不抛错，错误在 doc.errors。 */
export function parsePatchDoc(text) {
  const lineCounter = new LineCounter()
  const doc = parseDocument(text, { ...DOC_OPTIONS, lineCounter })
  return { doc, lineCounter }
}

/** 解析为纯 JS 值；解析失败抛错（调用方捕获）。 */
export function loadPatch(text) {
  return parse(text, DOC_OPTIONS)
}

/** 序列化 AST 节点或纯值（用于生成追加块 / 子树替换文本）。 */
export function stringifyNode(node) {
  return stringify(node, DOC_OPTIONS)
}

/** 1-based 行号（配合 parsePatchDoc 的 lineCounter 与节点 range）。 */
export function lineOf(lineCounter, offset) {
  return lineCounter.linePos(offset).line
}

/** 某偏移所在行的 1-based 列（缩进列）。 */
export function colOf(lineCounter, offset) {
  return lineCounter.linePos(offset).col
}

/**
 * 判断标量节点是否为本工具保真支持的形态：字符串 / `!!js` 原文标量。
 * 其它类型（数字、布尔等）不需要特殊处理。
 */
export function isPlainOrJsScalar(node) {
  return !!node && (typeof node.value === 'string' || node.tag === '!!js')
}
