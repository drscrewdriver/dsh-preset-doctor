# Changelog

## 0.9.4 (2026-11-14)

宿主声明改有界区间（版本上下限改造）：双清单 `engines.dsh`（`package.json` / `dsh.plugin.json`）由逐 21 档 rc 精确枚举改为 `>=0.1.0-rc.2 <0.3.0`（下限＝原枚举起点，上限不含 0.3 线），0.2.x 线上后续 rc 无需重发版即可安装；renderer peer 仍 optional 且不动。纯元数据发版，代码零改动；node --test 216/216 绿。

- i18n: add Portuguese (pt-BR) locale — package metadata and README mirror.

## 0.9.3 (2026-11-09)

**从「能看见」到「能改」，且显示跟随行开关**。

- **卡内就地编辑**：每段提示词后面多一个「编辑」→ 展开 textarea（带原全文）→ 「保存到 patch」。走新桥路由 `/prompt-write`（confirm 硬门 + loopback 守卫），落盘仍是 **span 替换**：只换该值那一段字节，同文件注释/缩进/其它行一字不动；写前 `.bak-<ts>` + 原子写；同内容再存 → `skipped`（幂等）。
- **保形**：块标量沿用原指示符（`|` / `|-` / `>`）与内容缩进；单行标量仍单行（单引号转义）；单行改多行 / 多行改单行自动换形态；行尾跟随文件（CRLF 写 CRLF）。
- **拒写**：缺 confirm、清空正文（宿主 `persona.prefix` / `plan-mode.section` 要求非空）、非提示词键（防误改 `fetch`/端口/id）、带自定义标签的值（`!!js` 表达式，改写会抹掉条件）。
- **显示跟随 enable**：条目按所属行的**解析值**（`effective`）分组——停用的段补「停用」标、名字划掉、下沉到启用段之后，且**不计入**「N 段」。这正是官方 `minimal` 那两个工具说明的处境：`persistent-bash` 带 `disabled: !!js process.platform === 'win32'`，Windows 上就是停用。汇总行改为 `系统提示词（N 段 · 随行停用 M · 注入 K 条）`。
- 修一个定位 bug：提示词值要从 `configNode` 取（不是行节点本身），否则除首行外一律「取不到值」。
- 测试 +6（216 全绿）：块标量保形 + roundtrip + 幂等、单行引号转义、单→多自动转块、CRLF、四条拒写、span 起点不碰键名。


## 0.9.2 (2026-11-09)

**把工具说明也算进提示词面**——之前只收 persona/plan-mode，漏了工具行覆写的 `description`（模型可见的工具说明）。

- 宿主源码核验（`deepseek-harness` 0.2.0/0.2.1）：由预设 config 驱动、真进模型的只有三处
  - `dsh-persona` 的 `prefix` / `suffix`（`packages/preset/persona/src/index.ts:66,72`）
  - `dsh-plan-mode` 的 `section`（`packages/plan/plan-mode/src/index.ts:72,191`）
  - 工具行的 `description`（`tool-bash-persistent` / `tool-pwsh-persistent` / `tool-str-replace-editor`，源码注释写明 *Model-facing tool description*）
  其余 `tool-*` 的 guidance 是代码里的静态段，不读 config。
- `prompt-text.js`：`description` 入白名单，但**排除预设声明行本身**的 `config.description`（那是面板文案，不是提示词）；条目新增 `kind`（persona / plan / tool / text）。
- 卡面：提示词段后面多一个小标（人设 / 计划模式 / 工具说明）。
- 实证：官方 `minimal` 预设从 1 段变 3 段 —— `persona.prefix[persona] + persistent-bash.description[tool] + persistent-pwsh.description[tool]`。
- 测试 210 全绿（断言补：工具 description 收录、预设元数据不收录、kind 归类）。


## 0.9.1 (2026-11-09)

**「系统提示词」框落到预设卡里，位置在行开关之后**（0.9.0 只在卡外列了注入目录，看不到 patch 里的提示词本身）。

- **patch 侧提示词段**：新增 `src/rules/prompt-text.js`，按预设行区间读出 `config` 里的提示词——已知键名（`prefix` / `suffix` / `text` / `section` / `prompt`…）不限长度，未知键名要求多行且 ≥200 字（自定义行也能兜住）；`description` / `fetch: true` 这类元数据不误扣。只读、不插值（`{{model}}` 按原文展示）。
- **卡面**：`PresetCard` 在行开关（`CompDetails`）之后渲染 `PromptBox`——默认展开，汇总「N 段 · 注入 M 条」，逐段列 `行id · 键（字数）+ 预览`，再列注入条目（`名称 role/order 字数`，关闭划掉、格式问题标 ⚠）。
- **全局注入区收窄**：卡外只剩「其他注入目录（未挂到预设卡）」——未接线、目录不存在、无归属的才出现在这里，不再与卡内重复。
- 真机实测（`~/.dsh`，5 个自建预设）：每个预设读出 `persona.prefix` + `plan-mode.section` 两段（1.3k～2.4k 字），框立刻有内容。
- 测试 +2（210 全绿）：按区间归组/区间隔离、已知键不限长 + 未知键长文本兜底。


## 0.9.0 (2026-11-09)

**新能力：读取预设里的提示词并校验格式**——对齐 `dsh-preset-studio` 的「注入」结构（`<预设目录>/注入/*.md` + 一行 `name: 'dsh-preset-studio/inject'` 的投递器）。原先 doctor 只看 patch 里的插件行；提示词写坏了（frontmatter 缺失、BOM、role 写错、同名重复）投递器是**沉默**的，UI 只表现成「这条提示词好像没生效」。

### 为什么是「对齐投递器」而不是「自己定一套校验」

判定权在消费方。`packages/studio/inject.js` 的实际读取行为是：

- frontmatter 必须是文件首行 `---` 围栏（**BOM 顶掉首字符就整篇丢弃**）
- 只读顶层**单行标量**：`name` / `role` / `order` / `enabled`（块标量、嵌套映射一律读不到）
- `role` 只认 `system | user | assistant`，其它**静默降级为 system**
- `order` 非数字**归零**，与所有没写号的条目同段位，先后由文件名决定
- `enabled` 拼错（如 `ture`）读不出时**按启用**——以为关掉的注入还在生效
- 正文全空的文件直接跳过；贡献名是 `custom-inject:<name>`，投递器不做去重

所以 doctor 的读取器（`src/prompts/frontmatter.js`）逐字段复刻这套语义，报出来的就是「投递器会怎么读」，不是另一套猜测。

### 新规则（`src/rules/prompt-injection.js`）

| 规则 | 触发 | 处置 |
|---|---|---|
| `R-INJECT-BOM` | 文件头带 UTF-8 BOM（投递器 `^---` 失配） | **自动**去 BOM（写前 `.bak`、原子写、幂等，其余字节不动） |
| `R-INJECT-FORMAT` | 无 frontmatter / 围栏未闭合（文件被静默丢弃） | 只报告 |
| `R-INJECT-EMPTY` | 正文为空（只有 frontmatter） | 只报告 |
| `R-INJECT-FIELD` | role 降级、order 非数字、enabled 拼错、字段写成块标量 | 只报告（带行号） |
| `R-INJECT-DUP` | 同一目录内贡献名重复（`custom-inject:<name>`） | 只报告 |
| `R-INJECT-ORDER` | 同 role 同 order（先后由名称决定） | 只报告 |
| `R-INJECT-VAR` | 正文里出现 `{{model}}` / `{{cwd}}`（投递器 `interpolate:false`，占位符原样进提示词） | 只报告 |
| `R-INJECT-DIR` | 缺 `config.dir`、`~`/`%VAR%` 不展开、相对路径按进程 cwd 解析、目录不存在 | 只报告 |
| `R-INJECT-EMPTY-DIR` | 目录无 `.md`，或全部 `enabled:false`（行在、投递 0 条） | 只报告 |
| `R-INJECT-UNWIRED` | `<home>/presets/<id>/注入` 有提示词，却没有任何投递器行指向它 | 只报告 |

### 消费面

- **扫描**：`src/scan.js` 逐源跑投递器行（按行区间归属到所属预设）+ `checkUnwiredPromptDirs` 扫 studio 默认根 `<home>/presets/<id>/注入`；结果落 `scanResult.promptDirs`（目录 → 条目清单：名称/角色/段位/开关/字数/变量）。
- **报告**：`renderText` 新增「预设提示词（注入）N 处」块（逐目录 + 逐条 `· 名称 role/order N 字`，关闭标 `x`、问题标 `⚠`）；`summary.prompts` 同步进 JSON。
- **卡面**：`lib/client.js` 新增「预设提示词（注入）」卡片区（已接线 / 未接线 / 目录不存在 + 条目明细）；注入问题还按 `data.presetFile`+`data.presetId` 挂回所属预设卡，不再出现「提示词坏了但预设显示已同步」。
- 只读承诺不变：除 BOM 清理外，全流程零改写用户提示词；写盘仍只经显式确认（卡内同步 / `/preset-doctor fix`）。

测试 +12（208 全绿）：读取器对齐（围栏/标量/布尔/数字）、正常清单、BOM 修复幂等、三种静默丢弃、字段三类写错、块标量、重名/同段位、`{{cwd}}`、缺 dir/目录不存在、空目录与全关、未接线、问题挂回预设卡。


## 0.8.3 (2026-11-08)

两条主线：**① 预设组合识别与对齐的语义收口**（bundle 层禁用并入判据、真值表 + disable 退避、子路径导出存在性、开启硬拦、预设级删除，见下方「 0.8.3 主体」）；**② 全组件地图与升级观测**（本轮新增）。

全组件地图：把「官方组件 ↔ 预设行 id ↔ 逐版本导出」扒干净。

### 结论先行：版本识别已有，地图不当判据

- 「这一行在当前宿主能不能起」**继续只看运行时探真**（`resolvePkg` 解析包体 + 读该包 `exports` 判子路径）。它是版本自适应的零维护真值，比任何静态表都准。
- 静态地图只补运行时拿不到的三件事：① **id → 包名/子路径**（缺行提示与将来自动补齐的必需品）；② **组件分级**（runtime/core/tool/client/experimental/provider/api/command/policy）；③ **跨版本演进**（某包/某子路径在哪个版本有/没有）。

### 新表：`src/tables/component-map.json`

三源合并（都是本地真值）：

| 源 | 版本 | 包 | 预设 |
|---|---|---|---|
| deepseek-harness 源码树 | 0.2.0-rc.2 | 318 | 4 |
| CLI 全局安装 bundle | 0.2.1-rc.5 | 305 | 4 |
| DSH Desktop `app.asar` | 0.2.2-rc.1 | 329 | 4 |

规模：381 个包（去重）、44 行（四份官方预设并集）；分级 core 220 / client 75 / experimental 42 / tool 28 / api 10 / command 3 / runtime 2 / policy 1。

**扒出来的两份真值很有用**：
- `tool-subagent-list-agents`（`dsh-tool-subagent-control/list-agents`）：`0.2.1-rc.5` ✓ / **`0.2.2-rc.1` ✗**——0.2.2 把 `./list-agents` 从 exports 删了，可 0.2.2-rc.1 自带的 standard 预设仍然列着这一行（上游自己的预设与宿主错位）。
- `tool-schedule`：`0.2.0-rc.2` ✗ / `0.2.1-rc.5` ✓ / `0.2.2-rc.1` ✓——新版本才有的组件。

### 生成器：`tools/component-map.mjs`（不随包发布）

- 纯函数导出（`categorize` / `splitSpec` / `exportsHas` / `extractPresetRows` / `readInstallScope` / `openAsar` / `readAsarScope` / `collectPresets` / `buildComponentMap`）+ CLI 入口；
- 预设行提取递归组行（`cordis:group` 的 `config` 直接是行表）；
- asar 直接手工解 pickle 头读文本（不依赖 Electron）；
- 三源自动探测（`--repo` / `--cli` / `--asar` 可覆盖，`--no-*` 可关，`--print` 打表）。

### 消费面（薄）

- `tables/load.js`：`loadComponentMap()` / `componentFor(id)` / `componentNameOf(id)`。
- `classifyComposition`：每行新增 `name`（包声明名，含子路径）与 `cat`（分级）；新增 `missingNames`（缺行 + 该写哪个包 + 分级），`missing` 保持原形不破兼容。
- UI：缺行提示从「一堆 id」改为 `id（包名）`；不可用行的 tooltip 带包名与子路径。
- 测试 +6（195 全绿）：表骨架/行记录完整性/两条跨版本真值/工具函数（组行提取、exportsHas）/`missingNames` 透出包名。

### 升级观测（README + 报告）

宿主升级后「预设到底存在哪」会变（落点/格式/内容三样同时变），但之前只能靠手摸。本次：

- **README 新增「升级观测清单：预设『存在哪』会随版本变」**：三代落点表（≤0.1.6 `.agent-presets/<id>/` → ≥0.1.7 `$DSH_HOME/cordis.patch.yml` → ≥0.2.0 `profiles/<name>/cordis.patch.yml`）、三个高频坑（改错 profile / 旧目录残留顶掉新声明 / 把官方 shipped 预设当自己的落点）、升级后五步；另附 `tools/component-map.mjs` 的维护者用法。
- **扫描报告新增「扫描源 N 处」块**：逐行 `[home] / [profile/<名>] / [legacy-dir]` + 文件路径 + `行 N · 预设 M` + 解析错误数（`summarize()` 新增 `sources` 字段）。无 sources 时整块不输出，旧调用不破。
- 测试 +1（196 全绿）：`renderText` 扫描源块（含 profile 名、legacy-dir、无 sources 不输出）。
- README 杂项校正：peer 串补到 `0.2.2-rc.1`；dist-tag 表改为「以 `package.json` 为准」。

> 已发布 npm：`dsh-preset-doctor@0.8.3`（dist-tag `latest`）。开发期装机件用过 `-local.N` 后缀（让 pnpm 重装），发版已统一回落为 `0.8.3`。

### 0.8.3 主体：bundle 层禁用 + 组合识别（2026-11-06 起）
第二层判据：profile bundle 层定向禁用（hostDisabled）并入识别机制。

- **0.8.2 在 desktop 形态不触发的真因（装机实证）**：宿主 asar 内置 `@deepseek-ai/dsh-tool-subagent-control`，Electron 内可解析性判据恒 ok；真正把行杀死的是 `dsh-experimental-agent-team-profile` 自带 cordis.patch.yml 的顶层定向覆盖（`tool-subagent-control`/`list-agents`/`tool-subagent`/`tool-subagent-fork` 全部 `disabled: true`）——包活、行被全局禁、启用即 never started。
- **`collectBundleDisabledIds(profileRoot)`**（pkg-resolve.js）：读 profile package.json 的 `dsh.profile.bundles` → 逐包自带 cordis.patch.yml → 收集顶层 id+disabled:true 覆盖行 id 集；insert 条目不入集；读不到/解析失败 fail-open。
- **`rowUnavailable(row, resolvePkg, hostDisabled)`**（composition-drift.js）= 包不可解析 ∥ bundle 禁用；classify 行新增 `hostDisabled`/`unavailable` 字段，defaultOn/triState 改按 unavailable 派生（pkgMissing 保留原语义）。对齐（planAlignForPreset/CustomPreset）与 follow 档同步换用 rowUnavailable。
- **src/index.js**：按源文件所属 profile 推导 bundle 禁用集（全局层→空集），list/align/toggle 三路透传；同文件多预设缓存只读一次。
- **UI**：不可用行徽章区分两种来源——「宿主层已禁用」（bundle 接管，tooltip 说明包可解析但不会启动）与「宿主不提供」（包不可解析）。
- 测试 +4（hostDisabled 分类翻转/collectBundleDisabledIds 收集与 fail-open/包全活但禁用仍删/follow 写 disabled）；164 例全绿，lint 干净。

### 0.8.3 追加项（2026-11-08）

> 本段开发期的装机件用 `-local.N` 后缀逐版推进（同版本号重打 tarball 不会被 pnpm 重装）；发版已统一回落为 `0.8.3`。

起因：装机桌面形态实测——doctor 迁移出的自定义预设（standard-win 系列）全部丢了 `command-goal` 行，`/goal` 消失，而卡面仍显示「已同步当前」。三件事同根：① 自定义预设识别盲区；② 对齐不再删行；③ 启停解析改为真值表。

#### ① 自定义 id 预设盲区修复

- `classifyComposition` 的 `missing` 早先只按 `baseline.presets[pid]` 算，自定义 id 恒为空集 → 官方行整行丢失也报「已同步当前」；现统一按参照预设（内置→自身；自定义→`inferRefPid` 推断）计算，新增 `missingRef` 回报参照来源。
- 自定义 id 预设的行不再一律算 `custom`：曾是官方行（任一内置预设任一版本）而当前版本彻底不活 → `drift(removed)`，仅更晚版本才活 → `drift(introduced)`，使卡面「漂移 N」与对齐按钮对自定义预设生效。
- `runAlign` 早先无条件走 `planAlignForPreset`，自定义预设 `baseRows` 为空 → 直接 `return empty`（点「对齐」完全 no-op）；现按 `baseline.presets[presetId]` 是否命中路由到 `planAlignForCustomPreset`，并透传 `removedHostMissing`/`missingRef`。

#### ② 对齐不再删行

- 新 `makeStateEdit`（row-edit.js）统一实现「只改 `disabled` 值，不碰行本体」；`planAlignForPreset`/`planAlignForCustomPreset`/`runResolveLegacy` 三路均改用它，注释 / `!!js` / 缩进 / 行本体原样保留，用户恢复只需把档拨回「开启」。`removed` 字段名沿用（现语义为「本次新落盘停用」），已落盘的行不计入以保持二次 noop 幂等。`runDelete`（显式删自定义行）不变。

#### ③ 启停解析：真值表 + disable 退避（用户定案 2026-11-08，含两次修订）

解析值只看「官方态」（id 在不在参照默认集）——**无值（无 `disabled` 键）时官方停用就是 false**：

| 官方 | 预设 | 解析 | 对齐 |
|---|---|---|---|
| true（在参照默认集）| 无值 / false / true | 跟随预设声明 | 不动 |
| false（不在默认集，含已移出）| 无值 | **false** | 退避 `disabled:true` |
| 空（任何内置预设任何版本都无此 id）| 无值 | false | 退避 `disabled:true` |
| 宿主不提供（包不可解析 / bundle 层禁用）| — | false | 退避（安全档优先）|

**退避不给强制开例外**（用户选定）：连 `disabled: false` 也覆写为 true；已显式 `disabled: true` 的行无改动以保持二次 noop。

- **三档载体重定**：无 `disabled` 键 = 跟随（写盘=删键）；`disabled: false` = 强制开；`disabled: true` = 强制关；值为 `!!js` 表达式 = `dynamic`（第四态）。`rowDeclaredState` 返回 `absent|false|true|dynamic`；`makeStateEdit` 统一三态写入与幂等（对 dynamic 返回 null）；`runToggle` 对 dynamic 行三档全拒（status `dynamic-value`，零写盘）；旧布尔入参 `disabled:false` → follow，保持历史行为。
- **classify 新字段**：`declared` / `dynamicValue` / `dynamicResolved` / `platformDisabled` / `platform` / `effective` / `alignable` / `inRefSet` / `baselineUncovered`；`defaultOn` = 在参照默认集 且 宿主提供。
- **参照预设推断 `inferRefPid`**（新）：自定义 id 预设的参照不再写死 standard——按「覆盖率（本预设行集中能被该官方预设解释的比例）→ 共有行数 → 并列优先 standard」选官方预设。写死 standard 会把从 minimal/ptc 迁移出的预设的能力行误判“官方停用”而全部退避。实盘：`simple-reply` 推断为 minimal、`standard-win-flash` 为 ptc、其余为 standard。
- **平台求值**（用户追加定案）：`evalPlatformDisabled(value, platform)` 只认单一 `process.platform` 比较（`===`/`!==`/`==`/`!=`），按当前运行平台**算完 true/false 再提交解析值**；复合表达式（`||`、环境变量等）一律返回 null 不猜。实盘：`standard-win`/`-flash` 的 `tool-bash` 在 win32 下解析为停用、`tool-pwsh` 为启用（与宿主实际行为一致）。
- **两条护栏**（没它们会把好预设改废）：
  - `rowIsThirdParty`：id 未见于基线但 `name` 属 `@deepseek-ai/*` 或 `cordis:` 虚拟行 → 归 `baselineUncovered`，**不退避**（否则 `simple-reply` 的 `fs-local`/`str-replace-editor` 这类基线表从 0.1.7 起未收录的旧官方工具会被关掉）。
  - `dynamic` 行一律不改写（追写第二个 `disabled` 键是非法 YAML，覆写则抹掉跨平台条件）。
- **回传字段改名**：`keptDrift`/`disabledNoBaseline` → `disabledOfficialOff` + `guarded`（护栏保留行清单），`runAlign`/`runResolveLegacy` 同步透传。

#### ④ 类型+版本适配：子路径导出存在性（装机实证驱动）

起因：`tool-subagent-list-agents` 一拨「开启」，整条预设立即从可用预设列表消失。实测：桌面 `app.asar` 内 `@deepseek-ai/dsh-tool-subagent-control` 是 **0.2.2-rc.1**，`exports` 只有 `.` / `./src/*` / `./package.json` / `./locale/*.json`——**无 `./list-agents`**；而 CLI 全局那份 0.2.1-rc.5 有。旧判据 `resolvePkg(pkgPart(name))` 只看包本体 → 误判“可用”，开了就 never started。

- `subPathOf(name)` / `subPathExported(pkgDir, sub)`（新）：按包 `exports` 判子路径导出存在性（精确键 / `./x/*` 模式 / conditions 层）；无 `exports` 字段回落文件存在性；读不到包 fail-open。
- `resolvePkg` 现接受完整名：包体在但子路径缺失 → `{ ok:false, subpathMissing:true }`；`rowPkgMissing` 改为**传完整 name**（不再先取 pkgPart），`rowUnavailableReason` 回报 `'subpath' | 'pkg' | 'bundle' | null` 供文案。
- `candidateRoots` 新增 **Electron `process.resourcesPath`** 基座（app.asar / app / app.asar.unpacked 下的 node_modules）并**排到最前**，同时展开其 bundle 内层——不加就会拿 CLI 全局那份不同版本副本作判据（同一包两版本 exports 表不同）。

#### ⑤ 开启硬拦：不允许把根本起不来的行拨成启用

- `runToggle(mode:'on')` 对 unavailable 行 → `status:'host-unavailable'` + 成因回报，**零写盘不备份**（旧行为：删键或写 `disabled:false`，直接把整条预设弄死）。
- `runToggle(mode:'follow')` 对 unavailable 行 → 退避为写 `disabled:true`（删键等于把死行交回宿主加载）；已停用再操 → `already-disabled` 幂等。
- UI：不可用行的「开启」按钮置灰，tooltip 区分 bundle 禁用 / 子路径无导出 / 包不可解析三种成因；「跟随」tooltip 说明此档会退避落盘。

#### ⑥ 预设级删除（新增动作）

- `runDeletePreset(scanResult, {file, presetId, confirm, allowDefault, dryRun, ts})`：整块删除一条预设声明（含其全部插件子行），与行级删除同一安全模型（confirm 硬门 + `.bak` + 原子写 + 区间外注释不动）。
- 护栏 `registryDefaults(scanResult)`：被 `agent-preset-registry` 的 `default`/`selectedDefault` 指着的预设默认拒删（`status:'is-default'`，需显式 `allowDefault:true`）。
- 配套：`scan.js` 新增 `src.overrideRows`（顶层 id 定向覆盖行以前根本不收集，所以读不到 profile patch 里的 `selectedDefault`）；`report.js` 预设视图新增 `isDefault`；桥新增 `delete-preset` 路由；卡面「删除预设」双确认（被默认指着时多一道确认）。
- **顺带修一个旧缺陷**：桥的 `delete` 路由一直在等 `ext.runDelete`，但 `index.js` 从未接线 → 行级删除实际返回 `delete provider not wired`；现已补上 `runDeleteAction`。

#### ⑦ 事故：client 半边语法错把整个应用打死（local.5 → local.6）

`0.8.3-local.5` 装机后宿主启动失败：`web boot: 1 entry did not activate / dsh-preset-doctor: import failed`，renderer console 的真因是 `dsh-preset-doctor/client.js:295 Uncaught SyntaxError: Unexpected token ')'`——我上一轮改「开启」按钮 tooltip 时写了一个缺 else 分支的嵌套三元：`(r.hostDisabled ? 'A' : r.pkgMissing ? 'B')`。

为什么没被门禁拦住（已修补）：
- `eslint.config.js` 的 `ignores` **含 `lib/`**，client 半边根本不参与 lint；
- 单测只 import `src/`，从不加载 `lib/client.js`；
- 于是这类错误只能在**宿主下一个启动**才暴露，代价是整个应用起不来。

修补：三元拆成 `unavailableRow` + `why` 两个局部常量（不再嵌套）；新增 `tests/syntax.test.js`：对 `src/` + `lib/` 每份 .js 逐个 `node --check`，并校验双清单版本一致与入口文件存在——这类错误现在会在 `node --test` 阶段就挂。

#### ⑧ 版本适配收口：asar 里宿主包在 `app.asar/dsh/node_modules`（local.6 → local.7）

④ 的根集只加了 `<res>/app.asar/node_modules`，但桌面真布局是：

```
resources/app.asar/dsh/package.json            → @deepseek-ai/dsh-desktop-runtime 0.2.2-rc.1
resources/app.asar/dsh/node_modules/@deepseek-ai/*   → 331 个官方包真身（宿主实际加载的那套）
resources/app.asar/node_modules/               → 存在，但不含宿主本体依赖
```

于是 `resolvePkg` 只能报“包不可解析”（`pkg`），报不出准确的“该版本无 `./list-agents` 导出”（`subpath`），宿主版本探测也会漏掉 0.2.2-rc.1。

- 新增 `electronRoots(resourcesPath)`：逐 `app.asar` / `app` / `app.asar.unpacked` 扫子目录，`package.json.name` 以 `@deepseek-ai/dsh` 开头即视为宿主 bundle → 收 `<bundle>/node_modules`；再收 `<base>/node_modules/@deepseek-ai/dsh*/node_modules`；最后收 `<base>/node_modules`。**不硬编码目录名 `dsh`**，换布局不碎。
- `candidateRoots` 改用 `electronRoots` 结果排最前；`host-version.js` 的资源通道同步换用（桌面宿主版本得以报 0.2.2-rc.1）。
- **真实数据验证**（把 asar 里的真 package.json 抽到临时目录复刻布局，跑装机同源代码）：
  `dsh-tool-subagent-control` → ok=true；`…/list-agents` → ok=false + subpathMissing=true；成因 `subpath`；对照片 `tool-subagent-control` 成因 null（不误伤）；`detectDshVersion` → 0.2.2-rc.1。
- **UI（lib/client.js）**：`alignCount` 按 `alignable`；摘要「漂移 N（退避停用）/ 宿主不提供 N / 官方空 N / 表达式 N（已按平台求值 M）/ 护栏保留 N / 缺官方行 N（参照 X）」；按钮「对齐：退避停用 N 行（宿主不提供 X、官方停用/已移出/官方空 Y）· 护栏保留 Z 行不动」；确认框写明“连 disabled:false 也覆写”与推断出的参照预设；状态位四分「解析·启用 / 解析·停用 / 官方空·默认停用 / 基线未收录 / 解析·×（win32）/ 表达式·不可求值」（不再与徽章重复）；三档按钮对 dynamic 行置灰；删除按钮对 `baselineUncovered` 行也不给。
- 未改动：R-COMPOSITION-DRIFT finding 仍只管覆盖内置预设（自定义预设的缺失/漂移走卡面 composition 视图上报，不进 findings，避免 `current`/`syncable` 语义扰动）；缺失行仍只报不自动补（基线表只存 id，无 id→包名映射）。
- 测试：`tests/composition-truth-table.test.js` 重写为 12 例（四态 declared、真值表四档含“不给强制开例外”、两条护栏、`evalPlatformDisabled` 七形态、`inferRefPid` 三例、runToggle 对 dynamic 行零写盘）；新增 `tests/host-unavailable-and-preset-delete.test.js` 8 例（子路径拆解、`subPathExported` 四种 exports 形态、`resolvePkg` subpathMissing、`rowPkgMissing`/`rowUnavailableReason` 成因、`candidateRoots` Electron 基座优先级、`registryDefaults`、`runDeletePreset` 三道门 + 幂等 + dryRun）；`_stub-resolve.js` 支持“包体活、子路径死”注入；align / host-missing / resolve-legacy / row-toggle / classify 共 5 个旧用例文件按退避语义重写；实盘 dryRun 验证 7 预设：liangshen/simple-reply noop（护栏全部命中），standard-win 系只退避 codex/claude-code/ralph。**187 例全绿，lint 干净**。

## 0.8.2 (2026-11-06)
宿主不提供行识别机制：可解析性并入行分类/对齐/跟随三条链路。

- **背景（桌面宿主实证）**：新建会话报 `agent-preset/invalid: tool-subagent-list-agents (@deepseek-ai/dsh-tool-subagent-control/list-agents): never started`——包在当前安装不存在，但卡面仍标「基准·启用」（基线表只存官方组合声明，看不见 bundle 层 `disabled` 与包缺失），且「对齐」不会删它、报 missing 想把它补回来。
- **`classifyComposition` 新增行级 `pkgMissing`**（rules/composition-drift.js）：复用 R-PKG-MISSING 同源判据（`resolvePkg(pkgPart(name))`）；绝对 `file://` 行改按磁盘存在性判定；`cordis:` 虚拟行/目录时代相对路径不判。基线成员但不可解析→`defaultOn=false`（不再「基准·启用」），triState 诚实派生（盘面未关→'off'，已显式关→'follow'）。未注入 resolver 保守旧行为。
- **对齐（fix/composition-align.js）**：`planAlignForPreset` 新增删除「基线有但包不可解析」行（计入 `removedHostMissing`，不再同时报 missing）；`planAlignForCustomPreset` 对当前活行加同一可解析性门。`runAlign`/`runToggle`（follow 档）经 src/index.js 透传 resolver（测试注入优先，否则真实解析链）。
- **UI（lib/client.js）**：不可解析行加「宿主不提供」徽章；基准徽章 tooltip 注明按停用解析；对齐按钮涵盖宿主不提供行计数；follow tooltip 同步。
- 测试 +7（tests/composition-host-missing.test.js：分类翻转/旧行为回退/虚拟行豁免与 file 存在性/规划层删除/写盘对齐幂等/无 resolver 保守/follow 写 disabled）；160 例全绿，lint 干净。

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
