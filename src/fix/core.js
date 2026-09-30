/**
 * dsh-preset-manager — 写盘安全契约（所有写操作经此）。
 *
 * 1. 新文与原文相同 → 跳过（幂等：重复运行 0 写操作）
 * 2. 写前备份 <file>.bak-<ts>（同一运行同一文件只备份一次，保留最初的原文）
 * 3. 临时文件 + rename 原子替换
 * 4. UTF-8 无 BOM（yaml.stringify 本就不产 BOM；读入的 BOM 原样保留在未触碰部分）
 * 5. dryRun 全程 0 写盘
 */
import fs from 'node:fs'
import path from 'node:path'

export function defaultTimestamp(now = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${p(now.getFullYear())}${p(now.getMonth() + 1)}${p(now.getDate())}T${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
}

export function backupPathFor(file, ts) {
  return `${file}.bak-${ts}`
}

export function detectEol(text) {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

/**
 * 原子写入（含备份与幂等跳过）。
 * @returns {{status: 'written'|'skipped'|'would-write', backup?: string}}
 */
export function writeFileSafe(file, newText, originalText, { dryRun = false, ts = defaultTimestamp() } = {}) {
  if (newText === originalText) return { status: 'skipped' }
  const backup = backupPathFor(file, ts)
  if (dryRun) return { status: 'would-write', backup }
  // 新建文件（原不存在）无需备份；已存在的文件同 ts 只备份一次（保留最初的原文）
  if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup)
  const tmp = `${file}.tmp-preset-manager-${process.pid}`
  fs.writeFileSync(tmp, newText, 'utf8')
  fs.renameSync(tmp, file)
  return { status: 'written', backup: fs.existsSync(backup) ? backup : undefined }
}

/** 在文本上应用一组 span 编辑（{start,end,text}），从后往前 splice；重叠视为程序错误抛出。 */
export function spliceEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start)
  let out = text
  let prevStart = Infinity
  for (const e of sorted) {
    if (e.end > prevStart) throw new Error(`编辑区间重叠：[${e.start},${e.end}) 越过 ${prevStart}`)
    if (e.start < 0 || e.end > text.length || e.start >= e.end) {
      throw new Error(`编辑区间非法：[${e.start},${e.end}) 文本长度 ${text.length}`)
    }
    out = out.slice(0, e.start) + e.text + out.slice(e.end)
    prevStart = e.start
  }
  return out
}

/** 统一给报告用的绝对路径（还原 junction）。 */
export function displayPath(p) {
  try {
    return fs.realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}
