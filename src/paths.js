/**
 * dsh-preset-manager — 路径与声明源收集。
 *
 * 声明源三层（对齐故障排查记录 §3 / 兼容指南 §1）：
 * - home 级：$DSH_HOME/cordis.patch.yml（对所有 profile 生效，优先扫）
 * - profile 级：$DSH_HOME/profiles/<name>/cordis.patch.yml
 * - 遗留目录：$DSH_HOME/.agent-presets/<id>/（0.1.6- 双文件格式）
 *
 * 常量与旧机制 discovery.ts 一致：USER_PRESET_DIR='.agent-presets'、
 * COMPOSITION_FILE='agent.cordis.yml'、METADATA_FILE='preset.yml'。
 */
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

export const dirname = path.dirname

export const LEGACY_DIR_NAME = '.agent-presets'
export const COMPOSITION_FILE = 'agent.cordis.yml'
export const METADATA_FILE = 'preset.yml'

function realpathSafe(p) {
  try {
    return fs.realpathSync(p)
  } catch {
    return null
  }
}

export function isFile(p) {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * 扫描根目录定位：显式覆盖 → DSH_HOME 环境变量 → ~/.dsh。
 * junction 还原为真实路径（Windows 全局安装常见 C:\nodejs → C:\nvm\...）。
 */
export function resolveDshHome(override = '') {
  // 用 || 而非 ??：宿主 settings 投影会把「未设置」给成空串，?? 对 '' 不穿透，
  // DSH_HOME（宿主家目录契约）就永远轮不到——沙盒/多实例场景全数失效
  const raw = String(override || process.env.DSH_HOME || '').trim()
  const home = raw || path.join(os.homedir(), '.dsh')
  return realpathSafe(home) || home
}

function readDirSafe(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** 收集待扫描的 patch 文件：home 级在前，profile 级按目录名排序（结果确定）。 */
export function collectPatchFiles(home, { scanProfiles = true } = {}) {
  const out = []
  const homePatch = path.join(home, 'cordis.patch.yml')
  if (isFile(homePatch)) out.push({ layer: 'home', profile: '', file: homePatch })
  if (scanProfiles) {
    const profileFiles = []
    for (const ent of readDirSafe(path.join(home, 'profiles'))) {
      if (!ent.isDirectory() || ent.name.startsWith('.')) continue
      const file = path.join(home, 'profiles', ent.name, 'cordis.patch.yml')
      if (isFile(file)) profileFiles.push({ layer: 'profile', profile: ent.name, file })
    }
    profileFiles.sort((a, b) => (a.profile < b.profile ? -1 : a.profile > b.profile ? 1 : 0))
    out.push(...profileFiles)
  }
  return out
}

/** 枚举遗留旧格式预设目录（存在 agent.cordis.yml 或 preset.yml 即算）。 */
export function collectLegacyDirs(home) {
  const root = path.join(home, LEGACY_DIR_NAME)
  const out = []
  for (const ent of readDirSafe(root)) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue
    const dir = path.join(root, ent.name)
    const composition = path.join(dir, COMPOSITION_FILE)
    const metadata = path.join(dir, METADATA_FILE)
    if (!isFile(composition) && !isFile(metadata)) continue
    out.push({
      id: ent.name,
      dir,
      compositionFile: isFile(composition) ? composition : '',
      metadataFile: isFile(metadata) ? metadata : '',
    })
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return out
}

/** 读写文本（UTF-8，不碰 BOM——由调用方决定处理策略）。 */
export function readText(file) {
  return fs.readFileSync(file, 'utf8')
}
