/**
 * dsh-preset-manager — client 半边（插件配置卡，跨代双面）。
 *
 * ≤0.1.5 面：设置页「插件配置」tab 卡。宿主派发条件（0.1.2/0.1.5）=
 * 宿主 served namespaces ∩ settings.plugin.item 卡，且 slot key === namespace：
 * 卡按 ns 认领，ns 须 bind 进 client 侧 settingsScope，三者缺一卡就不出现
 * （无任何报错）。数据读写走自家 webServer 桥（/api/dsh-preset-manager-settings/*，
 * 见 src/bridge.js），不依赖 settingsScope 的数据面。
 *
 * 本文件在其余线上注册后即休眠，不阻塞任何面：
 * - rc.1+（0.1.7/0.2.0）：旧设置页插件配置 slot 已废弃（注册静默闲置；
 *   settingsScope 服务不存在，scoped inject 永久 pending）。rc.1+ 的插件配置
 *   面是插件页行详情（plugins.row.config，key=`<包名>#<patch 行 id>`）与
 *   bundle 详情页（plugins.bundle.config，key=`<包名>`）——宿主不渲染任何
 *   volatile 自动表单（实测 0.1.7 设置面板导航无插件配置项），本卡同时挂
 *   这两个槽，数据同样走桥（桥在 rc.1+ 实测可用）；
 * - 0.1.0/0.1.1：壳连设置页都没有，配置经 patch / 桥读写（注册已由 host 半
 *   边 register 完成），UI 兜底（shell.overlay 浮窗）留待后续。
 */
window.__ModuleLoader__.load({
  id: 'dsh-preset-manager',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const react = require('react')

    const NS = 'preset-manager'
    const BRIDGE = '/api/dsh-preset-manager-settings'

    const FIELDS = [
      { key: 'autoFix', type: 'bool', label: '允许修复（autoFix）', hint: '默认关：启动扫描恒只报告，绝不自动修（共用预设防误改）；开启后 /preset-doctor fix 才会写入修复（.bak 备份 + 原子写）' },
      { key: 'scanProfiles', type: 'bool', label: '扫描 profile 级 patch（scanProfiles）', hint: '同时扫描 profiles/<name>/cordis.patch.yml' },
      { key: 'migrateLegacy', type: 'bool', label: '迁移旧格式目录（migrateLegacy）', hint: '自动迁移旧格式 .agent-presets/ 目录为 patch 声明' },
      { key: 'homeOverride', type: 'string', label: '扫描根目录覆盖（homeOverride）', hint: '留空用默认 ~/.dsh；测试/多实例用' },
    ]

    const css = [
      '.dshpm-card{font-family:-apple-system,"SF Pro Text","PingFang SC","Segoe UI",system-ui,sans-serif;border:1px solid rgba(0,0,0,.08);border-radius:12px;padding:16px 18px;margin-bottom:12px;color:#1d1d1f;background:rgba(255,255,255,.72)}',
      '@media (prefers-color-scheme: dark){.dshpm-card{background:rgba(30,30,32,.7);border-color:rgba(255,255,255,.08);color:#f5f5f7}}',
      '.dshpm-title{font-size:14px;font-weight:600;margin:0 0 2px}',
      '.dshpm-desc{font-size:12px;opacity:.62;margin:0 0 12px;line-height:1.5}',
      '.dshpm-field{display:flex;align-items:flex-start;gap:10px;padding:7px 0}',
      '.dshpm-field input[type=checkbox]{margin:3px 0 0;width:15px;height:15px;accent-color:#0071e3;flex:none}',
      '.dshpm-fieldText{min-width:0}',
      '.dshpm-label{font-size:13px;font-weight:500;display:block}',
      '.dshpm-hint{font-size:12px;opacity:.6;margin:2px 0 0;line-height:1.45}',
      '.dshpm-input{margin-top:6px;width:100%;box-sizing:border-box;border:1px solid rgba(0,0,0,.12);border-radius:8px;height:32px;padding:0 10px;font:inherit;font-size:13px;color:inherit;background:rgba(0,0,0,.03)}',
      '@media (prefers-color-scheme: dark){.dshpm-input{border-color:rgba(255,255,255,.12);background:rgba(255,255,255,.05)}}',
      '.dshpm-input:focus-visible{outline:none;border-color:#0071e3;box-shadow:0 0 0 3px rgba(0,113,227,.25)}',
      '.dshpm-footer{display:flex;align-items:center;gap:12px;margin-top:12px;flex-wrap:wrap}',
      '.dshpm-save{height:30px;padding:0 14px;border-radius:8px;border:0;background:#0071e3;color:#fff;font:inherit;font-size:13px;font-weight:500;cursor:pointer}',
      '.dshpm-save:disabled{opacity:.5;cursor:default}',
      '.dshpm-status{font-size:12px;opacity:.65}',
      '.dshpm-error{font-size:12px;color:#ff3b30}',
      '@media (prefers-color-scheme: dark){.dshpm-error{color:#ff453a}}',
    ]

    function injectStyle() {
      if (document.getElementById('dshpm-style')) return
      const el = document.createElement('style')
      el.id = 'dshpm-style'
      el.textContent = css.join('\n')
      document.head.appendChild(el)
    }

    async function bridgeDescribe() {
      const response = await fetch(`${BRIDGE}/describe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      return response.json()
    }

    async function bridgeMutate(payload) {
      const response = await fetch(`${BRIDGE}/mutate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      return response.json()
    }

    function PresetManagerCard() {
      const [state, setState] = react.useState({ status: 'loading' })
      const [values, setValues] = react.useState(null)
      const [dirty, setDirty] = react.useState(false)
      const [saving, setSaving] = react.useState(false)
      const [error, setError] = react.useState('')

      const load = react.useCallback(async () => {
        try {
          const result = await bridgeDescribe()
          if (result && result.ok) {
            const view = (result.value.namespaces || []).find((n) => n.ns === NS)
            if (!view) {
              setState({ status: 'unserved' })
              return
            }
            const v = view.value ?? {}
            setValues({
              autoFix: v.autoFix === true,
              scanProfiles: v.scanProfiles !== false,
              migrateLegacy: v.migrateLegacy !== false,
              homeOverride: typeof v.homeOverride === 'string' ? v.homeOverride : '',
            })
            setState({ status: 'ready', writable: view.writable !== false })
            setDirty(false)
            setError('')
          } else {
            setState({ status: 'error', message: (result && (result.message || result.code)) || 'describe failed' })
          }
        } catch (e) {
          setState({ status: 'error', message: (e && e.message) || String(e) })
        }
      }, [])

      react.useEffect(() => {
        load()
      }, [load])

      const save = async () => {
        setSaving(true)
        setError('')
        try {
          const ops = FIELDS.map((f) => ({
            op: 'set',
            path: [f.key],
            value: f.type === 'bool' ? values[f.key] !== false : String(values[f.key] ?? ''),
          }))
          const result = await bridgeMutate({ ns: NS, ops })
          if (result && result.ok) {
            await load()
          } else {
            setError(`mutate: ${(result && result.code) || 'error'}${result && result.message ? ' — ' + result.message : ''}`)
          }
        } catch (e) {
          setError((e && e.message) || String(e))
        } finally {
          setSaving(false)
        }
      }

      if (state.status === 'loading') {
        return react.createElement('div', { className: 'dshpm-card' },
          react.createElement('p', { className: 'dshpm-desc', style: { margin: 0 } }, 'preset-manager 设置读取中…'))
      }
      if (state.status === 'unserved') {
        return react.createElement('div', { className: 'dshpm-card' },
          react.createElement('p', { className: 'dshpm-desc', style: { margin: 0 } },
            'preset-manager 设置命名空间未注册（宿主未 served）；配置可经 cordis.patch.yml 本条目 config 修改。'))
      }
      if (state.status === 'error') {
        return react.createElement('div', { className: 'dshpm-card' },
          react.createElement('p', { className: 'dshpm-error', style: { margin: 0 } }, 'preset-manager 设置读取失败：' + state.message))
      }

      const children = [
        react.createElement('p', { className: 'dshpm-title', key: 'title' }, '预设医生（preset-manager）'),
        react.createElement('p', { className: 'dshpm-desc', key: 'desc' },
          '装载后自动扫描失效预设并机械对齐到当前语法；报告见启动日志，会话内可随时 /preset-doctor scan。'),
      ]
      for (let i = 0; i < FIELDS.length; i++) {
        const f = FIELDS[i]
        if (f.type === 'bool') {
          children.push(
            react.createElement('label', { className: 'dshpm-field', key: f.key },
              react.createElement('input', {
                type: 'checkbox',
                checked: values[f.key] !== false,
                disabled: !state.writable || saving,
                onChange: (e) => {
                  setValues({ ...values, [f.key]: e.target.checked })
                  setDirty(true)
                },
              }),
              react.createElement('span', { className: 'dshpm-fieldText' },
                react.createElement('span', { className: 'dshpm-label' }, f.label),
                react.createElement('span', { className: 'dshpm-hint' }, f.hint))))
        } else {
          children.push(
            react.createElement('div', { className: 'dshpm-field', key: f.key },
              react.createElement('span', { className: 'dshpm-fieldText', style: { width: '100%' } },
                react.createElement('span', { className: 'dshpm-label' }, f.label),
                react.createElement('span', { className: 'dshpm-hint' }, f.hint),
                react.createElement('input', {
                  className: 'dshpm-input',
                  type: 'text',
                  value: values[f.key] ?? '',
                  disabled: !state.writable || saving,
                  onChange: (e) => {
                    setValues({ ...values, [f.key]: e.target.value })
                    setDirty(true)
                  },
                }))))
        }
      }
      children.push(
        react.createElement('div', { className: 'dshpm-footer', key: 'footer' },
          react.createElement('button', {
            className: 'dshpm-save',
            type: 'button',
            disabled: !state.writable || saving || (!dirty && !error),
            onClick: save,
          }, saving ? '保存中…' : '保存'),
          error
            ? react.createElement('span', { className: 'dshpm-error' }, error)
            : react.createElement('span', { className: 'dshpm-status' },
                state.writable ? (dirty ? '有未保存的修改' : '已同步') : '本页只读（settings 服务不可写）'))
      )
      return react.createElement('div', { className: 'dshpm-card' }, children)
    }

    // 插件页行配置的摘要文案（行详情 description 位；不触发桥读取）
    function summaryText() {
      const primary = typeof navigator === 'undefined' ? 'zh' : String((navigator.languages && navigator.languages[0]) || navigator.language || 'zh').toLowerCase()
      return primary.startsWith('en')
        ? '4 scan settings · preset doctor · data via local bridge'
        : '4 项扫描设置 · 预设医生 · 数据走本地桥'
    }

    // 行配置/bundle 详情槽的组件：summary 面给一行摘要，page 面给整卡
    function rowConfigComponent(slotProps) {
      return slotProps && slotProps.view === 'summary' ? summaryText() : react.createElement(PresetManagerCard)
    }

    const inject = ['slots']

    function apply(ctx) {
      // 跨代护栏:每个 slot/服务注册独立 try——某条宿主线上未知的槽名或服务
      // 可能同步抛错(cordis inject 回调抛错会静默吞掉整段 apply),绝不能让
      // 一个面的失败带走其它面。失败打 console.warn(可达 start.log)。
      const safe = (tag, fn) => {
        try {
          fn()
        } catch (e) {
          console.warn('preset-manager: client surface \'' + tag + "' failed: " + (e && e.message ? e.message : String(e)))
        }
      }

      try {
        injectStyle()
      } catch (e) {
        console.warn('preset-manager: style inject failed: ' + (e && e.message ? e.message : String(e)))
      }

      // 家族节 contributor tab（2026-10-08 family-insection 第二轮）：设置面
      // 唯一入口 = 起子插件设置（TL dsh-family 节）里的「预设医生」tab。原
      // ≤0.1.5 的 settings.plugin.item 派发卡与之重复，已撤。TL 缺席的宿主该
      // 注入静默 pending（五格实证 TL 常驻）；无该槽的老宿主激活期抛错由
      // safe() 吞掉。卡不需要 inject props（数据全走自家桥 describe/mutate）。
      safe('dsh-family.tab', () =>
        ctx.slots.inject('dsh-family.tab', () =>
          ctx.slots.register(
            {
              name: 'dsh-family.tab',
              id: 'preset-manager',
              order: 25,
              label: '预设医生',
              locale: NS,
              inject: () => ({}),
            },
            PresetManagerCard
          )
        )
      )
      // ≤0.1.5 的「插件配置」tab 只渲染「宿主 served namespaces ∩ 卡」的交集,
      // ns 须 bind 进 client 侧 settingsScope 卡才会被派发(input-traffic 双代腰
      // 同款子 inject;rc.1+ 无此服务,静默挂起不阻塞)。原 settings.plugin.item
      // 卡已撤,此 bind 保留(无 UI 副作用)。
      safe('settingsScope', () =>
        ctx.inject(['settingsScope'], (settingsScope) => {
          settingsScope.bind({ namespace: NS })
        })
      )
      // rc.1+ 插件页:行详情配置区(plugins.row.config,view 分 summary/page 两面,
      // key=<包名>#<patch 行 id>,见 ui-plugin-manager rowConfigKey)+ bundle 详情页
      // 平铺(plugins.bundle.config,key=<包名>)。≤0.1.5 无持有者,静默闲置。
      safe('plugins.row.config', () =>
        ctx.slots.inject('plugins.row.config', () =>
          ctx.slots.register(
            { name: 'plugins.row.config', key: 'dsh-preset-manager#preset-manager' },
            rowConfigComponent
          )
        )
      )
      safe('plugins.bundle.config', () =>
        ctx.slots.inject('plugins.bundle.config', () =>
          ctx.slots.register(
            { name: 'plugins.bundle.config', key: 'dsh-preset-manager' },
            () => react.createElement(PresetManagerCard)
          )
        )
      )
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
