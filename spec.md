# Spec: dsh-preset-doctor — 内置预设逐版本基线 + 组合漂移检测/对齐 + 行级微调

> 目标仓：`mine-dsh-plugins/dsh-preset-doctor`（独立 git 仓）。基线源：`deepseek-harness` 的 32 个 `dsh-v0*` tag。

## 需求
- **R1 全链路内置预设基线**：遍历 deepseek-harness 所有宿主 tag（仅 `>=0.1.7-alpha.1` 声明式时代），抽取每版 `packages/bundle/web-app/presets/{standard,cordis,ptc,minimal}.patch.yml` 的插件行集（`- id:` 序列），生成逐版本快照 `src/tables/preset-baseline.json`。
- **R2 修 branches.json 冻结假设**：新增 `dsh-0.2.1` 分支（endpoint `0.2.1-rc.1`）；删除/更正 main 里"官方预设自 0.1.7 字节级冻结"的 note（基线已证 0.2.1 有漂移）。
- **R3 R-COMPOSITION-DRIFT（漂移检测 + 一键对齐）**：把用户 preset 的行集与"运行宿主版本基线"对齐，分类：①跨版本引入（本版本标准无、更晚版本才加，如 0.2.0 上写 `time-context`）；②本版本已移除（如 0.2.1 上写 `tool-subagent-codex`）；③用户自定义（第三方/有意加，保留）。报告 + **一键"对齐到当前版本基线"**（用户选 B）。
- **R4 分组标注视图**：client 卡展开某 preset 时按 section 分组（persona/tools/planning/compaction/delegation/context/subagent/market），每行标注来源徽标（内置默认 / 用户新增 / 用户禁用 / ⚠版本漂移）。
- **R5 R-TOGGLE 行级微调**：每行启用/禁用开关（典型：手动关 `time-context`）→ 在 patch 里给该行加/去 `disabled: true`；若活动 preset 是 shipped standard（profile 无用户行），先"物化"一条覆盖 preset 再 toggle。

## 技术方案
- **数据层**：新增 `src/tables/preset-baseline.json`（`{schemaVersion, snapshots:[{version, presets:{standard:[rowId…], cordis:[…], ptc:[…], minimal:[…]}}]}`，按 version 升序）。`src/tables/load.js` 加 `loadBaseline()` + `baselineForVersion(version)`（用现有 `compareSemver`/`semverSatisfies` 取 ≤version 的最近快照）。
- **生成层**：扩展 `tools/table-build.mjs` 增 `--composition --repo deepseek-harness --all-tags`：对每个 `dsh-v0*` tag `git show <tag>:.../presets/*.patch.yml`，抽 `- id:` 行集；路径不存在的 tag（<0.1.7）跳过；输出按版本快照 JSON。
- **规则层**：新增 `src/rules/composition-drift.js`（导出 `checkCompositionDrift(presetRows, baselineRows, currentVersion)` → findings[]）；在 `src/scan.js` 规则链注册（紧随 R-PKG-MISSING）。
- **修复层**：`src/fix/planner.js` 加 `planCompositionAlign()`（把用户 preset 行集变换到当前版本基线：补标准新增行、移除本版本已删行、保留用户自定义行）；`src/fix/core.js` 复用文本级 span 增/删行写（`.bak`+原子+幂等）。
- **交互层**：`lib/client.js` 加分组渲染 + 来源徽标 + 行开关 + "对齐到当前版本"按钮（显式确认框）；`src/bridge.js` 加 `/api/dsh-preset-doctor-composition` 端点（GET 视图数据 / POST toggle/align）。

## 决策记录
| 选项 | 选择 | 理由 |
|---|---|---|
| 基线数据源 | git tag 遍历（非 npm-pack） | 用户要"拉开全链路历史 rc 状态"，git 有全部 tag 且能独立证伪"冻结"假设 |
| 基线覆盖 | 全部 `>=0.1.7-alpha.1` 的 tag | 声明式 preset 只此时代起存在；更早无 `presets/*.patch.yml` |
| 漂移处置 | 报告 + 一键对齐到当前版本基线（B） | 用户明确选 B |
| toggle 落点 | preset 层 `disabled` 行 | 插件侧无法抑制 time-context（frozen message + waterfall 禁改） |
| 无用户行时 | 先物化覆盖 preset 再 toggle | shipped standard 无 profile 行，直接 toggle 无处落 |
| 对齐是否删用户自定义行 | 否，只对齐"标准成员"行 | 用户自定义是意图，非漂移 |

## 约束
- `src/` 禁止 import cordis（既有铁律，只依赖 schemastery/yaml）。
- 写盘只经显式确认（对齐 preset-doctor 红线），`.bak` + 原子 rename + 幂等。
- 版本比较统一用 `load.js` 的 `compareSemver`（支持 `-alpha./-rc.` 后缀）。
- 基线快照是**数据资产**：追加不改历史；新宿主版本发布时 table-build 追加新快照。
- 本次为已发布插件功能扩展，需过 82+ 测试、L3、V1-V6 门禁后再发版（发版另计，不在本 plan 执行内）。
