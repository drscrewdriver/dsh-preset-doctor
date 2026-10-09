/**
 * dsh-preset-doctor — 修复编排。
 *
 * 两阶段（先文本编辑后迁移，同一文件的追加读的是编辑后的最新盘上内容）：
 * 1. patch 文件内 span 编辑（R-PKG-RENAMED / R-KEY-RENAMED / R-LOCAL-PATH）：
 *    按文件分组 → 规划 span → splice → 备份 + 原子写
 * 2. 遗留目录迁移（R-LEGACY）：合并排序后一次性追加进 home patch
 *
 * report 级 finding 一律不写盘。
 */
import { planFileEdits } from './planner.js'
import { migrateLegacyDirs } from './migrate-legacy.js'
import { writeFileSafe, defaultTimestamp, displayPath } from './core.js'

export function applyFixes({ home, sources, findings, tables }, { dryRun = false, ts = defaultTimestamp() } = {}) {
  const results = {
    dryRun,
    ts,
    files: [], // [{ file, status, backup, rules: [...]}]
    migrated: [], // [{ id, status, target, backup?, message? }]
    errors: [], // [{ file?, id?, rule?, message }]
  }

  // ── 阶段 1：patch 内 span 编辑 ──
  const byFile = new Map()
  for (const f of findings) {
    if (f.level !== 'auto' || f.rule === 'R-LEGACY') continue
    if (!byFile.has(f.file)) byFile.set(f.file, [])
    byFile.get(f.file).push(f)
  }
  const srcByFile = new Map(sources.map((s) => [s.file, s]))
  for (const [file, list] of byFile) {
    const src = srcByFile.get(file)
    if (!src) {
      results.errors.push({ file, rule: list[0].rule, message: '找不到已解析的源（内部错误）' })
      continue
    }
    try {
      const { edits, newText } = planFileEdits(list, src)
      const write = writeFileSafe(file, newText, src.text, { dryRun, ts })
      results.files.push({
        file: displayPath(file),
        status: write.status,
        backup: write.backup,
        rules: [...new Set(edits.map((e) => e.rule))],
        editCount: edits.length,
      })
    } catch (e) {
      results.errors.push({ file, rule: list.map((f) => f.rule).join(','), message: e.message })
    }
  }

  // ── 阶段 2：遗留目录迁移（用扫描时生效的迁移表）──
  const legacyFindings = findings.filter((f) => f.rule === 'R-LEGACY')
  results.migrated.push(...migrateLegacyDirs(legacyFindings, { home, dryRun, ts, tables }))

  return results
}
