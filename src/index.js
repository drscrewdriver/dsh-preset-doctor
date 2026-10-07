/**
 * dsh-preset-manager — 插件入口（host half）。
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
import { applyFixes } from './fix/index.js'
import { defaultTimestamp } from './fix/core.js'
import { summarize, renderText, renderJson, DISCLAIMER } from './report.js'
import { registerPresetDoctorCommand } from './commands.js'
import { installSettingsWaist } from './settings-waist.js'
import { makeSettingsBridge } from './bridge.js'

export const name = 'preset-manager'
export const inject = []

export { DISCLAIMER }

/** 默认配置（设置服务不可用时即用此值）。 */
export const DEFAULT_SETTINGS = Object.freeze({
  autoFix: true, // 启动扫描后自动应用机械修复（写前自动备份）
  scanProfiles: true, // 同时扫描 profiles/<name>/cordis.patch.yml
  migrateLegacy: true, // 自动迁移旧格式 .agent-presets/ 目录
  homeOverride: '', // 覆盖扫描根目录（默认 ~/.dsh；测试/多实例用）
})

export const Config = z
  .object({
    autoFix: z.boolean().default(DEFAULT_SETTINGS.autoFix).volatile().description('启动扫描后自动修复机械可修问题（.bak 备份 + 原子写）'),
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

  /** 扫描 + （可选）修复 → 报告。mode: 'fix' | 'scan'。 */
  function runScanFix({ mode = 'fix' } = {}) {
    const cfg = current()
    const home = resolveDshHome(cfg.homeOverride)
    const scan = scanAll({
      home,
      scanProfiles: cfg.scanProfiles,
      migrateLegacy: cfg.migrateLegacy,
    })
    const doFix = mode === 'fix' && cfg.autoFix
    const fixResult = doFix ? applyFixes(scan, { dryRun: false, ts: defaultTimestamp() }) : undefined
    const summary = summarize(scan, fixResult)
    return { summary, text: renderText(summary), json: renderJson(summary) }
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
      const routes = makeSettingsBridge({ settings: sctx.settings, ns: name, resolveConfig })
      const disposers = routes.map((route) => sctx.webServer.register(route))
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'preset-manager: settings bridge')
  })

  // ── 启动后台扫描（不阻塞装载；1s 延迟让宿主先起完）──
  ctx.effect(() => {
    const timer = setTimeout(() => {
      try {
        const { text } = runScanFix({ mode: 'fix' })
        log(text)
      } catch (e) {
        log(`启动扫描失败: ${e.message}`)
      }
    }, 1000)
    return () => clearTimeout(timer)
  }, 'preset-manager: startup scan')

  // ── /preset-doctor 命令（fail-open）──
  ctx.effect(() => registerPresetDoctorCommand(ctx, (opts) => runScanFix(opts)), 'preset-manager: command register')
}
