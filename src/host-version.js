/**
 * dsh-preset-manager — 运行宿主版本探测（适配分支选择依据）。
 *
 * 判据是「能否解析到 DSH 自身包并读出 package.json 版本」，双通道与
 * pkg-resolve 一致（Node 解析链 + fs 候选根）。fail-soft：全部失败返回
 * undefined，调用方回退 main 分支（与 0.3.x 行为一致）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { resolvePkg, pkgPart } from './pkg-resolve.js'

/** 依次尝试的 DSH 包名（CLI 本体 → web-app → base，任一可读版本即用）。 */
const HOST_PKGS = ['@deepseek-ai/dsh', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-base']

const MAX_UPWALK = 6

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

export function detectDshVersion(resolve = resolvePkg) {
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
      if (typeof pkg?.version === 'string' && pkg.version) return { version: pkg.version, via: name }
    } catch {
      /* 该包读不出版本，试下一个 */
    }
  }
  return undefined
}
