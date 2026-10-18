/**
 * dsh-preset-doctor — 插件入口（host half）。
 *
 * 装载即工作：启动后台扫描三层声明源 → 机械可修的自动对齐到当前语法
 * （写前 .bak 备份、原子写、幂等）→ 输出结构化报告；不可机械修的逐条报告。
 * 全部服务访问 fail-open：settings/commands/logger 缺失时用默认配置照常运行。
 *
 * 0.1.7：声明式设置 —— volatile 字段即宿主托管存储/配置管道（session-guard 同款）。
 * 0.5.0：设置面三代 waist 下探 —— 0.1.2/0.1.5 走服务实例 installSection、
 * 0.1.0/0.1.1 走服务 register（注册即持久化，壳无设置页非缺陷）；rc.1+ 的
 * 设置 UI 由 client 半边插件页卡承担（数据走桥，宿主不渲染 volatile 表单）。
 */
import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from './paths.js'
import { scanAll } from './scan.js'
import { applyFixes, runAlign as alignPreset, runToggle as toggleRow, runResolveLegacy } from './fix/index.js'
import { defaultTimestamp } from './fix/core.js'
import { summarize, renderText, renderJson, collectPresets, eraCatalogFor, DISCLAIMER } from './report.js'
import { registerPresetDoctorCommand } from './commands.js'
import { classifyComposition } from './rules/composition-drift.js'
import { baselineForVersion, loadBaseline } from './tables/load.js'
import { installSettingsWaist } from './settings-waist.js'
import { makeSettingsBridge } from './bridge.js'

export const name = 'preset-manager'
export const inject = []

export { DISCLAIMER }

/** 默认配置（设置服务不可用时即用此值）。 */
export const DEFAULT_SETTINGS = Object.freeze({
  // autoFix 总闸已退役（2026-10-09 用户定案「取消自动闸 全手动确认」）：
  // 启动恒 scan-only，写盘只经显式手动动作（/preset-doctor fix 命令、
  // 卡内同步确认框）。旧配置里的 autoFix 值被 readConfig 丢弃，无害。
  scanProfiles: true, // 同时扫描 profiles/<name>/cordis.patch.yml
  migrateLegacy: true, // 自动迁移旧格式 .agent-presets/ 目录
  homeOverride: '', // 覆盖扫描根目录（默认 ~/.dsh；测试/多实例用）
})

export const Config = z
  .object({
    scanProfiles: z.boolean().default(DEFAULT_SETTINGS.scanProfiles).volatile().description('同时扫描 profile 级 cordis.patch.yml'),
    migrateLegacy: z.boolean().default(DEFAULT_SETTINGS.migrateLegacy).volatile().description('自动迁移旧格式 .agent-presets/ 目录为 patch 声明'),
    homeOverride: z.string().default(DEFAULT_SETTINGS.homeOverride).volatile().description('覆盖扫描根目录（默认 ~/.dsh；测试/多实例用）'),
  })

/** volatile 字段/字段级活引用解引出普通值（session-guard 同款）。 */
export function resolveConfig(config) {
  if (config === null || typeof config !== 'object') return {}
  const out = {}
  for (const [key, value] of Object.entries(config)) {
    out[key] = value !== null && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value
  }
  return out
}

/** 已知键合并默认值（未知键丢弃；undefined/null 落默认，空串照常穿透）。 */
function readConfig(config) {
  const resolved = resolveConfig(config)
  const out = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(out)) {
    const v = resolved[key]
    if (v !== undefined && v !== null) out[key] = v
  }
  return out
}

export function apply(ctx, config = {}) {
  // 活配置源：≤0.1.5 由 installSection 的 setSource 换绑，rc.1+ 恒为 loader
  // 传入的 volatile config（宿主改设置后引用原位更新）——所以 current 必须
  // 可变、每次扫描/修复前重新解引。
  let current = () => readConfig(config)

  const log = (msg) => {
    try {
      const l = typeof ctx.logger === 'function' ? ctx.logger('preset-manager') : ctx.logger
      ;(l?.info ?? l?.log ?? console.log).call(l ?? console, msg)
    } catch {
      console.log('[preset-manager]', msg)
    }
  }

  /** 扫描 + （显式调用时）修复 → 报告。mode: 'fix' | 'scan'。
   *  写盘语义（2026-10-09「取消自动闸 全手动确认」）：mode='fix' 只由
   *  /preset-doctor 显式命令进入——命令本身即手动确认；启动恒 'scan'。 */
  function runScanFix({ mode = 'fix' } = {}) {
    const cfg = current()
    const home = resolveDshHome(cfg.homeOverride)
    const scan = scanAll({
      home,
      scanProfiles: cfg.scanProfiles,
      migrateLegacy: cfg.migrateLegacy,
    })
    lastScan = { home, scan }
    const doFix = mode === 'fix'
    const fixResult = doFix ? applyFixes(scan, { dryRun: false, ts: defaultTimestamp() }) : undefined
    const summary = summarize(scan, fixResult)
    return { summary, text: renderText(summary), json: renderJson(summary) }
  }

  // ── 卡片化 UI 数据层：启动扫描缓存 + 单预设同步（桥 list/sync 消费）──
  let lastScan = null

  /** list 路由数据：默认走启动缓存（秒开），fresh 才重扫。 */
  function getSummary({ fresh = false } = {}) {
    if (fresh || !lastScan) runScanFix({ mode: 'scan' })
    const { home, scan } = lastScan
    const summary = summarize(scan, undefined)
    const cfg = current()
    // composition 视图数据：逐覆盖内置预设的行分类（供卡面分组标注 + toggle/对齐）
    const baseline = baselineForVersion(summary.detectedVersion)
    const allBaselines = loadBaseline()
    const composition = []
    for (const src of scan.sources || []) {
      for (const presetRow of src.presetRows || []) {
        if (!presetRow.presetId) continue
        composition.push({
          file: src.file,
          ...classifyComposition(src, presetRow, { baseline, allBaselines, currentVersion: summary.detectedVersion }),
        })
      }
    }
    return {
      version: summary.detectedVersion,
      branch: summary.branch,
      eras: eraCatalogFor(summary.branch),
      presets: summary.presets,
      composition,
      total: summary.total,
      byLevel: summary.byLevel,
      config: { scanProfiles: cfg.scanProfiles, migrateLegacy: cfg.migrateLegacy, homeOverride: cfg.homeOverride },
      home,
    }
  }

  /** sync 路由：单预设机械修复（全手动确认纪律——confirm 由桥入参强制）。 */
  function runSync({ key, confirm } = {}) {
    if (confirm !== true) {
      return { ok: false, code: 'confirm-required', message: '缺少确认（confirm:true）；写盘前必须在卡内确认框中明确同意' }
    }
    const cfg = current()
    const home = resolveDshHome(cfg.homeOverride)
    const scan = scanAll({
      home,
      scanProfiles: cfg.scanProfiles,
      migrateLegacy: cfg.migrateLegacy,
    })
    const target = collectPresets(scan).find((p) => p.key === key)
    if (!target) return { ok: false, code: 'preset-not-found', message: `预设不在本次扫描结果中（可能已删除）：${key}` }
    const autoFindings = target.broken.filter((f) => f.level === 'auto')
    if (autoFindings.length === 0) {
      return { ok: true, alreadySynced: true, applied: 0, skipped: target.broken.length }
    }
    const fixResult = applyFixes({ ...scan, findings: autoFindings }, { dryRun: false, ts: defaultTimestamp() })
    const applied =
      fixResult.files.filter((f) => f.status === 'written').length +
      fixResult.migrated.filter((m) => m.status === 'written').length
    return {
      ok: true,
      applied,
      skipped: target.broken.length - autoFindings.length,
      fix: {
        files: fixResult.files,
        migrated: fixResult.migrated,
        errors: fixResult.errors,
      },
    }
  }

  /** composition 对齐（桥 align 路由）：重扫取最新源 → 行级删漂移行（confirm 已在桥门）。 */
  function runAlignAction({ file, presetId, dryRun } = {}) {
    const cfg = current()
    const home = resolveDshHome(cfg.homeOverride)
    const scan = scanAll({ home, scanProfiles: cfg.scanProfiles, migrateLegacy: cfg.migrateLegacy })
    return alignPreset(scan, { file, presetId, dryRun: dryRun === true, ts: defaultTimestamp() })
  }

  /** 行级三档 toggle（桥 toggle 路由）：重扫 → 置行 跟随/开启/关闭（confirm 双门）。 */
  function runToggleAction({ file, presetId, rowId, mode, disabled, confirm, dryRun } = {}) {
    const cfg = current()
    const home = resolveDshHome(cfg.homeOverride)
    const scan = scanAll({ home, scanProfiles: cfg.scanProfiles, migrateLegacy: cfg.migrateLegacy })
    return toggleRow(scan, { file, presetId, rowId, mode, disabled, confirm: confirm === true, dryRun: dryRun === true, ts: defaultTimestamp() })
  }

  /** 遗留目录冲突的授权转写收尾（桥 resolve-legacy 路由）：重扫 → 对齐声明到当前版本默认预设参照 + 归档目录（confirm 硬门 + .bak 备份）。 */
  function runResolveLegacyAction({ key, confirm, dryRun } = {}) {
    const cfg = current()
    const home = resolveDshHome(cfg.homeOverride)
    const scan = scanAll({ home, scanProfiles: cfg.scanProfiles, migrateLegacy: cfg.migrateLegacy })
    return runResolveLegacy(scan, { key, confirm: confirm === true, dryRun: dryRun === true, ts: defaultTimestamp() })
  }

  // ── 三代设置 waist（0.1.2/0.1.5 installSection、0.1.0/0.1.1 register、
  //    rc.1+ loader volatile 存储无需动作，UI 走 client 卡）──
  installSettingsWaist(ctx, {
    ns: name,
    Config,
    base: () => resolveConfig(config),
    onSource: (source) => {
      current = () => readConfig(typeof source === 'function' ? source() : source)
    },
  })

  // ── 设置桥（client 卡数据层；webServer 缺席的线自动 pending 不阻塞）──
  ctx.inject(['webServer', 'settings'], (sctx) => {
    sctx.effect(() => {
      const routes = makeSettingsBridge({ settings: sctx.settings, ns: name, resolveConfig, context: { getSummary, runSync, runAlign: runAlignAction, runToggle: runToggleAction, runResolveLegacy: runResolveLegacyAction } })
      const disposers = routes.map((route) => sctx.webServer.register(route))
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'preset-manager: settings bridge')
  })

  // ── 启动后台扫描（不阻塞装载；1s 延迟让宿主先起完）。恒 scan-only：
  //    2026-10-08 定案「预设修复必须手动确认」+ 2026-10-09 定案「取消自动
  //    闸 全手动确认」——启动绝不写盘，修复只经显式手动动作（命令/卡内
  //    同步确认框）。扫描结果落 lastScan 缓存供卡面 list 秒开。──
  ctx.effect(() => {
    const timer = setTimeout(() => {
      try {
        const { text } = runScanFix({ mode: 'scan' })
        log(text)
      } catch (e) {
        log(`启动扫描失败: ${e.message}`)
      }
    }, 1000)
    return () => clearTimeout(timer)
  }, 'preset-manager: startup scan')

  // ── /preset-doctor 命令（fail-open）──
  ctx.effect(() => registerPresetDoctorCommand(ctx, (opts) => runScanFix(opts)), 'preset-manager: command register')

  // 供测试与高级宿主直接使用（宿主 apply 返回值照常忽略）
  return { getSummary, runSync, runAlign: runAlignAction, runToggle: runToggleAction, runResolveLegacy: runResolveLegacyAction }
}
