# Findings

## 架构决策
- **branches.json 的"预设冻结"假设已被 0.2.1 证伪**（实测两版发布包 web-app）：standard/cordis/ptc 三预设共同 `+time-context / +tool-schedule / +tool-plugin-market`，`−tool-subagent-codex / −tool-subagent-claude-code / −tool-ralph`；minimal 单独 `+tool-fs / +compaction(compaction-basic,command-compact)`。→ 这是"版本不一致预设"的根因，也是本功能的存在理由。
- **基线用"逐版本快照"而非"链式事件"**：changes.json 的链式收敛适合"令牌改名"（有限、可链）；但 preset 组合成员是"集合"，快照 diff 更直观、可支撑"分组标注"和"对齐"两种消费。快照按 version 升序，取 ≤运行版本 的最近一份。
- **漂移检测必须"只报告 + 显式对齐"**：对齐=改用户 preset 行集（意图层），不能自动跑；沿用 doctor"写盘只经显式确认"红线。
- **toggle 落 preset 层 `disabled` 行**：插件侧无法抑制 time-context（`agent/pre-step` 注入 durable frozen `user/message`，waterfall 禁改 messages、deriveMessages 只能重排/过滤）。唯一安全落点是 composition 声明。

## 技术选型
- **基线源 = deepseek-harness git tags**（非 npm-pack）：仓内有 32 个 `dsh-v0*` tag（起点 0.1.0-rc.7），`git show <tag>:packages/bundle/web-app/presets/*.patch.yml` 直接取；能覆盖"全链路历史 rc 状态"并独立验证冻结假设。
- **复用 table-build**：`tools/table-build.mjs` 已在做"两版官方预设包引用集合 diff"（产 package-rename 提案），composition 模式是同一 diff 换输出维度。
- **版本比较复用 `load.js` 的 `compareSemver`**（支持 `-alpha./-rc.`），不引新库。

## 约束与依赖
- 声明式 preset 仅 `>=0.1.7-alpha.1` 存在；更早 tag 无 `packages/bundle/web-app/presets/` → table-build 必须跳过（不能当空集污染基线）。
- `src/` 禁止 import cordis（profile 会解析插件私有大版本副本，双实例故障）。
- client 半是 `lib/client.js`（提交态），改它需与 host 侧 bridge 端点对齐。
- preset-doctor 是已发布插件（0.6.1，82+ 测试、L3、V1-V6 门禁、npm 多线 dist-tag）——功能扩展后须重跑门禁再发版。

## 风险识别
- **物化覆盖 preset 的副作用**：shipped standard 无 profile 行，toggle time-context 前若 insert 一条完整覆盖 preset，会把"内置默认"冻结进用户 patch——宿主升代后该覆盖会挡住新内置行（R-COMPOSITION-DRIFT 要能识别"物化覆盖"并提示）。
- **对齐可能删用户依赖的行**：只对齐"标准成员"，用户自定义行必须保留，否则误删。
- **基线数据体积**：32 tag × 4 preset × ~30 行，快照 JSON 可能偏大；可只存"相对上一快照的 +/−"压缩，但牺牲直读性——先按全快照，超预算再压。
- **table-build 跨平台**：`git show` 在 Windows 需绝对路径 + 编码；沿用现脚本的调用方式。
