/**
 * dsh-preset-doctor — 包引用检查（R-PKG-RENAMED / R-PKG-MISSING / R-LOCAL-PATH）。
 *
 * 门禁是**相对运行实例**的（这是「任意历史起点收敛到当前安装」的关键）：
 * - 旧名在当前安装**已死** 且 迁移表链式收敛后的新名**存在** → R-PKG-RENAMED（自动修）
 * - 旧名已死、新名也不存在 → R-PKG-MISSING（L3 报告，提示有改名候选但继任者缺失）
 * - 旧名在当前安装**仍活着** → 不产生任何 finding（老安装上不误伤）
 * 因此同一条追加式变更对任何用户都安全：规则只在「真的坏了」时触发。
 */
import { isLocalPath, resolvePkg, pkgPart } from '../pkg-resolve.js'

/** cordis: 前缀是内建虚拟行（cordis:group 等），不是 npm 包。 */
function isVirtualName(name) {
  return /^cordis:/.test(name)
}

/**
 * @param {object} row 行描述（file/line/id/name/nameNode/range…）
 * @param {object} tables 生效迁移表（packageRenames: Map<string,{to,renameRowId}> 等）
 * @param {object} deps { resolvePkg?, localPathsLegal? } 可注入以便测试；
 *   localPathsLegal：目录分支（≤0.1.5）下相对路径相对预设目录解析，是当时的
 *   合法语义 → 不产生 R-LOCAL-PATH（file:// 要求自 0.1.7 声明式机制始）。
 */
export function checkPackage(row, tables, deps = {}) {
  const resolve = deps.resolvePkg ?? resolvePkg
  const findings = []
  const name = row.name
  if (typeof name !== 'string' || name === '') return findings
  const at = `${row.file}:${row.nameLine}`

  if (isVirtualName(name)) return findings

  if (isLocalPath(name)) {
    if (deps.localPathsLegal) return findings
    findings.push({
      rule: 'R-LOCAL-PATH',
      level: 'auto',
      file: row.file,
      line: row.nameLine,
      rowId: row.id,
      reason: `本地插件用了相对路径 ${name}（${at}）。旧机制相对预设目录解析；0.1.7+ 需要绝对 file:// URL`,
      suggestion: '自动改写为绝对 file:// URL（原文件不移动）。注意：本地插件的 API 是否仍兼容当前版本无法静态验证',
      data: { name, baseDir: row.baseDir, rowRange: row.range },
    })
    return findings
  }

  // 链式收敛：name 可能是任意历史时代的旧名（A→B、B→C ⇒ A 解析为 C）
  const entry = tables.packageRenames instanceof Map ? tables.packageRenames.get(name) : undefined
  if (entry) {
    const oldAlive = resolve(name).ok
    const newAlive = resolve(entry.to).ok
    if (oldAlive && !newAlive) {
      // 老安装（新包还没出现）：声明照当前安装是合法的，不产生 finding
      return findings
    }
    if (!oldAlive && newAlive) {
      const fromRowId = pkgPart(name).split('/').pop().replace(/^dsh-/, '')
      const toRowId = pkgPart(entry.to).split('/').pop().replace(/^dsh-/, '')
      const renameRowId = entry.renameRowId && (row.id === fromRowId || row.id === `dsh-${fromRowId}`)
      findings.push({
        rule: 'R-PKG-RENAMED',
        level: 'auto',
        file: row.file,
        line: row.nameLine,
        rowId: row.id,
        reason: `包已改名：${name} → ${entry.to}（${at}）。旧包在当前安装不存在，会导致整条预设「加载失败：never started」`,
        suggestion: `自动替换包名${renameRowId ? ` 并同步行 id（${row.id} → ${toRowId}）` : ''}`,
        data: { from: name, to: entry.to, renameRowId, fromRowId, toRowId, rowRange: row.range, rowId: row.id, brokenIn: entry.brokenIn },
      })
      return findings
    }
    if (!oldAlive && !newAlive) {
      findings.push({
        rule: 'R-PKG-MISSING',
        level: 'report',
        file: row.file,
        line: row.nameLine,
        rowId: row.id,
        reason: `包 ${name} 在当前安装不可解析；迁移表中有改名记录（→ ${entry.to}），但继任包同样不可解析（${at}）。一行失效即整条预设加载失败`,
        suggestion: 'a) 确认继任包名是否再次变更（可在 tables.user.json 追加条目）；b) 若已废弃，手工删除该行；c) 检查 DSH 安装是否完整',
        data: { name, renameCandidate: entry.to },
      })
      return findings
    }
    // oldAlive && newAlive：过渡期双名共存（罕见），不动
    return findings
  }

  const res = resolve(name)
  if (!res.ok) {
    findings.push({
      rule: 'R-PKG-MISSING',
      level: 'report',
      file: row.file,
      line: row.nameLine,
      rowId: row.id,
      reason: `包 ${name} 在当前安装与 profile node_modules 中均不可解析（${at}）。一行失效即整条预设加载失败`,
      suggestion:
        'a) 若已知继任包，手工替换 name（或在 tables.user.json 追加改名条目后重扫）；b) 若该包已废弃，手工删除该行；c) 若为第三方包，确认其是否支持当前 DSH 版本',
      data: { name },
    })
  }
  return findings
}
