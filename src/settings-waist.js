/**
 * dsh-preset-doctor — 三代宿主设置 waist（特性检测分派，禁止读版本号）。
 *
 * 检测点互斥、只用 settings 服务自身方法（0.1.0/0.1.1 上动态 import
 * "@deepseek-ai/dsh-settings" 解析不出模块级 legacy 导出，实测 undefined，勿用）：
 * - 0.1.2-rc.1 / 0.1.5-rc.x：服务实例带 installSection（注册 ns + 设置→插件
 *   原生表单挂账 + setSource 换绑配置源；base 必须传 resolveConfig 解包后的
 *   普通值，活引用直传会 ValidationError 且 cordis 静默吞掉 inject 回调异常）；
 * - 0.1.0-rc.x / 0.1.1-rc.x：服务只有 register/update/mutate/describe（壳连
 *   设置页都没有，注册 ns 即获得持久化与 bridge 读写；无表可渲染，非缺陷）；
 * - 0.1.7-rc.1+ / 0.2.0：两个注册 API 均被 rc.1 移除，宿主也不渲染任何
 *   volatile 自动表单（0.1.7 设置面板导航实测无插件配置项）——volatile Config
 *   只负责存储/配置管道，设置 UI 由 client 半边的 plugins.row.config /
 *   plugins.bundle.config 卡承担（数据走桥）。
 *
 * 全部分支守卫：任何线缺方法都只降级（patch 配置 + 默认值），绝不 fatal。
 */
export function installSettingsWaist(ctx, { ns, Config, base, onSource }) {
  ctx.inject(['settings'], (sctx) => {
    const svc = sctx.settings
    if (typeof svc.installSection === 'function') {
      try {
        svc.installSection(ctx, ns, Config, base(), {
          setSource: (source) => onSource(source),
          onChange: () => {},
        })
        console.warn('preset-manager: settings via installSection (0.1.2/0.1.5 line)')
      } catch (e) {
        console.warn('preset-manager: installSection FAILED:', e?.stack ?? e)
      }
    } else if (typeof svc.register === 'function') {
      try {
        svc.register(ns, Config, { base: base() })
        console.warn('preset-manager: settings via register (0.1.0/0.1.1 line)')
      } catch (e) {
        console.warn('preset-manager: register FAILED:', e?.stack ?? e)
      }
    }
    // 其余（0.1.7-rc.1+/0.2.0）：volatile Config 由 loader 托管存储，UI 走
    // client 半边的插件页卡，此处无需注册。
  })
}
