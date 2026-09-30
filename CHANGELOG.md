# Changelog

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
