#!/usr/bin/env node
/**
 * fingerprint.mjs — palette + layout fingerprints from a PNG, without Pillow.
 *
 * design_lint.py's `compare` and `ledger` read two things off a screenshot:
 * a quantised palette (PIL) and a standardised edge-layout vector. This machine
 * has neither PIL nor playwright, so Chrome decodes the PNG and computes the same
 * two things: colours are quantised to a 5-level cube and the largest buckets are
 * kept, and the layout vector is a 32×20 standardised grayscale-edge map.
 *
 * Output JSON is shaped for design_lint.similar()/ledger, so `compare` and
 * `ledger add` work through design-demos/lint.py --fingerprints.
 *
 * Usage:
 *   node design-demos/fingerprint.mjs <shot.png> [<shot2.png> ...] --out facts.json
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

const args = process.argv.slice(2)
const outIdx = args.indexOf('--out')
const outPath = outIdx >= 0 ? args[outIdx + 1] : 'fingerprints.json'
const files = args.filter((a, i) => !a.startsWith('--') && i !== outIdx + 1)
if (files.length === 0) {
  console.error('usage: node fingerprint.mjs <shot.png …> --out facts.json')
  process.exit(2)
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

const results = []
for (const file of files) {
  const b64 = readFileSync(file).toString('base64')
  const dataUrl = 'data:image/png;base64,' + b64
  const { result } = await S('Runtime.evaluate', {
    expression: `(async () => {
      const img = new Image();
      img.src = ${JSON.stringify(dataUrl)};
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      const { data, width, height } = cx.getImageData(0, 0, cv.width, cv.height);

      // ---- palette: 5-level cube, top buckets by share (PIL quantize stand-in)
      const buckets = new Map();
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const key = ((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5);
        const cur = buckets.get(key) || [0, 0, 0, 0];
        cur[0] += r; cur[1] += g; cur[2] += b; cur[3] += 1;
        buckets.set(key, cur);
      }
      const total = width * height;
      const palette = [...buckets.values()]
        .sort((a, b) => b[3] - a[3]).slice(0, 6)
        .map(v => {
          const rgb = [Math.round(v[0] / v[3]), Math.round(v[1] / v[3]), Math.round(v[2] / v[3])];
          return { hex: '#' + rgb.map(x => x.toString(16).padStart(2, '0').toUpperCase()).join(''),
                   rgb, share: Math.round((v[3] / total) * 1000) / 1000 };
        });

      // ---- layout: grayscale -> edge magnitude -> 32×20 -> standardise
      const W = 32, H = 20;
      const gray = new Float32Array(width * height);
      for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
        gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }
      const small = new Float32Array(W * H);
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
          const x0 = Math.floor((x / W) * width), x1 = Math.max(x0 + 1, Math.floor(((x + 1) / W) * width));
          const y0 = Math.floor((y / H) * height), y1 = Math.max(y0 + 1, Math.floor(((y + 1) / H) * height));
          let sum = 0, n = 0;
          for (let yy = y0; yy < y1; yy += 1) for (let xx = x0; xx < x1; xx += 1) { sum += gray[yy * width + xx]; n += 1; }
          small[y * W + x] = sum / n;
        }
      }
      const edge = new Float32Array(W * H);
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
          const c = small[y * W + x];
          const l = x > 0 ? small[y * W + x - 1] : c;
          const r = x < W - 1 ? small[y * W + x + 1] : c;
          const u = y > 0 ? small[(y - 1) * W + x] : c;
          const d = y < H - 1 ? small[(y + 1) * W + x] : c;
          edge[y * W + x] = Math.abs(2 * c - l - r) + Math.abs(2 * c - u - d);
        }
      }
      const mu = edge.reduce((a, b) => a + b, 0) / edge.length;
      const sd = Math.sqrt(edge.reduce((a, b) => a + (b - mu) ** 2, 0) / edge.length) || 1;
      const layout = [...edge].map(v => Math.round(((v - mu) / sd) * 1000) / 1000);
      return { palette, layout, size: [width, height] };
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  results.push({ path: file, name: basename(file), ...result.value })
}

await send('Target.closeTarget', { targetId })
ws.close()
writeFileSync(outPath, JSON.stringify(results, null, 1))
console.log('ok', outPath, results.map(r => `${r.name}:${r.size.join('x')}`).join(' '))
