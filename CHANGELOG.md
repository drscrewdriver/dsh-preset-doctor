# Changelog

## 0.7.5 (2026-10-24)

版本探测抗残留修复（bug1）+ 对齐功能同根连带恢复（bug2）+ R-DEAD-VAR 死变量规则（`{{cwd}}` 残留）。

- **bug1 修复（host-version.js 重写）**：旧逻辑单包解析链会撞上 profile 上层目录的安装残留（如 `<home>/profiles/node_modules/@deepseek-ai/dsh` 停着 0.1.2-alpha.1 旧副本）导致版本误判；现改为**三通道全副本收集（Node 解析链 + 各候选根 + Electron `process.resourcesPath` 下的 app.asar 宿主包）取最高 semver**——desktop 形态真宿主跑在 Electron 运行时里（安装位置可多处且随升级漂移，resourcesPath 是运行时自报、天然指向当前在跑的那套），残留副本只会比运行宿主旧，max 启发式对垃圾鲁棒；返回附 `via/path/copies`，卡片版本行展示判定依据。
- **bug2（同根连带）**：版本误判→选中 0.1.2 时代分支→无基线快照→「对齐到当前版本标准」（R-COMPOSITION/行开关/同步）整体失效；版本修对后自动落回 `dsh-0.2.1` 分支。另补 `0.2.1-rc.3` 基线快照（宿主 tag 实证预设域相对 rc.2 零 diff，克隆 rc.2）。
- **新增 R-DEAD-VAR（rules/dead-var.js）**：宿主已移除的 prompt 变量残留检查+机械修复。首条死表条目 `{{cwd}}`（0.2.1-alpha.2 起 system-prompt 不再注册，模板残留抛 `unknown prompt variable "cwd"` 拒载整条预设）：表驱动（changes.json `prompt-var-removed`）+ 版本门控（旧宿主仍合法不报）；修复走既有 auto→applyFixes 流水线：cwd 提示整行删行、裸占位删 token 收敛空白，span 外字节不动，`.bak` 备份照旧。
- planner 抽出 `rewriteRowSpan`/`makeSetScalar` 共用（R-KEY-RENAMED 行为不变）；mergeChanges 对 prompt-var-removed 按 `variable` 去重；测试 +13（host-version 6 + dead-var 7），148 例全绿。

0.7.4: host enumeration addendum for DSH 0.2.1-rc.3 (declaration-only bump; contract plane zero diff).

## 0.7.3 (2026-10-19)

行开关基准语义定案（2026-10-19 用户裁决）：基准项逻辑上不存在→默认按关闭解析，UI 诚实区分「无基准」与「基准存在但停用」，并保留兜底失效手段。

- **`classifyComposition` 新增行级 `noBaseline`**：跨全部快照×全部内置预设求并集判定——仅当该行从未进过任何内置预设才为真（区别于「活在 minimal 但参照 standard 无」的基准·停用态）。
- **UI（lib/client.js）**：`noBaseline` 行徽章改标「无基准·默认停用」（原一律显示「基准·停用」，掩盖了基准项为空的事实）；tooltip 写明解析规则与两个兜底失效手段：置「关闭」写 `disabled:true`、手工改名行 name 令其加载失效；三档按钮不动（跟随对这类行本就解析为停用）。
- 测试 +1（noBaseline 跨预设/跨快照边界用例）+2 断言；135 例全绿。

## 0.7.2 (2026-10-18)

恢复「授权转写」：R-LEGACY-CONFLICT（遗留目录 + patch 已有同 id 转写声明）不再卡「需人工」，卡内「同步到当前版本」一键授权收尾（2026-10-18 用户定案：双确认提示 + 操作前备份即可，不强制手工操作）。

- **转写收尾动作**（`src/fix/resolve-legacy.js`）：① 把既有转写声明对齐到**当前版本默认预设参照**——内置 id 走 `planAlignForPreset`，自定义 id 走新增 `planAlignForCustomPreset`（删「曾是内置标准成员、当前版本已彻底不活」的漂移行；任何基线都没出现过的用户自定义行绝不删；不报 missing）；② 遗留目录**归档**（rename 整体移动到 `<home>/preset-doctor-archive/<ts>/<id>/`，不在扫描面内，绝不删除）。
- **安全契约**：UI 双确认（两道确认框，写明将执行的步骤）+ 服务端 `confirm:true` 硬门（桥 `/resolve-legacy` 新路由）；写盘走既有 `writeFileSafe`（.bak 备份 + 原子写 + 幂等）；dryRun 全程 0 写盘；归档同名冲突加序号后缀；对齐失败时不归档并如实报 partial/error。
- **入口打通**：`collectPresets` 对 R-LEGACY-CONFLICT 卡开放 `syncable`；client 卡面修复项标签新增「可授权」档；`apply()` 返回面与桥 context 同步暴露 `runResolveLegacy`。
- 测试 134 例（+7：confirm 硬门/全链收尾/内置 id 收尾/dryRun/归档后缀/桥路由/冲突卡 syncable）；lint 0；`node --check lib/client.js` 通过。

## 0.7.1 (2026-10-18)

- hosts: 追加 0.2.1-rc.2 声明面枚举（34/34 @deepseek-ai/* 宿主 peer 逐包 npm 实测 rc.2 在版；本插件不触 ctx.web provider 与 conversation.input.model.label 槽，代码零改动，纯元数据发版；农场 rc.2 格挂账待命）

## 0.7.0 (2026-10-18)

内置预设「组合基线 + 版本漂移检测 + 行级三档开关」——回溯整条线上内置标准组合，按当前运行版本对齐，避免跨版本错配（如 0.2.0 用 time-context / 0.2.1 用 tool-subagent-codex 这种反向）。

- **P0 逐版本基线表**：`tools/table-build.mjs --composition` 遍历 harness git tag 抽取逐版内置预设行集 → `src/tables/preset-baseline.json`（13 版快照）；`load.js` 加 `loadBaseline()/baselineForVersion()`；`branches.json` 新增 `dsh-0.2.1` 分支并更正「组合冻结」note（0.2.1 起漂移）。
- **P1 R-COMPOSITION-DRIFT**：`src/rules/composition-drift.js` 逐行三分类（introduced/removed/自定义），report 级不自动写盘；`scan.js` 注册。
- **P1b 行级对齐**：`src/fix/row-edit.js`（文本级 span 原语，区间外字节/注释不动）+ `src/fix/composition-align.js`（删漂移行、报缺失标准行）+ `runAlign`；`fix/core.js` 支持零宽插入。
- **P2 卡内行视图**：`getSummary` 暴露 `composition`（对所有声明式预设列行，含自定义 id）；`classifyComposition` 逐行标 `state`/`defaultOn`/`triState`。
- **P3 行级三档 toggle**：`runToggle` 收 `mode`（follow/on/off），follow 按当前版本参照预设（命中内置→自身，自定义 id→回退 standard）默认解析；桥 `/toggle` `/align` 路由（confirm 双门 + loopback 守卫）。
- **UI（lib/client.js）**：行开关**嵌入每张预设卡**（可展开 `<details>`）；每行**三档滑块** `[跟随 | 关闭 | 开启]`，行中间独立彩色条标注**当前版本基准**（`基准·启用`/`基准·停用`）；代际改**两层显示**（大代=格式目录/声明，小代=rc 线，当前高亮）。
- 测试 127 例（+28：baseline/漂移/对齐/行编辑/三档分类/toggle mode 解析）；lint 0；农场 0.2.1-rc.1 格实测 composition/漂移/triState 全链路跑通。

## 0.6.1 (2026-10-17)

装载判据补齐宿主 `0.2.1-rc.1`（纯 manifest 收紧，无代码逻辑变更）。

- **双清单同串**：`engines.dsh`、`dsh.plugin.json engines.dsh`、renderer peer `@deepseek-ai/dsh-client-ui-renderer`、`dsh.compatibility.dshReleases` 四处写点统一为逐 rc 精确枚举（16 项，`0.1.0-rc.2 … 0.2.0-rc.2 || 0.2.1-rc.1`），无区间/caret
- **收紧反模式**：`engines.dsh` 原 `>=0.1.1-rc.1`（无上界、且窄于 peers）与分支表「最老支持线含 0.1.0.x」矛盾——会静默阻断未测宿主且拒载 0.1.0-rc.x。改为精确枚举后拉宽至与 peers/compat 同域，semver 双向验证命中 `0.2.1-rc.1`、拒绝 `0.3.0-rc.1`
- 版本归一 `0.6.0-local.1` → `0.6.1`（`-local` 后缀不入 npm）

## 0.6.0 (2026-10-09)

预设医生卡片化改版 + autoFix 总闸退役（2026-10-09 用户定案「取消自动闸 全手动确认」）。

- **预设卡片网格**：检测到的全部「理论潜在可用」预设（home/profile patch 声明 + 遗留目录）以官方 AgentPresetSection 同款卡片展示（268px 起步网格、来源徽章、代际徽章、失效红边+修复项折叠明细）。数据源 = summarize() 新增 presets[]（三路 union + (id,file) 去重 + 健康预设补 current + era 关联，collectPresets 全程空安全）。
- **卡内「同步到当前版本」**：点击 → 确认框（可自动修处数 + .bak 备份说明）→ `POST .../sync {key,confirm:true}` → applyFixes 单预设 auto 级修复（.bak + 原子写）→ 重扫刷卡。confirm 缺失服务端硬拒绝（confirm-required）；report 级永不写盘。
- **autoFix 总闸退役**：DEFAULT_SETTINGS/Config/表单移除该字段，/preset-doctor fix 不再受闸（显式命令 = 手动确认）；启动恒 scan-only。旧配置里的 autoFix 值被 readConfig 丢弃。
- **信息区**：当前 DSH 版本 + 代际目录（目录预设期 0.1.0–0.1.5 / 声明 Patch 期 0.1.7α1+，自 branches.json presetFormat 派生，当前代高亮）。
- **桥扩容**：makeSettingsBridge 可选 context={getSummary,runSync}（向后兼容，缺省 list/sync 返 unavailable）+ `/list`（body {fresh:true} 重扫，默认走启动扫描缓存）+ `/sync` 两路由；BRIDGE_KEYS 白名单不变。
- **client**：list 请求 module 级 in-flight 去重（family tab/row.config/bundle.config 三槽并发共享）；配置表单 3 键。
- 测试 99 例（新增 7：collectPresets 声明/遗留/空安全 + eraCatalog + 桥 list/sync + runSync 全链确认闸；重写 autoFix 时代断言 3 处）。


## 0.5.0 (2026-10-08)

设置面三代 waist 下探 + client 半边（≤0.1.5 设置页插件配置卡）。

- **设置面标注（本发布主旨）**：可检查设置面 = **0.1.7-rc.1 → 0.2.0**（宿主 volatile 自动表单，设置 → 插件 → preset-manager）；本轮起下探：
  - **0.1.2-rc.1 / 0.1.5-rc.x**：host 侧 `settings.installSection(ctx, ns, Config, resolveConfig(config), {setSource, onChange})`（base 必须解包，活引用直传 ValidationError 且 cordis 静默吞异常）+ client 卡按 ns 派发——宿主实测派发条件 = served namespaces ∩ `settings.plugin.item` 卡 ∩ slot key === ns ∩ settingsScope.bind，四者缺一卡不出现（0.1.5 client-ui-settings-plugins client.js:1085-1146 源码定案）
  - **0.1.0-rc.x / 0.1.1-rc.x**：服务只有 `register/update/mutate/describe`，`register(ns, Config, {base})` 注册即持久化（壳无设置页无 UI 可渲染，非缺陷）；⚠️ 动态 import `@deepseek-ai/dsh-settings` 在两线解析不出模块级 legacy 导出（实测 undefined），特性检测只用服务自身方法
- **client 半边**（`lib/client.js`，ModuleLoader 纯 JS 无构建，跨代双面）：≤0.1.5 `settings.plugin.item` 卡（key=`preset-manager`）+ `settingsScope.bind` 子 inject；rc.1+ `plugins.row.config`（key=`dsh-preset-doctor#preset-manager`）+ `plugins.bundle.config`（key=`dsh-preset-doctor`）插件页卡——**0.1.7 设置面板实测无宿主渲染的 volatile 自动表单**，rc.1+ 的可见设置面只能由 client 卡承担（0.4.1 在 rc.1+ 实为无 UI，本版补齐）。4 键表单（3 布尔 + 1 文本），数据读写走自家 webServer 桥 `/api/dsh-preset-doctor-settings/*`（POST-only + loopback 守卫 + describe 出口解包 + mutate 键白名单）。manifest `dsh.client.inject` 非空（`@deepseek-ai/dsh-client-ui-renderer`，六线 cell 全存在）——空数组 = client 永不编组（§9 教训）
- **活配置源**：`current` 闭包可变，`setSource` 换绑后 `/preset-doctor` 与启动扫描即读新值，改设置无需重启；rc.1+ 语义不变（volatile 引用每次扫描前重新解引）
- **peers/兼容声明**：`dsh.compatibility.dshReleases` 15-rc 全枚举；engines/peers 不变（`>=0.1.1-rc.1` / cordis `>=4.0.1 <5` 无栅栏）
- 测试 91 例（新增 9：三代分支特性检测互斥 + setSource 换绑时序 + 桥 describe 解包/ns 过滤/白名单拒绝/loopback 守卫 + client 语法）
- **farm 五格实测（0.5.0.r2）**：五格 boot 零 fail；分支遥测各归其位（0.1.0/0.1.1 `register`、0.1.2/0.1.5 `installSection`、0.1.7 静默）；桥 describe 纯值 + mutate 回环 5/5 PASS；浏览器实测 0.1.5/0.1.2 设置页卡派发 + 表单交互 + UI 保存落盘（scanProfiles/migrateLegacy 翻转均持久化还原）、0.1.7 插件页卡渲染 + UI 保存落盘。0.2.0 走 desktop 通道（Electron 应用内），槽位契约与 0.1.7 逐字一致（宿主源码），待用户桌面复验

## 0.4.1 (2026-10-05)

修复六线宿主启动阻断（0.1.0-rc.8 / 0.1.1-rc.2 / 0.1.2-rc.1 / 0.1.5-rc.3 直接 fatal，
0.1.7+ 宿主降级为 `entry did not activate` 警告 + 插件整体失效）。

- **根因**：`/preset-doctor` 命令注册用 `ctx.commands?.register` 做 fail-open 守卫，但
  commands 服务只在宿主 web/desktop 装配面存在，headless CLI 启动的 fiber 祖先链上没有它
  ——严格 ctx 代理在**读取属性一步**即 throw（`cannot get property "commands" without
  inject`），可选链防不住，loader entry 判 failed。
- **修复**：改用 `ctx.get('commands')` 探测（cordis reflect mixin，缺失返回 undefined、
  永不 throw、与 inject 无关，惯用法同 dsh-skills-manager），外罩窄域 try/catch 防退化
  宿主（catch 只吞代理拒绝文案，其余错误原样上抛）。`inject` 保持空。
- **顺修 `resolveDshHome` 落点**：`homeOverride` 未设置（宿主 settings 投影给空串）时，
  `??` 对空串不穿透导致 `DSH_HOME` 环境变量从不生效、一律落到 `~/.dsh`——改用 `||`
  穿透（DSH_HOME 是宿主家目录契约；沙盒/多实例场景恢复正确落点）。
- **效果**：六线 CLI 上插件 entry 真激活、核心启动扫描/自动修复照常运行；`/preset-doctor`
  命令在装配了 commands 服务的宿主面（web/desktop）照常注册，CLI 面自然降级。
- **⚠️ 老线用户注意**：0.1.1–0.1.5 线此前该插件从未成功激活过；升级到此版后**首次真激活**，
  启动扫描将首次对真实 `~/.dsh` 生效——机械可修的失效预设会被自动对齐到当前语法（备份
  `.bak-*` + 原子写 + 幂等为既有设计；只想先看报告可在 settings 关闭 autoFix）。
- 声明面消漂移：dsh.plugin.json version 0.3.0 → 0.4.1、engines.dsh `>=0.1.7-rc.1 <0.1.8-0`
  → 与 package.json 一致（`>=0.1.1-rc.1`）；测试桩 mockCtx 补忠实 `get` 访问器（82 例全绿）。

## 0.4.0 (2026-10-01)

适配分支：按宿主主线分 branch（peer / 处理终点 / 算法档位 各不相同）。

- **分支表**（src/tables/branches.json，只追加不改历史）：main（0.2.0）、dsh-0.1.7、dsh-0.1.5、dsh-0.1.2、dsh-0.1.1 五个分支，各带 hostRange（版本选择范围，连续拼接无洞）、endpoint（处理终点 = 该线终版 rc）、peer（vendor/cordis 实证版本：4.0.4 / 4.0.4 / 4.0.2 / 4.0.2 / 4.0.1）、stages 算法档位
- **算法档位**：声明式分支（main/0.1.7）= patch span 修复 + 遗留目录 L1+L2 迁移；目录分支（0.1.5/0.1.2/0.1.1）= 目录是原生格式，不迁移不扫 patch，对 agent.cordis.yml **就地修**表内令牌（新 parseDirComposition 源 + span 编辑复用既有写安全契约）；相对本地路径在目录分支是合法语义（file:// 要求自 0.1.7 始），不再误报 R-LOCAL-PATH
- **事件表按分支终点截断**（仅内置条目；用户自救表不截断——显式覆盖运行环境判定正是自救的本意）：0.1.2 分支看不到 persona 事件（0.1.3-alpha.2 才断裂），不会把本线合法的 text 误修
- **运行宿主版本探测**（host-version.js，fail-soft）：检不出 → 回退 main（与 0.3.x 行为一致）；实测本机 0.1.7-rc.2 → dsh-0.1.7 分支
- 报告新增分支行（id / 线 / 处理终点 / peer / 格式 / 检出版本）；0.1.6-alpha 宿主落 dsh-0.1.5 分支（旧包名由运行安装门禁判定，两端皆安全）
- **首发五线 dist-tag**：单一 0.4.0 服务全部宿主主线（`latest` + `dsh-0.2.0` / `dsh-0.1.7` / `dsh-0.1.5` / `dsh-0.1.2` / `dsh-0.1.1`）；peer 放宽 `>=4.0.1 <5`、`engines.dsh` 声明 `>=0.1.1-rc.1`（五线 span，与分支表一致）
- 测试 82 例：分支解析 / semver 范围边界 / 事件表截断 / dsh-0.1.5 就地修（v0.1.2 快照跨线）+ 本线原生 0 findings / dsh-0.1.2 全表截断空转；既有套件钉 branch:'main' 与宿主机解耦
- 修正：eras 注释中「0.1.5 含 1 个 text 滞后样本」与实际提取不符（4/4 全 prefix）；CHANGELOG 重复的 0.2.0 小节重编号为 0.2.1

## 0.3.0 (2026-09-30)

变更日志闭环 + 影子 id 检测 + 四时代真实分支数据。

- **四时代真实 fixtures**（tests/fixtures/eras/，deepseek-harness 真实快照）：v0.1.2-rc.1（text: >- 折叠标量 + 旧包名）、v0.1.5-rc.3（prefix 主流 + 1 个官方线自己的 text 滞后样本——令牌驱动优于时代标签的实证）、v0.1.7-rc.2、v0.2.0（origin/master，与 0.1.7-rc.2 四文件字节一致）
- **修复真缺口：迁移路径 L2 漏了配置键改名**——text 时代真实预设迁移后残留已删键（era 测试抓出）；补 `applyKeyRenamesToComposition`（与 planner 同语义，迭代单目标）
- 修复 yaml 自定义标签匹配：`!!js` 短名不命中展开形式 `tag:yaml.org,2002:js`（此前靠未知标签兜底保真但每次解析刷警告）；现在 `!!js true` 字节级往返
- era 测试统计递归修复（workflow 行嵌在 group 的 config 列表里）

## 0.2.1 (2026-09-30)

- **table-build 维护者工具**（`npm run table-build`，不随包发布）：对 DSH 两版官方预设做包引用集合 diff，自动提案 `package-rename` 变更条目（一删一增才配对，歧义进 unpaired 不猜；跨预设去重）。实测校准：`0.1.5-rc.3→0.1.6-alpha.1` 自动重发现历史改名 F；`0.1.7-alpha.1→0.2.0-rc.2` 空提案与字节级复核一致。提案需人工核对后追加——变更日志只增不改的信任锚点不变
- **R-ID-SHADOWED**（report 级）：预设 id 与安装内置预设同名时声明不生效（断裂点 B，0.1.2-alpha.1 f94495e527，「卡片看不见」的常见原因）；数据源为运行安装内 dsh-web-app/presets，fail-soft
- table-build 修复：旧三代布局 basename 相互覆盖（改用完整 git 路径做 key）；注释性路径（xxx/package.json）误入包引用
- 进程内冒烟步骤文档化（npm -g 与 dsh plugin add 两种路径）

## 0.2.0 (2026-09-30)

架构重构：面向版本漂移的可扩展设计。

- 迁移表改为**追加式变更日志**（changes.json，`brokenIn` + from/to 事件）：新版 DSH 只追加条目，历史不改写；不再有「版本对」快照的 N×N 维护负担
- **链式收敛**：A→B→C 自动解析到终点，0.1.0/0.1.2/0.1.5/0.1.7 四个时代的预设同表收敛到当前安装（测试固化）
- 门禁相对运行实例：旧名已死 + 新名存在才自动修；旧名仍活（老安装）不误伤；两者皆死报 MISSING 并提示改名候选
- **用户自救表** `$DSH_HOME/preset-manager/tables.user.json`（同名 from 覆盖内置，损坏回退）
- 报告新增**起点时代判定**（每预设「写于 ≤X」+ 跨越节点列表）
- 修复：行 span 替换吞行尾换行导致与下一行拼接（多行用例暴露）；semver 预发布比较（0.1.3-alpha.2 < 0.1.3）
- 0.2.0 漂移复核：standard.patch.yml 在 dsh-v0.1.7-alpha.1 与 dsh-v0.2.0-rc.2 字节级相同（git 双 tag 验证）

## 0.1.0 (2026-09-30)

首个版本。

- 启动自动扫描三层声明源（home patch / profile patch / 遗留 `.agent-presets/` 目录）
- 检测规则：R-LEGACY / R-PKG-RENAMED / R-KEY-RENAMED / R-LOCAL-PATH / R-PKG-MISSING / R-DUP-ID / R-STRUCT / R-YAML
- 自动修复：旧格式结构迁移（L1+L2 一次到位）、包名+行 id 改名、persona text 拆分、本地路径 file:// 改写
- 写盘安全：.bak 时间戳备份、tmp+rename 原子写、幂等、UTF-8 无 BOM、行尾保持、文本级 span 替换保真 `!!js` 标签
- `/preset-doctor [scan|fix]` 命令；schemastery 设置（autoFix / scanProfiles / migrateLegacy / homeOverride）
- npm 名 `dsh-preset-doctor` 实测无冲突（2026-09-30）
