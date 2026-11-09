/**
 * 提示词段读取（patch 侧）：预设的系统提示词由若干行拼出来，
 * 卡面的「系统提示词」框要能按预设分组读到它们（persona prefix、plan-mode section…）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scanAll } from '../src/scan.js'
import { collectPromptTexts, presetPromptTexts } from '../src/rules/prompt-text.js'
import { makeDshResolve } from './_stub-resolve.js'

const resolve = makeDshResolve()

function tmpHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshpm-prompttext-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  return home
}

const PERSONA = 'You are a coding agent powered by the {{model}} model.\nYou run on Windows with Git Bash.'
const PLAN = 'You are in plan mode.\n\nExplore first, then submit the plan through exit_plan_mode.'

function writeTwoPresets(home) {
  const file = path.join(home, 'cordis.patch.yml')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(
    file,
    [
      '- insert:',
      '    - id: preset-a',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: a',
      '        name: 甲',
      '        description: 短描述不算提示词',
      '        plugins:',
      '          - id: persona',
      "            name: '@deepseek-ai/dsh-persona'",
      '            config:',
      '              prefix: |-',
      ...PERSONA.split('\n').map((line) => '                ' + line),
      '              suffix: 收尾一句',
      '          - id: planning',
      '            name: cordis:group',
      '            group: true',
      '            config:',
      '              - id: plan-mode',
      "                name: '@deepseek-ai/dsh-plan-mode'",
      '                config:',
      '                  section: |-',
      ...PLAN.split('\n').map((line) => '                        ' + line),
      '          - id: tool-web',
      "            name: '@deepseek-ai/dsh-tool-web'",
      '            config:',
      '              fetch: true',
      '    - id: preset-b',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: b',
      '        plugins:',
      '          - id: persona',
      "            name: '@deepseek-ai/dsh-persona'",
      '            config:',
      '              prefix: 乙的提示词不一样但也不长',
    ].join('\n'),
  )
  return file
}

test('按预设区间读出提示词段：prefix / section 命中，元数据与布尔不误抓', (t) => {
  const home = tmpHome(t)
  const file = writeTwoPresets(home)
  const scan = scanAll({ home, branch: 'main', resolvePkg: resolve, migrateLegacy: false })

  const map = presetPromptTexts(scan)
  const a = map.get(`${file}#a`)
  // persona 的 prefix/suffix 都是提示词键（suffix 不限长度），plan-mode 的 section 也是
  assert.ok(a && a.length === 3, '甲预设三段：persona.prefix + persona.suffix + plan-mode.section')
  assert.deepEqual(a.map((x) => `${x.rowId}:${x.key}`), ['persona:prefix', 'persona:suffix', 'plan-mode:section'])
  assert.equal(a[0].kind, 'persona')
  assert.equal(a[2].kind, 'plan')
  assert.ok(a[0].chars >= PERSONA.length, '字数按去首尾空白的正文计')
  assert.ok(a[0].preview.includes('coding agent'), '预览取正文开头')
  assert.ok(!a[0].preview.includes('\n'), '预览压成一行')

  const b = map.get(`${file}#b`)
  assert.ok(b && b.length === 1)
  assert.equal(b[0].key, 'prefix')
  assert.ok(!a.some((x) => x.preview.includes('乙')), '区间过滤：乙的提示词不出现在甲的清单里')
})

test('collectPromptTexts：已知键名不限长、未知键名要够长、工具 description 算提示词、预设元数据不算', () => {
  const rows = [
    {
      id: 'persona',
      name: '@deepseek-ai/dsh-persona',
      line: 3,
      range: [10, 40],
      configNode: { items: [{ key: { value: 'suffix' }, value: { value: '短句也算提示词' } }] },
    },
    {
      id: 'custom',
      name: 'dsh-custom',
      line: 20,
      range: [41, 60],
      configNode: {
        items: [
          { key: { value: 'brief' }, value: { value: '短的自定义值不猜' } },
          { key: { value: 'longish' }, value: { value: 'x'.repeat(220) + '\ny' } },
          { key: { value: 'count' }, value: { value: 12 } },
        ],
      },
    },
    {
      id: 'persistent-bash',
      name: '@deepseek-ai/dsh-tool-bash-persistent',
      line: 70,
      range: [61, 80],
      configNode: { items: [{ key: { value: 'description' }, value: { value: 'Run commands in a bash shell' } }] },
    },
    {
      id: 'preset-a',
      name: '@deepseek-ai/dsh-agent-preset',
      line: 1,
      range: [1, 9],
      configNode: { items: [{ key: { value: 'description' }, value: { value: '预设的面板文案，不是提示词' } }] },
    },
  ]
  const all = collectPromptTexts(rows)
  // 工具行的 description 是模型可见的工具说明（宿主注释实证），预设行的 description 只是面板文案
  assert.deepEqual(all.map((x) => `${x.rowId}:${x.key}`), [
    'persona:suffix',
    'custom:longish',
    'persistent-bash:description',
  ])
  assert.equal(all[2].kind, 'tool')
  // 区间外不取
  const onlyFirst = collectPromptTexts(rows, [10, 40])
  assert.deepEqual(onlyFirst.map((x) => x.key), ['suffix'])
})
