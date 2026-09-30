/**
 * dsh-preset-manager — R-DUP-ID：重复声明检测。
 *
 * 两类（都只报告，不自动裁决删哪个）：
 * 1. 同一 patch 文件内：两行 preset 声明行 id 相同（`preset-*` 行 id 须全文件唯一）
 * 2. 跨层级：同一预设 id（config.id）在 home 级与 profile 级同时声明
 *    ——「不要在 home 级和 profile 级同时声明同一预设，会重复插入」（故障记录 §3）
 */

export function checkDupIds(sources) {
  const findings = []
  // 1) 文件内行 id 重复
  for (const src of sources) {
    const byRowId = new Map()
    for (const row of src.rows) {
      if (!row.isPresetRow || !row.id) continue
      if (!byRowId.has(row.id)) byRowId.set(row.id, [])
      byRowId.get(row.id).push(row)
    }
    for (const [rowId, rows] of byRowId) {
      if (rows.length < 2) continue
      findings.push({
        rule: 'R-DUP-ID',
        level: 'report',
        file: src.file,
        line: rows[1].line,
        rowId,
        reason: `行 id ${rowId} 在 ${src.file} 中出现 ${rows.length} 次（第 ${rows.map((r) => r.line).join('、')} 行）。同一 patch 内行 id 必须唯一`,
        suggestion: '合并或重命名重复的声明行（人工裁决保留哪份）',
        data: { locations: rows.map((r) => `${src.file}:${r.line}`) },
      })
    }
  }
  // 2) 跨层级预设 id 重复
  const byPresetId = new Map()
  for (const src of sources) {
    for (const row of src.rows) {
      if (!row.isPresetRow || !row.presetId) continue
      if (!byPresetId.has(row.presetId)) byPresetId.set(row.presetId, [])
      byPresetId.get(row.presetId).push(row)
    }
  }
  for (const [presetId, rows] of byPresetId) {
    const files = [...new Set(rows.map((r) => r.file))]
    if (files.length < 2) continue
    findings.push({
      rule: 'R-DUP-ID',
      level: 'report',
      file: files[1],
      line: rows.find((r) => r.file === files[1]).line,
      rowId: rows[0].id,
      reason: `预设 id ${presetId} 在多个层级同时声明：${rows.map((r) => `${r.file}:${r.line}(${r.layer})`).join('、')}。home 级对所有 profile 生效，跨层重复会重复插入`,
      suggestion: '保留一处声明（推荐 home 级），删除其余',
      data: { locations: rows.map((r) => `${r.file}:${r.line}`) },
    })
  }
  return findings
}
