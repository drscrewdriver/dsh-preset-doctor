/**
 * dsh-preset-doctor — /preset-doctor 命令（fail-open）。
 *
 * commands 服务只在宿主的 web/desktop 装配面存在（dsh-commands 提供），headless
 * CLI 启动的 fiber 祖先链上没有它：此时严格 ctx 代理读 `ctx.commands` 属性本身
 * 即 throw（`cannot get property "commands" without inject`），可选链防不住，
 * 且宿主启动审计会把该 entry 判失败（老线直接 exit 1）。因此改用 `ctx.get()`
 * 探测（cordis reflect mixin，缺失返回 undefined、永不 throw、与 inject 无关，
 * 惯用法同 dsh-skills-manager），外罩窄域 try/catch 防退化宿主——catch 只吞
 * 代理拒绝文案，其余错误原样上抛，不掩盖真实注册错误。
 * 返回注册结果（注销函数或 undefined），由调用方的 ctx.effect 管理生命周期。
 */

export function registerPresetDoctorCommand(ctx, runScanFix) {
  try {
    const commands = typeof ctx.get === 'function' ? ctx.get('commands') : undefined
    if (typeof commands?.register !== 'function') return undefined
    return commands.register({
      name: 'preset-doctor',
      description:
        '扫描并修复失效的 DSH 预设声明（旧格式目录 / 过期包名 / persona 旧键 / 相对本地路径 / 重复声明）。参数: scan（只查）| fix（扫描+机械修复，默认）',
      input: { hint: '[scan|fix]' },
      handler: (invocation) => {
        const mode = String(invocation?.rawInput ?? '').trim().split(/\s+/)[0] === 'scan' ? 'scan' : 'fix'
        try {
          const { text } = runScanFix({ mode })
          return { kind: 'text', text }
        } catch (e) {
          return { kind: 'error', text: `preset-doctor ${mode} 失败: ${e.message}` }
        }
      },
    })
  } catch (e) {
    if (!/cannot get property "commands" without inject/.test(String(e?.message ?? e))) throw e
    return undefined
  }
}
