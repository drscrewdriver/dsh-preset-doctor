/**
 * dsh-preset-manager — /preset-doctor 命令（fail-open）。
 *
 * 注册方式对齐 dsh-session-guard：typeof ctx.commands?.register === 'function'
 * 守卫，commands 服务缺失时返回 undefined（核心的启动扫描/修复不依赖它）。
 * 返回注册结果（注销函数或 undefined），由调用方的 ctx.effect 管理生命周期。
 */

export function registerPresetDoctorCommand(ctx, runScanFix) {
  if (typeof ctx.commands?.register !== 'function') return undefined
  return ctx.commands.register({
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
}
