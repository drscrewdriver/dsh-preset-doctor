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
      '.dshpm-minor{font-size:10px;padding:2px 8px}',
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
      // ── composition 分组标注视图（行分类 + toggle + 对齐）──
      '.dshpm-comp{margin:10px 0 0}',
      '.dshpm-compbar{margin:6px 0}',
      '.dshpm-compgroup{margin:8px 0 0}',
      '.dshpm-comptitle{font-size:12px;font-weight:600;margin:0 0 4px;opacity:.85}',
      '.dshpm-crow{display:flex;align-items:center;gap:8px;font-size:12px;padding:2px 0}',
      '.dshpm-baseline{flex:none;font-size:11px;padding:1px 7px;border-radius:6px;border:1px solid rgba(127,127,127,.35);opacity:.9}',
      '.dshpm-baseOn{border-color:rgba(10,132,255,.5);color:#0a84ff}',
      '.dshpm-baseOff{border-color:rgba(196,0,0,.45);color:#c40000}',
      '.dshpm-seg{display:inline-flex;border:1px solid rgba(127,127,127,.4);border-radius:8px;overflow:hidden}',
      '.dshpm-segBtn{border:0;background:transparent;color:inherit;font-size:11px;padding:2px 8px;cursor:pointer;opacity:.72}',
      '.dshpm-segBtn+.dshpm-segBtn{border-left:1px solid rgba(127,127,127,.32)}',
      '.dshpm-segBtn:disabled{cursor:default}',
      '.dshpm-segBtn:not(.dshpm-segOn):hover{background:rgba(127,127,127,.14)}',
      '.dshpm-segOn{background:#0a84ff;color:#fff;opacity:1;font-weight:600}',
      '.dshpm-cname{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}',
      '.dshpm-badge{flex:none;font-size:10px;padding:1px 7px;border-radius:999px;border:1px solid rgba(127,127,127,.4);opacity:.85}',
      '.dshpm-badgeShipped{border-color:rgba(10,132,255,.5);color:#0a84ff}',
      '.dshpm-badgeDrift{border-color:rgba(255,149,0,.6);color:#ff9500;font-weight:600}',
      '.dshpm-badgeCustom{border-color:rgba(127,127,127,.5)}',
      '.dshpm-del{margin-left:6px;color:#c0392b;border-color:rgba(192,57,43,.55)}',
      '.dshpm-badgeOff{opacity:.5;text-decoration:line-through}',
      '@media (prefers-color-scheme: dark){.dshpm-badgeDrift{color:#ffb340}}',
      '.dshpm-tiny{height:22px;padding:0 8px;border-radius:6px;border:1px solid rgba(0,113,227,.5);background:transparent;color:#0a84ff;font:inherit;font-size:11px;cursor:pointer}',
      '.dshpm-tiny:disabled{opacity:.45;cursor:default}',
      '@media (prefers-color-scheme: dark){.dshpm-tiny{color:#6eb8ff}}',
      // 提示词就地编辑：等宽正文 + 适度高度，编辑态不撑爆卡片
      '.dshpm-promptEdit{margin:4px 0 6px;width:100%;box-sizing:border-box;border:1px solid rgba(0,0,0,.16);border-radius:8px;padding:8px 10px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.55;min-height:120px;resize:vertical;background:rgba(0,0,0,.03);color:inherit}',
      '.dshpm-promptEdit:focus-visible{outline:none;border-color:#0071e3;box-shadow:0 0 0 3px rgba(0,113,227,.25)}',
      '@media (prefers-color-scheme: dark){.dshpm-promptEdit{border-color:rgba(255,255,255,.16);background:rgba(255,255,255,.05)}}',
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
      const { version, versionVia, eras } = props
      const kids = [
        react.createElement('span', { key: 'v', className: 'dshpm-infoVer' },
          '当前 DSH 版本：' + (version || '未检出（回退 main 表）') +
          (version && versionVia ? '（依据 ' + versionVia + '）' : '')),
      ]
      if (eras && eras.length) {
        kids.push(react.createElement('span', { key: 'majors', className: 'dshpm-eras' },
          eras.map((e) =>
            react.createElement('span', {
              key: e.format,
              className: 'dshpm-era' + (e.current ? ' dshpm-eraCur' : ''),
              title: e.note,
            }, e.name)
          )))
        const cur = eras.find((e) => e.current)
        if (cur && Array.isArray(cur.minors) && cur.minors.length) {
          kids.push(react.createElement('span', { key: 'minors', className: 'dshpm-eras' },
            cur.minors.map((m) =>
              react.createElement('span', {
                key: m.line,
                className: 'dshpm-era dshpm-minor' + (m.current ? ' dshpm-eraCur' : ''),
                title: m.current ? '当前宿主所在小代' : '小代（rc 线）',
              }, m.line)
            )))
        }
      }
      return react.createElement('div', { className: 'dshpm-info' }, kids)
    }

    // 单条 composition →卡内可展开「行开关」（三档滑块 + disable 退避对齐）
    function CompDetails(props) {
      const { c, busyKey, onToggle, onAlign, onDelete } = props
      const groupKey = c.file + '#' + c.presetId
      const driftCount = c.rows.filter((r) => r.state === 'drift').length
      const hostMissingCount = c.rows.filter((r) => r.unavailable || r.pkgMissing).length
      const noBaseCount = c.rows.filter((r) => r.noBaseline).length
      const dynCount = c.rows.filter((r) => r.dynamicValue).length
      const dynResolvedCount = c.rows.filter((r) => r.dynamicResolved).length
      // 对齐落盘集（disable 退避）：官方停用/已移出/官方空 + 宿主不提供；护栏行（表达式/基线未收录）不动
      const alignCount = c.rows.filter((r) => r.alignable).length
      const guardedCount = c.rows.filter((r) => r.dynamicValue || r.baselineUncovered).length
      const missingRef = c.missingRef || c.presetId
      const summary = '行开关（' + c.rows.length + '）'
        + (driftCount ? ' · 漂移 ' + driftCount + '（退避停用）' : '')
        + (hostMissingCount ? ' · 宿主不提供 ' + hostMissingCount : '')
        + (noBaseCount ? ' · 官方空 ' + noBaseCount : '')
        + (dynCount ? ' · 表达式 ' + dynCount + (dynResolvedCount ? '（已按平台求值 ' + dynResolvedCount + '）' : '') : '')
        + (guardedCount ? ' · 护栏保留 ' + guardedCount : '')
        + (c.missing && c.missing.length ? ' · 缺官方行 ' + c.missing.length + '（参照 ' + missingRef + '）' : '')
        + (c.baselineVersion ? ' · 基线 ' + c.baselineVersion : '')
      return react.createElement('details', { className: 'dshpm-details dshpm-comp' },
        react.createElement('summary', null, summary),
        alignCount > 0
          ? react.createElement('div', { className: 'dshpm-compbar' },
              react.createElement('button', {
                className: 'dshpm-tiny', type: 'button',
                disabled: busyKey === groupKey,
                onClick: () => onAlign(c),
              }, busyKey === groupKey
                ? '对齐中…'
                : '对齐：退避停用 ' + alignCount + ' 行（宿主不提供 '
                  + c.rows.filter((r) => r.alignable && (r.unavailable || r.pkgMissing)).length
                  + '、官方停用/已移出/官方空 '
                  + c.rows.filter((r) => r.alignable && !(r.unavailable || r.pkgMissing)).length
                  + '）' + (guardedCount ? ' · 护栏保留 ' + guardedCount + ' 行不动' : '')))
          : null,
        c.rows.map((r) => react.createElement('div', { key: r.id, className: 'dshpm-crow' },
          react.createElement('span', { className: 'dshpm-cname' + (r.triState === 'off' ? ' dshpm-badgeOff' : '') }, r.id),
          r.driftKind
            ? react.createElement('span', {
                className: 'dshpm-badge dshpm-badgeDrift',
                title: r.driftKind === 'introduced' ? ('更晚版本才引入：' + r.firstVer) : ('本版本已移除，末见于：' + r.lastVer),
              }, r.driftKind === 'introduced' ? '跨版本引入' : '版本已移除')
            : null,
          react.createElement('span', {
            className: 'dshpm-baseline ' + (r.effective === null ? 'dshpm-baseOff' : r.effective ? 'dshpm-baseOn' : 'dshpm-baseOff'),
            title: r.dynamicValue
              ? r.dynamicResolved
                ? '该行 disabled 是平台条件表达式（`!!js process.platform …`），已按当前运行平台「' + r.platform + '」算出结果：' + (r.platformDisabled ? '表达式为真→禁用' : '表达式为假→启用') + '，解析值已提交到上面这一格。三档不改写表达式本身（覆写会抹掉跨平台条件，补第二个 disabled 键则非法 YAML）；要固定启停请手工编辑该 patch 行。'
                : '该行 disabled 是条件表达式（!!js），形式不在可求值范围内（只认单一 `process.platform` 比较）：不猜启用态，三档均不改写它。'
              : r.noBaseline
                ? '真值表：官方空（任何内置预设任何版本都未出现过此 id，且 name 也不属官方包）→ 解析为停用；对齐会把它落盘 disabled:true。要保留选「开启」（写 disabled:false）。'
                : r.baselineUncovered
                  ? '真值表：此 id 未被基线表（从 0.1.7 起）收录，但 name 属官方包/虚拟行→不归入「官方空」，只报不改（避免误删 fs-local 这类旧官方工具）。'
                  : '真值表：官方 ' + (r.inRefSet ? 'true（在参照「' + missingRef + '」默认集）' : 'false（不在默认集/已移出）')
                    + ' → 跟随档解析为' + (r.defaultOn ? '启用' : '停用')
                    + '；无 disabled 键（无值）就按这个值走，对齐会把不在默认集的行退避成 disabled:true（连 disabled:false 也覆写）。'
                    + ((r.unavailable || r.pkgMissing) ? '；且宿主不提供→安全档按停用解析并由对齐落盘' : ''),
          }, r.dynamicValue
            ? r.dynamicResolved
              ? (r.effective ? '解析·启用' : '解析·停用') + '（' + r.platform + '）'
              : '表达式·不可求值'
            : r.noBaseline ? '官方空·默认停用' : r.baselineUncovered ? '基线未收录' : (r.effective ? '解析·启用' : '解析·停用')),
          (r.unavailable || r.pkgMissing)
            ? react.createElement('span', {
                className: 'dshpm-badge dshpm-badgeDrift',
                title: r.hostDisabled
                  ? '该行 id 被已安装 bundle 的定向覆盖（disabled:true）全局禁用（如 agent-team-profile 接管 delegation）：包本身可解析但宿主不会启动它，启用即整条预设 never started。「跟随」按停用解析；建议「关闭」或对齐停用（写 disabled，不删行）。'
                  : '引用包在当前安装不可解析（宿主不提供）：该行一旦启用，整条预设加载失败（never started）。「跟随」按停用解析；建议「关闭」或对齐停用（写 disabled，不删行）。',
              }, r.hostDisabled ? '宿主层已禁用' : '宿主不提供')
            : null,
          r.dynamicValue && !r.dynamicResolved
            ? react.createElement('span', {
                className: 'dshpm-badge dshpm-badgeDrift',
                title: '该行的 disabled 是条件表达式（!!js，如按 process.platform 判定）：本工具不猜它的启用态，三档均不改写（追写第二个 disabled 键是非法 YAML，覆写则抹掉跨平台条件）。要置固定值请手工编辑该 patch 文件。',
              }, '表达式·不可求值')
            : null,
          react.createElement('span', { className: 'dshpm-seg', role: 'group' },
            ['follow', 'off', 'on'].map((mode) => {
              const active = r.triState === mode
              const label = mode === 'follow' ? '跟随' : (mode === 'off' ? '关闭' : '开启')
              const blockedByDynamic = r.dynamicValue // 表达式行：三档均不可写
              const unavailableRow = Boolean(r.unavailable || r.pkgMissing)
              // 不可用的具体成因（bundle 定向禁用 / 包或子路径不可解析），tooltip 分开说；带包名便于定位
              const spec = r.name ? '（' + r.name + '）' : ''
              const why = r.hostDisabled
                ? '该 id 被已安装 bundle 的顶层覆盖全局 disabled:true'
                : r.pkgMissing
                  ? '引用包' + spec + '在当前宿主版本不可用（包本体缺失，或该版本没导这个子路径）'
                  : '宿主不提供该行'
              return react.createElement('button', {
                key: mode,
                type: 'button',
                className: 'dshpm-segBtn' + (active ? ' dshpm-segOn' : ''),
                disabled: active || blockedByDynamic || (mode === 'on' && unavailableRow) || busyKey === groupKey + '/' + r.id,
                title: mode === 'follow'
                  ? (unavailableRow
                    ? '跟随：该行的包/子路径在当前安装起不来（或 id 被 bundle 层全局禁用），删键会把它交回宿主加载→整条预设 never started，所以此档退避为写 disabled:true'
                    : ('跟随解析默认（' + (r.defaultOn ? '启用' : '停用') + '）；写盘=删掉 disabled 键，启用态回到预设声明自身'))
                  : mode === 'on'
                    ? (unavailableRow
                      ? '不可开启：' + why + '；强行启用会让整条预设从可用预设列表消失'
                      : '强制开启（写 disabled:false，跟「跟随」的删键不同）')
                    : '强制关闭（写 disabled:true）',
                onClick: () => onToggle(c, r, mode),
              }, label)
            })),
          // 删除按钮：仅真自定义行（任何基线都无且非官方包）可删；内置/漂移/基线未收录行不给删。
          r.state === 'custom' && !r.baselineUncovered && typeof onDelete === 'function'
            ? react.createElement('button', {
                className: 'dshpm-tiny dshpm-del', type: 'button',
                disabled: busyKey === groupKey + '/' + r.id,
                title: '从该预设声明中整行移除（写前 .bak 备份，重启生效）',
                onClick: () => onDelete(c, r),
              }, '删除')
            : null)),
        c.missing && c.missing.length
          ? react.createElement('div', { className: 'dshpm-hint' },
            '参照预设「' + missingRef + '」有、本预设声明缺失的行（需手动补；自动补齐待后续）：'
            + (Array.isArray(c.missingNames) && c.missingNames.length
              ? c.missingNames.map((m) => (m.name ? m.id + ' （' + m.name.replace('@deepseek-ai/', '') + '）' : m.id)).join('、')
              : c.missing.join('、')))
          : null)
    }

    // 卡内「系统提示词」框：patch 里的提示词段（persona / plan-mode / 工具说明）+ 注入目录。
    // - 位置在行开关之后：先看这一行开没开，再看这个预设究竟对模型说了什么；
    // - 显示跟随行开关的解析值（effective）：停用的段淡出并标「停用」，不计入「N 段」；
    // - 每段可编辑：confirm 硬门 → /prompt-write → 只替换该值的 span（.bak + 原子写）。
    function PromptBox(props) {
      const c = props.c || {}
      const texts = Array.isArray(c.promptTexts) ? c.promptTexts : []
      const inj = Array.isArray(c.injections) ? c.injections : []
      const [editing, setEditing] = react.useState(null)
      const [busy, setBusy] = react.useState('')
      const [error, setError] = react.useState('')
      if (!texts.length && !inj.length) return null
      const rowById = new Map((Array.isArray(c.rows) ? c.rows : []).map((r) => [r.id, r]))
      // 行的解析值才是胜负：!!js 平台条件行在写盘前就能看出「这台机器上它不生效」
      const isOff = (t) => {
        const r = rowById.get(t.rowId)
        return r ? r.effective === false : false
      }
      const live = texts.filter((t) => !isOff(t))
      const off = texts.filter(isOff)
      const injEnabled = inj.reduce((n, d) => n + (d.enabled || 0), 0)
      const summary = '系统提示词（' + live.length + ' 段'
        + (off.length ? ' · 随行停用 ' + off.length : '')
        + (inj.length ? ' · 注入 ' + injEnabled + ' 条' : '') + '）'
      const KIND_LABELS = { persona: '人设', plan: '计划模式', tool: '工具说明', text: '提示词' }

      const save = async (t) => {
        const draft = editing ? editing.text : ''
        if (typeof draft !== 'string') return
        if (draft.trim() === '') {
          setError('提示词不能清空（宿主字段要求非空）')
          return
        }
        if (!window.confirm(
          '写回「' + t.rowId + ' · ' + t.key + '」？\n\n'
          + '只替换这个值的字节区间（' + t.chars + ' → ' + draft.trim().length + ' 字），同文件其余注释/缩进不动；'
          + '写前自动 .bak 备份。重启 DSH 后生效。')) return
        setBusy(t.rowId + '/' + t.key)
        setError('')
        try {
          const result = await fetch(`${BRIDGE}/prompt-write`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              file: c.file, presetId: c.presetId, rowId: t.rowId, key: t.key, text: draft, confirm: true,
            }),
          }).then((r) => r.json())
          if (!(result && result.ok)) {
            setError('prompt-write: ' + ((result && (result.code || result.message)) || 'error'))
          } else if (result.value && Array.isArray(result.value.errors) && result.value.errors.length) {
            setError(result.value.errors.map((e) => e.message).join('; '))
          } else {
            setEditing(null)
            if (typeof props.onReload === 'function') await props.onReload()
          }
        } catch (e) {
          setError((e && e.message) || String(e))
        } finally {
          setBusy('')
        }
      }

      const textNodes = (t, dim) => {
        const k = t.rowId + '/' + t.key
        const isEditing = Boolean(editing) && editing.rowId === t.rowId && editing.key === t.key
        const nodes = [
          react.createElement('div', { key: 't' + k, className: 'dshpm-crow' },
            react.createElement('span', { className: 'dshpm-cname' + (dim ? ' dshpm-badgeOff' : '') }, t.rowId + ' · ' + t.key),
            t.kind && t.kind !== 'text'
              ? react.createElement('span', { className: 'dshpm-badge' }, KIND_LABELS[t.kind] || t.kind)
              : null,
            dim ? react.createElement('span', { className: 'dshpm-badge' }, '停用') : null,
            react.createElement('span', { className: 'dshpm-badge' }, t.chars + ' 字'),
            react.createElement('button', {
              className: 'dshpm-tiny', type: 'button', disabled: busy === k,
              title: '就地编辑这段提示词（只替换该值，写前 .bak 备份）',
              onClick: () => {
                setError('')
                setEditing(isEditing ? null : { rowId: t.rowId, key: t.key, text: typeof t.text === 'string' ? t.text : t.preview })
              },
            }, isEditing ? '收起' : '编辑')),
        ]
        if (isEditing) {
          nodes.push(react.createElement('textarea', {
            key: 'ta' + k, className: 'dshpm-promptEdit', value: editing.text, spellCheck: false,
            onChange: (e) => setEditing({ ...editing, text: e.target.value }),
          }))
          nodes.push(react.createElement('div', { key: 'tb' + k, className: 'dshpm-compbar' },
            react.createElement('button', {
              className: 'dshpm-tiny', type: 'button',
              disabled: busy === k || String(editing.text || '').trim() === '',
              onClick: () => save(t),
            }, busy === k ? '写入中…' : '保存到 patch'),
            react.createElement('button', {
              className: 'dshpm-tiny', type: 'button', style: { marginLeft: '6px' },
              disabled: busy === k,
              onClick: () => { setEditing(null); setError('') },
            }, '取消'),
            react.createElement('span', { className: 'dshpm-hint', style: { marginLeft: '8px' } },
              String(editing.text || '').trim().length + ' 字 · 保存后重启生效')))
        } else {
          nodes.push(react.createElement('p', { key: 'tp' + k, className: 'dshpm-hint' }, t.preview))
        }
        return nodes
      }

      const kids = []
      if (texts.length) {
        kids.push(react.createElement('p', { key: 'th', className: 'dshpm-hint' },
          'patch 里的提示词段（显示跟随行开关；占位符不插值）：'))
        for (const t of live) kids.push(...textNodes(t, false))
        for (const t of off) kids.push(...textNodes(t, true))
        if (error) kids.push(react.createElement('p', { key: 'terr', className: 'dshpm-error' }, error))
      }
      if (inj.length) {
        kids.push(react.createElement('p', { key: 'ih', className: 'dshpm-hint' },
          '注入目录（dsh-preset-studio 结构）：'))
        for (const d of inj) {
          kids.push(react.createElement('p', { key: 'id' + d.dir, className: 'dshpm-hint', title: d.dir },
            (d.wired === false ? '未接线 · ' : '') + (d.missing ? '目录不存在 · ' : '')
            + (d.total || 0) + ' 条 / 生效 ' + (d.enabled || 0) + ' · ' + d.dir))
          for (const e of d.entries || []) {
            kids.push(react.createElement('div', { key: 'ie' + e.file, className: 'dshpm-crow' },
              react.createElement('span', { className: 'dshpm-cname' + (e.enabled ? '' : ' dshpm-badgeOff') }, e.name),
              react.createElement('span', { className: 'dshpm-badge' }, e.role + '/' + e.order),
              react.createElement('span', { className: 'dshpm-badge' }, e.chars + ' 字'),
              e.issues && e.issues.length
                ? react.createElement('span', { className: 'dshpm-badge dshpm-badgeDrift', title: e.issues.join('、') }, '⚠ ' + e.issues.length)
                : null))
          }
        }
      }
      // 默认展开：这个框本身就是「预设对模型说了什么」的答案，藏起来等于没做
      return react.createElement('details', { className: 'dshpm-details dshpm-comp', open: true },
        react.createElement('summary', null, summary),
        kids)
    }

    // 提示词注入清单（dsh-preset-studio 结构）：读到的条目 + 投递器会静默吞掉的问题
    function PromptsSection(props) {
      const prompts = props.prompts || []
      return react.createElement('div', { className: 'dshpm-prompts' },
        react.createElement('div', { className: 'dshpm-divider' }),
        react.createElement('p', { className: 'dshpm-gridTitle' }, '其他注入目录（未挂到预设卡）（' + prompts.length + '）'),
        react.createElement('p', { className: 'dshpm-desc' },
          '按 dsh-preset-studio 投递器语义读取：--- 围栏 + 顶层单行标量（name / role / order / enabled）。'
          + '读不出的文件会被投递器静默丢弃（BOM、无围栏、正文空），这里如实标出。'),
        react.createElement('div', { className: 'dshpm-cards' },
          prompts.map((p) => {
            const entries = Array.isArray(p.entries) ? p.entries : []
            const warnCount = entries.filter((e) => e.issues && e.issues.length).length
            const wired = p.wired !== false && !p.missing
            const stateTag = p.missing ? '目录不存在' : p.wired === false ? '未接线' : '已接线'
            return react.createElement('div', {
              key: p.dir + '#' + (p.presetId || ''),
              className: 'dshpm-pcard' + (wired && !warnCount ? '' : ' dshpm-pbroken'),
            },
              react.createElement('div', { className: 'dshpm-phead' },
                react.createElement('span', { className: 'dshpm-pname', title: p.presetId || p.dir },
                  p.presetId || '（未关联预设）'),
                react.createElement('span', {
                  className: 'dshpm-tag' + (wired && !p.missing ? ' dshpm-tagSolid' : ''),
                  title: p.wired === false
                    ? '目录里有提示词，但没有任何 dsh-preset-studio/inject 行指向它：永远不会生效'
                    : p.missing ? 'config.dir 指向的目录不存在' : '已有投递器行指向该目录',
                }, stateTag),
                react.createElement('span', { className: 'dshpm-tag' }, p.enabled + '/' + p.total + ' 生效')),
              react.createElement('p', { className: 'dshpm-pdesc', title: p.declared || p.dir }, p.dir),
              entries.length
                ? react.createElement('details', { className: 'dshpm-details' },
                    react.createElement('summary', null,
                      entries.length + ' 条'
                      + (p.disabled ? ' · 关闭 ' + p.disabled : '')
                      + (warnCount ? ' · 格式问题 ' + warnCount : '')),
                    react.createElement('ul', null, entries.map((e, i) =>
                      react.createElement('li', { key: i },
                        (e.enabled ? '' : '[关闭] ') + e.name + ' · ' + e.role + '/' + e.order + ' · ' + e.chars + ' 字'
                        + (e.vars && e.vars.length ? ' · {{' + e.vars.join('}}, {{') + '}}' : '')
                        + (e.issues && e.issues.length ? ' · ⚠ ' + e.issues.join('、') : '')))))
                : null)
          })))
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
        react.createElement('button', {
          key: 'delp',
          className: 'dshpm-tiny dshpm-del',
          type: 'button',
          disabled: props.busyKey === p.file + '#' + p.id || typeof props.onDeletePreset !== 'function',
          title: '整块删除这条预设声明（含其全部插件子行）；写前 .bak 备份，重启生效。被 default/selectedDefault 指着的预设需二次确认。',
          onClick: () => props.onDeletePreset(p),
        }, '删除预设'),
        (p.broken || []).length
          ? react.createElement('details', { className: 'dshpm-details' },
              react.createElement('summary', null, '查看修复项（' + p.broken.length + '）'),
              react.createElement('ul', null, p.broken.map((f, i) =>
                react.createElement('li', { key: i },
                  '[' + (f.level === 'auto' ? '自动' : f.rule === 'R-LEGACY-CONFLICT' ? '可授权' : '需人工') + '] ' + f.rule + '：' + f.reason))))
          : null))
      // 卡内行开关（仅声明式预设、有可列行时）
      if (props.composition && Array.isArray(props.composition.rows) && props.composition.rows.length) {
        kids.push(react.createElement(CompDetails, {
          key: 'comp',
          c: props.composition,
          busyKey: props.busyKey,
          onToggle: props.onToggle,
          onAlign: props.onAlign,
          onDelete: props.onDelete,
        }))
      }
      // 行开关之后：这个预设的系统提示词（patch 里的提示词段 + 注入目录；可编辑）
      if (props.composition) {
        kids.push(react.createElement(PromptBox, {
          key: 'promptbox', c: props.composition, onReload: props.onReload,
        }))
      }
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
      const [busyKey, setBusyKey] = react.useState(null)

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
        // 遗留目录冲突卡：走授权转写收尾（双确认 UI + 服务端 confirm 硬门）——
        // 对齐既有转写声明到当前版本默认预设参照 + 归档遗留目录（移动非删除）。
        if ((p.broken || []).some((f) => f.rule === 'R-LEGACY-CONFLICT')) {
          const ok1 = window.confirm(
            '转写预设「' + p.name + '」收尾？\n\n' +
            '该遗留目录已有 patch 转写声明，目录残留会重复插入同一预设。\n' +
            '授权后自动完成（不需手工操作）：\n' +
            '1) 把转写声明对齐到当前版本默认预设参照（行级停用漂移行，写 disabled 不删行；自定义行保留）；\n' +
            '2) 遗留目录归档到 preset-doctor-archive（整体移动，不删除）。\n' +
            '写盘前自动 .bak 备份 + 原子写；完成后需重启 DSH 进程生效。'
          )
          if (!ok1) return
          const ok2 = window.confirm('二次确认：授权执行以上写操作（对齐声明 + 归档目录）？')
          if (!ok2) return
          setSyncingKey(p.key)
          setError('')
          try {
            const result = await fetch(`${BRIDGE}/resolve-legacy`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ key: p.key, confirm: true }),
            }).then((r) => r.json())
            if (!(result && result.ok)) {
              setError('resolve-legacy: ' + ((result && (result.code || result.message)) || 'error'))
            } else if (result.value && Array.isArray(result.value.errors) && result.value.errors.length) {
              setError(result.value.errors.map((e) => e.message).join('; '))
            }
            await load(true)
          } catch (e) {
            setError((e && e.message) || String(e))
          } finally {
            setSyncingKey(null)
          }
          return
        }
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

      /** 通用写操作（align/toggle）：confirm 强制 + 重拉刷卡。busy 为行/组级 busyKey。 */
      const postAction = async (path, body, busy) => {
        setBusyKey(busy)
        setError('')
        try {
          const result = await fetch(`${BRIDGE}/${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...body, confirm: true }),
          }).then((r) => r.json())
          if (!(result && result.ok)) {
            setError(path + ': ' + ((result && (result.code || result.message)) || 'error'))
          } else if (result.value && Array.isArray(result.value.errors) && result.value.errors.length) {
            setError(result.value.errors.map((e) => e.message).join('; '))
          }
          await load(true)
        } catch (e) {
          setError((e && e.message) || String(e))
        } finally {
          setBusyKey(null)
        }
      }

      const alignPreset = (c) => {
        const n = c.rows.filter((r) => r.alignable).length
        const guarded = c.rows.filter((r) => r.dynamicValue || r.baselineUncovered).length
        if (!window.confirm(
          '对齐预设「' + c.presetId + '」（disable 退避）？\n\n'
          + '将把 ' + n + ' 行退避为 disabled:true（官方停用/已移出/官方空 + 宿主不提供），'
          + '不删任何行；连显式强制开（disabled:false）也会被覆写。区间外字节/注释不动，写前 .bak 备份。\n'
          + '护栏保留 ' + guarded + ' 行不动（!!js 表达式行、基线未收录的官方包行）。\n'
          + '参照预设为「' + (c.missingRef || c.presetId) + '」（自定义 id 按行集相似度推断）；缺失行仅提示不自动补。重启 DSH 后生效。')) return
        postAction('align', { file: c.file, presetId: c.presetId }, c.file + '#' + c.presetId)
      }

      const toggleRow = (c, r, mode) => {
        postAction('toggle', { file: c.file, presetId: c.presetId, rowId: r.id, mode },
          c.file + '#' + c.presetId + '/' + r.id)
      }

      /** 行级删除（仅自定义行）：单确认弹窗 + confirm 硬门 + 重拉刷卡。 */
      const deleteRow = (c, r) => {
        if (!window.confirm(
          '删除预设「' + c.presetId + '」里的行「' + r.id + '」？\n\n'
          + '将从 cordis.patch.yml 整行移除该插件声明（区间外字节/注释不动），写前 .bak 备份；'
          + '仅自定义行可删。重启 DSH 后生效。')) return
        postAction('delete', { file: c.file, presetId: c.presetId, rowId: r.id },
          c.file + '#' + c.presetId + '/' + r.id)
      }

      /** 预设级删除：双确认（第一道告知背条路径，第二道确认 allowDefault）+ confirm 硬门。 */
      const deletePreset = (p) => {
        if (!window.confirm(
          '删除整条预设「' + p.name + '」（id: ' + p.id + '）？\n\n'
          + '将从 ' + p.file + ':' + (p.line || '?') + ' 整块移除该预设声明（含其全部插件子行），'
          + '区间外注释不动，写前 .bak 备份。删后该模式在预设选择列表里消失；已有会话不受影响。重启 DSH 后生效。')) return
        if (p.isDefault && !window.confirm(
          '「' + p.id + '」正被 agent-preset-registry 的 default/selectedDefault 指着。\n\n'
          + '直接删会让新建会话报 agent-preset/not-found。确定仍要删？（取消则请先在设置里改默认预设）')) return
        postAction('delete-preset', { file: p.file, presetId: p.id, allowDefault: !!p.isDefault },
          p.file + '#' + p.id)
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
        versionVia: list && list.versionVia,
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
        const compByPreset = {}
        if (Array.isArray(list.composition)) {
          for (const c of list.composition) compByPreset[c.file + '#' + c.presetId] = c
        }
        children.push(react.createElement('div', { className: 'dshpm-cards', key: 'cards' },
          list.presets.map((p) => react.createElement(PresetCard, {
            key: p.key,
            preset: p,
            syncingKey: syncingKey,
            onSync: sync,
            composition: compByPreset[p.file + '#' + p.id],
            busyKey,
            onToggle: toggleRow,
            onAlign: alignPreset,
            onDelete: deleteRow,
            onDeletePreset: deletePreset,
            onReload: () => load(true),
          }))))
      }

      // ── 其他注入目录（没挂到任何预设卡的：未接线 / 目录不存在 / 无归属）──
      if (list && Array.isArray(list.prompts) && list.prompts.length) {
        const attached = new Set(
          (Array.isArray(list.composition) ? list.composition : []).map((c) => c.file + '#' + c.presetId),
        )
        const orphans = list.prompts.filter(
          (p) => p.wired === false || p.missing || !p.presetId || !attached.has(p.presetFile + '#' + p.presetId),
        )
        if (orphans.length) children.push(react.createElement(PromptsSection, { key: 'prompts', prompts: orphans }))
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
      let ownTabRegistered = false
      // 注册「预设医生」tab 进 dsh-family.tab。幂等：正牌 owner 触发 inject、
      // 或 backstop 上位后自宣，二者只会真正注册一次（避免同 id 重复注册）。
      const registerPresetTab = () => {
        if (ownTabRegistered) return undefined
        ownTabRegistered = true
        return ctx.slots.register(
          {
            name: 'dsh-family.tab',
            id: 'preset-manager',
            order: 25,
            label: '预设医生',
            locale: NS,
            inject: () => ({}),
          },
          PresetManagerCard,
        )
      }
      safe('dsh-family.tab', () =>
        ctx.slots.inject('dsh-family.tab', () => registerPresetTab())
      )
      // 家族容器兜底（rank 8，延迟 = 200 + RANK*900；唯一真源
      // mine-dsh-plugins/_tools/family-rank.mjs）：TL/guard/steward/mcp 全部让位或
      // 声明失败时，上面的 inject 会静默 pending——本卡整轮启动不可见且不报错。
      // 到点仍无人持有，则自己上位成通用容器（按账本渲染所有成员卡）。
      // declare-or-withdraw：声明失败就放弃，绝不裸注册不带 children 的残废节
      // ——残废节会占住导航行并让后来者集体退场（2026-10-14 面板丢失的成因）。
      safe('family-host-backstop', () => {
        const CLAIM_DELAY_MS = 200 + 7 * 900
        // 判断「有没有一个可用的家族容器承载本卡」：任何插件(TL/guard/steward/mcp/本插件)
        // seat 了 id=dsh-family 的 settings.section 即算有。以「容器在不在」为准，而非
        // 「我的 inject 有没有触发」——正牌 owner 声明了子槽却又撤回/没渲染时，账本里
        // 有本卡却无人渲染，familyTabHeld 会误判为「有家」，故改查 section 实际在位。
        const familySeated = () => {
          try {
            return ctx.slots.entries('settings.section')
              .some((e) => String((e.options || {}).id || '') === 'dsh-family')
          } catch { return false }
        }
        const timer = setTimeout(() => {
          if (familySeated()) return
          // 兜底 1：无人建家族容器 → 自己建（声明 dsh-family.tab 子槽）+ 内联挂本卡。
          try {
            // 无 owner 时不玩家族容器（children/账本/renderSlot 在本宿主下渲染成空体）：
            // 直接注册「无子槽的独立 settings.section」。组件体内先铺一排静态
            // tablist 头（对齐 thinking-levels FamilySettingsSection 样式：单 tab
            // 「预设医生」恒选中），下方 tabpanel 直挂本卡——既与「装了 TL 的多标签
            // 家族」视觉一致，又不依赖任何会渲染成空白的容器机制。
            ctx.slots.register(
              {
                name: 'settings.section',
                id: 'dsh-family',
                order: 40,
                priority: 50,
                label: () => '起子插件设置',
                inject: () => ({}),
              },
              () => {
                const tabStyle = {
                  appearance: 'none',
                  font: 'inherit',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                  background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.08))',
                  color: 'var(--dsw-alias-label-primary, inherit)',
                  borderRadius: '8px',
                  padding: '5px 12px',
                  fontSize: '13px',
                }
                return react.createElement(
                  'div',
                  { style: { display: 'grid', gap: '12px' } },
                  react.createElement(
                    'div',
                    { role: 'tablist', 'aria-label': '起子插件设置', style: { display: 'flex', flexWrap: 'wrap', gap: '4px' } },
                    react.createElement('button', { type: 'button', role: 'tab', 'aria-selected': true, style: tabStyle }, '预设医生'),
                  ),
                  react.createElement('div', { role: 'tabpanel' }, react.createElement(PresetManagerCard, {})),
                )
              },
            )
            console.warn('preset-manager: family container unclaimed — registered standalone childless section with single-tab header')
            return
          } catch (error) {
            console.warn('preset-manager: family claim lost (' + (error && error.message ? error.message : String(error)) + ') — falling back to standalone')
          }
          // 兜底 2（极端）：连 dsh-family.tab 子槽都被占住、无法声明家族容器 →
          // 注册本插件专属 settings.section（不碰家族槽），保证「预设医生」永远有家可回。
          try {
            ctx.slots.register(
              {
                name: 'settings.section',
                id: 'preset-manager-standalone',
                order: 41,
                priority: 50,
                label: () => '预设医生',
                inject: () => ({}),
              },
              () => react.createElement(PresetManagerCard, {}),
            )
            console.warn('preset-manager: registered standalone fallback section')
          } catch (error2) {
            console.warn('preset-manager: standalone fallback failed too (' + (error2 && error2.message ? error2.message : String(error2)) + ')')
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
