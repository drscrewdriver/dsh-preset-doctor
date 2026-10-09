/**
 * dsh-preset-doctor — R-LEGACY / R-LEGACY-CONFLICT：旧格式预设目录。
 *
 * 0.1.7-alpha.1（commit d1e22a7e24）整体移除 `.agent-presets/` 目录扫描，
 * 改为 cordis.patch.yml 声明式注册。遗留目录在新机制下**根本不会注册**
 * （预设从 UI 消失，而非标红）。
 *
 * - 目录存在且 patch 未声明同 id → R-LEGACY（auto：结构迁移为 insert 声明）
 * - 目录存在且 patch 已声明同 id → R-LEGACY-CONFLICT（report：删目录或删声明，人工裁决）
 */
import { readText, METADATA_FILE } from '../paths.js'
import { loadPatch } from '../yaml-doc.js'

/** 读 preset.yml 元数据（缺字段不补空，交由注册表默认——PRD R2）。 */
export function readLegacyMetadata(legacyDir) {
  if (!legacyDir.metadataFile) return {}
  try {
    const meta = loadPatch(readText(legacyDir.metadataFile))
    if (meta == null || typeof meta !== 'object') return {}
    const out = {}
    for (const key of ['name', 'description', 'order']) {
      if (meta[key] !== undefined) out[key] = meta[key]
    }
    return out
  } catch {
    return {}
  }
}

/**
 * @param {Array} legacyDirs collectLegacyDirs() 结果
 * @param {Map<string, Array>} declaredPresetIds patch 中已声明的 preset id → 位置列表
 */
export function checkLegacyDirs(legacyDirs, declaredPresetIds) {
  const findings = []
  for (const legacy of legacyDirs) {
    const declared = declaredPresetIds.get(legacy.id)
    if (declared?.length) {
      findings.push({
        rule: 'R-LEGACY-CONFLICT',
        level: 'report',
        file: legacy.dir,
        line: 0,
        rowId: `preset-${legacy.id}`,
        reason: `旧格式目录 .agent-presets/${legacy.id} 与 patch 声明（${declared.map((d) => `${d.file}`).join(', ')}）同时存在，会重复插入同一预设`,
        suggestion: '二选一：删除遗留目录（推荐，声明已迁移），或删除 patch 中对应声明',
        data: { legacy },
      })
      continue
    }
    findings.push({
      rule: 'R-LEGACY',
      level: 'auto',
      file: legacy.dir,
      line: 0,
      rowId: `preset-${legacy.id}`,
      reason: `旧格式预设目录 .agent-presets/${legacy.id}/ 存在。0.1.7-alpha.1 起目录扫描机制已移除，该预设不会注册（UI 中直接消失）`,
      suggestion: `自动迁移为 cordis.patch.yml 的 - insert: 声明（行 id: preset-${legacy.id}）`,
      data: { legacy, metadata: readLegacyMetadata(legacy), brokenIn: '0.1.7-alpha.1' },
    })
  }
  return findings
}

export { METADATA_FILE }
