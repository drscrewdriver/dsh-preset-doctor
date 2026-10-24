/**
 * dsh-preset-doctor — 扫描编排。
 *
 * 解析三层声明源 → 产出统一 finding 列表：
 *   { rule, level: 'auto'|'report', file, line, rowId, reason, suggestion, data }
 * level='auto' 表示机械可修（fix 阶段消费）；'report' 只报告（L3/需人工裁决）。
 *
 * 行遍历递归两层容器：预设行的 `config.plugins` 与 group 行（cordis:group）
 * 的 `config` 列表——真实预设的插件行嵌在 group 的 config 里（见 fixtures）。
 */
import { collectPatchFiles, collectLegacyDirs, readText, dirname } from './paths.js'
import { parsePatchDoc, lineOf } from './yaml-doc.js'
import { YAMLMap, YAMLSeq } from 'yaml'
import { isPresetRow, checkStruct, isLegalTopEntry } from './rules/struct.js'
import { checkPackage } from './rules/pkg.js'
import { checkConfigKeys } from './rules/persona.js'
import { checkDeadVars } from './rules/dead-var.js'
import { checkLegacyDirs } from './rules/legacy.js'
import { checkDupIds } from './rules/dup-id.js'
import { checkShadowedIds } from './rules/shadow.js'
import { checkCompositionDrift } from './rules/composition-drift.js'
import { loadTables, branchById, branchForVersion, loadBranches, loadBaseline, baselineForVersion } from './tables/load.js'
import { detectDshVersion } from './host-version.js'

function isMapNode(node) {
  return node instanceof YAMLMap
}

function isSeqNode(node) {
  return node instanceof YAMLSeq
}

function scalarOf(node, key) {
  if (!isMapNode(node)) return undefined
  const v = node.get(key)
  if (v === undefined || v === null) return undefined
  return typeof v === 'string' ? v : String(v)
}

/** 找某键的 key 节点行号（config 键改名类 finding 的定位）。 */
function keyLineOf(mapNode, key, lineCounter) {
  if (!isMapNode(mapNode)) return undefined
  const pair = mapNode.items.find((p) => p.key?.value === key)
  if (!pair?.key?.range) return undefined
  return lineOf(lineCounter, pair.key.range[0])
}

/** 分析单个行节点（任意深度）。 */
function analyzeRowNode(node, ctx, depth = 0) {
  if (!isMapNode(node)) return null
  const name = scalarOf(node, 'name')
  const row = {
    file: ctx.file,
    layer: ctx.layer,
    profile: ctx.profile,
    depth,
    id: scalarOf(node, 'id'),
    name,
    nameNode: node.get('name', true),
    line: node.range ? lineOf(ctx.lineCounter, node.range[0]) : 0,
    nameLine:
      node.get('name', true)?.range != null
        ? lineOf(ctx.lineCounter, node.get('name', true).range[0])
        : lineOf(ctx.lineCounter, node.range[0]),
    range: node.range,
    isPresetRow: isPresetRow(name),
    baseDir: ctx.baseDir,
    node,
  }
  const configNode = node.get('config', true)
  row.configNode = configNode
  row.textKeyLine = keyLineOf(configNode, 'text', ctx.lineCounter)
  if (row.isPresetRow) {
    row.presetId = scalarOf(configNode, 'id')
    row.pluginsNode = configNode ? configNode.get('plugins', true) : undefined
  }
  return row
}

/** 递归遍历一行及其全部子行（preset 行的 config.plugins、group 行的 config 列表）。 */
function* walkRows(node, ctx, depth = 0) {
  const row = analyzeRowNode(node, ctx, depth)
  if (!row) return
  yield row
  for (const container of iterChildRowContainers(node)) {
    for (const child of container.items) {
      if (!isMapNode(child)) continue
      yield* walkRows(child, ctx, depth + 1)
    }
  }
}

/** 解析单个 patch 文件。解析失败产出 R-YAML finding，不抛错。 */
export function parsePatchFile(file, layer, profile = '') {
  const text = readText(file)
  const src = {
    file,
    layer,
    profile,
    text,
    rows: [],
    presetRows: [],
    errors: [],
  }
  const { doc, lineCounter } = parsePatchDoc(text)
  src.doc = doc
  src.lineCounter = lineCounter

  const ctx = { file, layer, profile, lineCounter, baseDir: dirname(file) }

  if (doc.errors.length) {
    src.errors.push({
      rule: 'R-YAML',
      level: 'report',
      file,
      line: 1,
      rowId: '',
      reason: `YAML 解析失败：${doc.errors.map((e) => e.message).join('；')}。该文件的所有声明都不会生效`,
      suggestion: '先修复 YAML 语法（缩进/引号/标签），再跑本工具',
    })
    return src
  }
  const root = doc.contents
  if (root == null) return src // 空文件：无声明
  if (!isSeqNode(root)) {
    src.errors.push({
      rule: 'R-STRUCT',
      level: 'report',
      file,
      line: 1,
      rowId: '',
      reason: 'patch 文件根节点不是列表（应为 `- insert:` 条目的列表）',
      suggestion: '补齐结构：顶层为列表，每项是含 insert 键的映射',
    })
    return src
  }
  for (const item of root.items) {
    if (!isMapNode(item)) {
      src.errors.push({
        rule: 'R-STRUCT',
        level: 'report',
        file,
        line: item.range ? lineOf(lineCounter, item.range[0]) : 1,
        rowId: '',
        reason: '顶层列表项不是映射（应形如 `- insert: [...]` 或 id 定向覆盖行）',
        suggestion: '每项应为映射：insert 条目或 id+name 覆盖行',
      })
      continue
    }
    if (!isLegalTopEntry(item)) {
      src.errors.push({
        rule: 'R-STRUCT',
        level: 'report',
        file,
        line: item.range ? lineOf(lineCounter, item.range[0]) : 1,
        rowId: '',
        reason: '顶层映射缺少任何已知操作键（insert/remove/modify/replace/id）',
        suggestion: 'insert 列表形如 `- insert: [...]`；定向覆盖行需含 id+name',
      })
      continue
    }
    const insertNode = item.get('insert', true)
    if (insertNode == null) continue // id 定向覆盖/禁用行：合法，非预设声明，跳过
    if (!isSeqNode(insertNode)) {
      src.errors.push({
        rule: 'R-STRUCT',
        level: 'report',
        file,
        line: lineOf(lineCounter, insertNode.range?.[0] ?? item.range[0]),
        rowId: '',
        reason: 'insert 的值不是列表',
        suggestion: 'insert 后应为预设声明行列表',
      })
      continue
    }
    for (const rowNode of insertNode.items) {
      let first = true
      for (const row of walkRows(rowNode, ctx, 0)) {
        if (first) {
          src.presetRows.push(row)
          first = false
        }
        src.rows.push(row)
      }
      if (first) {
        // walkRows 一个都没产出：该列表项不是映射
        src.errors.push({
          rule: 'R-STRUCT',
          level: 'report',
          file,
          line: rowNode.range ? lineOf(lineCounter, rowNode.range[0]) : 1,
          rowId: '',
          reason: 'insert 列表项不是映射（应形如 `- id: preset-x` + `name: ...`）',
          suggestion: '每个声明行应为含 id/name/config 的映射',
        })
      }
    }
  }
  return src
}

/** 递归收集行（preset 行的 config.plugins、group 行的 config 列表、直挂的 plugins）。 */
function* iterChildRowContainers(node) {
  const direct = node.get('plugins', true)
  if (isSeqNode(direct)) yield direct
  const config = node.get('config', true)
  if (isSeqNode(config)) yield config
  else if (isMapNode(config)) {
    const plugins = config.get('plugins', true)
    if (isSeqNode(plugins)) yield plugins
  }
}

/** 已声明预设 id → 位置列表（供遗留目录冲突判定；同一行去重）。 */
export function mapDeclaredPresetIds(sources) {
  const map = new Map()
  const push = (key, loc) => {
    if (!key) return
    if (!map.has(key)) map.set(key, [])
    const list = map.get(key)
    if (!list.some((l) => l.file === loc.file && l.line === loc.line)) list.push(loc)
  }
  for (const src of sources) {
    for (const row of src.presetRows) {
      const loc = { file: src.file, line: row.line }
      push(row.presetId, loc)
      if (row.id?.startsWith('preset-')) push(row.id.slice('preset-'.length), loc)
    }
  }
  return map
}

/**
 * 解析单个遗留目录的 composition（agent.cordis.yml：顶层为插件行列表，
 * 无 - insert: 包装）。目录分支（≤0.1.5）的就地修在它产出的 rows 上进行；
 * 不产 presetRows（目录本身就是预设，没有声明行）。
 */
export function parseDirComposition(legacy) {
  const text = readText(legacy.compositionFile)
  const src = {
    file: legacy.compositionFile,
    layer: 'legacy-dir',
    profile: '',
    text,
    rows: [],
    presetRows: [],
    errors: [],
  }
  const { doc, lineCounter } = parsePatchDoc(text)
  src.doc = doc
  src.lineCounter = lineCounter
  const ctx = { file: src.file, layer: src.layer, profile: '', lineCounter, baseDir: legacy.dir }
  if (doc.errors.length) {
    src.errors.push({
      rule: 'R-YAML',
      level: 'report',
      file: src.file,
      line: 1,
      rowId: '',
      reason: `YAML 解析失败：${doc.errors.map((e) => e.message).join('；')}。该预设无法加载`,
      suggestion: '先修复 YAML 语法（缩进/引号/标签），再跑本工具',
    })
    return src
  }
  const root = doc.contents
  if (root == null) return src
  if (!isSeqNode(root)) {
    src.errors.push({
      rule: 'R-STRUCT',
      level: 'report',
      file: src.file,
      line: 1,
      rowId: '',
      reason: 'agent.cordis.yml 根节点不是列表（应为插件行列表，每项含 id/name）',
      suggestion: '顶层为列表；分组行（cordis:group）把子行放在 config 列表里',
    })
    return src
  }
  for (const rowNode of root.items) {
    for (const row of walkRows(rowNode, ctx, 0)) src.rows.push(row)
  }
  return src
}

/** 全量扫描：按适配分支决定扫描面与算法档位，事件表按分支终点截断。 */
export function scanAll({ home, scanProfiles = true, migrateLegacy = true, resolvePkg, dshVersion, branch } = {}) {
  const branches = loadBranches()
  const pinned = typeof branch === 'string' ? branchById(branch, branches) : branch
  const det = dshVersion ? { version: dshVersion, via: 'pinned' } : detectDshVersion()
  const detected = det?.version
  // 显式钉定 > 宿主版本匹配 > 回退 main（检测失败时与 0.3.x 行为一致）
  const active = pinned ?? branchForVersion(detected, branches) ?? branchById('main', branches)
  const stages = active?.stages ?? { scanPatches: true, migrateLegacy: true, fixLegacyInPlace: false }
  const { tables, warnings } = loadTables({ home, eventsUpTo: active?.endpoint })
  const sources = []
  const findings = []
  if (stages.scanPatches) {
    for (const { file, layer, profile } of collectPatchFiles(home, { scanProfiles })) {
      sources.push(parsePatchFile(file, layer, profile))
    }
  }
  const legacyDirs = collectLegacyDirs(home)
  if (stages.migrateLegacy) {
    // 声明式分支：目录是失效形态 → R-LEGACY（auto 迁移）/ 与 patch 冲突时 R-LEGACY-CONFLICT
    findings.push(...checkLegacyDirs(legacyDirs, mapDeclaredPresetIds(sources)))
  }
  if (stages.fixLegacyInPlace) {
    // 目录分支：目录是原生形态 → 不迁移，解析后按事件表就地修令牌
    for (const legacy of legacyDirs) {
      if (legacy.compositionFile) sources.push(parseDirComposition(legacy))
    }
  }
  for (const src of sources) {
    findings.push(...src.errors)
    for (const row of src.presetRows) findings.push(...checkStruct(row))
    for (const row of src.rows) {
      findings.push(
        ...checkPackage(row, tables, {
          ...(resolvePkg ? { resolvePkg } : {}),
          // 目录时代相对路径相对预设目录解析，是当时的合法语义，不算失效
          ...(src.layer === 'legacy-dir' ? { localPathsLegal: true } : {}),
        }),
      )
      findings.push(...checkConfigKeys(row, tables))
      findings.push(...checkDeadVars(row, { tables, currentVersion: detected }))
    }
  }
  findings.push(...checkDupIds(sources))
  findings.push(...checkShadowedIds(sources, resolvePkg ? { resolvePkg } : {}))
  // R-COMPOSITION-DRIFT：用户覆盖内置预设的行集 vs 运行版本基线（仅声明式时代有基线）
  findings.push(
    ...checkCompositionDrift(sources, {
      baseline: baselineForVersion(detected),
      allBaselines: loadBaseline(),
      currentVersion: detected,
    }),
  )
  if (migrateLegacy && !stages.migrateLegacy) {
    warnings.push(`设置 migrateLegacy=true 在分支 ${active?.id} 上不生效：该线目录是原生预设格式（无声明式机制）`)
  }
  // 时代判定归属：把带行区间的 finding 归到其所属的顶层预设（config.id）
  for (const f of findings) {
    const rr = f.data?.rowRange
    if (!rr) continue
    for (const src of sources) {
      if (src.file !== f.file) continue
      const owner = src.presetRows.find((p) => p.range && p.range[0] <= rr[0] && rr[1] <= p.range[1])
      if (owner?.presetId) {
        f.presetId = owner.presetId
        break
      }
    }
  }
  return { home, sources, findings, tables, warnings, branch: active, detectedVersion: dshVersion ?? detected, detectedVia: det?.via, detectedPath: det?.path }
}
