/**
 * dsh-preset-doctor — R-INJECT-*：预设里的「提示词注入」目录格式校验。
 *
 * 场景：预设用 dsh-preset-studio 的结构把提示词写成 `<预设目录>/注入/*.md`
 * （frontmatter 提供 name/role/order/enabled，正文即提示词），再由一行
 *
 *     - id: studio-inject
 *       name: 'dsh-preset-studio/inject'
 *       config:
 *         dir: <预设目录>/注入
 *
 * 在挂载时投递成系统提示词段/上下文块。投递器对坏文件是**沉默**的：没有
 * frontmatter、BOM 顶掉 `^---`、正文全空 → 该文件静默丢弃；role 写错 → 静默
 * 降级为 system；order 写成非数字 → 归零；enabled 拼错 → 按启用。UI 上只表现
 * 为「这条提示词好像没生效」，没有行号也没有原因。
 *
 * 本规则把这些沉默吞掉的行为逐条报出来，并把**读到的内容**（名称/角色/段位/
 * 开关/字数/变量）整理成清单供卡面展示——只读，从不改写用户提示词。
 * 唯一的机械可修项是文件头 BOM（R-INJECT-BOM，auto：删 BOM 后文件立刻恢复可读）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  hasBom,
  stripBom,
  splitFrontmatter,
  readField,
  readBoolean,
  readNumber,
  fieldLine,
  bodyLine,
} from '../prompts/frontmatter.js'

export const INJECT_DIR_NAME = '注入'
/** 投递器行名（studio 的 `./inject` 子路径入口）。 */
const INJECTOR_NAME_RE = /^(?:@[^/]+\/)?dsh-preset-studio\/inject$/
const PROMPT_ROLES = ['system', 'user', 'assistant']
/** 宿主确有、且用户在注入正文里最可能想插值的两个变量。 */
const HOST_PROMPT_VARS = ['model', 'cwd']
const VAR_RE = /\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g
const BLOCK_SCALAR_RE = /^[|>][+-]?\d*$/

export function isInjectorRow(name) {
  return typeof name === 'string' && INJECTOR_NAME_RE.test(name)
}

/** 从行节点读 config.dir（非映射/缺键 → undefined）。 */
function declaredDirOf(configNode) {
  if (!configNode || typeof configNode.get !== 'function') return undefined
  try {
    const v = configNode.get('dir')
    if (v === undefined || v === null) return undefined
    return typeof v === 'string' ? v : String(v)
  } catch {
    return undefined
  }
}

/**
 * 投递器怎么解析 config.dir：`path.resolve(declared)`——按**宿主进程 cwd**，
 * 既不展开 `~` 也不展开 `%VAR%`。这里复现它的判定，同时为了能实际检查内容，
 * 额外给出「展开后」的路径（notes 记录两者差异）。
 */
export function resolveInjectionDir(declared, baseDir = '') {
  const raw = String(declared ?? '').trim()
  const notes = []
  let text = raw
  if (text === '~' || text.startsWith('~/') || text.startsWith('~\\')) {
    notes.push('tilde')
    text = path.join(os.homedir(), text.slice(1))
  } else if (/%[^%\\/]+%/.test(text)) {
    notes.push('env')
  }
  if (!path.isAbsolute(text)) {
    notes.push('relative')
    text = path.resolve(baseDir || process.cwd(), text)
  }
  return { declared: raw, resolved: path.resolve(text), notes }
}

/** 判断目录里有哪些 .md（不可读 → 空）。 */
function listMarkdown(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

/**
 * 读一个注入文件：返回条目 + 该文件的格式问题。
 * 条目字段与投递器一致（读不出的按投递器的默认值填），另带 chars/vars 供展示。
 */
export function inspectInjectionFile(file) {
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return { entry: null, problems: [{ code: 'R-INJECT-FORMAT', level: 'report', file, line: 1, reason: '文件读不出来（权限/占用）', suggestion: '检查文件权限后重试；投递器读不到内容时同样静默跳过' }] }
  }
  const problems = []
  const push = (code, level, line, reason, suggestion) => problems.push({ code, level, file, line, reason, suggestion })
  const fileBom = hasBom(raw)
  const text = fileBom ? stripBom(raw) : raw
  if (fileBom) {
    push(
      'R-INJECT-BOM',
      'auto',
      1,
      '文件头带 UTF-8 BOM：投递器按 `^---` 匹配 frontmatter，BOM 占了首字符 → 匹配失败 → 整个文件被静默丢弃（一条都不投递）',
      '自动去掉 BOM（写前 .bak 备份、原子写、幂等）；其余字节不动',
    )
  }
  const split = splitFrontmatter(text)
  const base = path.basename(file).replace(/\.md$/i, '')
  const entry = {
    file,
    name: base,
    role: 'system',
    roleRaw: undefined,
    order: 0,
    orderRaw: undefined,
    enabled: true,
    enabledRaw: undefined,
    chars: 0,
    vars: [],
    issues: [],
  }
  if (!split) {
    const unclosed = /^---\r?\n/.test(text)
    push(
      'R-INJECT-FORMAT',
      'report',
      1,
      unclosed
        ? 'frontmatter 未闭合（首行 `---` 之后找不到结束的 `---`）：投递器读不到 head → 整个文件被静默丢弃'
        : '缺少 frontmatter（首行必须是 `---`）：投递器对无 frontmatter 的 .md 一律跳过',
      '补一个形如 `--- / name: … / role: system / order: 10 / ---` 的文件头；确实不需要该文件就删掉它',
    )
    entry.issues = problems.map((p) => p.code)
    return { entry, problems }
  }

  for (const key of ['name', 'role', 'order', 'enabled']) {
    const value = readField(split.head, key)
    if (value === undefined || !BLOCK_SCALAR_RE.test(value)) continue
    push(
      'R-INJECT-FIELD',
      'report',
      fieldLine(text, split, key),
      `${key} 的值写成了块标量（\`${value}\`）：投递器只读顶层单行标量，会把 \`${value}\` 当字面值 —— ${key} 实际失效`,
      `改成单行写法（${key}: <值>）`,
    )
  }

  const nameRaw = readField(split.head, 'name')
  if (nameRaw !== undefined && nameRaw !== '' && !BLOCK_SCALAR_RE.test(nameRaw)) entry.name = nameRaw

  const roleRaw = readField(split.head, 'role')
  entry.roleRaw = roleRaw
  if (roleRaw !== undefined) {
    const lowered = roleRaw.trim().toLowerCase()
    if (PROMPT_ROLES.includes(lowered)) entry.role = lowered
    else if (!BLOCK_SCALAR_RE.test(roleRaw)) {
      push(
        'R-INJECT-FIELD',
        'report',
        fieldLine(text, split, 'role'),
        `role 值 "${roleRaw}" 不是 system | user | assistant：投递器静默降级为 system（进系统提示词段）。本意若是上下文块，内容会跑到系统提示词里`,
        '改成 role: system / user / assistant 之一（小写）',
      )
    }
  }

  const orderRaw = readField(split.head, 'order')
  entry.orderRaw = orderRaw
  if (orderRaw !== undefined) {
    const num = readNumber(split.head, 'order')
    if (num === undefined) {
      if (!BLOCK_SCALAR_RE.test(orderRaw)) {
        push(
          'R-INJECT-FIELD',
          'report',
          fieldLine(text, split, 'order'),
          `order 值 "${orderRaw}" 不是数字：投递器按 0 处理 → 该条与所有没写号的文件同段位，实际先后由文件名决定`,
          '改成数字（studio 约定按段位留空：10–19 人设、20–29 风格、30–49 纪律、50–69 字数、70–89 模式、90+ 补丁）',
        )
      }
    } else entry.order = num
  }

  const enabledRaw = readField(split.head, 'enabled')
  entry.enabledRaw = enabledRaw
  if (enabledRaw !== undefined) {
    const bool = readBoolean(enabledRaw)
    if (bool === undefined) {
      if (!BLOCK_SCALAR_RE.test(enabledRaw)) {
        push(
          'R-INJECT-FIELD',
          'report',
          fieldLine(text, split, 'enabled'),
          `enabled 值 "${enabledRaw}" 不是布尔拼写（true/false/yes/no/on/off/1/0）：投递器读不出时按「启用」处理 —— 以为关掉的注入其实还在生效`,
          '改成 enabled: false（或删掉该行表示启用）',
        )
      }
    } else entry.enabled = bool
  }

  const body = split.rest.trim()
  entry.chars = body.length
  if (body === '') {
    push(
      'R-INJECT-EMPTY',
      'report',
      bodyLine(text, split),
      '正文为空（只有 frontmatter）：投递器对空正文的文件直接跳过 —— 文件在、提示词不生效',
      '写上正文，或删掉该文件',
    )
  }

  const vars = []
  for (const m of body.matchAll(VAR_RE)) if (!vars.includes(m[1])) vars.push(m[1])
  entry.vars = vars
  for (const v of vars) {
    if (!HOST_PROMPT_VARS.includes(v)) continue
    const at = body.search(new RegExp(`\\{\\{\\s*${v}\\s*\\}\\}`))
    push(
      'R-INJECT-VAR',
      'report',
      bodyLine(text, split, at < 0 ? 0 : at),
      `正文里的 {{${v}}} 不会被替换：投递器注册该段时显式 interpolate:false，宿主跳过变量插值 —— 占位符会原样进提示词`,
      `要么删掉 {{${v}}}，要么把这段改成宿主会插值的行（如 persona 的 prefix/suffix）`,
    )
  }

  entry.issues = problems.map((p) => p.code)
  return { entry, problems }
}

/** 同一目录内的一对冲突（重名 / 同段位）。 */
function collectDirConflicts(entries) {
  const problems = []
  const live = entries.filter((e) => e.enabled && !e.issues.includes('R-INJECT-FORMAT'))
  const byName = new Map()
  for (const e of live) {
    if (!byName.has(e.name)) byName.set(e.name, [])
    byName.get(e.name).push(e)
  }
  for (const [name, group] of byName) {
    if (group.length < 2) continue
    for (const e of group) {
      const others = group.filter((x) => x !== e).map((x) => path.basename(x.file))
      problems.push({
        code: 'R-INJECT-DUP',
        level: 'report',
        file: e.file,
        line: 1,
        reason: `与 ${others.join('、')} 同名（都注册成 custom-inject:${name}）：投递器不做去重，一次挂载里重复注册同名段，最终哪条生效不可预期`,
        suggestion: '改 frontmatter 的 name 让每条唯一（文件名兜底也算 name，改文件名同效）',
      })
    }
  }
  const byOrder = new Map()
  for (const e of live) {
    const key = `${e.role}#${e.order}`
    if (!byOrder.has(key)) byOrder.set(key, [])
    byOrder.get(key).push(e)
  }
  for (const [key, group] of byOrder) {
    if (group.length < 2) continue
    const [role, order] = key.split('#')
    for (const e of group) {
      const others = group.filter((x) => x !== e).map((x) => path.basename(x.file))
      problems.push({
        code: 'R-INJECT-ORDER',
        level: 'report',
        file: e.file,
        line: 1,
        reason: `与 ${others.join('、')} 同段位（role=${role} · order=${order}）：投递器按 (order, 名称) 排序，先后由名称决定，改段位才可控`,
        suggestion: '把段位错开（同一段位区间内用 10/20/30… 留空位，方便以后插新的不用重排）',
      })
    }
  }
  return problems
}

/**
 * 读一个注入目录：条目清单 + 全部格式问题（不含预设上下文，由调用方补齐）。
 * 目录不存在/不可读 → entries 空、problems 空（由 dir 级检查单独报）。
 */
export function inspectInjectionDir(dir) {
  const entries = []
  const problems = []
  for (const name of listMarkdown(dir)) {
    const result = inspectInjectionFile(path.join(dir, name))
    if (result.entry) entries.push(result.entry)
    problems.push(...result.problems)
  }
  problems.push(...collectDirConflicts(entries))
  return { entries, problems }
}

function inventoryOf(dir, entries, extra = {}) {
  // 按投递器的排序口径（order → 名称）呈现，清单即实际投递顺序
  const ordered = [...entries].sort(
    (a, b) => a.order - b.order || String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'),
  )
  return {
    dir,
    ...extra,
    entries: ordered.map((e) => ({
      file: e.file,
      name: e.name,
      role: e.role,
      order: e.order,
      enabled: e.enabled,
      chars: e.chars,
      vars: e.vars,
      issues: e.issues,
    })),
    total: entries.length,
    enabled: entries.filter((e) => e.enabled).length,
    disabled: entries.filter((e) => !e.enabled).length,
    issues: entries.filter((e) => e.issues.length).length,
  }
}

/** 给问题补上「属于哪条预设声明」的上下文（卡面据此挂到预设卡）。 */
function contextualize(problem, ctx) {
  return {
    rule: problem.code,
    level: problem.level ?? 'report',
    file: problem.file,
    line: problem.line ?? 1,
    rowId: ctx.rowId ?? '',
    reason: problem.reason,
    suggestion: problem.suggestion,
    data: { presetId: ctx.presetId, presetFile: ctx.presetFile, dir: ctx.dir, promptFile: problem.file },
  }
}

/**
 * 扫描一个 patch 源里的投递器行：校验 config.dir 指向的注入目录。
 * @param {{file:string, profile?:string, rows:Array, presetRows:Array}} src
 * @returns {{findings:Array, inventories:Array}}
 */
export function checkInjectorRows(src) {
  const findings = []
  const inventories = []
  const rows = Array.isArray(src?.rows) ? src.rows : []
  const presetRows = Array.isArray(src?.presetRows) ? src.presetRows : []
  for (const row of rows) {
    if (!isInjectorRow(row.name)) continue
    const owner =
      presetRows.find((p) => p.range && row.range && p.range[0] <= row.range[0] && row.range[1] <= p.range[1]) ?? null
    const ctx = { rowId: row.id, presetId: owner?.presetId, presetFile: src.file, dir: '' }
    const declared = declaredDirOf(row.configNode)
    if (declared === undefined || declared.trim() === '') {
      findings.push({
        rule: 'R-INJECT-DIR',
        level: 'report',
        file: src.file,
        line: row.line ?? 1,
        rowId: row.id ?? '',
        reason: `投递器行 ${row.id ?? ''} 缺 config.dir：投递器打一条 warn 后什么都不投递（提示词全部不生效）`,
        suggestion: `补 config.dir，指向预设的「${INJECT_DIR_NAME}」目录（推荐绝对路径）`,
        data: { presetId: owner?.presetId, presetFile: src.file },
      })
      continue
    }
    const { declared: raw, resolved, notes } = resolveInjectionDir(declared, row.baseDir)
    ctx.dir = resolved
    if (notes.includes('tilde')) {
      findings.push({
        rule: 'R-INJECT-DIR',
        level: 'report',
        file: src.file,
        line: row.line ?? 1,
        rowId: row.id ?? '',
        reason: `config.dir 以 ~ 开头（${raw}）：投递器用 path.resolve 原样拼接宿主进程 cwd，不展开 ~ → 实际指向 <cwd>/~/${raw.replace(/^[~\\/]+/, '')}，投递不到`,
        suggestion: '改成绝对路径（或 %USERPROFILE% 之外的完整路径）',
        data: { presetId: owner?.presetId, presetFile: src.file, dir: resolved },
      })
    }
    if (notes.includes('relative')) {
      findings.push({
        rule: 'R-INJECT-DIR',
        level: 'report',
        file: src.file,
        line: row.line ?? 1,
        rowId: row.id ?? '',
        reason: `config.dir 是相对路径（${raw}）：投递器按宿主进程 cwd 解析，不是 patch 文件所在目录 —— 换启动目录就投递不到`,
        suggestion: '改成绝对路径',
        data: { presetId: owner?.presetId, presetFile: src.file, dir: resolved },
      })
    }
    let stat
    try {
      stat = fs.statSync(resolved)
    } catch {
      stat = null
    }
    if (!stat || !stat.isDirectory()) {
      findings.push({
        rule: 'R-INJECT-DIR',
        level: 'report',
        file: src.file,
        line: row.line ?? 1,
        rowId: row.id ?? '',
        reason: `config.dir 指向的目录不存在（${resolved}）：投递器 readdir 失败后按 0 条处理 —— 行在、提示词一条都不进`,
        suggestion: `确认「${INJECT_DIR_NAME}」目录路径（注意大小写与中文目录名），或修正 config.dir`,
        data: { presetId: owner?.presetId, presetFile: src.file, dir: resolved },
      })
      inventories.push(inventoryOf(resolved, [], { declared: raw, presetId: owner?.presetId ?? null, presetFile: src.file, source: 'declared', wired: true, missing: true }))
      continue
    }
    const { entries, problems } = inspectInjectionDir(resolved)
    for (const p of problems) findings.push(contextualize(p, ctx))
    const live = entries.filter((e) => e.enabled)
    if (entries.length === 0) {
      findings.push({
        rule: 'R-INJECT-EMPTY-DIR',
        level: 'report',
        file: src.file,
        line: row.line ?? 1,
        rowId: row.id ?? '',
        reason: `注入目录里没有任何 .md（${resolved}）：投递器挂载成 0 条，提示词全部不生效`,
        suggestion: `在「${INJECT_DIR_NAME}」里新建 <段位>-<名称>.md（带 frontmatter），或删掉这条投递器行`,
        data: { presetId: owner?.presetId, presetFile: src.file, dir: resolved },
      })
    } else if (live.length === 0) {
      findings.push({
        rule: 'R-INJECT-EMPTY-DIR',
        level: 'report',
        file: src.file,
        line: row.line ?? 1,
        rowId: row.id ?? '',
        reason: `注入目录有 ${entries.length} 个 .md，但全部 enabled:false（或读不出 frontmatter）：投递器实际投递 0 条`,
        suggestion: '把要生效的注入改回 enabled: true / 删掉该键；或补 frontmatter',
        data: { presetId: owner?.presetId, presetFile: src.file, dir: resolved },
      })
    }
    inventories.push(
      inventoryOf(resolved, entries, {
        declared: raw,
        notes,
        presetId: owner?.presetId ?? null,
        presetFile: src.file,
        source: 'declared',
        wired: true,
        missing: false,
      }),
    )
  }
  return { findings, inventories }
}

/** 枚举 `<home>/presets/<id>/注入`（studio 默认根：checkout 用仓库 预设/，装进 profile 用 ~/.dsh/presets）。 */
export function collectPresetPromptDirs(home) {
  const root = path.join(home, 'presets')
  const out = []
  let children
  try {
    children = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const ent of children) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue
    const dir = path.join(root, ent.name, INJECT_DIR_NAME)
    let stat
    try {
      stat = fs.statSync(dir)
    } catch {
      stat = null
    }
    if (!stat || !stat.isDirectory()) continue
    out.push({ id: ent.name, dir, patchFile: path.join(root, ent.name, 'cordis.patch.yml') })
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return out
}

function realpathOr(p) {
  try {
    return fs.realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}

/**
 * 未接线检查：`<home>/presets/<id>/注入` 里写了注入，却没有任何投递器行指向它
 * —— studio 的话说，「某个条目接上了没有，面板直接说」，否则表现就是「改了没反应」。
 */
export function checkUnwiredPromptDirs(home, wiredDirs) {
  const wired = new Set([...wiredDirs].map(realpathOr))
  const findings = []
  const inventories = []
  for (const { id, dir, patchFile } of collectPresetPromptDirs(home)) {
    if (wired.has(realpathOr(dir))) continue
    const { entries } = inspectInjectionDir(dir)
    if (entries.length === 0) continue
    const at = fs.existsSync(patchFile) ? patchFile : dir
    findings.push({
      rule: 'R-INJECT-UNWIRED',
      level: 'report',
      file: at,
      line: 1,
      rowId: '',
      reason: `预设 ${id} 的「${INJECT_DIR_NAME}」有 ${entries.length} 条提示词，但没有任何 dsh-preset-studio/inject 行指向它：这些提示词永远不会进系统提示词（文件在、投递器缺席）`,
      suggestion: `在该预设的 cordis.patch.yml 里加一行：id: studio-inject / name: 'dsh-preset-studio/inject' / config: { dir: '${dir}' }`,
      data: { presetId: id, presetFile: patchFile, dir },
    })
    inventories.push(inventoryOf(dir, entries, { declared: '', presetId: id, presetFile: patchFile, source: 'presets-root', wired: false, missing: false }))
  }
  return { findings, inventories }
}
