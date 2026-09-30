/**
 * dsh-preset-manager — R-ID-SHADOWED：预设 id 与内置预设同名（断裂点 B）。
 *
 * 0.1.2-alpha.1（commit f94495e527）起 resolvedRoots 把 shipped 根前置：
 * 用户预设与内置预设同 id 时**内置赢**，用户声明不生效——表现为「卡片看不见」
 * 或「怎么改都没反应」，而非加载失败，极难排查。
 *
 * 数据源是**运行安装**内的 `@deepseek-ai/dsh-web-app/presets/*.patch.yml`
 * （插件进程内直接可读，零网络依赖）。fail-soft：定位失败静默跳过。
 */
import path from 'node:path'
import fs from 'node:fs'
import { resolvePkg as defaultResolve } from '../pkg-resolve.js'
import { loadPatch } from '../yaml-doc.js'

/** 收集安装内置预设 id → 声明文件。任何缺失/损坏均静默降级为空表。 */
export function collectShippedPresetIds(resolvePkg = defaultResolve) {
  const ids = new Map()
  try {
    const res = resolvePkg('@deepseek-ai/dsh-web-app')
    if (!res?.ok || !res.resolvedPath) return ids
    let pkgDir = res.resolvedPath
    try {
      if (fs.statSync(pkgDir).isFile()) pkgDir = path.dirname(pkgDir)
    } catch {
      return ids
    }
    const presetsDir = path.join(pkgDir, 'presets')
    let entries = []
    try {
      entries = fs.readdirSync(presetsDir)
    } catch {
      return ids
    }
    for (const f of entries.filter((n) => n.endsWith('.patch.yml')).sort()) {
      const file = path.join(presetsDir, f)
      try {
        const val = loadPatch(fs.readFileSync(file, 'utf8'))
        for (const item of Array.isArray(val) ? val : []) {
          const rows = item?.insert
          if (!Array.isArray(rows)) continue
          for (const row of rows) {
            const id = row?.config?.id
            if (typeof id === 'string' && id) ids.set(id, file)
          }
        }
      } catch {
        /* 单文件损坏跳过 */
      }
    }
  } catch {
    /* 定位失败跳过 */
  }
  return ids
}

/** 用户声明 id 与内置预设求交集 → report 级 finding。 */
export function checkShadowedIds(sources, { resolvePkg } = {}) {
  const findings = []
  const shipped = collectShippedPresetIds(resolvePkg)
  if (!shipped.size) return findings
  for (const src of sources) {
    for (const row of src.presetRows) {
      if (!row.presetId || !shipped.has(row.presetId)) continue
      findings.push({
        rule: 'R-ID-SHADOWED',
        level: 'report',
        file: src.file,
        line: row.line,
        rowId: row.id,
        presetId: row.presetId,
        reason: `预设 id「${row.presetId}」与安装内置预设同名（${shipped.get(row.presetId)}）。0.1.2-alpha.1（commit f94495e527）起 resolvedRoots 把 shipped 根前置，同 id 时内置赢——你的声明不会生效（「卡片看不见」的常见原因）`,
        suggestion: '改用自定义 id（推荐）；若本意是覆盖内置预设，请注意当前版本下覆盖并不生效',
        data: { presetId: row.presetId, shippedFile: shipped.get(row.presetId) },
      })
    }
  }
  return findings
}
