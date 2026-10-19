/**
 * dsh-preset-doctor — R-LEGACY-CONFLICT 授权转写收尾。
 *
 * 场景：遗留目录早已被本插件转写进 patch（声明存在），但目录残留 → 冲突
 * report 级。此前只报不修（「需人工」），现恢复授权自动收尾（显式确认 +
 * 双确认 UI + 操作前备份，不要求用户手工动文件）：
 * 1. 对齐既有转写声明——以当前版本默认预设为参照删漂移行
 *    （内置 id → planAlignForPreset；自定义 id → planAlignForCustomPreset），
 *    写盘走 writeFileSafe（.bak 备份 + 原子写 + 幂等）。
 * 2. 遗留目录**归档**（rename 移动，绝不删除）到
 *    <home>/preset-doctor-archive/<ts>/<id>/——目录名以 `preset-doctor-archive`
 *    开头，不在任何扫描面（.agent-presets / profiles）内，天然不会再被检出。
 *
 * 无声明可对齐（版本判不出基线）→ 只归档并如实报告；声明找不到 → 拒绝。
 */
import fs from 'node:fs'
import path from 'node:path'
import { planAlignForPreset, planAlignForCustomPreset } from './composition-align.js'
import { spliceEdits, writeFileSafe, displayPath } from './core.js'
import { baselineForVersion, loadBaseline } from '../tables/load.js'

export const ARCHIVE_DIR_NAME = 'preset-doctor-archive'

/**
 * 把遗留目录整体移入归档区（同盘 rename，跨盘失败如实报错，不做静默删除）。
 * @returns {{status:'archived'|'would-archive'|'absent'|'error', from:string, to?:string, message?:string}}
 */
export function archiveLegacyDir(dir, { home, ts, dryRun = false } = {}) {
  const from = path.resolve(dir)
  if (!fs.existsSync(from)) return { status: 'absent', from }
  const base = path.basename(from)
  let to = path.join(home, ARCHIVE_DIR_NAME, ts, base)
  for (let n = 2; fs.existsSync(to); n++) to = path.join(home, ARCHIVE_DIR_NAME, ts, `${base}-${n}`)
  if (dryRun) return { status: 'would-archive', from, to }
  try {
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.renameSync(from, to)
    return { status: 'archived', from, to }
  } catch (e) {
    return { status: 'error', from, message: e.message }
  }
}

/** 在 scan.sources 里找声明了该 id 的预设行（优先 declaredFiles）。 */
function findDeclaration(sources, id, declaredFiles = []) {
  const preferred = new Set(declaredFiles)
  let fallback = null
  for (const src of Array.isArray(sources) ? sources : []) {
    for (const presetRow of Array.isArray(src.presetRows) ? src.presetRows : []) {
      if (presetRow.presetId !== id) continue
      if (preferred.has(src.file)) return { src, presetRow }
      fallback ??= { src, presetRow }
    }
  }
  return fallback
}

/**
 * 冲突收尾编排（纯函数，confirm 门在调用方 runResolveLegacy）。
 * @param {Array} conflictFindings R-LEGACY-CONFLICT findings
 * @param {{home:string, sources:Array, detectedVersion?:string, dryRun?:boolean, ts:string}} ctx
 */
export function resolveLegacyConflicts(conflictFindings, { home, sources, detectedVersion, dryRun = false, ts } = {}) {
  const results = []
  const baseline = baselineForVersion(detectedVersion)
  const allBaselines = loadBaseline()
  for (const f of Array.isArray(conflictFindings) ? conflictFindings : []) {
    const legacy = f.data?.legacy
    if (!legacy?.id || !legacy?.dir) {
      results.push({ id: legacy?.id, status: 'error', message: 'finding 缺 data.legacy（内部错误）' })
      continue
    }
    const declaredFiles = (f.data.declared ?? []).map((d) => d.file)
    const decl = findDeclaration(sources, legacy.id, declaredFiles)
    if (!decl) {
      results.push({ id: legacy.id, status: 'error', message: `patch 中找不到预设 ${legacy.id} 的声明（可能已被删除），请重跑扫描` })
      continue
    }
    const out = { id: legacy.id, status: 'resolved', file: decl.src.file, aligned: null, backup: undefined, archive: null }
    // 步 1：转写声明对齐到当前版本默认预设参照（无基线判定时跳过并如实报告）
    if (!baseline) {
      out.aligned = { status: 'no-baseline', removed: [], missing: [] }
    } else {
      const isBuiltin = Boolean(baseline.presets?.[legacy.id])
      const plan = isBuiltin
        ? planAlignForPreset(decl.src, decl.presetRow, { baseline, allBaselines })
        : planAlignForCustomPreset(decl.src, decl.presetRow, { baseline, allBaselines })
      if (plan.edits.length === 0) {
        out.aligned = { status: 'noop', removed: [], missing: plan.missing ?? [] }
      } else {
        try {
          const newText = spliceEdits(decl.src.text, plan.edits)
          const write = writeFileSafe(decl.src.file, newText, decl.src.text, { dryRun, ts })
          out.aligned = { status: write.status, removed: plan.removed, missing: plan.missing ?? [] }
          out.backup = write.backup
          if (write.status === 'written' || write.status === 'would-write') {
            decl.src.text = newText // 同批多预设共享源：行 range 基于旧文本，重扫前只保内存一致
          }
        } catch (e) {
          out.aligned = { status: 'error', message: e.message, removed: [], missing: [] }
        }
      }
    }
    // 步 2：归档遗留目录（对齐失败不拦归档——目录本就失效形态；但写盘异常时保守停步）
    if (out.aligned.status === 'error') {
      out.status = 'error'
      out.message = `对齐失败，未归档：${out.aligned.message}`
      results.push(out)
      continue
    }
    out.archive = archiveLegacyDir(legacy.dir, { home, ts, dryRun })
    if (out.archive.status === 'error') {
      out.status = 'partial'
      out.message = `声明已处理，但目录归档失败：${out.archive.message}（目录保留原位，无重复插入以外的新影响）`
    } else if (out.archive.status === 'absent') {
      out.status = 'resolved'
      out.message = '遗留目录已不存在（可能已被移动）'
    }
    results.push(out)
  }
  return results
}

/**
 * 桥/命令入口：单卡授权转写收尾。confirm 硬门（UI 双确认后的第二道服务端闸）。
 * @param {{home,sources,findings,detectedVersion}} scanResult
 * @param {{key:string, confirm:boolean, dryRun?:boolean, ts:string}} opts key=卡 key（legacy|<id>|<dir>）
 */
export function runResolveLegacy(scanResult, { key, confirm = false, dryRun = false, ts } = {}) {
  const out = { dryRun, ts, status: 'noop', results: [], errors: [] }
  if (confirm !== true) {
    out.status = 'rejected'
    out.errors.push({ message: '写盘需显式确认 confirm:true' })
    return out
  }
  const parts = String(key ?? '').split('|')
  if (parts.length < 3 || parts[0] !== 'legacy') {
    out.status = 'bad-key'
    out.errors.push({ message: `key 应为 legacy|<id>|<目录>：${key ?? ''}` })
    return out
  }
  const dir = parts.slice(2).join('|')
  const findings = (Array.isArray(scanResult?.findings) ? scanResult.findings : []).filter(
    (f) => f.rule === 'R-LEGACY-CONFLICT' && f.data?.legacy?.dir === dir,
  )
  if (!findings.length) {
    out.status = 'not-found'
    out.errors.push({ message: '该卡已不再是冲突形态（可能已转写/已归档），请刷新清单' })
    return out
  }
  out.results = resolveLegacyConflicts(findings, {
    home: scanResult.home,
    sources: scanResult.sources,
    detectedVersion: scanResult.detectedVersion,
    dryRun,
    ts,
  })
  for (const r of out.results) {
    if (r.status === 'error') out.errors.push({ id: r.id, message: r.message })
    if (r.status === 'partial') out.errors.push({ id: r.id, message: r.message })
  }
  out.results = out.results.map((r) => ({ ...r, file: r.file ? displayPath(r.file) : r.file, archive: r.archive ? { ...r.archive, from: displayPath(r.archive.from), to: r.archive.to ? displayPath(r.archive.to) : r.archive.to } : null }))
  out.status = out.results.some((r) => r.status === 'error')
    ? 'error'
    : dryRun
      ? 'would-resolve'
      : 'resolved'
  return out
}
