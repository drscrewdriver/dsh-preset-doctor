/**
 * dsh-preset-doctor — client 半边（预设医生卡：信息区 + 配置表单 + 预设卡片网格）。
 *
 * ≤0.1.5 面：设置页「插件配置」tab 卡。宿主派发条件（0.1.2/0.1.5）=
 * 宿主 served namespaces ∩ settings.plugin.item 卡，且 slot key === namespace：
 * 卡按 ns 认领，ns 须 bind 进 client 侧 settingsScope，三者缺一卡就不出现
 * （无任何报错）。数据读写走自家 webServer 桥（/api/dsh-preset-doctor-settings/*，
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
 *   边 register 完成）。
 *
 * 0.6.0 卡片化改版（2026-10-09）：信息区（当前 DSH 版本 + 代际目录）+
 * 预设卡片网格（官方 AgentPresetSection 视觉规格）+ 卡内「同步到当前版本」
 * （全手动确认：点击后确认框 → sync {key,confirm:true} → 重拉刷卡）。
 * autoFix 总闸退役（2026-10-09 用户定案「取消自动闸 全手动确认」），
 * 配置表单只剩 scanProfiles / migrateLegacy / homeOverride 三项。
 */
window.__ModuleLoader__.load({
  id: 'dsh-preset-doctor',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const react = require('react')

    const NS = 'preset-manager'
    const BRIDGE = '/api/dsh-preset-doctor-settings'

    const FIELDS = [
      { key: 'scanProfiles', type: 'bool', label: '扫描 profile 级 patch（scanProfiles）', hint: '同时扫描 profiles/<name>/cordis.patch.yml' },
      { key: 'migrateLegacy', type: 'bool', label: '迁移旧格式目录（migrateLegacy）', hint: '自动迁移旧格式 .agent-presets/ 目录为 patch 声明' },
      { key: 'homeOverride', type: 'string', label: '扫描根目录覆盖（homeOverride）', hint: '留空用默认 ~/.dsh；测试/多实例用' },
    ]

    const SOURCE_LABELS = { home: 'home 声明', legacy: '遗留目录' }

    const css = [
      '.dshpm-card{font-family:-apple-system,"SF Pro Text","PingFang SC","Segoe UI",system-ui,sans-serif;border:1px solid rgba(0,0,0,.08);border-radius:12px;padding:16px 18px;margin-bottom:12px;color:#1d1d1f;background:rgba(255,255,255,.72)}',
      '@media (prefers-color-scheme: dark){.dshpm-card{background:rgba(30,30,32,.7);border-color:rgba(255,255,255,.08);color:#f5f5f7}}',
      '.dshpm-title{font-size:14px;font-weight:600;margin:0 0 2px}',
      '.dshpm-desc{font-size:12px;opacity:.62;margin:0 0 12px;line-height:1.5}',
      '.dshpm-info{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;padding:10px 12px;border-radius:10px;background:rgba(127,127,127,.08);margin:0 0 12px;font-size:12px}',
      '.dshpm-infoVer{font-weight:600}',
      '.dshpm-eras{display:flex;flex-wrap:wrap;gap:6px}',
      '.dshpm-era{padding:3px 10px;border-radius:999px;border:1px solid rgba(127,127,127,.35);font-size:11px;opacity:.75}',
      '.dshpm-eraCur{border-color:#0a84ff;color:#0a84ff;opacity:1;font-weight:600}',
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
      // ── 预设卡片网格（官方 AgentPresetSection 规格复刻）──
      '.dshpm-divider{height:1px;background:rgba(127,127,127,.18);margin:14px 0 12px}',
      '.dshpm-gridTitle{font-size:13px;font-weight:600;margin:0 0 8px}',
      '.dshpm-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(268px,1fr));gap:12px}',
      '.dshpm-pcard{display:flex;flex-direction:column;border:.5px solid rgba(127,127,127,.4);border-radius:14px;background:rgba(127,127,127,.05);padding:14px;min-width:0}',
      '.dshpm-pbroken{border-color:rgba(255,59,48,.55)}',
      '.dshpm-phead{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px}',
      '.dshpm-pname{font-size:13px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshpm-tag{flex:none;font-size:10px;padding:2px 8px;border-radius:999px;border:1px solid rgba(127,127,127,.4);opacity:.8}',
      '.dshpm-tagSolid{background:#0071e3;border-color:#0071e3;color:#fff;opacity:1}',
      '.dshpm-tagEra{border-color:#0a84ff;color:#0a84ff;opacity:1}',
      '@media (prefers-color-scheme: dark){.dshpm-tagEra{color:#6eb8ff}}',
      '.dshpm-pdesc{font-size:12px;opacity:.66;line-height:1.5;margin:0 0 8px;word-break:break-all}',
      '.dshpm-pbrokenTip{font-size:11px;color:#ff3b30;margin:0 0 8px}',
      '@media (prefers-color-scheme: dark){.dshpm-pbrokenTip{color:#ff453a}}',
      '.dshpm-pfoot{margin-top:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dshpm-sync{height:26px;padding:0 12px;border-radius:7px;border:1px solid rgba(0,113,227,.55);background:transparent;color:#0a84ff;font:inherit;font-size:12px;cursor:pointer}',
      '.dshpm-sync:disabled{opacity:.45;cursor:default}',
      '@media (prefers-color-scheme: dark){.dshpm-sync{color:#6eb8ff}}',
      '.dshpm-details{font-size:11px;opacity:.75;max-width:100%}',
      '.dshpm-details summary{cursor:pointer}',
      '.dshpm-details li{margin:4px 0 0 16px;line-height:1.45}',
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

    // list 请求 in-flight 去重：family tab + row.config + bundle.config 三槽同挂
    // 时并发挂载共享同一请求（0.6.0）。
    let listInflight = null
    function bridgeList(fresh) {
      if (!fresh && listInflight) return listInflight
      const p = fetch(`${BRIDGE}/list`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(fresh ? { fresh: true } : {}),
      })
        .then((r) => r.json())
        .finally(() => {
          if (listInflight === p) listInflight = null
        })
      if (!fresh) listInflight = p
      return p
    }

    function sourceTag(source) {
      if (SOURCE_LABELS[source]) return SOURCE_LABELS[source]
      if (typeof source === 'string' && source.startsWith('profile:')) return 'profile ' + source.slice('profile:'.length)
      return source
    }

    function InfoSection(props) {
      const { version, eras } = props
      const kids = [
        react.createElement('span', { key: 'v', className: 'dshpm-infoVer' },
          '当前 DSH 版本：' + (version || '未检出（回退 main 表）')),
      ]
      if (eras && eras.length) {
        kids.push(react.createElement('span', { key: 'eras', className: 'dshpm-eras' },
          eras.map((e, i) =>
            react.createElement('span', {
              key: e.format,
              className: 'dshpm-era' + (e.current ? ' dshpm-eraCur' : ''),
              title: e.note,
            }, e.name + '（' + e.range + '）' + (e.current ? ' · 当前' : ''))
          )))
      }
      return react.createElement('div', { className: 'dshpm-info' }, kids)
    }

    function PresetCard(props) {
      const p = props.preset
      const syncing = props.syncingKey === p.key
      const eraText = p.era
        ? '写于 ' + p.era.baseEra + ' · 跨 ' + p.era.hops.length + ' 代'
        : (p.current ? '已同步当前' : '')
      const autoCount = (p.broken || []).filter((f) => f.level === 'auto').length
      const kids = [
        react.createElement('div', { key: 'head', className: 'dshpm-phead' },
          react.createElement('span', { className: 'dshpm-pname', title: p.name }, p.name),
          react.createElement('span', { className: 'dshpm-tag' }, sourceTag(p.source)),
          p.current
            ? react.createElement('span', { className: 'dshpm-tag dshpm-tagSolid' }, '已同步当前')
            : eraText
              ? react.createElement('span', { className: 'dshpm-tag dshpm-tagEra' }, eraText)
              : null),
        react.createElement('p', { key: 'desc', className: 'dshpm-pdesc' },
          p.description || p.file + (p.line ? ':' + p.line : '')),
      ]
      if (!p.current) {
        kids.push(react.createElement('p', { key: 'broken', className: 'dshpm-pbrokenTip' },
          (p.broken || []).length + ' 处声明问题（机械可修 ' + autoCount + '）'))
      }
      kids.push(react.createElement('div', { key: 'foot', className: 'dshpm-pfoot' },
        react.createElement('button', {
          className: 'dshpm-sync',
          type: 'button',
          disabled: !p.syncable || syncing,
          onClick: () => props.onSync(p, autoCount),
        }, p.current ? '已同步' : syncing ? '同步中…' : '同步到当前版本'),
        (p.broken || []).length
          ? react.createElement('details', { className: 'dshpm-details' },
              react.createElement('summary', null, '查看修复项（' + p.broken.length + '）'),
              react.createElement('ul', null, p.broken.map((f, i) =>
                react.createElement('li', { key: i },
                  '[' + (f.level === 'auto' ? '自动' : '需人工') + '] ' + f.rule + '：' + f.reason))))
          : null))
      return react.createElement('div', {
        className: 'dshpm-pcard' + (p.current ? '' : ' dshpm-pbroken'),
      }, kids)
    }

    function PresetManagerCard() {
      const [state, setState] = react.useState({ status: 'loading' })
      const [values, setValues] = react.useState(null)
      const [dirty, setDirty] = react.useState(false)
      const [saving, setSaving] = react.useState(false)
      const [error, setError] = react.useState('')
      const [list, setList] = react.useState(null)
      const [syncingKey, setSyncingKey] = react.useState(null)

      const load = react.useCallback(async (fresh) => {
        try {
          const [result, lst] = await Promise.all([bridgeDescribe(), bridgeList(fresh)])
          if (result && result.ok) {
            const view = (result.value.namespaces || []).find((n) => n.ns === NS)
            if (!view) {
              setState({ status: 'unserved' })
              return
            }
            const v = view.value ?? {}
            setValues({
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
          setList(lst && lst.ok ? lst.value : { error: (lst && (lst.message || lst.code)) || 'list failed' })
        } catch (e) {
          setState({ status: 'error', message: (e && e.message) || String(e) })
        }
      }, [])

      react.useEffect(() => {
        load(false)
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
            await load(true) // 扫描行为变了：重扫刷新清单
          } else {
            setError(`mutate: ${(result && result.code) || 'error'}${result && result.message ? ' — ' + result.message : ''}`)
          }
        } catch (e) {
          setError((e && e.message) || String(e))
        } finally {
          setSaving(false)
        }
      }

      const sync = async (p, autoCount) => {
        const ok = window.confirm(
          '同步预设「' + p.name + '」到当前版本？\n\n' +
          '将机械修复 ' + autoCount + ' 处可自动修的声明问题（需人工 ' +
          ((p.broken || []).length - autoCount) + ' 处不会动）。\n' +
          '写盘前自动 .bak 备份 + 原子写；修复后需重启 DSH 进程生效。'
        )
        if (!ok) return
        setSyncingKey(p.key)
        setError('')
        try {
          const result = await fetch(`${BRIDGE}/sync`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key: p.key, confirm: true }),
          }).then((r) => r.json())
          if (!(result && result.ok)) {
            setError('sync: ' + ((result && (result.code || result.message)) || 'error'))
          }
          await load(true) // 无论成败重扫，让卡面反映磁盘真值
        } catch (e) {
          setError((e && e.message) || String(e))
        } finally {
          setSyncingKey(null)
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
          '装载后自动扫描失效预设并机械对齐到当前语法；报告见启动日志，会话内可随时 /preset-doctor scan。修复只经你显式确认（卡内同步按钮或 /preset-doctor fix）。'),
      ]
      children.push(react.createElement(InfoSection, {
        key: 'info',
        version: list && list.version,
        eras: list && list.eras,
      }))
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

      // ── 预设卡片网格 ──
      children.push(react.createElement('div', { className: 'dshpm-divider', key: 'div' }))
      children.push(react.createElement('p', { className: 'dshpm-gridTitle', key: 'gridTitle' },
        '检测到的预设' + (list && Array.isArray(list.presets) ? '（' + list.presets.length + '）' : '')))
      if (list && list.error) {
        children.push(react.createElement('p', { className: 'dshpm-error', key: 'listErr' }, '清单读取失败：' + list.error))
      } else if (!list || !Array.isArray(list.presets)) {
        children.push(react.createElement('p', { className: 'dshpm-desc', key: 'listLoading', style: { margin: 0 } }, '预设清单读取中…'))
      } else if (list.presets.length === 0) {
        children.push(react.createElement('p', { className: 'dshpm-desc', key: 'listEmpty', style: { margin: 0 } },
          '未检测到任何预设声明（home/profile patch 无 preset 行，且无遗留目录）。'))
      } else {
        children.push(react.createElement('div', { className: 'dshpm-cards', key: 'cards' },
          list.presets.map((p) => react.createElement(PresetCard, {
            key: p.key,
            preset: p,
            syncingKey: syncingKey,
            onSync: sync,
          }))))
      }

      return react.createElement('div', { className: 'dshpm-card' }, children)
    }

    // 插件页行配置的摘要文案（行详情 description 位；不触发桥读取）
    function summaryText() {
      const primary = typeof navigator === 'undefined' ? 'zh' : String((navigator.languages && navigator.languages[0]) || navigator.language || 'zh').toLowerCase()
      return primary.startsWith('en')
        ? 'preset cards · era catalog · manual-confirm sync · data via local bridge'
        : '预设卡片 · 代际目录 · 手动确认同步 · 数据走本地桥'
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
      // safe() 吞掉。卡不需要 inject props（数据全走自家桥）。
      // 探针：宿主执行过本工厂 == 有人声明了 `dsh-family.tab`（插件侧唯一合法的
      // 「容器在不在」判据：槽门面不暴露 spec 查询，entriesOfSlot 也不区分空与未声明）。
      let familyTabHeld = false
      safe('dsh-family.tab', () =>
        ctx.slots.inject('dsh-family.tab', () => {
          familyTabHeld = true
          return ctx.slots.register(
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
        })
      )
      // 家族容器兜底（rank 8，延迟 = 200 + RANK*900；唯一真源
      // mine-dsh-plugins/_tools/family-rank.mjs）：TL/guard/steward/mcp 全部让位或
      // 声明失败时，上面的 inject 会静默 pending——本卡整轮启动不可见且不报错。
      // 到点仍无人持有，则自己上位成通用容器（按账本渲染所有成员卡）。
      // declare-or-withdraw：声明失败就放弃，绝不裸注册不带 children 的残废节
      // ——残废节会占住导航行并让后来者集体退场（2026-10-14 面板丢失的成因）。
      safe('family-host-backstop', () => {
        const CHILD = 'dsh-family.tab'
        const CLAIM_DELAY_MS = 200 + 7 * 900
        const project = () => ctx.slots.entries(CHILD)
          .map((entry) => {
            const o = (entry && entry.options) || {}
            let label = String(o.id || '')
            if (typeof o.label === 'function') {
              try { label = String(o.label() ?? label) } catch { label = String(o.id || '') }
            } else if (typeof o.label === 'string') {
              label = o.label
            }
            return { id: String(o.id || ''), order: Number(o.order || 0), label }
          })
          .sort((a, b) => a.order - b.order)
        const ledger = {
          getSnapshot: project,
          subscribe: (listener) => (ctx.slots.subscribe ? ctx.slots.subscribe(CHILD, listener) : () => {}),
        }
        const renderContributor = (id) => {
          try {
            const entry = ctx.slots.entries(CHILD).find((c) => String((c.options || {}).id || '') === id)
            const component = entry && entry.component
            if (typeof component !== 'function') return null
            const injected = typeof entry.inject === 'function' ? entry.inject() : {}
            return react.createElement(component, injected || {})
          } catch {
            return null
          }
        }
        const FamilyHostSection = (props) => {
          const raw = props && props.hooks ? props.hooks.tabs : undefined
          const [rows, setRows] = react.useState(() => (raw ? raw.getSnapshot() : []))
          react.useEffect(() => {
            if (!raw) return undefined
            return raw.subscribe(() => setRows(raw.getSnapshot()))
          })
          const tabs = props && props.useTabs ? props.useTabs((v) => v) : rows
          return react.createElement(
            'div',
            { style: { display: 'grid', gap: '12px' } },
            tabs.map((row) => react.createElement(
              'div',
              { key: row.id },
              props.renderSlot
                ? props.renderSlot(CHILD, {}, { only: row.id, fallback: null })
                : renderContributor(row.id),
            )),
          )
        }
        const timer = setTimeout(() => {
          if (familyTabHeld) return
          try {
            ctx.slots.register(
              {
                name: 'settings.section',
                id: 'dsh-family',
                order: 40,
                // 遮蔽优先级：必须高于正牌 owner（TL=0 / guard=10），owner 回来时盖住本行。
                priority: 50,
                label: () => '起子插件设置',
                inject: () => ({ hooks: { tabs: ledger }, renderContributor }),
                children: { [CHILD]: { kind: 'list', scope: 'root' } },
              },
              FamilyHostSection,
            )
            console.warn('preset-manager: family container unclaimed — took it over')
          } catch (error) {
            console.warn('preset-manager: family claim lost — withdrawing (' + (error && error.message ? error.message : String(error)) + ')')
          }
        }, CLAIM_DELAY_MS)
        if (typeof ctx.effect === 'function') ctx.effect(() => () => clearTimeout(timer), 'preset-manager: family host backstop')
      })
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
            { name: 'plugins.row.config', key: 'dsh-preset-doctor#preset-manager' },
            rowConfigComponent
          )
        )
      )
      safe('plugins.bundle.config', () =>
        ctx.slots.inject('plugins.bundle.config', () =>
          ctx.slots.register(
            { name: 'plugins.bundle.config', key: 'dsh-preset-doctor' },
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
