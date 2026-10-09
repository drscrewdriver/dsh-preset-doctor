# Changelog

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
- **client 半边**（`lib/client.js`，ModuleLoader 纯 JS 无构建，跨代双面）：≤0.1.5 `settings.plugin.item` 卡（key=`preset-manager`）+ `settingsScope.bind` 子 inject；rc.1+ `plugins.row.config`（key=`dsh-preset-manager#preset-manager`）+ `plugins.bundle.config`（key=`dsh-preset-manager`）插件页卡——**0.1.7 设置面板实测无宿主渲染的 volatile 自动表单**，rc.1+ 的可见设置面只能由 client 卡承担（0.4.1 在 rc.1+ 实为无 UI，本版补齐）。4 键表单（3 布尔 + 1 文本），数据读写走自家 webServer 桥 `/api/dsh-preset-manager-settings/*`（POST-only + loopback 守卫 + describe 出口解包 + mutate 键白名单）。manifest `dsh.client.inject` 非空（`@deepseek-ai/dsh-client-ui-renderer`，六线 cell 全存在）——空数组 = client 永不编组（§9 教训）
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
- npm 名 `dsh-preset-manager` 实测无冲突（2026-09-30）
