/**
 * dsh-preset-doctor — 结构化报告与文本渲染。
 *
 * 免责声明是报告的第一行：本工具保证「语法合法可加载」，
 * 不保证「行为等价」。
 */

import { compareSemver, loadBranches } from './tables/load.js'

export const DISCLAIMER =
  '注意：本报告只保证修复后的预设「语法合法、可加载」；不保证与旧版本「行为等价」。修复生效需重启 DSH 进程。'

/** 给 finding 编号并按 文件/行 排序，供文本与 JSON 输出共用。 */
export function normalizeFindings(findings) {
  const sorted = [...findings].sort(
    (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : (a.line ?? 0) - (b.line ?? 0)),
  )
  return sorted.map((f, i) => ({ no: i + 1, ...f }))
}

/**
 * 起点时代判定：每个预设按它命中的失效事件（brokenIn）推断「写于哪个时代」，
 * 以及要收敛到当前安装需要跨越哪几个版本节点。
 * 这是「不同分支终点不同」的可视化：起点越老，跨越的节点越多，但终点同为当前安装。
 */
export function eraAnalysis(findings) {
  const byPreset = new Map()
  for (const f of findings) {
    const brokenIn = f.data?.brokenIn ?? (f.rule === 'R-LEGACY' || f.rule === 'R-LEGACY-CONFLICT' ? '0.1.7-alpha.1' : undefined)
    if (!brokenIn) continue
    const key = f.presetId ?? (f.rowId?.startsWith('preset-') ? f.rowId.slice('preset-'.length) : f.rowId || f.file)
    if (!byPreset.has(key)) byPreset.set(key, { preset: key, events: [] })
    const e = byPreset.get(key)
    if (!e.events.some((x) => x.rule === f.rule && x.brokenIn === brokenIn)) {
      e.events.push({ rule: f.rule, brokenIn })
    }
  }
  for (const e of byPreset.values()) {
    let era = e.events[0].brokenIn
    for (const ev of e.events) if (compareSemver(ev.brokenIn, era) < 0) era = ev.brokenIn
    e.baseEra = `≤${era}` // 该预设的语法写于这个版本之前
    e.hops = e.events.map((x) => x.brokenIn).sort(compareSemver) // 跨越的版本节点
  }
  return [...byPreset.values()]
}

/**
 * 代际目录（展示名自梳理，由 branches.json 的 presetFormat 派生，不新建表）：
 * 官方 PresetDefinition 无任何版本字段，「代际」是本插件自产概念。
 */
export const ERA_CATALOG = Object.freeze([
  Object.freeze({
    format: 'legacy-dir',
    name: '目录预设期',
    range: '0.1.0 – 0.1.5',
    note: '.agent-presets/<id>/ 目录即格式；agent.cordis.yml 就地令牌修复',
  }),
  Object.freeze({
    format: 'declarative-patch',
    name: '声明 Patch 期',
    range: '0.1.7α1+',
    note: 'cordis.patch.yml 声明式插入（- insert:）。本代只管格式；内置组合于 0.2.1 起漂移属另一轴（见 preset-baseline / R-COMPOSITION-DRIFT），不在代标签里叠版本号',
  }),
])

/** 当前分支所处代际（catalog 内引用）。 */
export function eraForBranch(branch) {
  const format = branch?.presetFormat
  return ERA_CATALOG.find((e) => e.format === format) ?? ERA_CATALOG[ERA_CATALOG.length - 1]
}

/** 代际目录 + 当前高亮（桥 list 路由消费）。两层：大代=格式（目录/声明），小代=该格式下的 rc 线。 */
export function eraCatalogFor(branch) {
  const branches = loadBranches()
  const curFormat = branch?.presetFormat
  const curLine = branch?.line
  return ERA_CATALOG.map((e) => {
    const minors = branches
      .filter((b) => b.presetFormat === e.format)
      .map((b) => b.line)
      .sort(compareSemver)
    return {
      ...e,
      current: e.format === curFormat,
      minors: minors.map((line) => ({ line, current: e.format === curFormat && line === curLine })),
    }
  })
}

/** 从 preset 行的 config 节点读标量展示字段（容错：非映射/缺键返 undefined）。 */
function configScalar(configNode, key) {
  if (!configNode || typeof configNode.get !== 'function') return undefined
  try {
    const v = configNode.get(key)
    if (v === undefined || v === null) return undefined
    return typeof v === 'string' ? v : String(v)
  } catch {
    return undefined
  }
}

function displayId(row) {
  return (
    row.presetId ??
    (typeof row.id === 'string' && row.id.startsWith('preset-') ? row.id.slice('preset-'.length) : row.id) ??
    `#${row.line ?? '?'}`
  )
}

/**
 * 预设清单（卡片化 UI 的数据源）——union 三路后 (id,file) 去重：
 * ① 声明式分支 sources[].presetRows（home/profile patch 声明）
 * ② 遗留目录 findings（R-LEGACY / R-LEGACY-CONFLICT 的 data.legacy，声明式分支下目录只出现在 findings）
 * ③ 目录分支 sources[].rows（layer='legacy-dir'，目录即原生格式，无 presetRows）
 * 健康预设没有 eraAnalysis 条目 → 补 current；全程空安全（旧 scanResult 无 sources 不炸）。
 */
export function collectPresets(scanResult) {
  const sources = Array.isArray(scanResult?.sources) ? scanResult.sources : []
  const findings = Array.isArray(scanResult?.findings) ? scanResult.findings : []
  const eraByPreset = new Map(eraAnalysis(findings).map((e) => [e.preset, e]))
  // registry 默认选择集（删预设护栏与 UI 徽章用）：顶层 id 覆盖行里的 selectedDefault/default
  const defaultIds = new Set()
  for (const src of sources) {
    const pool = [...(Array.isArray(src.overrideRows) ? src.overrideRows : []), ...(Array.isArray(src.rows) ? src.rows : [])]
    for (const row of pool) {
      if (!/dsh-agent-preset-registry$/.test(String(row?.name ?? ''))) continue
      for (const key of ['selectedDefault', 'default']) {
        const v = configScalar(row.configNode, key)
        if (v) defaultIds.add(v)
      }
    }
  }
  const presets = []
  const seen = new Set()

  const brokenFor = (p) =>
    findings.filter((f) => {
      if (f.rule === 'R-LEGACY' || f.rule === 'R-LEGACY-CONFLICT') {
        return p.source === 'legacy' && f.file === p.file
      }
      // 提示词注入（R-INJECT-*）的 finding 落在 .md 上，归属靠 data 里的预设上下文：
      // 不加这一条，注入问题就只留在全局列表里，所属预设卡会显示「已同步」
      if (typeof f.rule === 'string' && f.rule.startsWith('R-INJECT-') && f.data?.presetFile) {
        return f.data.presetFile === p.file && String(f.data.presetId ?? '') === String(p.id)
      }
      const pid = f.presetId ?? (typeof f.rowId === 'string' && f.rowId.startsWith('preset-') ? f.rowId.slice('preset-'.length) : f.rowId)
      return pid === p.id && f.file === p.file
    })

  const push = (p) => {
    const key = `${p.source}|${p.id}|${p.file}`
    if (seen.has(key)) return
    seen.add(key)
    p.key = key
    p.isDefault = defaultIds.has(String(p.id))
    p.broken = brokenFor(p)
    const era = eraByPreset.get(String(p.id))
    if (era) p.era = { baseEra: era.baseEra, hops: era.hops }
    p.current = p.broken.length === 0
    // R-LEGACY-CONFLICT 虽为 report 级，但有独立授权转写收尾动作（resolve-legacy），
    // 卡面同样可同步；其余 report 级仍不开放。
    p.syncable = !p.current && p.broken.some((f) => f.level === 'auto' || f.rule === 'R-LEGACY-CONFLICT')
    presets.push(p)
  }

  for (const src of sources) {
    if (src.layer === 'legacy-dir') {
      // 目录分支：目录本身即预设；id/metadata 从对应 legacy finding 取（可能没有）
      const lf = findings.find(
        (f) => (f.rule === 'R-LEGACY' || f.rule === 'R-LEGACY-CONFLICT') && f.data?.legacy?.compositionFile === src.file,
      )
      const legacy = lf?.data?.legacy
      const id = legacy?.id ?? String(src.file).replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? 'legacy-dir'
      const meta = lf?.data?.metadata ?? {}
      push({
        source: 'legacy',
        id,
        name: typeof meta.name === 'string' ? meta.name : undefined,
        description: typeof meta.description === 'string' ? meta.description : undefined,
        file: src.file,
        line: 0,
      })
      continue
    }
    for (const row of Array.isArray(src.presetRows) ? src.presetRows : []) {
      if (!row.presetId && !row.id) continue
      const id = String(displayId(row))
      push({
        source: src.layer === 'home' ? 'home' : `profile:${src.profile ?? ''}`,
        id,
        name: configScalar(row.configNode, 'name'),
        description: configScalar(row.configNode, 'description'),
        file: src.file,
        line: row.line ?? 0,
      })
    }
  }
  // 遗留目录只出现在 findings 的形态（声明式分支）：sources 里没有它的源
  for (const f of findings) {
    if (f.rule !== 'R-LEGACY' && f.rule !== 'R-LEGACY-CONFLICT') continue
    const legacy = f.data?.legacy
    if (!legacy) continue
    const meta = f.data?.metadata ?? {}
    push({
      source: 'legacy',
      id: String(legacy.id),
      name: typeof meta.name === 'string' ? meta.name : undefined,
      description: typeof meta.description === 'string' ? meta.description : undefined,
      file: legacy.dir,
      line: 0,
    })
  }

  presets.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return presets
}

/** 面向 UI 的预设轻量视图（broken 摘去内部 data；key 供 sync 回传）。 */
export function presetsForUi(presets) {
  return presets.map((p) => ({
    key: p.key,
    id: p.id,
    name: p.name ?? `${p.id}（未命名）`,
    description: p.description ?? '',
    source: p.source,
    file: p.file,
    line: p.line ?? 0,
    era: p.era ?? null,
    current: p.current,
    syncable: p.syncable,
    isDefault: p.isDefault === true,
    broken: p.broken.map((f) => ({ rule: f.rule, level: f.level, line: f.line, reason: f.reason, suggestion: f.suggestion })),
  }))
}

export function summarize(scanResult, fixResult) {
  const findings = normalizeFindings(scanResult.findings)
  const byLevel = { auto: 0, report: 0 }
  for (const f of findings) byLevel[f.level] = (byLevel[f.level] ?? 0) + 1
  const byRule = {}
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1
  return {
    home: scanResult.home,
    branch: scanResult.branch
      ? {
          id: scanResult.branch.id,
          line: scanResult.branch.line,
          endpoint: scanResult.branch.endpoint,
          baseline: scanResult.branch.baseline,
          presetFormat: scanResult.branch.presetFormat,
          npmTag: scanResult.branch.npmTag,
          peer: scanResult.branch.peer,
          hostRange: scanResult.branch.hostRange,
        }
      : undefined,
    detectedVersion: scanResult.detectedVersion,
    detectedVersionVia: scanResult.detectedVia,
    // 扫描源清单（升级观测用）：预设「存在哪」是否随版本变，报告里直接列出来，
    // 不用人去猜 home / profile / legacy-dir 哪个还在。
    sources: (Array.isArray(scanResult.sources) ? scanResult.sources : []).map((s) => ({
      file: s.file,
      layer: s.layer,
      profile: s.profile ?? '',
      rows: Array.isArray(s.rows) ? s.rows.length : 0,
      presets: Array.isArray(s.presetRows) ? s.presetRows.length : 0,
      overrides: Array.isArray(s.overrideRows) ? s.overrideRows.length : 0,
      errors: Array.isArray(s.errors) ? s.errors.length : 0,
    })),
    total: findings.length,
    byLevel,
    byRule,
    findings,
    // 读到的提示词注入清单（注入目录 → 条目）：报告与卡面共用一份
    prompts: Array.isArray(scanResult.promptDirs) ? scanResult.promptDirs : [],
    presets: presetsForUi(collectPresets(scanResult)),
    eras: eraAnalysis(findings),
    fix: fixResult
      ? {
          dryRun: fixResult.dryRun,
          filesWritten: fixResult.files.filter((f) => f.status === 'written').length,
          filesWouldWrite: fixResult.files.filter((f) => f.status === 'would-write').length,
          migrated: fixResult.migrated,
          errors: fixResult.errors,
        }
      : null,
  }
}

/** 文本报告（供 logger / /preset-doctor 命令）。 */
export function renderText(summary) {
  const L = []
  L.push(DISCLAIMER)
  L.push('')
  L.push(`dsh-preset-doctor 扫描报告 — 根目录: ${summary.home}`)
  if (summary.branch) {
    const b = summary.branch
    const via = summary.detectedVersion ? `，宿主 ${summary.detectedVersion}` : '，未检出版本，回退默认'
    L.push(
      `适配分支: ${b.id}（${b.line} 线 · 处理终点 ${b.endpoint} · peer ${b.peer?.package ?? '?'}@${b.peer?.version ?? '?'} · 格式 ${b.presetFormat}${via}）`,
    )
  }
  L.push(`预设声明问题共 ${summary.total} 处（机械可修 ${summary.byLevel.auto ?? 0}，需人工 ${summary.byLevel.report ?? 0}）`)
  // 升级观测：把「这一轮到底扫到了哪几个落点」明写出来（空落点=该位置没东西，不是扫不到）
  if (Array.isArray(summary.sources) && summary.sources.length) {
    L.push(`扫描源 ${summary.sources.length} 处：`)
    for (const s of summary.sources) {
      const where = s.profile ? `${s.layer}/${s.profile}` : s.layer
      // 覆盖行（顶层 id 定向 disabled / registry 选择）也算声明：只看行/预设会误读成「空文件」
      const detail = s.rows || s.presets || s.overrides
        ? `行 ${s.rows} · 预设 ${s.presets}${s.overrides ? ` · 覆盖 ${s.overrides}` : ''}`
        : '无声明'
      L.push(`  [${where}] ${s.file}（${detail}${s.errors ? ` · 解析错误 ${s.errors}` : ''}）`)
    }
  }
  if (Array.isArray(summary.prompts) && summary.prompts.length) {
    // 提示词注入（studio 结构）：报告里直接列出「读了哪些、几条生效、几条有问题」，
    // 否则「改了没反应」只能靠人猜——文件在、投递器缺席/格式坏了是两回事。
    L.push('')
    L.push(`预设提示词（注入）${summary.prompts.length} 处：`)
    for (const p of summary.prompts) {
      const who = p.presetId ? `预设 ${p.presetId}` : '未关联预设'
      const state = p.missing
        ? '目录不存在'
        : p.wired === false
          ? '未接投递器行'
          : `${p.total} 条 · 生效 ${p.enabled}${p.disabled ? ` · 关闭 ${p.disabled}` : ''}${p.issues ? ` · 格式问题 ${p.issues}` : ''}`
      L.push(`  [${who}] ${p.dir}（${state}）`)
      for (const e of p.entries ?? []) {
        L.push(
          `      ${e.enabled ? '·' : 'x'} ${e.name}  ${e.role}/${e.order}  ${e.chars} 字${e.issues?.length ? `  ⚠ ${e.issues.join(',')}` : ''}`,
        )
      }
    }
  }
  if (summary.fix) {
    const fx = summary.fix
    L.push(
      fx.dryRun
        ? `修复模式: dry-run（将写 ${fx.filesWouldWrite} 个文件，未写盘）`
        : `修复模式: 已写 ${fx.filesWritten} 个文件（写前均有 .bak-${fx.ts ?? ''} 备份）`,
    )
    for (const m of fx.migrated) {
      L.push(`  [迁移] ${m.id}: ${m.status}${m.message ? `（${m.message}）` : ''}`)
    }
    for (const e of fx.errors) L.push(`  [错误] ${e.file ?? ''} ${e.rule ?? ''}: ${e.message}`)
  }
  if (summary.total > 0) {
    L.push('')
    for (const e of summary.eras ?? []) {
      L.push(`  [时代] ${e.preset}: 写于 ${e.baseEra}，需跨越 ${e.hops.length} 个版本节点（${e.hops.join(' → ')}) 到达当前安装`)
    }
    L.push('')
    for (const f of summary.findings) {
      const tag = f.level === 'auto' ? '[L2 自动修]' : '[需人工]'
      L.push(`${String(f.no).padStart(3)} ${tag} ${f.rule}  ${f.file}:${f.line}${f.rowId ? `  行 ${f.rowId}` : ''}`)
      L.push(`      原因: ${f.reason}`)
      L.push(`      建议: ${f.suggestion}`)
    }
  }
  if (summary.fix && !summary.fix.dryRun && (summary.fix.filesWritten > 0 || summary.fix.migrated.some((m) => m.status === 'written'))) {
    L.push('')
    L.push('修复已写盘。重启 DSH 进程后生效（预设注册表仅在启动时加载）。')
  }
  return L.join('\n')
}

/** JSON 报告（--json / 程序消费）。 */
export function renderJson(summary) {
  return JSON.stringify(
    {
      behaviorEquivalent: false,
      disclaimer: DISCLAIMER,
      ...summary,
    },
    null,
    2,
  )
}
