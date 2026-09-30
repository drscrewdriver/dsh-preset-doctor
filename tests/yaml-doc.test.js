import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePatchDoc, loadPatch, stringifyNode, lineOf } from '../src/yaml-doc.js'

const PATCH = [
  '- insert:',
  '    - id: row',
  "      name: '@deepseek-ai/dsh-tool-bash'",
  "      disabled: !!js process.platform === 'win32'",
  '      flag: !!js true',
  '      note: 中文备注',
].join('\n')

test('parsePatchDoc: !!js 标签无错误且保留原文', () => {
  const { doc } = parsePatchDoc(PATCH)
  assert.equal(doc.errors.length, 0)
  const row = doc.contents.items[0].get('insert', true).items[0]
  assert.equal(row.get('disabled'), "process.platform === 'win32'")
  assert.equal(row.get('disabled', true).tag, 'tag:yaml.org,2002:js')
  assert.equal(row.get('flag'), 'true')
})

test('loadPatch: !!js 值为原文标量', () => {
  const v = loadPatch(PATCH)
  assert.equal(v[0].insert[0].disabled, "process.platform === 'win32'")
  assert.equal(v[0].insert[0].flag, 'true')
})

test('!!js 表达式序列化字节保真', () => {
  const { doc } = parsePatchDoc(PATCH)
  const row = doc.contents.items[0].get('insert', true).items[0]
  const out = stringifyNode(row)
  assert.ok(out.includes("disabled: !!js process.platform === 'win32'"), `输出缺 !!js 原文: ${out}`)
  const reparsed = loadPatch(out)
  assert.equal(reparsed.disabled, "process.platform === 'win32'")
})

test('!!js true 序列化字节保真（标签正确命中后无需引号）', () => {
  const { doc } = parsePatchDoc(PATCH)
  const row = doc.contents.items[0].get('insert', true).items[0]
  const out = stringifyNode(row)
  assert.ok(out.includes('flag: !!js true'), out)
  assert.equal(loadPatch(out).flag, 'true')
})

test('多行字符串（含空行）块字面量值级往返无损', () => {
  const value = 'line1\n\nline3\n  indented\n中文行'
  const out = stringifyNode({ prefix: value })
  assert.equal(loadPatch(out).prefix, value)
  assert.ok(out.includes('|-'), '多行字符串应走块字面量')
})

test('键名不被加引号', () => {
  const out = stringifyNode({ prefix: 'a\n\nb' })
  assert.ok(out.startsWith('prefix: |-'), out)
})

test('lineOf 给出 1-based 行号', () => {
  const { doc, lineCounter } = parsePatchDoc(PATCH)
  const row = doc.contents.items[0].get('insert', true).items[0]
  const nameNode = row.get('name', true)
  assert.equal(lineOf(lineCounter, nameNode.range[0]), 3)
})

test('解析既有 fixtures 不报错（真实数据冒烟）', async () => {
  const { readFileSync, readdirSync } = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const dir = fileURLToPath(new URL('./fixtures/converted/', import.meta.url))
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.yml')) continue
    const { doc } = parsePatchDoc(readFileSync(path.join(dir, f), 'utf8'))
    assert.equal(doc.errors.length, 0, `${f} 应无解析错误: ${doc.errors.map((e) => e.message).join('; ')}`)
  }
})
