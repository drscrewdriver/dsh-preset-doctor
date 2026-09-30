/**
 * 测试桩：模拟 DSH 运行时的包解析。
 * - `dead` 名单里的包判为不可解析（内置表里的历史旧名，在 0.1.7+ 安装里已死）
 * - 其余全部可解析（官方 27 包基线在当前安装都存在）
 * 这正是门禁的真实语义：R-PKG-RENAMED 只在「旧名已死 + 新名存在」时触发。
 */
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
