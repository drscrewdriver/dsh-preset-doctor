/**
 * dsh-preset-doctor — 引用包存在性校验。
 *
 * 双通道（对齐故障排查记录 §4.3 的手工方法）：
 * 1. import.meta.resolve：走 Node 真实解析链。插件物理位于 profile
 *    node_modules，目录上溯天然命中 DSH 全局安装的 node_modules。
 * 2. fs 候选根目录检查：本模块祖先链上的 node_modules + 可执行文件旁的
 *    node_modules（Windows 全局安装 C:\nodejs\node_modules）。
 *
 * 判据是「能否解析到包」，不是有没有 default 导出——Cordis 插件有函数式
 * （无 default）与类式（有 default）两种合法形态。
 */
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'

/** '@a/b/c' → '@a/b'；'pkg/sub' → 'pkg'（存在性检查先看包本体，子路径另判）。 */
export function pkgPart(name) {
  const seg = String(name).split('/')
  return String(name).startsWith('@') ? seg.slice(0, 2).join('/') : seg[0]
}

/** 包名除本体外的子路径导出段（无子路径返回 ''）。 */
export function subPathOf(name) {
  const s = String(name)
  if (!s || s.startsWith('@')) {
    const seg = s.split('/')
    return seg.slice(2).join('/')
  }
  return s.split('/').slice(1).join('/')
}

/**
 * 子路径导出存在性（类型+版本适配）：`@deepseek-ai/dsh-tool-subagent-control/list-agents`
 * 这类行引用的是包内子路径，包本体存在不等于该导出存在（导出表逐版本变过）。
 * 判据：exports 命中（精确键 / './x/*' 模式 / 子对象）→ ok；无 exports 字段 → 回落文件存在性；
 * exports 存在但既无精确键也无匹配模式 → 不可用。拿不准（读不到包/解析失败）一律 ok（fail-open）。
 * @param {string} pkgDir 包目录
 * @param {string} sub 子路径（不含 './'）
 * @returns {boolean} 子路径是否可用
 */
export function subPathExported(pkgDir, sub) {
  if (!sub) return true
  let pj
  try {
    pj = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return true // 读不到 package.json：保守当可用
  }
  const exp = pj?.exports
  if (exp == null) {
    // 无 exports 字段：按传统文件存否判定（main/module 时代语义）
    return fs.existsSync(path.join(pkgDir, sub)) || fs.existsSync(path.join(pkgDir, `${sub}.js`)) || fs.existsSync(path.join(pkgDir, sub, 'index.js'))
  }
  const want = `./${sub}`
  const scan = (node) => {
    if (typeof node === 'string' || node == null) return false
    if (Array.isArray(node)) return node.some(scan)
    if (typeof node !== 'object') return false
    const keys = Object.keys(node)
    if (keys.includes(want)) return true
    if (keys.some((k) => k.endsWith('/*') && want.startsWith(k.slice(0, -1)))) return true
    return keys.some((k) => k !== '.' && !k.startsWith('./') && scan(node[k])) // conditions 层（require/import/browser…）
  }
  return scan(exp)
}

export function isLocalPath(name) {
  return typeof name === 'string' && /^\.{1,2}[\\/]/.test(name)
}

/** 读 package.json 的 name（读不到/坏 JSON → null，fail-open）。Electron 主进程 fs 已被 asar patch。 */
function readPkgName(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8').replace(/^\uFEFF/, '')).name ?? null
  } catch {
    return null
  }
}

/**
 * Electron 运行时的候选 node_modules 根（desktop 形态真实布局，2026-11-08 实测）：
 *
 *   C:\...\Programs\DeepSeek Harness\resources\app.asar\dsh\                ← @deepseek-ai/dsh-desktop-runtime 0.2.2-rc.1
 *   C:\...\resources\app.asar\dsh\node_modules\@deepseek-ai\*              ← 331 个官方包真身（宿主实际加载的那套）
 *   C:\...\resources\app.asar\node_modules\                                ← asar 顶层也有一份，但不含宿主本体依赖
 *
 * 所以**只加 `<res>/app.asar/node_modules` 是不够的**：桌面宿主的包全在 `app.asar/dsh/` 这个
 * `@deepseek-ai/dsh-desktop-runtime` 目录里。识别方式走 bundle 内层扫描（包名以 `@deepseek-ai/dsh`
 * 开头即视为宿主 bundle），不硬编码目录名 `dsh`，兼容后续换布局。
 * 读不到/非 Electron 环境一律返回 []（fail-open，不影响其它通道）。
 * @param {string} [resourcesPath] 默认 process.resourcesPath
 * @returns {string[]} 去重后的根（bundle 内层优先于仓基座）
 */
export function electronRoots(resourcesPath = globalThis.process?.resourcesPath) {
  const out = []
  const push = (p) => {
    if (p && !out.includes(p) && dirExists(p)) out.push(p)
  }
  if (!resourcesPath) return out
  for (const baseName of ['app.asar', 'app', 'app.asar.unpacked']) {
    const base = path.join(resourcesPath, baseName)
    let children
    try {
      children = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      continue // 该布局不存在（或非 Electron：纯 Node 读不了 asar）
    }
    // 1) bundle 内层：<base>/<宿主包目录>/node_modules
    for (const name of children) {
      if (name === 'node_modules') continue
      const pkgName = readPkgName(path.join(base, name))
      if (pkgName && /^@deepseek-ai\/dsh/.test(pkgName)) push(path.join(base, name, 'node_modules'))
    }
    // 2) node_modules 里官方 bundle 的再内层：<base>/node_modules/@deepseek-ai/dsh*/node_modules
    try {
      const scope = path.join(base, 'node_modules', '@deepseek-ai')
      for (const name of fs.readdirSync(scope)) {
        if (/^dsh/.test(name)) push(path.join(scope, name, 'node_modules'))
      }
    } catch {
      /* 无 scope 目录 */
    }
    // 3) 基座自身
    push(path.join(base, 'node_modules'))
  }
  return out
}

/**
 * 候选 node_modules 根：本模块祖先链上的所有 node_modules +
 * 可执行文件旁的 node_modules + **Electron 运行时 resourcesPath 下的 app.asar 内层**
 * （desktop 形态真宿主跑在 asar 里，不把它排在最前就会用 CLI 全局那份不同版本的副本作判据）
 * + 官方 bundle 内层 node_modules（`<root>/@deepseek-ai/dsh/node_modules`）。顺序即优先级，去重。
 */
export function candidateRoots({ here = import.meta.url, execPath = process.execPath, resourcesPath = globalThis.process?.resourcesPath } = {}) {
  const roots = []
  const push = (p) => {
    if (p && !roots.includes(p)) roots.push(p)
  }
  const pushChain = (startDir) => {
    let cur = startDir
    for (;;) {
      // 已安装布局：模块位于 <...>/node_modules/<pkg>/ 内，祖先链上有 node_modules
      if (path.basename(cur) === 'node_modules') push(cur)
      // 开发布局：模块位于 <pkg>/src/ 内，取每个祖先的 node_modules 兄弟目录
      push(path.join(cur, 'node_modules'))
      const parent = path.dirname(cur)
      if (parent === cur) break
      cur = parent
    }
  }
  try {
    pushChain(path.dirname(fileURLToPath(here)))
  } catch {
    /* import.meta.url 不可用（非 ESM 环境）时跳过 */
  }
  try {
    pushChain(path.dirname(execPath))
  } catch {
    /* execPath 不可用时跳过 */
  }
  // 官方 CLI/desktop bundle 内层：<root>/@deepseek-ai/dsh/node_modules/@deepseek-ai/*
  for (const root of [...roots]) {
    if (dirExists(path.join(root, '@deepseek-ai', 'dsh'))) {
      push(path.join(root, '@deepseek-ai', 'dsh', 'node_modules'))
    }
  }
  // Electron 运行时（desktop 形态）的根排最前：宿主自报的 resourcesPath 才是当前在跑的那套
  // （顺序：asar 内 bundle 内层 → asar 基座 → app / unpacked）
  const electron = electronRoots(resourcesPath)
  return [...electron, ...roots.filter((p) => !electron.includes(p))]
}

function dirExists(p) {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function existsInRoot(root, name) {
  const parts = pkgPart(name).split('/')
  return dirExists(path.join(root, ...parts))
}

/**
 * 解析一个包名。返回 { ok, resolvedVia, resolvedPath, subpathMissing }：
 * - ok=false 表示所有通道都找不到（R-PKG-MISSING 的依据）
 * - subpathMissing=true：包本体在，但行引用的子路径导出在该版本不存在（同样 never started）
 * - resolvedVia 记录命中通道，报告里展示实际解析路径
 */
export function resolvePkg(name, { roots } = {}) {
  if (isLocalPath(name)) return { ok: true, resolvedVia: 'local-path', resolvedPath: '' }
  if (typeof name !== 'string' || name === '') return { ok: false, resolvedVia: '', resolvedPath: '' }
  const sub = subPathOf(name)
  // 1) Node 解析链（含 exports/subpath 语义）
  try {
    const url = import.meta.resolve(sub ? name : pkgPart(name))
    const p = fileURLToPath(url)
    if (dirExists(p) || fs.existsSync(p)) {
      return { ok: true, resolvedVia: 'import.meta.resolve', resolvedPath: p }
    }
  } catch {
    /* 解析失败继续走 fs 候选根 */
  }
  // 2) fs 候选根（先按包体找目录，再单独判子路径导出）
  for (const root of roots?.length ? roots : candidateRoots()) {
    if (existsInRoot(root, name)) {
      const pkgDir = path.join(root, ...pkgPart(name).split('/'))
      if (sub && !subPathExported(pkgDir, sub)) {
        return { ok: false, resolvedVia: `fs:${root}`, resolvedPath: pkgDir, subpathMissing: true }
      }
      return { ok: true, resolvedVia: `fs:${root}`, resolvedPath: pkgDir }
    }
  }
  return { ok: false, resolvedVia: '', resolvedPath: '' }
}

/**
 * 收集 profile bundle 层的行级禁用集（2026-11-06 桌面实证）：
 * profile package.json 的 dsh.profile.bundles 各包自带 cordis.patch.yml 里的
 * 顶层定向覆盖行（含 id + disabled:true，无 insert）会全局关掉对应行 id——
 * 包可解析但被 bundle 禁用同样 never started（如 agent-team-profile 关
 * tool-subagent-control/list-agents）。读不到/解析失败静默跳过（fail-open）。
 * @param {string} profileRoot profile 目录（含 package.json + node_modules）
 * @returns {Set<string>} 被 bundle 禁用的行 id 集
 */
export function collectBundleDisabledIds(profileRoot) {
  const out = new Set()
  if (!profileRoot) return out
  let bundles
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(profileRoot, 'package.json'), 'utf8').replace(/^\uFEFF/, ''))
    bundles = pj?.dsh?.profile?.bundles ?? []
  } catch {
    return out
  }
  for (const b of bundles) {
    if (typeof b !== 'string' || isLocalPath(b) || /^file:/i.test(b)) continue
    let text
    try {
      text = fs.readFileSync(path.join(profileRoot, 'node_modules', ...b.split('/'), 'cordis.patch.yml'), 'utf8')
    } catch {
      continue // 包无自带 patch 或未装 → 跳过
    }
    try {
      const doc = parseDocument(text, { prettyErrors: true })
      if (doc.errors.length || !doc.contents || typeof doc.contents.items !== 'object') continue
      for (const item of doc.contents.items ?? []) {
        if (!item || typeof item.get !== 'function') continue
        if (item.get('insert') != null) continue // 插入类条目不是覆盖禁用行
        const id = item.get('id')
        const d = item.get('disabled')
        if (typeof id === 'string' && id && (d === true || d === 'true')) out.add(id)
      }
    } catch {
      /* 单包解析失败不影响其余 */
    }
  }
  return out
}
