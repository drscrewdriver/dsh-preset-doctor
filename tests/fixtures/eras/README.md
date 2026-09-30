# 四时代真实官方预设快照（deepseek-harness 仓库提取）

均为官方仓库真实文件，非手工构造。刷新方式（在 deepseek-harness 仓库内）：

```bash
# 0.1.2 时代（旧目录机制，persona text: >- 折叠标量 + 旧包名 workflow-worker-thread）
git show dsh-v0.1.2-rc.1:packages/preset/agent-presets/presets/standard/agent.cordis.yml > standard/agent.cordis.yml
# …对 cordis / minimal / ptc / standard 四预设的 agent.cordis.yml 与 preset.yml 重复

# 0.1.5 时代（prefix 为主，含 1 个 text 滞后样本：令牌驱动的实证）
#   tag: dsh-v0.1.5-rc.3，布局同上

# 0.1.7 时代（声明式 patch）
git show dsh-v0.1.7-rc.2:packages/bundle/web-app/presets/standard.patch.yml > standard.patch.yml
# …对 cordis / minimal / ptc / standard 重复

# 0.2.0（主线）：本仓库无 main 分支，主线 = master/origin/master
#   提取时 origin/master == dsh-v0.2.0-rc.2（同一提交 639ed01539）；本地 master 分支是陈旧旧提交，勿用
git show origin/master:packages/bundle/web-app/presets/standard.patch.yml > standard.patch.yml
```

真实令牌分布（2026-09-30 提取时核对）：

| 时代 | text: | prefix: | 旧 workflow 名 |
|---|---|---|---|
| v0.1.2-rc.1 | 4/4 | 0 | 3/4 文件 |
| v0.1.5-rc.3 | **1/4（官方线自己的滞后样本）** | 4/4 | 3/4 文件 |
| v0.1.7-rc.2 | —（声明式，0.1.7-rc.2 全 4 文件与 master 字节一致） | | |

验证见 `tests/eras.test.js`。
