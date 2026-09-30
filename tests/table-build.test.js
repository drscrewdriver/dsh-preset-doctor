import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractPkgRefs, pairOnePreset, diffShipped, PRESET_PATH_PATTERNS } from '../tools/table-build.mjs'

test('extractPkgRefs：保序提取官方包引用', () => {
  const refs = extractPkgRefs("name: '@deepseek-ai/dsh-persona'\nname: '@deepseek-ai/dsh-tool-bash'\nname: '@deepseek-ai/dsh-persona'")
  assert.deepEqual(refs, ['@deepseek-ai/dsh-persona', '@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-persona'])
})

test('PRESET_PATH_PATTERNS 覆盖三代布局', () => {
  const paths = [
    'packages/bundle/web-app/presets/standard.patch.yml',
    'packages/preset/agent-presets/presets/standard/agent.cordis.yml',
    'apps/cli/config/agent-presets/standard/agent.cordis.yml',
    'packages/bundle/web-app/src/index.ts', // 不应匹配
  ]
  const hit = paths.filter((p) => PRESET_PATH_PATTERNS.some((re) => re.test(p)))
  assert.equal(hit.length, 3)
})

test('pairOnePreset：一删一增 → 提案改名（brokenIn 取自 to tag）', () => {
  const r = pairOnePreset(
    'standard',
    ['@deepseek-ai/dsh-persona', '@deepseek-ai/dsh-workflow-worker-thread'],
    ['@deepseek-ai/dsh-persona', '@deepseek-ai/dsh-workflow-ptc'],
    { fromTag: 'dsh-v0.1.5-rc.3', toTag: 'dsh-v0.1.6-alpha.1' },
  )
  assert.equal(r.proposals.length, 1)
  assert.equal(r.proposals[0].from, '@deepseek-ai/dsh-workflow-worker-thread')
  assert.equal(r.proposals[0].to, '@deepseek-ai/dsh-workflow-ptc')
  assert.equal(r.proposals[0].brokenIn, '0.1.6-alpha.1')
  assert.ok(r.proposals[0].source.includes('standard'))
})

test('pairOnePreset：纯增/纯删/歧义 → 不猜，进 unpaired', () => {
  // 纯增
  const add = pairOnePreset('a', ['@x/keep'], ['@x/keep', '@x/new'])
  assert.equal(add.proposals.length, 0)
  assert.deepEqual(add.unpairedAdditions, [{ preset: 'a', name: '@x/new' }])
  // 纯删
  const del = pairOnePreset('a', ['@x/keep', '@x/gone'], ['@x/keep'])
  assert.equal(del.proposals.length, 0)
  assert.deepEqual(del.unpairedRemovals, [{ preset: 'a', name: '@x/gone' }])
  // 歧义：两删一增
  const amb = pairOnePreset('a', ['@x/gone1', '@x/gone2'], ['@x/fresh'])
  assert.equal(amb.proposals.length, 0)
  assert.equal(amb.unpairedRemovals.length, 2)
})

test('diffShipped：同名预设 diff + 整预设消失/新增', () => {
  const oldFiles = new Map([
    ['standard', "name: '@deepseek-ai/dsh-a'\nname: '@deepseek-ai/dsh-b'"],
    ['legacy-only', "name: '@deepseek-ai/dsh-old'"],
  ])
  const newFiles = new Map([
    ['standard', "name: '@deepseek-ai/dsh-a'\nname: '@deepseek-ai/dsh-c'"],
    ['fresh', "name: '@deepseek-ai/dsh-new'"],
  ])
  const r = diffShipped(oldFiles, newFiles, { fromTag: 'tA', toTag: 'tB' })
  assert.equal(r.proposals.length, 1)
  assert.equal(r.proposals[0].from, '@deepseek-ai/dsh-b')
  assert.equal(r.proposals[0].to, '@deepseek-ai/dsh-c')
  assert.deepEqual(r.unpairedRemovals, [{ preset: 'legacy-only', name: '@deepseek-ai/dsh-old' }])
  assert.deepEqual(r.unpairedAdditions, [{ preset: 'fresh', name: '@deepseek-ai/dsh-new' }])
})

test('diffShipped：零差异 → 全空（0.2.0 漂移复核的形状）', () => {
  const text = "name: '@deepseek-ai/dsh-persona'\ndisabled: !!js process.platform === 'win32'"
  const files = new Map([['standard', text]])
  const r = diffShipped(files, new Map([['standard', text]]), { fromTag: 'a', toTag: 'b' })
  assert.deepEqual(r, { proposals: [], unpairedRemovals: [], unpairedAdditions: [] })
})
