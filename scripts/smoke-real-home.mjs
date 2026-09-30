/**
 * 真实 home 副本冒烟（task_21 自动化安全版）：
 * - 只读真实 ~/.dsh 的 cordis.patch.yml、每个 profile 的 cordis.patch.yml、遗留 .agent-presets/
 * - 对副本跑 scan + dry-run fix，输出报告
 * - 绝不写真实 ~/.dsh；不拷贝 node_modules（只拷声明文件）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scanAll } from '../src/scan.js'
import { applyFixes } from '../src/fix/index.js'
import { renderText, summarize } from '../src/report.js'
import { resolveDshHome } from '../src/paths.js'

const realHome = resolveDshHome()
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dshpm-smoke-'))
console.log('真实 home（只读拷贝来源）:', realHome)
console.log('冒烟副本:', tmp)

// 顶层 patch
if (fs.existsSync(path.join(realHome, 'cordis.patch.yml'))) {
  fs.copyFileSync(path.join(realHome, 'cordis.patch.yml'), path.join(tmp, 'cordis.patch.yml'))
}
// 每个 profile 的 cordis.patch.yml（不拷 node_modules）
const profilesDir = path.join(realHome, 'profiles')
if (fs.existsSync(profilesDir)) {
  for (const p of fs.readdirSync(profilesDir, { withFileTypes: true })) {
    if (!p.isDirectory()) continue
    const patch = path.join(profilesDir, p.name, 'cordis.patch.yml')
    if (fs.existsSync(patch)) {
      fs.mkdirSync(path.join(tmp, 'profiles', p.name), { recursive: true })
      fs.copyFileSync(patch, path.join(tmp, 'profiles', p.name, 'cordis.patch.yml'))
    }
  }
}
// 遗留目录（体量小：双文件 + .mjs）
const legacyDir = path.join(realHome, '.agent-presets')
if (fs.existsSync(legacyDir)) {
  fs.cpSync(legacyDir, path.join(tmp, '.agent-presets'), { recursive: true })
}

const scan = scanAll({ home: tmp, scanProfiles: true, migrateLegacy: true })
const fix = applyFixes(scan, { dryRun: true, ts: 'SMOKE' })
const summary = summarize(scan, fix)
console.log('--- 报告（dry-run，0 写盘） ---')
console.log(renderText(summary))
fs.rmSync(tmp, { recursive: true, force: true })
