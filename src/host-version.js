/**
 * dsh-preset-doctor — 运行宿主版本探测（适配分支选择依据）。
 *
 * 判据是「能否解析到 DSH 自身包并读出 package.json 版本」。0.7.5 起改为
 * **全副本收集取最高 semver**：单包解析链会撞上 profile 上层目录的安装残留
 * （如 <home>/profiles/node_modules/@deepseek-ai/dsh 停着旧版副本），
 * desktop 形态下真实宿主跑在 Electron 运行时里、node_modules 副本本就非权威。
 * 三通道：Node 解析链 + fs 候选根 + **process.resourcesPath**（Electron 主
 * 进程里宿主自报的 app.asar 位置，fs 已被 asar patch——不依赖 exe 安装目录
 * 在磁盘哪里，升级换代/多套安装都天然正确）。残留副本只会比运行宿主旧，
 * 因此对全部候选取 max 是对垃圾鲁棒的启发式。
 * fail-soft：全部失败返回 undefined，调用方回退 main 分支。
 * 返回 { version, via, path, copies }——via/path 供 UI 展示判定依据。
 */
import fs from 'node:fs'
import path from 'node:path'
import { resolvePkg, candidateRoots, pkgPart } from './pkg-resolve.js'
import { compareSemver } from './tables/load.js'

/** 依次收集的 DSH 包名（CLI 本体 → web-app → base，任一可读版本即候选）。 */
const HOST_PKGS = ['@deepseek-ai/dsh', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-base']

const MAX_UPWALK = 6

/** 读一个包目录的 version（非包根/坏 JSON 返回 undefined）。 */
function readVersion(pkgDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : undefined
  } catch {
    return undefined
  }
}

/** 从解析结果（文件或目录）向上定位包根的 package.json（以 name 匹配为准）。 */
function findPackageJson(startPath, expectName) {
  let cur = fs.statSync(startPath).isFile() ? path.dirname(startPath) : startPath
  for (let i = 0; i < MAX_UPWALK; i++) {
    const pkgFile = path.join(cur, 'package.json')
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
      if (pkg.name === expectName || pkg.name === pkgPart(expectName)) return pkg
    } catch {
      /* 不是包根，继续向上 */
    }
    const parent = path.dirname(cur)
    if (parent === cur) return undefined
    cur = parent
  }
  return undefined
}

/**
 * @param {{ resolve?: Function, roots?: string[], resourcesPath?: string }} [opts] 测试注入口：
 *   resolve 覆盖 Node 解析通道，roots 覆盖 fs 候选根集合，resourcesPath
 *   覆盖 Electron 运行时资源目录（默认 process.resourcesPath）。
 */
export function detectDshVersion({ resolve = resolvePkg, roots, resourcesPath = process.resourcesPath } = {}) {
  const candidates = [] // [{ version, via, file }]
  const seen = new Set()
  const add = (version, via, file) => {
    if (!version || seen.has(file)) return
    seen.add(file)
    candidates.push({ version, via, file })
  }
  // 通道 1：Node 真实解析链（含 exports 语义）
  for (const name of HOST_PKGS) {
    let res
    try {
      res = resolve(name)
    } catch {
      continue
    }
    if (!res?.ok || !res.resolvedPath) continue
    try {
      const pkg = findPackageJson(res.resolvedPath, name)
      if (pkg?.version) add(pkg.version, `resolve:${name}`, res.resolvedPath)
    } catch {
      /* 该包读不出版本，试下一个 */
    }
  }
  // 通道 2：全部候选 fs 根（含 CLI bundle 内层，candidateRoots 已展开）
  let allRoots
  try {
    allRoots = roots ?? candidateRoots()
  } catch {
    allRoots = []
  }
  for (const root of allRoots) {
    for (const name of HOST_PKGS) {
      const dir = path.join(root, ...pkgPart(name).split('/'))
      const v = readVersion(dir)
      if (v) add(v, `fs:${root}`, dir)
    }
  }
  // 通道 3：Electron 运行时（desktop 形态真宿主在 app.asar 内，主进程 fs 已 asar patch）
  if (resourcesPath) {
    for (const base of [
      path.join(resourcesPath, 'app.asar', 'node_modules'),
      path.join(resourcesPath, 'app', 'node_modules'),
      path.join(resourcesPath, 'app.asar.unpacked', 'node_modules'),
    ]) {
      for (const name of HOST_PKGS) {
        const dir = path.join(base, ...pkgPart(name).split('/'))
        const v = readVersion(dir)
        if (v) add(v, `electron:${base}`, dir)
      }
    }
  }
  if (candidates.length === 0) return undefined
  candidates.sort((a, b) => compareSemver(b.version, a.version))
  const best = candidates[0]
  return { version: best.version, via: best.via, path: best.file, copies: candidates.length }
}
