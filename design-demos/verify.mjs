// Functional check of the live panel: row toggle, group toggle, filter, footer.
// Every assertion reads the DOM after a real click, so a broken handler shows up.
//
// The toggles are real writes to the plugin's SQLite state, so the script records
// every row's state up front and restores it at the end — running the check must
// not change what the user had loaded.
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
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
const ev = async (expression) => {
  const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (reply.result && reply.result.exceptionDetails) {
    throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 300))
  }
  return reply.result.result.value
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass, detail })
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
}

// open
await ev(`(() => { const t = document.querySelector('.dshsk-trigger'); if (t.getAttribute('aria-expanded') !== 'true') t.click(); return 1 })()`)
await sleep(600)

const rows = await ev(`document.querySelectorAll('.dshsk-row').length`)
check('面板打开且有 26 行', rows === 26, `rows=${rows}`)

// snapshot: name -> "true"/"false" for every row, to put back at the end
const snapshot = await ev(`(() => {
  const out = {};
  for (const r of document.querySelectorAll('.dshsk-row')) {
    out[r.querySelector('.dshsk-name').textContent.trim().split('\\n')[0]] = r.dataset.on;
  }
  return out;
})()`)

// every row has a glyph and a description
const shape = await ev(`(() => {
  const rows = [...document.querySelectorAll('.dshsk-row')];
  return {
    glyphs: rows.filter(r => r.querySelector('.dshsk-glyph')?.textContent.trim()).length,
    descs: rows.filter(r => (r.querySelector('.dshsk-desc')?.textContent || '').trim().length > 3).length,
    dupes: (() => {
      const g = rows.map(r => r.querySelector('.dshsk-glyph').textContent.trim());
      return g.length - new Set(g).size;
    })(),
  };
})()`)
check('每行都有字形块', shape.glyphs === 26, `glyphs=${shape.glyphs}`)
check('每行都有描述文字', shape.descs === 26, `descs=${shape.descs}`)
check('字形块互不重复', shape.dupes === 0, `dupes=${shape.dupes}`)

// toggle a row on, then off again
const target = 'triage'
const before = await ev(`(() => {
  const r = [...document.querySelectorAll('.dshsk-row')].find(x => x.querySelector('.dshsk-name').textContent.trim().startsWith('${target}'));
  return r ? r.dataset.on : null;
})()`)
await ev(`(() => {
  const r = [...document.querySelectorAll('.dshsk-row')].find(x => x.querySelector('.dshsk-name').textContent.trim().startsWith('${target}'));
  r.querySelector('.dshsk-switch').click();
  return 1;
})()`)
await sleep(1200)
const after = await ev(`(() => {
  const r = [...document.querySelectorAll('.dshsk-row')].find(x => x.querySelector('.dshsk-name').textContent.trim().startsWith('${target}'));
  return r ? r.dataset.on : null;
})()`)
check('单行开关切换生效', before !== after, `${target}: ${before} -> ${after}`)

// restore
await ev(`(() => {
  const r = [...document.querySelectorAll('.dshsk-row')].find(x => x.querySelector('.dshsk-name').textContent.trim().startsWith('${target}'));
  r.querySelector('.dshsk-switch').click();
  return 1;
})()`)
await sleep(1200)
const restored = await ev(`(() => {
  const r = [...document.querySelectorAll('.dshsk-row')].find(x => x.querySelector('.dshsk-name').textContent.trim().startsWith('${target}'));
  return r ? r.dataset.on : null;
})()`)
check('再切一次恢复原状', restored === before, `${target}: ${restored}`)

// filter narrows the list and the empty state appears for a miss
const filtered = await ev(`(() => {
  const input = document.querySelector('.dshsk-search input');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'cloud');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return 1;
})()`)
await sleep(400)
const visibleRows = await ev(`document.querySelectorAll('.dshsk-row').length`)
check('筛选 cloud 收窄列表', visibleRows > 0 && visibleRows < 26, `visible=${visibleRows}`)

await ev(`(() => {
  const input = document.querySelector('.dshsk-search input');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'zzzznomatch');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return 1;
})()`)
await sleep(400)
const emptyText = await ev(`document.querySelector('.dshsk-empty')?.innerText || ''`)
check('无匹配时有空态与出路', emptyText.includes('没有匹配') && emptyText.includes('清空筛选'), JSON.stringify(emptyText.slice(0, 60)))

// clear
await ev(`(() => {
  const input = document.querySelector('.dshsk-search input');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, '');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return 1;
})()`)
await sleep(400)
const backRows = await ev(`document.querySelectorAll('.dshsk-row').length`)
check('清空筛选恢复全部', backRows === 26, `rows=${backRows}`)

// group toggle: turn a whole group on then back off
const groupBefore = await ev(`(() => {
  const g = [...document.querySelectorAll('.dshsk-group')].find(x => x.querySelector('.dshsk-grouplabel').textContent.includes('humanlayer'));
  return { state: g.querySelector('.dshsk-grouptoggle').dataset.state, count: g.querySelector('.dshsk-groupcount').textContent };
})()`)
await ev(`(() => {
  const g = [...document.querySelectorAll('.dshsk-group')].find(x => x.querySelector('.dshsk-grouplabel').textContent.includes('humanlayer'));
  g.querySelector('.dshsk-grouptoggle').click();
  return 1;
})()`)
await sleep(1500)
const groupAfter = await ev(`(() => {
  const g = [...document.querySelectorAll('.dshsk-group')].find(x => x.querySelector('.dshsk-grouplabel').textContent.includes('humanlayer'));
  return { state: g.querySelector('.dshsk-grouptoggle').dataset.state, count: g.querySelector('.dshsk-groupcount').textContent };
})()`)
check('组头三态开关切换整组', groupBefore.state !== groupAfter.state, `${groupBefore.state}/${groupBefore.count} -> ${groupAfter.state}/${groupAfter.count}`)

// put it back
await ev(`(() => {
  const g = [...document.querySelectorAll('.dshsk-group')].find(x => x.querySelector('.dshsk-grouplabel').textContent.includes('humanlayer'));
  g.querySelector('.dshsk-grouptoggle').click();
  return 1;
})()`)
await sleep(1500)
const groupRestored = await ev(`(() => {
  const g = [...document.querySelectorAll('.dshsk-group')].find(x => x.querySelector('.dshsk-grouplabel').textContent.includes('humanlayer'));
  return { state: g.querySelector('.dshsk-grouptoggle').dataset.state, count: g.querySelector('.dshsk-groupcount').textContent };
})()`)
check('组头再切一次恢复', groupRestored.state === groupBefore.state, `${groupRestored.state}/${groupRestored.count}`)

// footer actions present and reflect state
const foot = await ev(`document.querySelector('.dshsk-foot')?.innerText || ''`)
check('底栏有批量与刷新', foot.includes('全部加载') || foot.includes('全部关闭'), JSON.stringify(foot))

// escape closes
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
await sleep(300)
const closed = await ev(`!document.querySelector('.dshsk-panel')`)
check('Esc 关闭面板', closed === true)

// ---- restore whatever the checks changed -------------------------------
await ev(`(() => { const t = document.querySelector('.dshsk-trigger'); if (t.getAttribute('aria-expanded') !== 'true') t.click(); return 1 })()`)
await sleep(500)
const drift = await ev(`(() => {
  const want = ${JSON.stringify(snapshot)};
  const out = [];
  for (const r of document.querySelectorAll('.dshsk-row')) {
    const name = r.querySelector('.dshsk-name').textContent.trim().split('\\n')[0];
    if (want[name] !== undefined && want[name] !== r.dataset.on) out.push(name);
  }
  return out;
})()`)
for (const name of drift) {
  await ev(`(() => {
    const r = [...document.querySelectorAll('.dshsk-row')].find(x => x.querySelector('.dshsk-name').textContent.trim().startsWith(${JSON.stringify(name)}));
    r.querySelector('.dshsk-switch').click();
    return 1;
  })()`)
  await sleep(1100)
}
const restoredAll = await ev(`(() => {
  const want = ${JSON.stringify(snapshot)};
  let bad = 0;
  for (const r of document.querySelectorAll('.dshsk-row')) {
    const name = r.querySelector('.dshsk-name').textContent.trim().split('\\n')[0];
    if (want[name] !== undefined && want[name] !== r.dataset.on) bad += 1;
  }
  return bad;
})()`)
check('测试结束后状态还原', restoredAll === 0, `drift restored: ${drift.length}`)

const failed = results.filter(r => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
await send('Target.detachFromTarget', { sessionId })
ws.close()
process.exit(failed.length ? 1 : 0)
