#!/usr/bin/env node
/**
 * probe.mjs — run huashu-design's design_lint COLLECT_JS over a page with Chrome,
 * and write the facts JSON that `lint.py` then judges.
 *
 * This is the playwright replacement: design_lint's collector is a plain function
 * source string, so it runs unchanged inside Chrome over CDP.
 *
 * Usage:
 *   node design-demos/probe.mjs <url> <out.json> [--selector .panel] [--dark]
 *                               [--width 1440] [--height 1000]
 *
 *   --selector   collect only inside this subtree (for a panel sitting on a host
 *                page, so the host's own chrome does not pollute the numbers)
 *   --dark       flip DSH's dark theme attribute before collecting
 *   --expand     un-clip the panel's internal scroller before collecting, so every
 *                row is painted and measured. Contrast sampling uses
 *                elementsFromPoint, which cannot see rows clipped out of a
 *                scrollport; without this the rows below the fold read as
 *                white-on-white. Typography and colours are unaffected.
 *   --attach     measure the page already open at --match <url-fragment> instead
 *                of loading a fresh one. Needed for anything that only exists
 *                after an interaction, like the plugin's popover.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const { COLLECT_JS } = (() => {
  const src = readFileSync(resolve(HERE, '.collect.js'), 'utf8')
  const body = src.slice(src.indexOf('= ') + 2).replace(/;\s*$/, '')
  return { COLLECT_JS: JSON.parse(body) }
})()

const args = process.argv.slice(2)
const url = args[0]
const out = args[1]
if (!url || !out) {
  console.error('usage: node probe.mjs <url> <out.json> [--selector CSS] [--dark] [--width N] [--height N]')
  process.exit(2)
}
const opt = { selector: null, dark: false, expand: false, attach: null, width: 1440, height: 1000 }
for (let i = 2; i < args.length; i += 1) {
  const a = args[i]
  if (a === '--selector') opt.selector = args[++i]
  else if (a === '--dark') opt.dark = true
  else if (a === '--expand') opt.expand = true
  else if (a === '--attach') opt.attach = args[++i]
  else if (a === '--width') opt.width = Number(args[++i])
  else if (a === '--height') opt.height = Number(args[++i])
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

const res = await fetch('http://127.0.0.1:9222/json/version')
const { webSocketDebuggerUrl } = await res.json()
const ws = new WebSocket(webSocketDebuggerUrl)
await new Promise((ok, no) => {
  ws.addEventListener('open', ok, { once: true })
  ws.addEventListener('error', no, { once: true })
})

let id = 0
const pending = new Map()
const errors = []
ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data)
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(JSON.stringify(msg.error)))
    else resolve(msg.result)
    return
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails?.exception?.description?.slice(0, 160) || 'exception')
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push(msg.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 160))
  }
})
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const msgId = ++id
  pending.set(msgId, { resolve, reject })
  ws.send(JSON.stringify({ id: msgId, method, params, sessionId }))
})

let targetId = null
let sessionId = null
if (opt.attach) {
  const { targetInfos } = await send('Target.getTargets')
  const hit = targetInfos.find(t => t.type === 'page' && t.url.includes(opt.attach))
  if (!hit) {
    console.error('no open page matching', opt.attach)
    process.exit(2)
  }
  const attached = await send('Target.attachToTarget', { targetId: hit.targetId, flatten: true })
  sessionId = attached.sessionId
  targetId = hit.targetId
} else {
  const created = await send('Target.createTarget', { url: 'about:blank' })
  targetId = created.targetId
  const attached = await send('Target.attachToTarget', { targetId, flatten: true })
  sessionId = attached.sessionId
}
const S = (m, p) => send(m, p, sessionId)

await S('Page.enable')
await S('Runtime.enable')
if (!opt.attach) {
  await S('Emulation.setDeviceMetricsOverride', {
    width: opt.width, height: opt.height, deviceScaleFactor: 1, mobile: false,
  })
  await S('Page.navigate', { url })
  for (let i = 0; i < 120; i += 1) {
    const { result } = await S('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true })
    if (result.value === 'complete') break
    await sleep(100)
  }
}
await S('Runtime.evaluate', {
  expression: 'document.fonts ? document.fonts.ready.then(() => true) : true',
  awaitPromise: true,
})
if (opt.dark) {
  await S('Runtime.evaluate', {
    expression: `document.body.setAttribute('data-ds-dark-theme',''); true`,
  })
}
if (opt.expand) {
  await S('Runtime.evaluate', {
    expression: `(() => {
      document.querySelectorAll('.panel').forEach(p => { p.style.height = 'auto'; });
      document.querySelectorAll('.list').forEach(l => { l.style.overflow = 'visible'; l.style.maxHeight = 'none'; });
      document.querySelectorAll('.surface').forEach(s => { s.style.height = 'auto'; s.style.paddingBottom = '18px'; });
      return document.documentElement.scrollHeight;
    })()`,
    returnByValue: true,
  })
  if (!opt.attach) {
    const { result: h } = await S('Runtime.evaluate', { expression: 'document.documentElement.scrollHeight', returnByValue: true })
    await S('Emulation.setDeviceMetricsOverride', {
      width: opt.width, height: Math.max(opt.height, h.value + 20), deviceScaleFactor: 1, mobile: false,
    })
    await sleep(200)
  }
}
await sleep(500)

const setup = opt.selector
  ? `const __root = document.querySelector(${JSON.stringify(opt.selector)}); if (!__root) return { fatal: 'selector not found' };`
  : 'const __root = document.body;'
// Flatten the frosted surface before collecting.
//
// The popover is deliberately translucent (--dsw-specific-menu is 0.58 alpha).
// COLLECT_JS samples the background with elementsFromPoint, which sees straight
// through it to whatever is behind and reports a contrast the reader never
// experiences — on a light page under a dark panel that becomes white-on-white.
// For the duration of the collection only, the root's background is replaced by
// the colour the reader actually sees (each translucent layer composited over
// the next), and restored afterwards. Nothing about the design changes.
const wrapper = `() => {
  ${setup}
  const flatten = (el) => {
    const layers = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') continue;
      const m = cs.backgroundColor.match(/[\\d.]+/g);
      if (!m) continue;
      const [r, g, b] = m.map(Number);
      const a = m.length > 3 ? Number(m[3]) : 1;
      if (a === 0) continue;
      layers.push([r, g, b, a]);
      if (a >= 1) break;
    }
    let out = [255, 255, 255];
    for (let i = layers.length - 1; i >= 0; i -= 1) {
      const [r, g, b, a] = layers[i];
      out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)];
    }
    return out;
  };
  const original = __root.style.backgroundColor;
  const flat = flatten(__root);
  __root.style.backgroundColor = 'rgb(' + flat.map(Math.round).join(',') + ')';
  window.__MIN_BODY = 14;
  window.__MIN_LABEL = 12;
  // The collector walks document.body; re-point it at the requested subtree by
  // running the original body walk against a proxy document whose body is the root.
  const realBody = document.body;
  const collect = ${COLLECT_JS};
  const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'body');
  Object.defineProperty(document, 'body', { configurable: true, get: () => __root });
  try { return collect(); } finally {
    Object.defineProperty(document, 'body', descriptor);
    __root.style.backgroundColor = original;
  }
}`

const { result } = await S('Runtime.evaluate', {
  expression: `(${wrapper})()`,
  returnByValue: true,
  awaitPromise: true,
})
if (!result.value) {
  console.error('collector returned nothing:', JSON.stringify(result).slice(0, 300))
  if (!opt.attach) await send('Target.closeTarget', { targetId })
  ws.close()
  process.exit(3)
}
const facts = result.value
facts.errors = errors
facts.path = url
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(facts, null, 1))

if (!opt.attach) await send('Target.closeTarget', { targetId })
else await send('Target.detachFromTarget', { sessionId })
ws.close()
console.log('ok', out, `text=${facts.textTotal} small=${facts.small?.length ?? 0} contrast=${facts.lowContrast?.length ?? 0}`)
