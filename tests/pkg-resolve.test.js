import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pkgPart, isLocalPath, candidateRoots, resolvePkg } from '../src/pkg-resolve.js'

test('pkgPart: scoped 与普通包名取包本体', () => {
  assert.equal(pkgPart('@deepseek-ai/dsh-tool-subagent-control/list-agents'), '@deepseek-ai/dsh-tool-subagent-control')
  assert.equal(pkgPart('@deepseek-ai/dsh-persona'), '@deepseek-ai/dsh-persona')
  assert.equal(pkgPart('dsh-browser-cdp'), 'dsh-browser-cdp')
})

test('isLocalPath: ./ 与 ../ 与反斜杠变体', () => {
  assert.ok(isLocalPath('./x.mjs'))
  assert.ok(isLocalPath('../y/z.mjs'))
  assert.ok(isLocalPath('.\\win.mjs'))
  assert.ok(!isLocalPath('@deepseek-ai/dsh-persona'))
  assert.ok(!isLocalPath('plain-name'))
})

test('candidateRoots: 含本模块祖先链的 node_modules 与可执行文件旁', () => {
  const roots = candidateRoots()
  assert.ok(roots.length >= 1)
  // 本测试文件位于 <root>/tests/，祖先链上应有 <root>/node_modules
  assert.ok(roots.some((r) => r.replace(/\\/g, '/').endsWith('dsh-preset-doctor/node_modules')))
})

test('resolvePkg: 已安装依赖（yaml）可解析', () => {
  const r = resolvePkg('yaml')
  assert.ok(r.ok, JSON.stringify(r))
  assert.ok(r.resolvedPath)
})

test('resolvePkg: 不存在的包返回 ok=false', () => {
  const r = resolvePkg('@deepseek-ai/dsh-definitely-not-exists-xyz')
  assert.equal(r.ok, false)
})

test('resolvePkg: 本地路径直接视为 ok（由 R-LOCAL-PATH 处理）', () => {
  const r = resolvePkg('./tool.mjs')
  assert.equal(r.ok, true)
  assert.equal(r.resolvedVia, 'local-path')
})

test('resolvePkg: 空/非法输入返回 ok=false', () => {
  assert.equal(resolvePkg('').ok, false)
  assert.equal(resolvePkg(null).ok, false)
})
