/**
 * 语法闸（2026-11-08 事故复盘）：
 * `lib/client.js`（client 半边）既不在 eslint 的检查范围内（`ignores: ['lib/']`），
 * 也没有被任何单测 import——而它错了只会在宿主启动时以
 * `web boot: 1 entry did not activate / dsh-preset-doctor: import failed` 炸掉整个应用。
 * 这里对交付的每一份 .js 逐个 `node --check`，把这类错误提前到 `node --test`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      walk(full, out)
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
      out.push(full)
    }
  }
  return out
}

test('交付文件语法：src/ + lib/ 每个 .js 都能被 node --check 解析', () => {
  const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'lib'))]
  assert.ok(files.length > 10, `应扫到交付源码，实际 ${files.length}`)
  const broken = []
  for (const file of files) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
    } catch (error) {
      broken.push(`${path.relative(ROOT, file)}: ${String(error.stderr || error.message).split('\n').slice(0, 3).join(' ')}`)
    }
  }
  assert.deepEqual(broken, [], '以下文件语法错误（会导致宿主 web boot 失败）：\n' + broken.join('\n'))
})

test('清单与实际文件一致：dsh.plugin.json / package.json 指向的入口存在', () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, 'dsh.plugin.json'), 'utf8'))
  const files = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')
  const pkg = JSON.parse(files)
  assert.equal(plugin.version, pkg.version, 'dsh.plugin.json 与 package.json 版本必须一致')
  const main = plugin.main ?? pkg.main
  assert.ok(main && fs.existsSync(path.join(ROOT, main)), `入口文件不存在：${main}`)
  // client 半边：package.json 的 exports["./client"] 指的就是宿主 web boot 加载的那份，
  // 它语法错会直接让整个应用起不来（local.5 事故）——入清单同步校验。
  const exported = [pkg.exports?.['.'], pkg.exports?.['./client']].filter((v) => typeof v === 'string')
  assert.ok(exported.includes('./lib/client.js'), `exports["./client"] 应指向 ./lib/client.js，实际 ${JSON.stringify(pkg.exports)}`)
  for (const rel of exported) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `exports 指向的文件不存在：${rel}`)
  }
})
