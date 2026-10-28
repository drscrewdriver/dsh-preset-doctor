# dsh-preset-doctor

**DSH 预设医生**：装载后自动扫描失效的 Agent 预设声明，机械可修的**自动对齐到当前版本语法**（写前 `.bak` 备份、原子写、幂等），不可机械修的逐条报告（文件：行号 + 原因 + 建议）。

适用于 DeepSeek Harness **0.1.1+ 五条主线**（0.1.7+ 声明式 `cordis.patch.yml` 机制；0.1.5 及更早的目录原生格式对 `agent.cordis.yml` 就地修），运行时按宿主版本自选适配分支（见下文）。

---

## 为什么需要它

DSH 0.1.7 把预设机制从「`.agent-presets/<id>/` 目录扫描 + 双文件」整体替换为「`cordis.patch.yml` 声明式注册」，且 0.1.0 → 0.1.7 之间发生过 7 处会让旧模板失效的改动（包改名、persona 配置键移除、本地路径语义等）。失效在 UI 上只显示「加载失败」，**没有行号、没有原因**。

本插件把这些纯机械的事实交给确定性代码处理，全过程**零 LLM 介入**。

## 检测与修复矩阵

| 规则 | 检测内容 | 处置 |
|---|---|---|
| R-LEGACY | 旧格式 `.agent-presets/<id>/` 目录（新机制下根本不注册） | **自动**迁移为 patch 声明（L1 结构变换 + L2 改名/路径改写一次到位） |
| R-PKG-RENAMED | 引用包名命中迁移表（如 `dsh-workflow-worker-thread` → `dsh-workflow-ptc`） | **自动**替换包名 + 同步行 id |
| R-KEY-RENAMED | `persona` 的 `config.text`（0.1.3-alpha.2 起移除） | **自动**拆为 `prefix` + `suffix`（独立 cwd 行进 suffix，其余进 prefix） |
| R-LOCAL-PATH | `name` 以 `./`/`../` 开头 | **自动**改写为绝对 `file://` URL，并标记「插件 API 未验证」 |
| R-PKG-MISSING | 包在运行安装/profile node_modules 均不可解析，且不在迁移表 | **只报告**（a 替换 / b 删除 / c 确认第三方兼容） |
| R-DUP-ID | patch 内行 id 重复；同一预设 id 跨 home/profile 重复声明 | **只报告**（无法替你裁决删哪份） |
| R-ID-SHADOWED | 预设 id 与安装内置预设同名（0.1.2-alpha.1 起 shipped 赢，声明不生效） | **只报告**（有意覆盖可忽略；推荐改自定义 id） |
| R-STRUCT / R-YAML | 缺 id/config/plugins、非 insert 条目、YAML 语法错误 | **只报告** |

> 上表是 main/0.1.7（声明式）分支的处置；**旧线适配分支（≤0.1.5）目录是原生格式，R-LEGACY 不触发、R-LOCAL-PATH 豁免，改为目录内就地修**——见下方「适配分支」一节。

## 架构：追加式变更日志 + 链式收敛（为什么不怕版本漂移）

迁移表不是「版本对」快照，而是**追加式变更日志**（`src/tables/changes.json`）：每条记录「某 DSH 版本起，旧令牌失效 → 新形态」（`brokenIn` + `from`/`to`）。

- **新版 DSH 改模板 → 只追加条目**，历史条目永不改写；不存在 N×N 版本对表
- **链式收敛**：A→B、B→C 自动解析为 A→C（fixpoint）——0.1.0 / 0.1.2 / 0.1.5 / 0.1.7 四个时代写下的预设，用同一张表全部收敛到**当前运行安装**（起点不同、终点统一，分支差异只体现为命中的失效令牌不同；有测试固化该行为）
- **门禁相对运行实例**：旧名在当前安装已死**且**新名存在才自动修——同一条规则对任何安装都安全
- **报告起点时代**：每个预设显示「写于 ≤X」与需跨越的版本节点（如 `写于 ≤0.1.3-alpha.2，跨越 0.1.3-alpha.2 → 0.1.6-alpha.1`）
- **用户自救表**：`$DSH_HOME/preset-manager/tables.user.json`（与内置同 schema，同名 `from` 覆盖内置）——DSH 新版本断裂时不必等插件发版

**0.2.0 漂移复核（2026-09-30，git 双 tag 硬验证）**：`standard.patch.yml` 在 `dsh-v0.1.7-alpha.1` 与 `dsh-v0.2.0-rc.2` 间字节级相同，4 个官方预设包引用集合零差异；0.2.0-rc.2 即当前 npm latest。若未来 0.2.x 出现漂移，向 `changes.json` 追加条目即可覆盖所有历史起点。

## 时代对照：哪个版本写的预设会命中哪些事件

按预设**语法**（令牌组合）划分只有四个时代，版本号不影响处理路径——影响处理的是预设里包含的失效令牌：

| 编写时代 | 版本区间 | 令牌特征 | 命中事件 | 跨越节点 |
|---|---|---|---|---|
| text 时代 | 0.1.0 ~ 0.1.3-alpha.1（**含 0.1.1、0.1.2**） | persona `text` + 旧包名 + 遗留目录 | D + F + G | 0.1.3-alpha.2 → 0.1.6-alpha.1 → 0.1.7-alpha.1 |
| prefix 时代 | 0.1.3-alpha.2 ~ 0.1.6-alpha.0（**0.1.5 为代表**） | persona `prefix` + 旧包名 + 遗留目录 | F + G | 0.1.6-alpha.1 → 0.1.7-alpha.1 |
| ptc 时代 | 0.1.6-alpha.1 ~ 0.1.6-alpha.2 | 新包名 + 遗留目录 | G | 0.1.7-alpha.1 |
| 现行 | ≥0.1.7-alpha.1 | 声明式 patch | 无（0 findings） | — |

> 说明：0.1.1 与 0.1.2 之间没有任何影响用户预设语法的断裂（0.1.2-alpha.1 的 B 是内置预设同 id 顶掉、C 是 tool-web.fetch 默认值——均为行为类，非语法可修项，报告以 advisory 提示）；`isolate` realm 要求（A）早在 0.1.0-rc.7 生效，能在 0.1.0/0.1.1 跑起来的预设天然合规。故 **0.1.0/0.1.1/0.1.2 同属 text 时代，无需按版本号单独处理**。优先级上 prefix 时代（0.1.3-alpha.2~0.1.6 存续最久）的存量预设最多，text 时代次之——两者均已由「四代预设同表收敛」测试覆盖。

### 适配分支：按宿主线的 peer / 处理终点 / 算法

工具按**运行宿主版本**自动选择适配分支（`src/tables/branches.json`，只追加不改历史）。每条旧主线一个分支，peer 基线、处理终点、算法档位各不相同：

| 分支 | 宿主范围 | peer 基线（vendor/cordis） | 处理终点 | 预设格式 | 算法档位 |
|---|---|---|---|---|---|
| main（0.2.0） | ≥0.2.0-rc.1 | 4.0.4 | 0.2.0-rc.2 | 声明式 patch | patch span 修复 + 遗留目录 L1+L2 迁移 |
| dsh-0.1.7 | ≥0.1.7-alpha.1 <0.2.0-rc.1 | 4.0.4 | 0.1.7-rc.2 | 声明式 patch | 同 main（事件表相同） |
| dsh-0.1.5 | ≥0.1.5-alpha.1 <0.1.7-alpha.1 | 4.0.2 | 0.1.5-rc.3 | 目录（原生） | 不迁移、不扫 patch；目录内**就地修**表内令牌 |
| dsh-0.1.2 | ≥0.1.2-alpha.1 <0.1.5-alpha.1 | 4.0.2 | 0.1.2-rc.1 | 目录（原生） | 同上；终点前无断裂事件 → 实际只报告 |
| dsh-0.1.1 | <0.1.2-alpha.1 | 4.0.1 | 0.1.1-rc.2 | 目录（原生） | 同上 |

- **事件表按分支终点截断**：0.1.2 分支看不到 persona 事件（0.1.3-alpha.2 才断裂），不会把本线合法的 `text` 误修；用户自救表（`tables.user.json`）**不截断**——显式覆盖运行环境判定正是自救的本意
- **目录分支不迁移**：0.1.5 及更早的宿主没有声明式机制，目录就是预设本体——生成 `cordis.patch.yml` 毫无意义；修复落在 `agent.cordis.yml` 原文件内（同样的 .bak/原子写/幂等契约），相对本地路径也是当时的合法语义，不再误报
- **0.1.6-alpha 宿主**落 dsh-0.1.5 分支：旧包名由运行安装门禁判定（旧名死 + 新名活才修），0.1.5 / 0.1.6 两端皆安全
- **检不出宿主版本时回退 main**（与 0.3.x 行为一致）；npm 发布按线走 dist-tag（`dsh-0.2.0` / `dsh-0.1.7` / …，对齐 host-matrix 惯例）

### table-build：变更条目自动提案（维护者）

```bash
npm run table-build -- --repo <dsh 源码仓库> --from dsh-v0.1.5-rc.3 --to dsh-v0.2.0-rc.2 [--json]
```

- 对两版官方预设做包引用集合 diff；「同一预设文件内恰好一删一增」→ 提案 `package-rename` 事件；任何歧义进 unpaired 清单（不猜）
- 退出码：0=无变化、2=有提案、3=有待人工项
- 实测校准：`dsh-v0.1.5-rc.3 → dsh-v0.1.6-alpha.1` 自动重发现历史改名 F（workflow-worker-thread → workflow-ptc，1 条提案零误配）；`dsh-v0.1.7-alpha.1 → dsh-v0.2.0-rc.2` 空提案（与字节级复核一致）
- **提案需人工核对 commit 后再追加进 `src/tables/changes.json`**——变更日志是信任锚点，追加永远是人工动作
- config-key 类事件（如 persona 键改名）无法从预设 diff 唯一推导（语义歧义），仍需人工考古 + commit 实证

## 写入安全契约


- 修复既有 patch 一律**文本级 span 替换**：区间外字节 100% 不动（`!!js` 表达式、注释、缩进天然保真）
- 写前自动备份 `<file>.bak-<时间戳>`；临时文件 + rename 原子替换
- 幂等：同一输入重复运行，第二次 0 写操作
- UTF-8 无 BOM；CRLF/LF 行尾保持
- 写盘只经显式手动确认：卡内「同步到当前版本」按钮（确认框）或 `/preset-doctor fix` 命令；启动扫描恒只报告（0.6.0 起 autoFix 总闸退役）

## 使用

**兼容性范围**：单一 `0.6.1` 服务全部宿主主线——适配分支在运行时按宿主版本自选（见上文「适配分支」），无 per-line 代码分叉。`engines.dsh` 与 renderer peer `@deepseek-ai/dsh-client-ui-renderer` 双清单同串、逐 rc 精确枚举（无区间/caret）：`0.1.0-rc.2 || 0.1.0-rc.3 || 0.1.0-rc.6 || 0.1.0-rc.7 || 0.1.0-rc.8 || 0.1.1-rc.1 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.5-rc.3 || 0.1.7-rc.1 || 0.1.7-rc.2 || 0.2.0-rc.1 || 0.2.0-rc.2 || 0.2.1-rc.1 || 0.2.1-rc.2 || 0.2.1-rc.3 || 0.2.1-rc.4`；peer `@deepseek-ai/cordis` 为 `>=4.0.1 <5`。**宿主保留场冒烟实测（2026-10-05，0.4.1）**：0.1.0-rc.8 / 0.1.1-rc.2 / 0.1.2-rc.1 / 0.1.5-rc.3 / 0.1.7-rc.2 五线启动全绿且插件 entry 激活（栽植测试自动修复 + `.bak` 坐实）；0.2.0 走桌面版实测通道。工程约束：`src/` **禁止 import cordis**（profile 安装会解析插件私有大版本副本，与宿主形成双实例；本插件刻意只依赖 schemastery）。按宿主线选 dist-tag 安装（截至 2026-10-05；0.4.1 未发布 npm 前以 tgz 安装）：

| DSH 宿主 | 本插件版本 | 安装 dist-tag |
|---|---|---|
| 0.2.0 | 0.4.1（latest） | `dsh-0.2.0` |
| 0.1.7 | 0.4.1 | `dsh-0.1.7` |
| 0.1.5 | 0.4.1 | `dsh-0.1.5` |
| 0.1.2 | 0.4.1 | `dsh-0.1.2` |
| 0.1.1 及更早 | 0.4.1 | `dsh-0.1.1` |

```bash
npm install -g dsh-preset-doctor            # latest（当前即 0.4.0）
dsh plugin add dsh-preset-doctor@dsh-0.2.0  # 按宿主线选 tag：dsh-0.1.7 / dsh-0.1.5 / dsh-0.1.2 / dsh-0.1.1
```

装载后（约 1 秒后）自动扫描 `$DSH_HOME/cordis.patch.yml`、`profiles/<name>/cordis.patch.yml` 与遗留 `.agent-presets/` 目录，修复结果与报告输出到日志。

会话内可随时手动触发：

```
/preset-doctor          # 扫描 + 机械修复（默认）
/preset-doctor scan     # 只扫描报告，不写盘
```

### 进程内冒烟（手动步骤）

```powershell
# 路径 A：全局安装
npm install -g dsh-preset-doctor
# 路径 B：作为 profile 插件挂载
dsh plugin add dsh-preset-doctor

# 重启 DSH 进程（预设注册表与插件仅在启动时加载）
# 启动后 ~1s 在日志中找 [preset-manager] 扫描报告；会话内 /preset-doctor scan 验证命令
```

### 设置项

| 键 | 默认 | 说明 |
|---|---|---|

| `scanProfiles` | `true` | 同时扫描 profile 级 patch |
| `migrateLegacy` | `true` | 自动迁移旧格式目录 |
| `homeOverride` | `''` | 覆盖扫描根目录（测试/多实例用） |

**设置面分布（0.5.0 起三代 waist 特性检测，禁止读版本号；farm 实测）**：

| 宿主线 | 设置入口 | 说明 |
|---|---|---|
| 0.1.7-rc.1+ / 0.2.0（**本发布标注的可检查设置面**） | 插件页 → dsh-preset-doctor 行详情 / bundle 详情页 | client 卡（`plugins.row.config` key=`dsh-preset-doctor#preset-manager` + `plugins.bundle.config` key=`dsh-preset-doctor`）。宿主**不**渲染 volatile 自动表单（0.1.7 设置面板导航实测无插件配置项）；volatile Config 只负责存储管道，卡数据走 `/api/dsh-preset-doctor-settings` 桥（0.1.7 实测卡渲染 + UI 保存落盘） |
| 0.1.2-rc.1 / 0.1.5-rc.x | 设置 → 插件 → 插件配置 标签页 | host 侧 `installSection` 注册 ns + client 卡按 ns 派发（派发条件 = served ns ∩ `settings.plugin.item` 卡 ∩ key===ns ∩ `settingsScope.bind`；0.1.2/0.1.5 实测卡渲染 + 保存回环） |
| 0.1.0-rc.x / 0.1.1-rc.x | 无 UI（宿主壳无设置页） | host 侧 `register` 注册 ns 即获得持久化 + 桥读写（实测 mutate 回环通）；配置经 `cordis.patch.yml` |

老线上改动经 `setSource` 换绑配置源，改完即对下一次 `/preset-doctor` 与启动扫描生效，无需重启。

## 边界与免责

> **本工具保证修复后的预设「语法合法、可加载」，不保证与旧版本「行为等价」。**
> 修复生效需**重启 DSH 进程**（预设注册表仅在启动时加载）。

- 无继任者的被删包、语义变化的配置键、用户 `.mjs` 插件的 API 变化——无法静态判定，只标记不建议
- 变更日志 v1 内置两条实证事件（`workflow-ptc`、`persona` 键），随 DSH 新版本断裂**追加**新条目；用户可用 `tables.user.json` 先行自救
- 只写 patch 文件与 `.bak` 备份；不安装依赖、不改 `package.json`、不重启进程

## 与相近包的定位差异

| 包 | 定位 | 差异 |
|---|---|---|
| `@linxin666/dsh-client-ui-preset-center` | 预设市场安装/禁用/卸载管理 UI | 管理市场预设的**生命周期**；本工具诊断修复**本地预设的语法失效** |
| `dsh-win32` | Windows 综合修复套件 | 含 legacy preset repair 但面向通用 Windows 问题；本工具专注预设，跨平台 |
| PRD `preset-migrate`（设计文档） | 独立 CLI、迁移表自动生成 | 本工具 = 常驻插件 doctor（PRD §13.5 的开放问题 5），面向「存量已失效」场景 |

## 开发

```bash
npm install
npm test   # node --test（82 个用例，含真实预设 fixtures 的端到端迁移验证 + 适配分支行为）
npm run lint
```

测试资产来自真实用户预设：6 个旧格式目录（含 `.mjs` 本地插件、`!!js` 表达式、块标量空行、中文）与 5 个人工转换的 patch 基线（其中保留了真实历史 bug——旧包名漏改——工具必须修掉它才能通过测试）。

## License

MIT
