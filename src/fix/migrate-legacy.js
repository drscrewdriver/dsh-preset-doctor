/**
 * dsh-preset-doctor — L1 结构迁移：旧格式 .agent-presets/<id>/ → cordis.patch.yml 声明。
 *
 * 规则（PRD §6.1 R1–R5）：
 * - R1 目录名即预设 id；行 id 固定加前缀 preset-
 * - R2 preset.yml 缺失的 name/description/order 不补空值
 * - R3 agent.cordis.yml 顶层列表整体作为 plugins 原样搬入，内部 id 一个不改
 *   （实现：纯文本重排缩进，不做 parse→dump，!!js 标签 / 注释 / 块标量字节级保真）
 * - R4 UTF-8 无 BOM、缩进 2 空格、块标量保留原文
 * - R5 多个预设按 preset.yml:order 升序合并进同一个 - insert: 列表（缺 order 按 id 序）
 *
 * 迁移前对 composition 文本施加 L2 改名（迁移表），使一次迁移即为最终形态
 * （历史教训：手工转换曾因遗漏包改名导致全部「加载失败」）。
 */
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Scalar, YAMLMap, YAMLSeq } from 'yaml'
import { parsePatchDoc, stringifyNode, colOf } from '../yaml-doc.js'
import { readText } from '../paths.js'
import { splitPersonaText } from '../rules/persona.js'
import { detectEol, writeFileSafe } from './core.js'

/** 顶层插件行缩进：`- insert:`(0) → 条目(4) → 键(6) → config 字段(8) → plugins 行(10)。 */
const PLUGIN_ROW_INDENT = 10

function yamlInline(value) {
  // 标量 → 单行 YAML 文本（自动加引号 / 块字面量），去尾部换行
  return stringifyNode(value).replace(/\n+$/, '')
}

function safeId(id) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) ? id : yamlInline(id)
}

/** 对 composition 文本施加包名/行 id 改名（L2，文本级、精确 token）。表为链式收敛后的生效表。 */
export function applyRenamesToComposition(text, tables) {
  let out = text
  const renames =
    tables?.packageRenames instanceof Map
      ? [...tables.packageRenames.entries()].map(([from, e]) => [from, e.to])
      : Object.entries(tables?.packageRenames ?? {})
  for (const [from, to] of renames) {
    const fromShort = from.split('/').pop()
    const toShort = to.split('/').pop()
    // name 值（无论引号风格）
    out = out.replace(new RegExp(`(name:[ \\t]*)(['"]?)${from}(\\2)(?=[ \\t]*(\\r?\\n|$))`, 'g'), (_m, pre, q) => `${pre}${q}${to}${q}`)
    // 行 id：去掉 dsh- 前缀的短名同步
    const fromRowId = fromShort.replace(/^dsh-/, '')
    const toRowId = toShort.replace(/^dsh-/, '')
    out = out.replace(new RegExp(`(id:[ \\t]*)(['"]?)${fromRowId}\\2(?=[ \\t]*(\\r?\\n|$))`, 'g'), (_m, pre, q) => `${pre}${q}${toRowId}${q}`)
  }
  return out
}

/** composition 全文统一重排缩进（空行保持空，不做其它改动）。 */
export function reindentComposition(text, indent = PLUGIN_ROW_INDENT) {
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  // 去掉文档头 '---' 标记行（保留其余一切，含注释）
  if (lines.length && /^---[ \t]*$/.test(lines[0])) lines.shift()
  const out = lines.map((l) => (l.trim() === '' ? '' : ' '.repeat(indent) + l))
  while (out.length && out[out.length - 1] === '') out.pop()
  return out
}

/** L2 本地路径改写：相对 name 值 → 绝对 file:// URL（相对预设目录解析，PRD R8）。 */
export function rewriteLocalPaths(text, baseDir) {
  return text.replace(
    /(name:[ \t]*)(['"]?)(\.{1,2}[\\/][^\s'"]+)\2(?=[ \t]*(\r?\n|$))/g,
    (_m, pre, q, p) => `${pre}${q}${pathToFileURL(path.resolve(baseDir, p)).href}${q}`,
  )
}

/**
 * 迁移路径的配置键改名（L2）：与 planner.planKeyRename 同语义，但作用于
 * composition 全文。迁移不走规则驱动的 fix 阶段（composition 是文本级重排），
 * 键改名必须在此显式执行——否则 text 时代的真实预设迁移后仍带已删键
 * （v0.1.2 官方预设实测暴露）。
 * 实现：迭代「解析→定位首个目标行→变换→span 替换」，每次重解析保证偏移有效。
 */
export function applyKeyRenamesToComposition(text, tables) {
  let current = text
  for (const entry of tables?.configKeyRenames ?? []) {
    const fromKey = entry.from?.[0]
    const to = entry.to ?? []
    if (!fromKey || to.includes(fromKey)) continue
    for (let guard = 0; guard < 100; guard++) {
      const { doc, lineCounter } = parsePatchDoc(current)
      if (doc.errors.length) break
      const target = findKeyRenameTarget(doc.contents, entry)
      if (!target) break
      const cfg = target.node.get('config', true)
      const oldValue = cfg.get(fromKey)
      cfg.delete(fromKey)
      const setScalar = (key, value) => {
        const s = new Scalar(value)
        if (typeof value === 'string' && value.includes('\n')) s.type = 'BLOCK_LITERAL'
        cfg.set(key, s)
      }
      if (entry.valueRule === 'persona.text.splitCwdSuffix' && to.includes('prefix') && to.includes('suffix')) {
        const parts = splitPersonaText(oldValue)
        setScalar('prefix', parts.prefix)
        if (parts.suffix !== undefined) setScalar('suffix', parts.suffix)
      } else if (to.length === 1) {
        setScalar(to[0], oldValue)
      } else {
        break // 无确定性规则：诚实跳过，不猜
      }
      // 行 span 替换（range 从首个 key 开始，`- ` 在 span 外；尾部换行补回）
      const [start, end] = target.node.range
      const original = current.slice(start, end)
      const trailing = /(?:\r?\n)+$/.exec(original)?.[0] ?? ''
      const body = stringifyNode(target.node).replace(/\n+$/, '')
      const pad = ' '.repeat(colOf(lineCounter, start) - 1)
      const lines = body.split('\n').map((l, i) => (i === 0 || l === '' ? l : `${pad}${l}`))
      current = current.slice(0, start) + lines.join('\n') + trailing + current.slice(end)
    }
  }
  return current
}

function findKeyRenameTarget(root, entry) {
  let found
  const visit = (node) => {
    if (found) return
    if (node instanceof YAMLMap) {
      if (node.get('name') === entry.package) {
        const cfg = node.get('config', true)
        if (cfg instanceof YAMLMap && cfg.has?.(entry.from?.[0])) {
          found = { node }
          return
        }
      }
      for (const pair of node.items) visit(pair.value)
    } else if (node instanceof YAMLSeq) {
      for (const item of node.items) visit(item)
    }
  }
  visit(root)
  return found
}

/** 对 composition 文本施加全部 L2 变换（包名/行 id 改名 + 键改名 + 本地路径改写）。 */
export function applyL2ToComposition(text, baseDir, tables) {
  return rewriteLocalPaths(applyKeyRenamesToComposition(applyRenamesToComposition(text, tables), tables), baseDir)
}

/** 组装一个预设的 insert 条目文本块（缩进 4 起步，多行）。 */
export function buildPresetItem(legacy, metadata, compositionText, tables) {
  const comp = applyL2ToComposition(compositionText, legacy.dir, tables)
  const compLines = reindentComposition(comp)
  const lines = [
    `    - id: preset-${safeId(legacy.id)}`,
    `      name: '@deepseek-ai/dsh-agent-preset'`,
    `      config:`,
    `        id: ${safeId(legacy.id)}`,
  ]
  for (const key of ['name', 'description']) {
    if (metadata[key] !== undefined) lines.push(`        ${key}: ${yamlInline(metadata[key])}`)
  }
  if (metadata.order !== undefined) lines.push(`        order: ${yamlInline(metadata.order)}`)
  lines.push(`        plugins:`)
  lines.push(...compLines)
  return lines
}

/** 找既有 patch 中第一个 `- insert:` 列表里「最后一个条目」的行号（0-based；无条目返回 insert 行号）。 */
export function findInsertListTail(text) {
  const lines = text.split('\n')
  const insertIdx = lines.findIndex((l) => /^- insert:[ \t]*(#.*)?$/.test(l))
  if (insertIdx === -1) return -1
  let tail = insertIdx
  for (let i = insertIdx + 1; i < lines.length; i++) {
    const l = lines[i]
    if (l.trim() === '') continue // 空行可能是列表间分隔，继续向后看
    if (/^[^ \t#]/.test(l)) break // 顶层新条目（如第二个 - insert:）→ 停
    if (/^[ \t]+(- |[A-Za-z_"'])/.test(l)) tail = i // 列表内容行
    // 纯注释行不影响 tail 判定
  }
  return tail
}

const HEADER_COMMENT = [
  '# 本文件由 dsh-preset-doctor 生成/追加：旧格式预设（.agent-presets/）的结构迁移结果。',
  '# 如需手工编辑，请保持 `- insert:` 列表结构与缩进（条目 4 空格起）。',
].join('\n')

/**
 * 迁移一批遗留目录到 home patch。
 * @returns 每个目录的处理结果（written/skipped/conflict/error）
 */
export function migrateLegacyDirs(legacyFindings, { home, dryRun = false, ts, tables } = {}) {
  const results = []
  if (!legacyFindings.length) return results

  // R5 排序：order 升序（缺失排后，按 id 稳定序）
  const sorted = [...legacyFindings].sort((a, b) => {
    const oa = a.data.metadata?.order
    const ob = b.data.metadata?.order
    const na = typeof oa === 'number' ? oa : Number.MAX_SAFE_INTEGER
    const nb = typeof ob === 'number' ? ob : Number.MAX_SAFE_INTEGER
    return na !== nb ? na - nb : a.data.legacy.id < b.data.legacy.id ? -1 : 1
  })

  const target = path.join(home, 'cordis.patch.yml')
  const exists = fs.existsSync(target)
  const originalText = exists ? readText(target) : ''

  // 幂等：目标已声明同 id 的跳过（scan 阶段应已标为 conflict，这里再保险一次）
  const items = []
  for (const f of sorted) {
    const { legacy, metadata } = f.data
    const compositionText = legacy.compositionFile ? readText(legacy.compositionFile) : ''
    if (!compositionText.trim()) {
      results.push({ id: legacy.id, status: 'error', message: 'agent.cordis.yml 缺失或为空' })
      continue
    }
    const rowRe = new RegExp(`^\\s*- id: ['"]?preset-${escapeRe(legacy.id)}['"]?[ \\t]*$`, 'm')
    if (exists && rowRe.test(originalText)) {
      results.push({ id: legacy.id, status: 'skipped', message: '目标 patch 已含同 id 声明' })
      continue
    }
    items.push({ finding: f, lines: buildPresetItem(legacy, metadata ?? {}, compositionText, tables) })
  }
  if (!items.length) return results

  // 组装新文本（追加块按目标文件行尾转换，避免混合行尾）
  const eol = exists ? detectEol(originalText) : '\n'
  const toEol = (block) => (eol === '\r\n' ? block.replace(/\n/g, '\r\n') : block)
  let newText
  if (!exists) {
    const allItems = items.flatMap((it) => it.lines)
    newText = `${HEADER_COMMENT}\n\n- insert:\n${allItems.join('\n')}\n`
  } else {
    const tail = findInsertListTail(originalText)
    if (tail === -1) {
      // 没有 - insert: 列表 → 追加一个（保守：仅当文件可解析时）
      const { doc } = parsePatchDoc(originalText)
      if (doc.errors.length) {
        for (const it of items) results.push({ id: it.finding.data.legacy.id, status: 'error', message: '目标 patch 非 insert 结构且解析失败，拒绝追加' })
        return results
      }
      const allItems = toEol(items.flatMap((it) => it.lines).join('\n'))
      newText = `${originalText.replace(/\n+$/, '')}\n\n- insert:\n${allItems}\n`
    } else {
      const lines = originalText.split('\n')
      const allItems = toEol(items.flatMap((it) => it.lines).join('\n'))
      lines.splice(tail + 1, 0, allItems)
      newText = lines.join('\n')
    }
  }

  const write = writeFileSafe(target, newText, originalText, { dryRun, ts })
  for (const it of items) {
    results.push({
      id: it.finding.data.legacy.id,
      status: write.status === 'written' ? 'written' : write.status === 'would-write' ? 'would-write' : 'skipped',
      target,
      backup: write.backup,
    })
  }
  return results
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
