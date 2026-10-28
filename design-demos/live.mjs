// Inspect the live GUI's skills-status trigger/panel over CDP.
// Usage: node design-demos/live.mjs [--open] [--shot out.png]
const res = await fetch('http://127.0.0.1:9222/json/version')
const { webSocketDebuggerUrl } = await res.json()
const ws = new WebSocket(webSocketDebuggerUrl)
await new Promise(r => ws.addEventListener('open', r, { once: true }))

let id = 0
const pending = new Map()
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data)
  if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
const send = (method, params = {}, sessionId) => new Promise(r => {
  const i = ++id
  pending.set(i, r)
  ws.send(JSON.stringify({ id: i, method, params, sessionId }))
})

const { result: { targetInfos } } = await send('Target.getTargets')
const page = targetInfos.find(t => t.type === 'page' && t.url.includes('3080'))
if (!page) {
  console.error('no DSH page at :3080')
  process.exit(2)
}
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true })

const evaluate = async (expression) => {
  const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  return reply.result && reply.result.result ? reply.result.result.value : undefined
}

if (process.argv.includes('--open')) {
  await evaluate(`(() => {
    const trig = document.querySelector('.dshsk-trigger');
    if (trig && trig.getAttribute('aria-expanded') !== 'true') trig.click();
    return true;
  })()`)
  await new Promise(r => setTimeout(r, 600))
}

console.log(JSON.stringify(await evaluate(`(() => {
  const trig = document.querySelector('.dshsk-trigger');
  const panel = document.querySelector('.dshsk-panel');
  const out = { trigger: trig ? trig.innerText : null };
  if (panel) {
    const r = panel.getBoundingClientRect();
    out.panel = {
      w: Math.round(r.width), h: Math.round(r.height),
      bg: getComputedStyle(panel).backgroundColor,
      font: getComputedStyle(panel).fontSize,
    };
    out.rows = panel.querySelectorAll('.dshsk-row').length;
    out.groups = panel.querySelectorAll('.dshsk-group').length;
    out.glyphs = [...panel.querySelectorAll('.dshsk-glyph')].slice(0, 8).map(g => g.textContent);
    out.firstDesc = panel.querySelector('.dshsk-desc')?.textContent?.slice(0, 60);
    out.foot = panel.querySelector('.dshsk-foot')?.innerText;
  }
  return out;
})()`), null, 1))

if (process.argv.includes('--shot')) {
  const out = process.argv[process.argv.indexOf('--shot') + 1]
  const box = await send('Runtime.evaluate', {
    expression: `(() => { const p = document.querySelector('.dshsk-panel'); const r = p.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
    returnByValue: true,
  }, sessionId)
  const result = { value: box.result.result.value }
  const shot = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true, clip: { ...result.value, scale: 2 },
  }, sessionId)
  const { writeFileSync } = await import('node:fs')
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
  console.log('shot ->', out)
}

await send('Target.detachFromTarget', { sessionId })
ws.close()
process.exit(0)
