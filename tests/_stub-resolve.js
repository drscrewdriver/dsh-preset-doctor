/**
 * 测试桩：模拟 DSH 运行时的包解析。
 * - `dead` 名单里的包判为不可解析（内置表里的历史旧名，在 0.1.7+ 安装里已死）
 * - 其余全部可解析（官方 27 包基线在当前安装都存在）
 * 这正是门禁的真实语义：R-PKG-RENAMED 只在「旧名已死 + 新名存在」时触发。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolvePkg as realResolve } from '../src/pkg-resolve.js'

export const DSH_DEAD_DEFAULT = ['@deepseek-ai/dsh-workflow-worker-thread']

export function makeDshResolve({ dead = DSH_DEAD_DEFAULT, alive = [] } = {}) {
  const deadSet = new Set(dead)
  const aliveSet = new Set(alive)
  return (name) => {
    if (deadSet.has(name)) return { ok: false, resolvedVia: 'stub-dead', resolvedPath: '' }
    if (aliveSet.has(name)) return { ok: true, resolvedVia: 'stub-alive', resolvedPath: '' }
    return { ok: true, resolvedVia: 'stub', resolvedPath: '' }
  }
}

/**
 * 桩：让 shadow.js 的 collectShippedPresetIds 能读到「内置预设包」的 presets/ 目录，
 * 而无需真装 @deepseek-ai/dsh-web-app（该包由 Electron 运行时注入，npm/CI 上没有）。
 * 直接把 fixture 目录（v0.1.7/*.patch.yml 等）伪装成 <root>/presets/。
 * 其它包名仍走真实 resolve（保留 yaml 等真实依赖的解析）。
 *
 * 返回 { resolvePkg, cleanup } —— 调用方在测试结束后 cleanup()，或让 OS 清 tmp。
 */
export function makeShippedWebAppResolve(fixtureDir) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-shipped-stub-'))
  const presets = path.join(root, 'presets')
  fs.mkdirSync(presets, { recursive: true })
  for (const f of fs.readdirSync(fixtureDir)) {
    if (!f.endsWith('.patch.yml')) continue
    fs.copyFileSync(path.join(fixtureDir, f), path.join(presets, f))
  }
  const resolvePkg = (name, opts) =>
    name === '@deepseek-ai/dsh-web-app'
      ? { ok: true, resolvedVia: 'stub-shipped', resolvedPath: root }
      : realResolve(name, opts)
  resolvePkg.cleanup = () => {
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* best-effort */ }
  }
  return resolvePkg
}
