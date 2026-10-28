#!/usr/bin/env node
/**
 * shot.mjs — 用 chrome-devtools-mcp 背后的同一台 Chrome 截图，不需要 playwright。
 *
 * 走 CDP：新建一个 target → 设视口 → 等字体与动画稳定 → Page.captureScreenshot
 * → 写 PNG → 关 target。这样在 WSL 里没有 python playwright / Pillow 也能出图。
 *
 * 用法：
 *   node design-demos/shot.mjs <url> <out.png> [--width 1440] [--height 1000]
 *                              [--dark] [--selector .dshsk-panel] [--scale 2]
 *                              [--wait 800]
 *
 *   --dark      给 <html> 加 data-ds-dark-theme（DSH 的暗色开关在 body 上）
 *   --selector  只截这个元素的包围盒（默认整页视口）
 */

const args = process.argv.slice(2)
const url = args[0]
const out = args[1]
if (!url || !out) {
  console.error('usage: node shot.mjs <url> <out.png> [--width N] [--height N] [--dark] [--selector CSS] [--scale N] [--wait ms]')
  process.exit(2)
}

const opt = { width: 1440, height: 1000, dark: false, selector: null, scale: 1, wait: 800 }
for (let i = 2; i < args.length; i += 1) {
  const a = args[i]
  if (a === '--dark') opt.dark = true
  else if (a === '--width') opt.width = Number(args[++i])
  else if (a === '--height') opt.height = Number(args[++i])
  else if (a === '--selector') opt.selector = args[++i]
  else if (a === '--scale') opt.scale = Number(args[++i])
  else if (a === '--wait') opt.wait = Number(args[++i])
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function cdp() {
  const res = await fetch('http://127.0.0.1:9222/json/version')
  const { webSocketDebuggerUrl } = await res.json()
  const ws = new WebSocket(webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  let id = 0
  const pending = new Map()
  const events = []
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data)
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    } else if (msg.method) {
      events.push(msg)
    }
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const msgId = ++id
    pending.set(msgId, { resolve, reject })
    ws.send(JSON.stringify({ id: msgId, method, params, sessionId }))
  })
  return { ws, send, events }
}

const { ws, send, events } = await cdp()
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const S = (method, params) => send(method, params, sessionId)

await S('Page.enable')
await S('Runtime.enable')
await S('Emulation.setDeviceMetricsOverride', {
  width: opt.width, height: opt.height, deviceScaleFactor: opt.scale, mobile: false,
})

const consoleErrors = []
ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data)
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map(a => a.value ?? a.description ?? '').join(' '))
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(msg.params.exceptionDetails?.exception?.description || 'exception')
  }
})

await S('Page.navigate', { url })
// Wait for load: poll readyState, then settle fonts + our --wait window.
for (let i = 0; i < 100; i += 1) {
  const { result } = await S('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true })
  if (result.value === 'complete') break
  await sleep(100)
}
await S('Runtime.evaluate', { expression: 'document.fonts ? document.fonts.ready.then(() => true) : true', awaitPromise: true })
if (opt.dark) {
  await S('Runtime.evaluate', {
    expression: `document.body.setAttribute('data-ds-dark-theme', ''); document.documentElement.setAttribute('data-theme','dark'); true`,
  })
}
await sleep(opt.wait)

let clip
if (opt.selector) {
  const { result } = await S('Runtime.evaluate', {
    expression: `(() => { const el = document.querySelector(${JSON.stringify(opt.selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
    returnByValue: true,
  })
  if (!result.value) {
    console.error('selector not found:', opt.selector)
    await send('Target.closeTarget', { targetId })
    ws.close()
    process.exit(3)
  }
  clip = { ...result.value, scale: 1 }
}

// captureBeyondViewport breaks backdrop-filter compositing (the panel paints
// empty), so the viewport is sized to the shot instead and capture stays
// in-viewport.
const shot = await S('Page.captureScreenshot', {
  format: 'png',
  ...(clip ? { clip: { ...clip, scale: 1 }, captureBeyondViewport: true } : {}),
})

const { writeFileSync, mkdirSync } = await import('node:fs')
const { dirname } = await import('node:path')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, Buffer.from(shot.data, 'base64'))

await send('Target.closeTarget', { targetId })
ws.close()

if (consoleErrors.length) {
  console.error('console errors:', consoleErrors.slice(0, 5))
  process.exit(1)
}
console.log('ok', out)
