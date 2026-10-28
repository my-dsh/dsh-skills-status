#!/usr/bin/env node
/**
 * measure.mjs — layout audit at several viewport widths, over CDP.
 *
 * `references/modules/web.md` asks for at least 1440 and 375 to be verified. This
 * reports, per width: horizontal overflow (whole document), any element sticking
 * out past the content box, and the panel's own box — enough to catch the classic
 * `100vw` scrollbar overflow and wide non-wrapping rows.
 *
 * Usage:
 *   node design-demos/measure.mjs <url> [--widths 1440,375] [--selector .panel]
 */

import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const url = args[0]
if (!url) {
  console.error('usage: node measure.mjs <url> [--widths 1440,375] [--selector .panel]')
  process.exit(2)
}
let widths = [1440, 375]
let selector = '.panel'
for (let i = 1; i < args.length; i += 1) {
  if (args[i] === '--widths') widths = args[++i].split(',').map(Number)
  else if (args[i] === '--selector') selector = args[++i]
}

const res = await fetch('http://127.0.0.1:9222/json/version')
const { webSocketDebuggerUrl } = await res.json()
const ws = new WebSocket(webSocketDebuggerUrl)
await new Promise((ok, no) => {
  ws.addEventListener('open', ok, { once: true })
  ws.addEventListener('error', no, { once: true })
})
let id = 0
const pending = new Map()
ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data)
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(JSON.stringify(msg.error)))
    else resolve(msg.result)
  }
})
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const msgId = ++id
  pending.set(msgId, { resolve, reject })
  ws.send(JSON.stringify({ id: msgId, method, params, sessionId }))
})

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const S = (m, p) => send(m, p, sessionId)
await S('Page.enable')
await S('Runtime.enable')

let bad = 0
for (const width of widths) {
  await S('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
  await S('Page.navigate', { url })
  for (let i = 0; i < 100; i += 1) {
    const { result } = await S('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true })
    if (result.value === 'complete') break
    await new Promise(r => setTimeout(r, 100))
  }
  await new Promise(r => setTimeout(r, 400))
  const { result } = await S('Runtime.evaluate', {
    expression: `(() => {
      const doc = document.documentElement;
      const content = doc.clientWidth;
      const panel = document.querySelector(${JSON.stringify(selector)});
      const pr = panel ? panel.getBoundingClientRect() : null;
      const outside = [...document.querySelectorAll('body *')]
        .map(e => ({ tag: e.tagName, cls: String(e.className || '').slice(0, 40), r: e.getBoundingClientRect() }))
        .filter(x => x.r.width > 0 && (x.r.right > content + 1 || x.r.left < -1))
        .slice(0, 8)
        .map(x => \`\${x.tag}.\${x.cls} left=\${Math.round(x.r.left)} right=\${Math.round(x.r.right)}\`);
      return {
        contentWidth: content,
        scrollWidth: doc.scrollWidth,
        overflowX: doc.scrollWidth > content + 1,
        panel: pr ? { w: Math.round(pr.width), h: Math.round(pr.height), right: Math.round(pr.right) } : null,
        outside,
      };
    })()`,
    returnByValue: true,
  })
  const v = result.value
  const flag = v.overflowX || v.outside.length ? '✗' : '✓'
  if (flag === '✗') bad += 1
  console.log(`${flag} ${width}px  内容宽 ${v.contentWidth} / 滚动宽 ${v.scrollWidth}` +
    (v.panel ? `　面板 ${v.panel.w}×${v.panel.h}` : ''))
  for (const o of v.outside) console.log(`    overflow: ${o}`)
}

await send('Target.closeTarget', { targetId })
ws.close()
process.exit(bad ? 1 : 0)
