import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveDshHome, collectPatchFiles, collectLegacyDirs, readText } from '../src/paths.js'

function mkHomeLayout(home, profiles = ['web', 'cli']) {
  fs.writeFileSync(path.join(home, 'cordis.patch.yml'), '- insert: []\n')
  for (const p of profiles) {
    fs.mkdirSync(path.join(home, 'profiles', p), { recursive: true })
    fs.writeFileSync(path.join(home, 'profiles', p, 'cordis.patch.yml'), '- insert: []\n')
  }
  // 遗留目录：两个旧格式预设 + 一个空目录（不算）+ 一个非目录项（不算）
  for (const id of ['alpha', 'beta']) {
    fs.mkdirSync(path.join(home, '.agent-presets', id), { recursive: true })
    fs.writeFileSync(path.join(home, '.agent-presets', id, 'agent.cordis.yml'), '- id: x\n')
    fs.writeFileSync(path.join(home, '.agent-presets', id, 'preset.yml'), 'name: x\n')
  }
  fs.mkdirSync(path.join(home, '.agent-presets', 'empty-dir'), { recursive: true })
  fs.writeFileSync(path.join(home, '.agent-presets', 'a-file'), 'x')
}

test('resolveDshHome: 显式覆盖优先于环境变量与默认值', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshpm-ovr-'))
  try {
    assert.equal(resolveDshHome(dir), fs.realpathSync(dir))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('resolveDshHome: 无覆盖时回退 ~/.dsh', () => {
  const saved = process.env.DSH_HOME
  delete process.env.DSH_HOME
  try {
    assert.equal(resolveDshHome(), path.join(os.homedir(), '.dsh'))
  } finally {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
  }
})

test('collectPatchFiles: home 在前，profile 按名排序，可关闭', () => {
  const home = tmpHomeInTest()
  mkHomeLayout(home)
  const all = collectPatchFiles(home)
  assert.equal(all.length, 3)
  assert.equal(all[0].layer, 'home')
  assert.equal(all[1].profile, 'cli')
  assert.equal(all[2].profile, 'web')
  const homeOnly = collectPatchFiles(home, { scanProfiles: false })
  assert.equal(homeOnly.length, 1)
  assert.equal(homeOnly[0].layer, 'home')

  function tmpHomeInTest() {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshpm-pf-'))
    process.on('exit', () => fs.rmSync(home, { recursive: true, force: true }))
    return home
  }
})

test('collectPatchFiles: 无任何文件时返回空数组', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshpm-empty-'))
  try {
    assert.deepEqual(collectPatchFiles(home), [])
    assert.deepEqual(collectLegacyDirs(home), [])
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('collectLegacyDirs: 只收含双文件之一的目录，按 id 排序', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshpm-legacy-'))
  try {
    mkHomeLayout(home)
    const dirs = collectLegacyDirs(home)
    assert.deepEqual(
      dirs.map((d) => d.id),
      ['alpha', 'beta'],
    )
    assert.ok(dirs[0].compositionFile.endsWith('agent.cordis.yml'))
    assert.ok(dirs[0].metadataFile.endsWith('preset.yml'))
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('readText: 中文 UTF-8 无损', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dshpm-enc-')), 'a.yml')
  try {
    fs.writeFileSync(file, 'name: 标准模式\n', 'utf8')
    assert.equal(readText(file), 'name: 标准模式\n')
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true })
  }
})
