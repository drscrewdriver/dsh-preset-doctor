/**
 * dsh-preset-doctor 维护者工具（不随 npm 包发布）— 全组件地图生成。
 *
 * 目的：把「官方组件 ↔ 预设行 id ↔ 各版本是否提供/提供哪些子路径」这张地图扒干净，
 * 落成 `src/tables/component-map.json`。它是**知识表**，不当运行时判据用：
 *   - 判「这一行能不能起」永远靠运行时探真宿主（resolvePkg + exports 子路径检查）；
 *   - 这张表只补运行时拿不到的三件事：
 *       ① id → 包名/子路径 映射（缺失行提示、将来自动补齐的必需品）
 *       ② 组件分级（runtime / core / tool / client / experimental / provider / api / policy）
 *       ③ 跨版本演进（某包/某子路径在哪个版本有、哪个版本没有）
 *
 * 三个来源（都能在本地离盘取到真值）：
 *   repo    deepseek-harness 源码树（packages/** 的 package.json + bundle/web-app/presets/*.patch.yml）
 *   cli     CLI 全局安装 bundle（…/@deepseek-ai/dsh/node_modules/@deepseek-ai/*）
 *   asar    DSH Desktop 的 app.asar（…/resources/app.asar/dsh/node_modules/@deepseek-ai/*）
 *
 * 用法：
 *   node tools/component-map.mjs                        # 自动探测三源 + 写 src/tables/component-map.json
 *   node tools/component-map.mjs --repo e:/x/deepseek-harness --no-cli --no-asar
 *   node tools/component-map.mjs --out /tmp/map.json --print
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument, isSeq } from 'yaml'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_OUT = path.join(HERE, '..', 'src', 'tables', 'component-map.json')

/** 组件分级（按包名的稳定前缀，先命中先用）。 */
export const CATEGORY_RULES = [
  [/^@deepseek-ai\/dsh-(desktop-runtime|web-app|base|cli)$/, 'runtime'],
  [/^@deepseek-ai\/dsh-experimental-/, 'experimental'],
  [/^@deepseek-ai\/dsh-client(-ui)?-/, 'client'],
  [/^@deepseek-ai\/dsh-tool-/, 'tool'],
  [/^@deepseek-ai\/dsh-provider-/, 'provider'],
  [/^@deepseek-ai\/dsh-api-|^@deepseek-ai\/dsh-protocol/, 'api'],
  [/^@deepseek-ai\/dsh-(policy|guard|perm|permission)/, 'policy'],
  [/^@deepseek-ai\/dsh-command-/, 'command'],
  [/^cordis:/, 'virtual'],
]

export function categorize(name) {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(String(name))) return cat
  return 'core'
}

/** '@a/b/sub' → { pkg: '@a/b', sub: 'sub' }；无子路径 sub=''。 */
export function splitSpec(name) {
  const s = String(name ?? '')
  if (!s || s.startsWith('cordis:') || /^\.{1,2}[\\/]/.test(s)) return { pkg: s, sub: '' }
  const seg = s.split('/')
  const base = s.startsWith('@') ? seg.slice(0, 2).join('/') : seg[0]
  return { pkg: base, sub: s.slice(base.length).replace(/^\//, '') }
}

/** 从一份 cordis.patch.yml 里扒出「预设 id → 行列表（id/name/group）」。容错：解析失败返空。 */
export function extractPresetRows(text) {
  const out = new Map() // presetId → [{ id, name, group }]
  let doc
  try {
    doc = parseDocument(String(text ?? ''), { prettyErrors: false })
  } catch {
    return out
  }
  if (doc.errors?.length || !doc.contents) return out
  const walkRows = (node, sink) => {
    if (!node || typeof node.get !== 'function') return
    const id = node.get('id')
    const name = node.get('name')
    if (typeof id === 'string') {
      sink.push({ id, name: typeof name === 'string' ? name : '', group: node.get('group') === true })
    }
    const cfg = node.get('config', true)
    if (!cfg) return
    // 组行：config 直接是行列表（YAMLSeq）；普通行：config.plugins 是行列表
    const list = isSeq(cfg) ? cfg : cfg?.get?.('plugins', true)
    if (isSeq(list)) for (const child of list.items) walkRows(child, sink)
  }
  for (const item of doc.contents.items ?? []) {
    if (!item || typeof item.get !== 'function') continue
    const insert = item.get('insert', true)
    const presets = insert?.items ?? [item] // insert 块里的每个 item 都是一条预设声明
    for (const presetNode of presets) {
      const cfg = presetNode?.get?.('config', true)
      const presetId = cfg?.get?.('id')
      if (typeof presetId !== 'string' || !presetId) continue
      const rows = []
      walkRows(presetNode, rows)
      // 首行是预设声明本身（id=preset-xxx / name=@deepseek-ai/dsh-agent-preset），不算插件行
      out.set(presetId, rows.filter((r) => r.name && r.name !== '@deepseek-ai/dsh-agent-preset'))
    }
  }
  return out
}

/** 读一个 node_modules 根下的 @deepseek-ai/* 包清单（exports 键 + 版本）。 */
export function readInstallScope(scopeDir) {
  const out = new Map()
  let names
  try {
    names = fs.readdirSync(scopeDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return out
  }
  for (const name of names) {
    const dir = path.join(scopeDir, name)
    try {
      const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8').replace(/^\uFEFF/, ''))
      out.set(pj.name ?? `@deepseek-ai/${name}`, { version: pj.version ?? '', exports: Object.keys(pj.exports ?? {}), dir })
    } catch {
      /* 坏包/非包目录跳过 */
    }
  }
  return out
}

/** 读 JSON 文件（坏/缺 → null）。 */
export function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
}

/** 打开 asar（手工解 pickle 头）。返回 { readText(segs), node(segs), close() }；失败返 null。 */
export function openAsar(asarPath) {
  let fd
  try {
    fd = fs.openSync(asarPath, 'r')
  } catch {
    return null
  }
  const head = Buffer.alloc(8)
  fs.readSync(fd, head, 0, 8, 0)
  const headerSize = head.readUInt32LE(4)
  const hbuf = Buffer.alloc(headerSize)
  fs.readSync(fd, hbuf, 0, headerSize, 8)
  const jsonStart = hbuf.indexOf(0x7b)
  if (jsonStart < 0) {
    fs.closeSync(fd)
    return null
  }
  const header = JSON.parse(hbuf.slice(jsonStart).toString('utf8').replace(/\0+$/, ''))
  const dataBase = 8 + headerSize
  const seg = (segs) => segs.reduce((cur, s) => cur?.files?.[s], header)
  const readText = (segs) => {
    const node = seg(segs)
    if (node?.size == null || node?.offset == null) return null
    const buf = Buffer.alloc(Number(node.size))
    fs.readSync(fd, buf, 0, Number(node.size), dataBase + Number(node.offset))
    return buf.toString('utf8')
  }
  return {
    readText,
    node: seg,
    close: () => {
      try {
        fs.closeSync(fd)
      } catch {
        /* ignore */
      }
    },
  }
}

/** 读 asar 内某路径的 JSON（坏/缺 → null）。 */
export function readAsarJson(asarPath, innerPath) {
  const ar = openAsar(asarPath)
  if (!ar) return null
  try {
    const text = ar.readText(innerPath.split('/'))
    return text ? JSON.parse(text) : null
  } catch {
    return null
  } finally {
    ar.close()
  }
}

/** 读 asar 内的 @deepseek-ai/* 清单（手工解 pickle 头；不依赖 Electron）。 */
export function readAsarScope(asarPath, innerDir = 'dsh/node_modules/@deepseek-ai') {
  const out = new Map()
  const ar = openAsar(asarPath)
  if (!ar) return out
  try {
    const scopeSegs = innerDir.split('/')
    const scope = ar.node(scopeSegs)
    for (const name of Object.keys(scope?.files ?? {})) {
      const pjText = ar.readText([...scopeSegs, name, 'package.json'])
      if (!pjText) continue
      try {
        const pj = JSON.parse(pjText)
        out.set(pj.name ?? `@deepseek-ai/${name}`, { version: pj.version ?? '', exports: Object.keys(pj.exports ?? {}), dir: `${innerDir}/${name}` })
      } catch {
        /* 坏 JSON 跳过 */
      }
    }
  } finally {
    ar.close()
  }
  return out
}

/** 收集一个来源的预设行集（多份 patch 合并，同 id 取并集）。 */
export function collectPresets(presetDir) {
  const out = new Map() // presetId → [{id,name,group}]
  let files
  try {
    files = fs.readdirSync(presetDir).filter((f) => f.endsWith('.patch.yml'))
  } catch {
    return out
  }
  for (const f of files) {
    let text
    try {
      text = fs.readFileSync(path.join(presetDir, f), 'utf8')
    } catch {
      continue
    }
    for (const [pid, rows] of extractPresetRows(text)) {
      const cur = out.get(pid) ?? []
      const seen = new Set(cur.map((r) => r.id))
      for (const r of rows) if (!seen.has(r.id)) cur.push(r)
      out.set(pid, cur)
    }
  }
  return out
}

/** 该包的 exports 是否提供某子路径（与 src/pkg-resolve.js 的 subPathExported 同语义，但吃键数组）。 */
export function exportsHas(exportsKeys, sub) {
  if (!sub) return true
  const want = `./${sub}`
  return exportsKeys.some((k) => k === want || (k.endsWith('/*') && want.startsWith(k.slice(0, -1))))
}

/**
 * 主流程：三源 → 地图。
 * @param {{repo?:string,cli?:string,asar?:string,version?:Record<string,string>}} opts
 */
export function buildComponentMap(opts = {}) {
  const sources = [] // { kind, label, version, packageCount, presets: Map }
  // —— repo ——
  if (opts.repo) {
    const pkgRoot = path.join(opts.repo, 'packages')
    const pkgs = new Map()
    const walk = (dir, depth) => {
      if (depth > 4) return
      let ents
      try {
        ents = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of ents) {
        if (!e.isDirectory() || e.name === 'node_modules' || e.name.startsWith('.')) continue
        const full = path.join(dir, e.name)
        if (fs.existsSync(path.join(full, 'package.json'))) {
          try {
            const pj = JSON.parse(fs.readFileSync(path.join(full, 'package.json'), 'utf8'))
            if (pj.name) pkgs.set(pj.name, { version: pj.version ?? '', exports: Object.keys(pj.exports ?? {}), dir: full })
          } catch {
            /* skip */
          }
        }
        walk(full, depth + 1)
      }
    }
    walk(pkgRoot, 0)
    const webApp = pkgs.get('@deepseek-ai/dsh-web-app')
    sources.push({
      kind: 'repo',
      label: opts.repo,
      version: opts.version?.repo ?? webApp?.version ?? 'repo',
      packages: pkgs,
      presets: collectPresets(path.join(opts.repo, 'packages', 'bundle', 'web-app', 'presets')),
    })
  }
  // —— CLI 安装 ——
  if (opts.cli) {
    const pkgs = readInstallScope(opts.cli)
    const host = readJsonSafe(path.join(opts.cli, '..', '..', 'package.json'))?.version
    sources.push({
      kind: 'install',
      label: 'cli',
      version: opts.version?.cli ?? host ?? 'cli',
      packages: pkgs,
      presets: collectPresets(path.join(opts.cli, 'dsh-web-app', 'presets')),
    })
  }
  // —— Desktop asar ——
  if (opts.asar) {
    const pkgs = readAsarScope(opts.asar)
    const host = readAsarJson(opts.asar, 'dsh/package.json')?.version
    sources.push({
      kind: 'install',
      label: 'desktop-asar',
      version: opts.version?.asar ?? host ?? 'desktop',
      packages: pkgs,
      presets: collectPresetsFromAsar(opts.asar),
    })
  }

  // 包维度：合并三源
  const packages = {}
  for (const src of sources) {
    for (const [name, info] of src.packages) {
      const entry = (packages[name] ??= { cat: categorize(name), v: {} })
      entry.v[src.version] = { version: info.version, exports: info.exports }
    }
  }

  // 行维度：id → 包/子路径 + 各来源是否在官方预设里 + 各版本可用性
  const rows = {}
  for (const src of sources) {
    for (const [presetId, list] of src.presets) {
      for (const row of list) {
        const spec = splitSpec(row.name)
        const entry = (rows[row.id] ??= { pkg: spec.pkg, sub: spec.sub, cat: categorize(spec.pkg), group: false, presets: {}, avail: {} })
        if (row.group) entry.group = true
        entry.presets[src.version] = [...new Set([...(entry.presets[src.version] ?? []), presetId])].sort()
      }
    }
  }
  for (const [id, entry] of Object.entries(rows)) {
    void id
    for (const src of sources) {
      const info = src.packages.get(entry.pkg)
      entry.avail[src.version] = info ? exportsHas(info.exports, entry.sub) : false
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    note:
      '官方组件地图（知识表，非运行时判据）。判「行能不能起」仍靠运行时探真宿主（resolvePkg + 子路径 exports）。'
      + '本表提供 id→包/子路径映射、组件分级、跨版本导出演进；由 tools/component-map.mjs 生成，追加不改历史。',
    sources: sources.map((s) => ({
      kind: s.kind,
      label: s.label,
      version: s.version,
      packageCount: s.packages.size,
      presetCount: s.presets.size,
    })),
    categories: Object.values(packages).reduce((acc, info) => {
      acc[info.cat] = (acc[info.cat] ?? 0) + 1
      return acc
    }, {}),
    packages,
    rows,
  }
}

/** asar 内的 presets/*.patch.yml（文本文件，走同一个 asar reader）。 */
function collectPresetsFromAsar(asarPath) {
  const out = new Map()
  const ar = openAsar(asarPath)
  if (!ar) return out
  try {
    const base = ['dsh', 'node_modules', '@deepseek-ai', 'dsh-web-app', 'presets']
    const presetsDir = ar.node(base)
    for (const f of Object.keys(presetsDir?.files ?? {})) {
      if (!f.endsWith('.patch.yml')) continue
      const text = ar.readText([...base, f])
      if (!text) continue
      for (const [pid, rows] of extractPresetRows(text)) {
        const cur = out.get(pid) ?? []
        const seen = new Set(cur.map((r) => r.id))
        for (const r of rows) if (!seen.has(r.id)) cur.push(r)
        out.set(pid, cur)
      }
    }
  } finally {
    ar.close()
  }
  return out
}

/** 自动探测：CLI 全局安装 scope 与桌面 asar。 */
export function detectSources() {
  const out = {}
  const cliRoots = [
    path.join(path.dirname(process.execPath), 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'),
    'C:/nodejs/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai',
  ]
  for (const r of cliRoots) if (fs.existsSync(r)) { out.cli = r; break }
  const res = process.env.DSH_DESKTOP_RESOURCES
    ?? path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DeepSeek Harness', 'resources')
  const asar = path.join(res, 'app.asar')
  if (process.env.LOCALAPPDATA && fs.existsSync(asar)) out.asar = asar
  const repo = process.env.DSH_REPO ?? path.join(os.homedir(), '..')
  if (fs.existsSync(path.join(repo, 'packages'))) out.repo = repo
  return out
}

// ── CLI 入口 ──
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const args = process.argv.slice(2)
  const arg = (flag) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  const auto = detectSources()
  const opts = {
    repo: args.includes('--no-repo') ? undefined : (arg('--repo') ?? (fs.existsSync('e:/test/rewrite-agently/deepseek-harness/packages') ? 'e:/test/rewrite-agently/deepseek-harness' : auto.repo)),
    cli: args.includes('--no-cli') ? undefined : (arg('--cli') ?? auto.cli),
    asar: args.includes('--no-asar') ? undefined : (arg('--asar') ?? auto.asar),
  }
  const map = buildComponentMap(opts)
  const out = arg('--out') ?? DEFAULT_OUT
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify(map, null, 2) + '\n', 'utf8')
  const bytes = fs.statSync(out).size
  console.log(`写入 ${out}（${(bytes / 1024).toFixed(1)} KB）`)
  console.log('来源:', map.sources.map((s) => `${s.kind}:${s.version}（包 ${s.packageCount} / 预设 ${s.presetCount}）`).join('  '))
  console.log('分级:', JSON.stringify(map.categories))
  console.log('行数:', Object.keys(map.rows).length)
  if (args.includes('--print')) {
    for (const [id, r] of Object.entries(map.rows)) {
      const avail = Object.entries(r.avail).map(([v, ok]) => `${v}:${ok ? '✓' : '✗'}`).join(' ')
      console.log(` ${id.padEnd(30)} ${r.pkg.replace('@deepseek-ai/', '')}${r.sub ? '/' + r.sub : ''}  [${r.cat}] ${avail}`)
    }
  }
}
