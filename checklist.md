# Checklist

## Must Pass — 基线与分支（P0）
- [ ] `tools/table-build.mjs --composition` 能遍历 deepseek-harness 全部 `dsh-v0*` tag，跳过 `<0.1.7-alpha.1`（无 presets 路径）
- [ ] 生成的 `preset-baseline.json` 含 standard/cordis/ptc/minimal 四预设逐版本行集快照，按 version 升序
- [ ] 0.2.0-rc.2 快照不含 time-context；0.2.1-rc.1 快照含 time-context/tool-schedule/tool-plugin-market 且不含 tool-subagent-codex/claude-code/ralph（与实测 diff 一致）
- [ ] minimal 快照体现 0.2.1 新增 tool-fs/compaction
- [ ] branches.json 新增 dsh-0.2.1 分支（endpoint 0.2.1-rc.1），main 的"冻结"note 已更正
- [ ] `loadBaseline()` / `baselineForVersion('0.2.1-rc.1')` 返回正确行集；`baselineForVersion('0.2.0-rc.2')` 不含 time-context

## Must Pass — 漂移检测（P1）
- [ ] 0.2.0 运行 + 用户 preset 含 time-context → R-COMPOSITION-DRIFT 报"跨版本引入"
- [ ] 0.2.1 运行 + 用户 preset 含 tool-subagent-codex → 报"本版本已移除"
- [ ] 用户自定义第三方行（不在任何基线）→ 归"用户自定义"，不报漂移
- [ ] 只报告不自动写盘；findings 带 presetId + rowId + 建议

## Must Pass — 一键对齐（P1b）
- [ ] "对齐到当前版本基线"计划：补标准新增行 / 移除本版本已删行 / **保留用户自定义行**
- [ ] 写盘经显式确认，`.bak` 备份 + 原子 rename + 幂等（二次运行 0 写）
- [ ] 文本级 span 写：区间外字节（`!!js`/注释/缩进/行尾）不动
- [ ] 对齐后重扫 0 findings（对当前版本）

## Must Pass — 分组标注 + toggle（P2/P3）
- [ ] client 卡展开 preset 按 section 分组，每行带来源徽标（内置默认/用户新增/用户禁用/⚠漂移）
- [ ] 行级 toggle：关 time-context → patch 该行 `disabled: true`；再开 → 移除
- [ ] 活动 preset 是 shipped standard（无用户行）时，toggle 先物化覆盖 preset，且物化被 R-COMPOSITION-DRIFT 识别标注
- [ ] bridge 端点 `/api/dsh-preset-doctor-composition` GET/POST 回环通

## Should Pass
- [ ] 单测覆盖：baseline 加载、漂移三分类、对齐计划、toggle 写盘幂等（含 fixtures 真实预设）
- [ ] `npm test` 全绿（含既有 82+ 用例不回归）；`npm run lint` 0
- [ ] 农场 0.2.1 格（3091）实测：复制的 6 遗留预设迁移后，卡显示分组 + time-context 可关
- [ ] 老线（0.1.7/0.2.0 分支）不误报：基线按 eventsUpTo 截断，用户表不截断

## Out of Scope（本 plan 不含）
- [ ] npm 发版 / dist-tag / git push（功能实现+测试通过后另走发版门禁）
