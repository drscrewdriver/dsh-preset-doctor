/**
 * dsh-preset-manager — 自家 webServer 桥（client 卡的设置数据层）。
 *
 * 0.1.2/0.1.5 插件配置 tab 的卡由 client 半边渲染（宿主派发条件 =
 * served namespaces ∩ settings.plugin.item 卡），数据读写走本桥而非
 * client 侧 settingsScope 数据面。全路由 POST-only + loopback 守卫。
 * describe 出口统一 resolveConfig 解包（≤0.1.5 的 section 值是字段级
 * 活引用，rc.1+ 纯值原样透传，双代无害）。
 */

const BRIDGE_PREFIX = '/api/dsh-preset-manager-settings'
const MAX_JSON_BODY_BYTES = 256 * 1024

/** 本插件暴露给桥的配置键（mutate 白名单，防任意路径写入）。 */
export const BRIDGE_KEYS = ['autoFix', 'scanProfiles', 'migrateLegacy', 'homeOverride']

export function isLoopbackRequest(request) {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try {
    hostUrl = new URL('http://' + host)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function writeJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(JSON.stringify(body))
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

/** describe 描述符 → 桥视图（活引用解包；schema 不外泄，卡是手写表单）。 */
export function toView(settings, descriptor, resolveConfig) {
  return {
    ns: String(descriptor.ns),
    value: resolveConfig(descriptor.value),
    revision: descriptor.revision,
    writable: settings.writable !== false,
  }
}

/**
 * 构造桥路由（返回给 webServer.register 的路由数组）。
 * @param opts.settings settings 服务实例（ctx.inject(['settings']) 的成员）
 * @param opts.ns 本插件 settings namespace
 * @param opts.resolveConfig 活引用解包函数（index.js 提供，测试可注入）
 * @param opts.context 可选扩展面（卡片化 UI）：{ getSummary({fresh}), runSync({key,confirm}) }；
 *        缺省时 list/sync 返回 unavailable——三参旧调用与既有测试不受影响。
 */
export function makeSettingsBridge({ settings, ns, resolveConfig, context } = {}) {
  const ext = context ?? {}
  const mine = () => settings.describe({ redactSecrets: true }).filter((descriptor) => String(descriptor.ns) === ns)

  const handlers = {
    async describe() {
      try {
        const found = mine()[0]
        if (found === undefined) {
          return { ok: false, code: 'settings-not-exposed', message: `settings namespace "${ns}" is not exposed` }
        }
        return { ok: true, value: { namespaces: [toView(settings, found, resolveConfig)] } }
      } catch (error) {
        return { ok: false, code: 'internal', message: error instanceof Error ? error.message : String(error) }
      }
    },

    async mutate(request) {
      const body = request
      if (body === null || typeof body !== 'object' || body.ns !== ns || !Array.isArray(body.ops)) {
        return { ok: false, code: 'settings-rejected', message: 'malformed bridge settings request' }
      }
      const ops = []
      for (const op of body.ops) {
        if (op === null || typeof op !== 'object' || op.op !== 'set' || !Array.isArray(op.path) || op.path.length !== 1) {
          return { ok: false, code: 'settings-rejected', message: 'malformed mutate op (only single-key set is supported)' }
        }
        if (!BRIDGE_KEYS.includes(String(op.path[0]))) {
          return { ok: false, code: 'settings-not-exposed', message: `settings key "${String(op.path[0])}" is not exposed` }
        }
        ops.push({ op: 'set', path: [String(op.path[0])], value: op.value })
      }
      const expectedRevision = typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined
      try {
        await settings.mutate(ns, ops, expectedRevision)
      } catch (error) {
        const conflict = error instanceof Error && /conflict/i.test(`${error.name} ${error.message}`)
        return { ok: false, code: conflict ? 'settings-conflict' : 'internal', message: error instanceof Error ? error.message : String(error) }
      }
      const descriptor = mine()[0]
      if (descriptor === undefined) {
        return { ok: false, code: 'internal', message: `settings namespace "${ns}" was disposed after the mutate` }
      }
      return { ok: true, value: toView(settings, descriptor, resolveConfig) }
    },

    /** 卡片化 UI：预设清单 + 当前版本/代际目录。body {fresh?:true} 重扫。 */
    async list(request) {
      if (typeof ext.getSummary !== 'function') {
        return { ok: false, code: 'unavailable', message: 'summary provider not wired' }
      }
      try {
        const fresh = request !== null && typeof request === 'object' && request.fresh === true
        return { ok: true, value: ext.getSummary({ fresh }) }
      } catch (error) {
        return { ok: false, code: 'internal', message: error instanceof Error ? error.message : String(error) }
      }
    },

    /** 卡片化 UI：单预设同步。body {key, confirm:true}——confirm 缺失即拒绝（全手动确认纪律）。 */
    async sync(request) {
      if (typeof ext.runSync !== 'function') {
        return { ok: false, code: 'unavailable', message: 'sync provider not wired' }
      }
      if (request === null || typeof request !== 'object' || typeof request.key !== 'string' || !request.key) {
        return { ok: false, code: 'sync-rejected', message: 'malformed sync request (key required)' }
      }
      try {
        return await ext.runSync(request)
      } catch (error) {
        return { ok: false, code: 'internal', message: error instanceof Error ? error.message : String(error) }
      }
    },
  }

  const guard = (req, res) => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { error: 'loopback requests only' })
      return false
    }
    if (req.method !== 'POST') {
      writeJson(res, 405, { error: 'method not allowed: ' + (req.method ?? '') })
      return false
    }
    return true
  }

  return [
    {
      kind: 'exact',
      path: `${BRIDGE_PREFIX}/describe`,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        writeJson(res, 200, await handlers.describe())
      },
    },
    {
      kind: 'exact',
      path: `${BRIDGE_PREFIX}/mutate`,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        const body = await readJsonBody(req)
        if (body === undefined) {
          writeJson(res, 400, { ok: false, code: 'settings-rejected', message: 'malformed JSON body' })
          return
        }
        writeJson(res, 200, await handlers.mutate(body))
      },
    },
    {
      kind: 'exact',
      path: `${BRIDGE_PREFIX}/list`,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        const body = await readJsonBody(req)
        writeJson(res, 200, await handlers.list(body ?? {}))
      },
    },
    {
      kind: 'exact',
      path: `${BRIDGE_PREFIX}/sync`,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        const body = await readJsonBody(req)
        if (body === undefined) {
          writeJson(res, 400, { ok: false, code: 'sync-rejected', message: 'malformed JSON body' })
          return
        }
        writeJson(res, 200, await handlers.sync(body))
      },
    },
  ]
}

export { BRIDGE_PREFIX }
