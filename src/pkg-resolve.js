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

/** '@a/b/c' → '@a/b'；'pkg/sub' → 'pkg'（存在性检查只看包本体）。 */
export function pkgPart(name) {
  const seg = String(name).split('/')
  return String(name).startsWith('@') ? seg.slice(0, 2).join('/') : seg[0]
}

export function isLocalPath(name) {
  return typeof name === 'string' && /^\.{1,2}[\\/]/.test(name)
}

/**
 * 候选 node_modules 根：本模块祖先链上的所有 node_modules +
 * 可执行文件旁的 node_modules + DSH 安装 bundle 的内层 node_modules
 * （官方包装在 <root>/@deepseek-ai/dsh/node_modules 里，不在插件的解析链上）。
 * 顺序即优先级，去重。
 */
export function candidateRoots({ here = import.meta.url, execPath = process.execPath } = {}) {
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
  // DSH CLI 的 bundle 内层：C:\nodejs\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\*
  for (const root of [...roots]) {
    if (dirExists(path.join(root, '@deepseek-ai', 'dsh'))) {
      push(path.join(root, '@deepseek-ai', 'dsh', 'node_modules'))
    }
  }
  return roots
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
 * 解析一个包名。返回 { ok, resolvedVia, resolvedPath }：
 * - ok=false 表示所有通道都找不到（R-PKG-MISSING 的依据）
 * - resolvedVia 记录命中通道，报告里展示实际解析路径
 */
export function resolvePkg(name, { roots } = {}) {
  if (isLocalPath(name)) return { ok: true, resolvedVia: 'local-path', resolvedPath: '' }
  if (typeof name !== 'string' || name === '') return { ok: false, resolvedVia: '', resolvedPath: '' }
  // 1) Node 解析链（含 exports/subpath 语义）
  try {
    const url = import.meta.resolve(name)
    const p = fileURLToPath(url)
    if (dirExists(p) || fs.existsSync(p)) {
      return { ok: true, resolvedVia: 'import.meta.resolve', resolvedPath: p }
    }
  } catch {
    /* 解析失败继续走 fs 候选根 */
  }
  // 2) fs 候选根
  for (const root of roots?.length ? roots : candidateRoots()) {
    if (existsInRoot(root, name)) {
      return { ok: true, resolvedVia: `fs:${root}`, resolvedPath: path.join(root, ...pkgPart(name).split('/')) }
    }
  }
  return { ok: false, resolvedVia: '', resolvedPath: '' }
}
