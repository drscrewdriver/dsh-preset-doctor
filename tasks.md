# Tasks

> 顺序即依赖：P0 → P1 → P1b → P2 → P3。每 task ≤5 分钟粒度，含文件路径 + 方案 + 验证。CodePlan 确认前不执行任何代码。

## Phase 0：基线数据与分支（地基）
- [ ] T0.1 `tools/table-build.mjs`：加 `--composition --repo <harness> --all-tags` 分支——枚举 `git tag | grep dsh-v0`，对每 tag `git show <tag>:packages/bundle/web-app/presets/{standard,cordis,ptc,minimal}.patch.yml`，抽顶层 `- id:` 行集（跳过组内嵌套用缩进阈值），路径不存在→该 tag 跳过。交付物：脚本 diff。
- [ ] T0.2 跑 `node tools/table-build.mjs --composition --repo ../../deepseek-harness --all-tags > preset-baseline.draft.json`，人工核对 0.2.0 vs 0.2.1 差集 = 实测（+time-context/tool-schedule/tool-plugin-market，−codex/claude-code/ralph）。交付物：draft JSON + 核对记录。
- [ ] T0.3 落 `src/tables/preset-baseline.json`（`{schemaVersion:1, snapshots:[{version,presets:{standard:[…],cordis:[…],ptc:[…],minimal:[…]}}]}`，升序）。交付物：数据文件。
- [ ] T0.4 `src/tables/load.js`：加 `loadBaseline()` + `baselineForVersion(version)`（取 ≤version 最近快照，用 `compareSemver`）。交付物：函数 + 单测。
- [ ] T0.5 `src/tables/branches.json`：头部（main 下）加 `dsh-0.2.1` 分支（hostRange `>=0.2.1-rc.1`、endpoint/baseline `0.2.1-rc.1`、peer cordis 4.0.5、declarative-patch、npmTag `dsh-0.2.1`）；改 main note 去掉"字节级冻结"。交付物：diff。
- [ ] T0.6 单测 `tests/baseline.test.js`：断言 0.2.0-rc.2 无 time-context、0.2.1-rc.1 有；minimal 0.2.1 含 tool-fs。交付物：测试绿。

## Phase 1：R-COMPOSITION-DRIFT（只报告）
- [ ] T1.1 新建 `src/rules/composition-drift.js`：`checkCompositionDrift(presetId, userRows, baselineRows, allBaselineUnion, currentVersion)` → findings[]，三分类：跨版本引入 / 本版本已移除 / 用户自定义（不在 anyBaselineUnion）。交付物：规则模块。
- [ ] T1.2 `src/scan.js`：规则链注册 composition-drift（紧随 R-PKG-MISSING），喂 `baselineForVersion(hostVersion)`。交付物：diff。
- [ ] T1.3 `src/report.js`：渲染漂移 finding（presetId+rowId+类别+建议）。交付物：diff。
- [ ] T1.4 单测 `tests/composition-drift.test.js`：020+time-context→引入；021+codex→已移除；未知第三方→自定义不报。交付物：测试绿。

## Phase 1b：一键对齐到当前版本基线
- [ ] T1b.1 `src/fix/planner.js`：`planCompositionAlign(presetId, userRows, baselineRows)` → 计划：补 baseline 有而 userRows 无的标准行、移除 userRows 有而 baseline 无且属"标准成员"的行、**保留用户自定义行**。交付物：计划生成。
- [ ] T1b.2 `src/fix/core.js`：支持行级 insert/delete 的文本 span 写（复用 `.bak`+原子+幂等+区间外字节不动）。交付物：diff。
- [ ] T1b.3 对齐走显式确认（复用现有"同步到当前版本"确认框路径）。交付物：接线。
- [ ] T1b.4 单测：对齐后重扫 0 findings；二次 apply 0 写；用户自定义行保留。交付物：测试绿。

## Phase 2：分组标注视图（client）
- [ ] T2.1 `src/bridge.js`：加 `/api/dsh-preset-doctor-composition` GET（返回按 section 分组 + 来源标注的行数据）。交付物：端点。
- [ ] T2.2 `lib/client.js`：展开 preset 时按 section 分组渲染 + 来源徽标（内置默认/用户新增/用户禁用/⚠漂移）。交付物：diff。
- [ ] T2.3 section 归类映射（persona/tools/planning/compaction/delegation/context/subagent/market）放 `preset-baseline.json` 或 `src/rules` 侧常量。交付物：映射表。

## Phase 3：R-TOGGLE 行级微调
- [ ] T3.1 `src/bridge.js`：`/api/dsh-preset-doctor-composition` POST `{presetId,rowId,disabled}`。交付物：端点。
- [ ] T3.2 `src/fix/core.js`：给指定行加/去 `disabled: true`（span 写 + 确认 + 幂等）。交付物：diff。
- [ ] T3.3 物化覆盖：活动 preset 无 profile 行时，先 insert 一条覆盖 preset（复用 migrate-legacy 的 insert 能力）再 toggle；物化行被 T1.1 识别标注。交付物：diff。
- [ ] T3.4 `lib/client.js`：每行 toggle 开关（显式确认）。交付物：diff。
- [ ] T3.5 单测：关 time-context → patch 有 `disabled:true`；再开→移除；幂等；物化路径。交付物：测试绿。

## 收尾（不在本 plan 执行）
- [ ] TX `npm test` + `npm run lint` 全绿；农场 3091 格实测分组+关 time-context；L3 + V1-V6；发版另起。

---

## 执行结果（2026-10-17，CodePlan 确认后依次实现）

**已完成并验证**（`npm test` 123/123 绿、`npm run lint` 0、`node --check lib/client.js` 0）：
- ✅ P0：`tools/table-build.mjs` 加 `--composition --all-tags`；生成 `src/tables/preset-baseline.json`（13 版快照，0.1.7-alpha.1→0.2.1-rc.2）；`load.js` 加 `loadBaseline/baselineForVersion`；`branches.json` 加 dsh-0.2.1 分支 + 更正冻结 note；`tests/baseline.test.js`。
- ✅ P1：`src/rules/composition-drift.js`（R-COMPOSITION-DRIFT 三分类，report 级）；`scan.js` 注册；`tests/composition-drift.test.js`。漂移 finding 经 `collectPresets` 自动进卡片 broken 列表。
- ✅ P1b：`src/fix/row-edit.js`（行级 span 原语）+ `src/fix/composition-align.js`（删漂移行 + 报缺失）+ `fix/index.js` `runAlign`；`core.js` spliceEdits 支持零宽插入；`tests/composition-align.test.js`（含注释保真、幂等、dryRun）。
- ✅ P2：`classifyComposition`（行分类 shipped/drift/custom + disabled + missing）；`getSummary` 暴露 `composition`；`lib/client.js` `CompositionSection`（分组徽标 + 行级禁用/启用按钮 + 一键对齐）；`tests/composition-classify.test.js`。
- ✅ P3：`runToggle`（confirm 门、置/解 disabled、row-not-in-preset 提示物化）；`bridge.js` 加 `/align` `/toggle` 端点；`index.js` 注入 context。

**偏差与后续（明确记录）**：
1. **P2 分组按「状态」而非「功能 section」**：徽标分组是 内置/漂移/自定义（数据来自基线，可靠）；按 persona/tools/… 的 section 归类需基线额外存 section（未做，收益低）。
2. **对齐只删漂移、不自动补**：自动补齐缺失标准行需 `preset-baseline.json` 存 `id→包名`（现为纯 id 列表）→ 列为后续；当前把 missing 行**报告**给用户手动补。
3. **物化覆盖未做**：活动 preset 是 shipped standard（profile 无用户行）时 toggle 返回 `row-not-in-preset` 并提示；「先物化一条覆盖 preset 再 toggle」为后续（复用 migrate-legacy 的 insert）。
4. **TX 农场实测未完成**：3091 格跑的是 npm 版 preset-doctor 0.6.1，非本地改版；要实点新按钮需 `npm pack` 本地版换装该格。单测已覆盖逻辑，UI 手测待这步。
5. **发版未做**（本 plan Out-of-Scope）：需 L3 + V1-V6 + 多线 dist-tag，另起。
