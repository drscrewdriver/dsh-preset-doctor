/**
 * dsh-preset-manager（维护者工具，不随 npm 包发布）— table build：变更日志提案生成。
 *
 * 对 DSH 两个版本的官方预设做集合 diff，自动**提案**新的变更条目（package-rename）。
 * 人工确认后手动追加进 src/tables/changes.json——变更日志是收敛体系的信任锚点，
 * 追加永远是人工动作，本工具只产提案，绝不直写。
 *
 * 纯函数与 CLI 分离：本文件导出纯函数供测试；CLI 入口在文件尾（import.meta.url 判定）。
 *
 * 用法：
 *   node tools/table-build.mjs --repo <dsh-src> --from dsh-v0.1.6-alpha.2 --to dsh-v0.2.0-rc.2 [--json]
 *   node tools/table-build.mjs --repo <dsh-src> --composition --all-tags [--out <file>]  # 逐版内置预设行集基线
 * 退出码：0=无提案；2=有提案；3=存在无法配对的增删（需人工考古）
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { compareSemver } from '../src/tables/load.js'

const PKG_REF_RE = /@deepseek-ai\/[A-Za-z0-9._/-]+/g

/** 官方预设文件的 git 路径模式（三代布局：apps/cli → preset 包 → bundle web-app）。 */
export const PRESET_PATH_PATTERNS = [
  /packages\/bundle\/web-app\/presets\/[^/]+\.patch\.yml$/,
  /packages\/preset\/agent-presets\/presets\/[^/]+\/agent\.cordis\.yml$/,
  /apps\/cli\/config\/agent-presets\/[^/]+\/agent\.cordis\.yml$/,
]

/** 提取文本内全部官方包引用（保序，含重复；过滤注释性路径如 xxx/package.json）。 */
export function extractPkgRefs(text) {
  return [...String(text ?? '').matchAll(PKG_REF_RE)]
    .map((m) => m[0])
    .filter((ref) => !/\.(json|ya?ml|mjs|cjs|ts|js)$/i.test(ref))
}

/** 集合差：old 有 new 无（保序去重）。 */
function setDiffOld(order, oldSet, newSet) {
  return [...new Set(order)].filter((n) => !newSet.has(n))
}

/**
 * 配对单个预设文件的新旧引用序列。
 * 恰好一删一增 → 提案改名；任何歧义 → unpaired（不猜）。
 */
export function pairOnePreset(presetName, oldRefs, newRefs, { fromTag, toTag } = {}) {
  const oldSet = new Set(oldRefs)
  const newSet = new Set(newRefs)
  const removals = setDiffOld(oldRefs, oldSet, newSet)
  const additions = setDiffOld(newRefs, newSet, oldSet)
  if (removals.length === 0 && additions.length === 0) return { proposals: [], unpairedRemovals: [], unpairedAdditions: [] }
  if (removals.length === 1 && additions.length === 1) {
    return {
      proposals: [
        {
          kind: 'package-rename',
          brokenIn: String(toTag ?? '').replace(/^dsh-v/, ''),
          from: removals[0],
          to: additions[0],
          source: `table-build: ${fromTag}..${toTag} (${presetName})`,
        },
      ],
      unpairedRemovals: [],
      unpairedAdditions: [],
    }
  }
  return {
    proposals: [],
    unpairedRemovals: removals.map((name) => ({ preset: presetName, name })),
    unpairedAdditions: additions.map((name) => ({ preset: presetName, name })),
  }
}

/**
 * 两代官方预设全文 diff → 提案与 unpaired 清单。
 * @param {Map<string,string>} oldFiles 预设名 → 文本
 * @param {Map<string,string>} newFiles
 */
export function diffShipped(oldFiles, newFiles, { fromTag = '', toTag = '' } = {}) {
  const proposals = []
  const unpairedRemovals = []
  const unpairedAdditions = []
  const names = [...new Set([...oldFiles.keys(), ...newFiles.keys()])].sort()
  for (const name of names) {
    const oldText = oldFiles.get(name)
    const newText = newFiles.get(name)
    if (oldText != null && newText == null) {
      // 整个预设在新版消失：其引用全部记为 removals（供人工判断是改名还是废弃）
      for (const n of [...new Set(extractPkgRefs(oldText))]) unpairedRemovals.push({ preset: name, name: n })
      continue
    }
    if (oldText == null && newText != null) {
      for (const n of [...new Set(extractPkgRefs(newText))]) unpairedAdditions.push({ preset: name, name: n })
      continue
    }
    const r = pairOnePreset(name, extractPkgRefs(oldText), extractPkgRefs(newText), { fromTag, toTag })
    proposals.push(...r.proposals)
    unpairedRemovals.push(...r.unpairedRemovals)
    unpairedAdditions.push(...r.unpairedAdditions)
  }
  const result = { proposals: [], unpairedRemovals, unpairedAdditions }
  // 跨预设去重：同一条改名在 N 个预设文件里出现 → 合并为一条提案（source 记录全部出处）
  const byPair = new Map()
  for (const p of proposals) {
    const key = `${p.from}=>${p.to}`
    if (!byPair.has(key)) byPair.set(key, p)
    else byPair.get(key).source += ` + ${p.source}`
  }
  result.proposals = [...byPair.values()]
  return result
}

// ── CLI（git 层）──

function gitShow(repo, tag, file) {
  try {
    return execFileSync('git', ['-C', repo, 'show', `${tag}:${file}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  } catch {
    return null
  }
}

function gitListPresetFiles(repo, tag) {
  let out
  try {
    out = execFileSync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', tag], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  } catch (e) {
    throw new Error(`git ls-tree 失败（tag=${tag}）: ${e.message}`, { cause: e })
  }
  return out.split('\n').filter((f) => PRESET_PATH_PATTERNS.some((re) => re.test(f)))
}

function collectTagFiles(repo, tag) {
  const files = new Map()
  // key 用完整 git 路径：旧三代布局下多个预设都叫 agent.cordis.yml，basename 会互相覆盖
  for (const f of gitListPresetFiles(repo, tag)) {
    const text = gitShow(repo, tag, f)
    if (text != null) files.set(f, text)
  }
  return files
}

// ── composition 模式：逐版本内置预设「行集」基线（供 R-COMPOSITION-DRIFT 用）──

/** 声明式 web-app 预设文件路径（仅 0.1.7-alpha.1+ 存在）。 */
const WEBAPP_PRESET_RE = /packages\/bundle\/web-app\/presets\/([^/]+)\.patch\.yml$/

/** 抽一个 patch 文件里所有 `- id: <rowId>` 行 id（保序去重；含组内嵌套成员）。 */
export function extractRowIds(text) {
  return [...new Set([...String(text ?? '').matchAll(/^\s*-\s*id:\s*(\S+)/gm)].map((m) => m[1]))]
}

/** 从 web-app 预设文件路径取预设名（standard/cordis/ptc/minimal）。 */
function presetKeyFromPath(p) {
  const m = WEBAPP_PRESET_RE.exec(p)
  return m ? m[1] : null
}

/** 列仓库全部 dsh-v0* tag。 */
function gitTags(repo) {
  return execFileSync('git', ['-C', repo, 'tag'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split('\n').map((s) => s.trim()).filter((t) => /^dsh-v0/.test(t))
}

/**
 * 单个 tag 的内置预设行集快照；无声明式预设（<0.1.7-alpha.1）→ null（跳过，不记空集）。
 * @returns {{version:string, presets:Record<string,string[]>}|null}
 */
export function collectCompositionSnapshot(repo, tag, show = gitShow, list = gitListPresetFiles) {
  const files = list(repo, tag).filter((f) => WEBAPP_PRESET_RE.test(f))
  const presets = {}
  for (const f of files) {
    const key = presetKeyFromPath(f)
    if (!key) continue
    const text = show(repo, tag, f)
    if (text != null) presets[key] = extractRowIds(text)
  }
  return Object.keys(presets).length ? { version: String(tag).replace(/^dsh-v/, ''), presets } : null
}

/**
 * 遍历多 tag 构建基线（按 version 升序）。纯函数：注入 show/list 便于单测。
 */
export function buildBaseline(repo, tags, show, list) {
  const snapshots = []
  for (const t of tags) {
    const snap = collectCompositionSnapshot(repo, t, show, list)
    if (snap) snapshots.push(snap)
  }
  snapshots.sort((a, b) => compareSemver(a.version, b.version))
  return {
    schemaVersion: 1,
    note: '内置 shipped 预设逐版本行集快照，由 tools/table-build.mjs --composition 生成；追加不改历史。',
    snapshots,
  }
}

function parseArgs(argv) {
  const args = { repo: '.', from: '', to: '', json: false, composition: false, allTags: false, out: '' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') args.repo = argv[++i]
    else if (argv[i] === '--from') args.from = argv[++i]
    else if (argv[i] === '--to') args.to = argv[++i]
    else if (argv[i] === '--json') args.json = true
    else if (argv[i] === '--composition') args.composition = true
    else if (argv[i] === '--all-tags') args.allTags = true
    else if (argv[i] === '--out') args.out = argv[++i]
  }
  if (args.composition) {
    if (!args.allTags && !(args.from && args.to)) throw new Error('composition 模式需 --all-tags 或 --from/--to 限定 tag 范围')
    return args
  }
  if (!args.from || !args.to) throw new Error('用法: node tools/table-build.mjs --repo <dsh-src> --from <tag> --to <tag> [--json] | --composition --all-tags [--out f]')
  return args
}

function runComposition(args) {
  const tags = args.allTags
    ? gitTags(args.repo)
    : gitTags(args.repo).filter((t) => {
        const v = t.replace(/^dsh-v/, '')
        return compareSemver(v, args.from.replace(/^dsh-v/, '')) >= 0 && compareSemver(v, args.to.replace(/^dsh-v/, '')) <= 0
      })
  const baseline = buildBaseline(args.repo, tags, gitShow, gitListPresetFiles)
  const json = JSON.stringify(baseline, null, 2) + '\n'
  if (args.out) {
    writeFileSync(args.out, json, 'utf8')
    console.log(`baseline → ${args.out}（${baseline.snapshots.length} 个版本快照）`)
  } else {
    console.log(json)
  }
  return { status: baseline.snapshots.length ? 2 : 3, result: baseline }
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.composition) return runComposition(args)
  const oldFiles = collectTagFiles(args.repo, args.from)
  const newFiles = collectTagFiles(args.repo, args.to)
  const result = diffShipped(oldFiles, newFiles, { fromTag: args.from, toTag: args.to })
  const status = result.proposals.length ? 2 : result.unpairedRemovals.length || result.unpairedAdditions.length ? 3 : 0
  if (args.json) {
    console.log(JSON.stringify({ behaviorNote: 'proposals 需人工核对 commit 后再追加进 src/tables/changes.json', ...result }, null, 2))
  } else {
    console.log(`table-build ${args.from} → ${args.to}`)
    console.log(`  提案 ${result.proposals.length} 条；unpaired 删除 ${result.unpairedRemovals.length}、新增 ${result.unpairedAdditions.length}`)
    for (const p of result.proposals) console.log(`  [提案] ${p.from} → ${p.to}（${p.source}）`)
    for (const r of result.unpairedRemovals) console.log(`  [待人工·删] ${r.preset}: ${r.name}`)
    for (const a of result.unpairedAdditions) console.log(`  [待人工·增] ${a.preset}: ${a.name}`)
    if (status === 0) console.log('  两版官方预设引用零差异，无需追加变更条目')
  }
  return { status, result }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  process.exit(main().status)
}
