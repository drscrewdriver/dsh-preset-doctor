/**
 * dsh-preset-doctor — 从 patch 行里读出「提示词段」。
 *
 * 预设的系统提示词由若干行拼出来（persona 的 prefix/suffix、plan-mode 的
 * section，以及任何一条 config 里的长文本）。这些内容以前只存在于 YAML 里，
 * 卡面只能看到行 id 与开关——想知道「这个预设到底对模型说了什么」得去翻文件。
 *
 * 判据只有两条，都不猜语义：
 * 1. 已知提示词键名（prefix / suffix / text / section / prompt … / 工具行的 description）；
 * 2. 任意键，但值是多行且 ≥ 200 字（用户自定义的行也能兜住）。
 *
 * 宿主实证（deepseek-harness 0.2.0/0.2.1 源码）：由预设 config 驱动、真的进模型
 * 的只有三处 —— persona 的 prefix/suffix、plan-mode 的 section，以及工具行覆写的
 * description（`Model-facing tool description; deployments may describe their environment`）。
 * 其余 tool-* 的 guidance 是代码里的静态段，不读 config。
 *
 * 只读：原文一个字节不动，也不做变量插值（占位符按文件里的样子展示）。
 */

/** 预设声明行本身：它的 config.description 是面板文案，不是提示词。 */
const PRESET_ROW_NAMES = new Set(['@deepseek-ai/dsh-agent-preset', 'dsh-agent-preset'])

const PROMPT_KEYS = new Set([
  'text',
  'prefix',
  'suffix',
  'section',
  'prompt',
  'instructions',
  'system',
  'systemPrompt',
  'template',
  'message',
  'preamble',
  'append',
  // 工具行覆写工具说明：模型看得到，属提示词面（如 official minimal 预设的 bash/pwsh 行）
  'description',
])

/** 给人看的归类（卡面小标）。 */
function kindOf(rowName, key) {
  if (key === 'description') return 'tool'
  if (/dsh-persona$/.test(rowName)) return 'persona'
  if (/dsh-plan-mode$/.test(rowName)) return 'plan'
  return 'text'
}

/** 卡面可编辑的键：与提取白名单同一套（描述/预置名等短元数据不在内）。 */
export function isPromptKey(key) {
  return typeof key === 'string' && PROMPT_KEYS.has(key)
}

/** 未知键名要够长才算提示词（避开 toolName / name / id 这类短元数据）。 */
const LONG_TEXT_MIN = 200
const PREVIEW_MAX = 160

function previewOf(value) {
  const flat = String(value).replace(/\s+/g, ' ').trim()
  return flat.length > PREVIEW_MAX ? flat.slice(0, PREVIEW_MAX) + '…' : flat
}

/**
 * 收集一个行区间内的提示词段（区间不传 = 全部行）。
 * @param {Array} rows 扫描出的行（含 configNode / id / name / line / range）
 * @param {[number, number]} [range] 归属预设的范围
 * @returns {Array<{rowId:string,name:string,key:string,kind:string,line:number,chars:number,preview:string,text:string}>}
 */
export function collectPromptTexts(rows, range) {
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.range || !Array.isArray(row.configNode?.items)) continue
    if (range && !(row.range[0] >= range[0] && row.range[1] <= range[1])) continue
    for (const pair of row.configNode.items) {
      const key = pair?.key?.value
      const raw = pair?.value?.value
      if (typeof key !== 'string' || typeof raw !== 'string') continue
      if (key === 'description' && PRESET_ROW_NAMES.has(row.name)) continue
      const text = raw.trim()
      if (text === '') continue
      const isPrompt = PROMPT_KEYS.has(key) || (raw.includes('\n') && text.length >= LONG_TEXT_MIN)
      if (!isPrompt) continue
      out.push({
        rowId: typeof row.id === 'string' ? row.id : '',
        name: typeof row.name === 'string' ? row.name : '',
        key,
        kind: kindOf(typeof row.name === 'string' ? row.name : '', key),
        line: row.line ?? 0,
        chars: text.length,
        preview: previewOf(text),
        // 全文供卡内编辑（卡面只显示 preview；编辑时一次性带入，不额外发请求）
        text,
      })
    }
  }
  return out
}

/**
 * 全量扫描结果 → `${file}#${presetId}` → 提示词段。
 * 键与桥的 composition 视图一致（卡面按同一个键取数据）。
 */
export function presetPromptTexts(scan) {
  const map = new Map()
  for (const src of Array.isArray(scan?.sources) ? scan.sources : []) {
    for (const presetRow of Array.isArray(src.presetRows) ? src.presetRows : []) {
      if (!presetRow.presetId || !presetRow.range) continue
      const list = collectPromptTexts(src.rows, presetRow.range)
      if (list.length) map.set(`${src.file}#${presetRow.presetId}`, list)
    }
  }
  return map
}
