#!/usr/bin/env python3
"""Build the three direction demos from one content fixture.

Each output is a single self-contained HTML file: the same 26 real skills and the
same DSH theme tokens, rendered once in light and once in dark, so the three
skeletons can be compared without the content drifting between them.

Run:
  python3 design-demos/build_demos.py                      # rebuild dir-*.html
  python3 design-demos/build_demos.py --export-collector    # refresh .collect.js
"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
FIXTURE = json.loads((HERE / '.skills-fixture.json').read_text(encoding='utf-8'))

ON = {
    'huashu-design', 'code-review', 'domain-modeling', 'grilling', 'to-tickets', 'triage',
    'find-skills', 'cloudflare', 'workers-best-practices', 'durable-objects',
}

# Display order mirrors the shipped plugin: real upstreams alphabetically, the
# catch-all local bucket last.
GROUP_ORDER = ['agent.qq.com', 'cloudflare/skills', 'humanlayer/skills',
               'mattpocock/skills', 'vercel-labs/skills', 'local']


def short_codes(names):
    """A short shelf mark per skill, unique within the catalog.

    Two-letter initials collide constantly (cloudflare-one and
    cloudflare-one-migrations are both "co"), and a row handle two rows share is
    not a handle. Taking the first letter of the first three hyphen segments is
    unique across the shipped 26; any residual collision falls back to a longer
    prefix.
    """
    codes = {}
    for name in names:
        parts = [p for p in name.split('-') if p]
        code = ''.join(p[0] for p in parts[:3]) if len(parts) >= 2 else name[:2]
        if len(code) < 2:
            code = name[:2]
        codes[name] = code
    seen = {}
    for name, code in codes.items():
        seen.setdefault(code, []).append(name)
    for code, owners in seen.items():
        if len(owners) == 1:
            continue
        for name in owners:
            for n in range(3, len(name) + 1):
                prefix = name[:n]
                if sum(1 for other in names if other.startswith(prefix)) == 1:
                    codes[name] = prefix
                    break
    return codes


def one_line(text: str) -> str:
    return ' '.join(text.split())


CODES = short_codes([item['name'] for item in FIXTURE])

rows = []
for item in FIXTURE:
    rows.append({
        'name': item['name'],
        'desc': one_line(item['description']),
        'group': item['upstream'],
        'on': item['name'] in ON,
        'mono': CODES[item['name']],
    })

groups = []
for key in GROUP_ORDER:
    members = [r for r in rows if r['group'] == key]
    if not members:
        continue
    groups.append({
        'key': key,
        'rows': members,
        'on': sum(1 for r in members if r['on']),
        'total': len(members),
    })

TOTAL = len(rows)
LOADED = sum(1 for r in rows if r['on'])
WORKSPACE = 'dsh-skills-status'

assert TOTAL == 26 and LOADED == 10, (TOTAL, LOADED)

# ---------------------------------------------------------------- shared shell

TOKENS = """
  :root {
    --menu: rgba(248, 249, 250, 0.58);
    --ink: #0f1115;
    --ink-2: #61666b;
    --ink-3: #81858c;
    --line-1: rgba(0, 0, 0, 0.04);
    --line-2: rgba(0, 0, 0, 0.10);
    --line-3: rgba(0, 0, 0, 0.16);
    --hover: rgba(38, 49, 72, 0.06);
    --brand: #0f1115;
    --brand-ink: #ffffff;
    --ok: #22c55e;
    --radius-lg: 16px;
    --radius-md: 12px;
    --radius-sm: 8px;
    --elev: 0 0 0 0.5px rgba(0, 0, 0, 0.16), 0 3px 8px rgba(0, 0, 0, 0.04), 0 0 20px rgba(0, 0, 0, 0.05);
    --knob: #ffffff;
    --knob-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    --page: #eceef1;
    --page-ink: #0f1115;
    --page-dim: #61666b;
  }
  .dark {
    --menu: rgba(67, 69, 74, 0.45);
    --ink: #f9fafb;
    --ink-2: #cfd3d6;
    --ink-3: #adb2b8;
    --line-1: rgba(255, 255, 255, 0.06);
    --line-2: rgba(255, 255, 255, 0.12);
    --line-3: rgba(255, 255, 255, 0.20);
    --hover: rgba(255, 255, 255, 0.08);
    --brand: #f9fafb;
    --brand-ink: #1b1b1d;
    --elev: 0 0 0 0.5px rgba(255, 255, 255, 0.12), 0 3px 8px rgba(0, 0, 0, 0.35), 0 0 20px rgba(0, 0, 0, 0.28);
    --knob: #1b1b1d;
    --knob-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
    --page: #151517;
    --page-ink: #f9fafb;
    --page-dim: #a2a7ad;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  /* An explicit display in a class rule outranks the UA [hidden] rule, so any
     element toggled by the state switcher needs this to actually hide. */
  [hidden] { display: none !important; }
  body {
    background: #f7f8fa; padding: 34px 40px 44px; color: #0f1115;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB",
                 "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .page-head { max-width: 1180px; }
  .page-kicker { font-size: 12px; color: #61666b; letter-spacing: .01em; }
  .page-title { margin-top: 6px; font-size: 22px; font-weight: 600; letter-spacing: -.01em; }
  .page-note { margin-top: 8px; font-size: 13px; line-height: 21px; color: #61666b; max-width: 760px; }
  .stage { margin-top: 26px; display: flex; gap: 28px; align-items: flex-start; }
  .col { flex: none; width: 404px; }
  .colcap { display: flex; align-items: baseline; gap: 8px; margin-bottom: 9px; font-size: 12px; color: #61666b; }
  .colcap b { font-size: 12px; font-weight: 600; color: #0f1115; }
  .surface {
    width: 100%; min-height: 560px; border-radius: 20px; background: var(--page);
    display: flex; align-items: flex-start; justify-content: center; padding: 18px 12px 24px;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .05);
  }
  .dark.surface { box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .06); }
  .states { margin-top: 30px; }
  .states h2 { font-size: 14px; font-weight: 600; color: #0f1115; }
  .states p { margin-top: 4px; font-size: 14px; line-height: 21px; color: #61666b; max-width: 760px; }
  .states .row { margin-top: 14px; display: flex; gap: 22px; flex-wrap: wrap; }
  .states figure { margin: 0; }
  .states figcaption { margin-top: 7px; font-size: 13px; color: #61666b; }
  .notes { margin-top: 30px; max-width: 1180px; display: flex; gap: 40px; }
  .notes div { flex: 1; }
  .notes dt { font-size: 12px; font-weight: 600; color: #0f1115; }
  .notes dd { margin-top: 3px; font-size: 13px; line-height: 20px; color: #61666b; }

  /* ---- the popover shell every direction shares ---- */
  .panel {
    position: relative; width: 380px; max-width: 100%; height: 524px;
    display: flex; flex-direction: column;
    border-radius: var(--radius-lg); background: var(--menu);
    -webkit-backdrop-filter: blur(40px) saturate(150%);
    backdrop-filter: blur(40px) saturate(150%);
    box-shadow: var(--elev);
    color: var(--ink-2);
    font-size: 14px; line-height: 20px;
    overflow: hidden;
  }
  .panel * { flex-shrink: 0; }
  .panel .grow { flex: 1 1 auto; min-height: 0; }
  .head { display: flex; align-items: center; gap: 10px; padding: 13px 14px 0; }
  .title { font-size: 15px; font-weight: 600; line-height: 22px; color: var(--ink); letter-spacing: -.005em; }
  .x {
    margin-left: auto; width: 26px; height: 26px; display: grid; place-items: center;
    border: none; background: transparent; border-radius: var(--radius-sm);
    color: var(--ink-2); font-size: 15px; line-height: 1; cursor: pointer;
  }
  .x:hover { background: var(--hover); color: var(--ink); }
  .search {
    display: flex; align-items: center; gap: 8px; margin: 10px 14px 4px; height: 30px; padding: 0 9px;
    border: 1px solid var(--line-2); border-radius: var(--radius-sm);
  }
  .search input {
    flex: 1; min-width: 0; border: none; outline: none; background: transparent;
    color: var(--ink); font: inherit; font-size: 13px; line-height: 18px;
  }
  .search input::placeholder { color: var(--ink-2); }
  .sw {
    position: relative; width: 34px; height: 20px; border: none; border-radius: 10px;
    background: var(--line-3); cursor: pointer; transition: background 120ms ease;
  }
  .sw i {
    position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
    background: var(--knob); box-shadow: var(--knob-shadow); transition: transform 120ms ease;
  }
  .sw[aria-checked="true"] { background: var(--brand); }
  .sw[aria-checked="true"] i { transform: translateX(14px); }
  .name { font-size: 14px; line-height: 20px; font-weight: 500; color: var(--ink); }
  .desc {
    display: block; font-size: 14px; line-height: 19px; color: var(--ink-2);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .foot {
    display: flex; align-items: center; gap: 12px; margin-top: auto;
    padding: 9px 14px; border-top: 1px solid var(--line-1);
    font-size: 12px; line-height: 18px; color: var(--ink-2);
  }
  .foot .ws { margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .textbtn {
    border: none; background: transparent; padding: 0; cursor: pointer;
    font: inherit; font-size: 12px; line-height: 18px; color: var(--ink-2);
  }
  .textbtn:hover { color: var(--ink); text-decoration: underline; text-underline-offset: 2px; }
  .textbtn:disabled { color: var(--ink-3); text-decoration: none; cursor: default; }
  .list { overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--line-3) transparent; }
  .list::-webkit-scrollbar { width: 8px; }
  .list::-webkit-scrollbar-thumb { background: var(--line-3); border-radius: 4px; border: 2px solid transparent; background-clip: content-box; }
"""

STATES_CSS = """
  .states { margin-top: 34px; max-width: 1180px; }
  .states h2 { font-size: 14px; font-weight: 600; color: #0f1115; }
  .states > p { margin-top: 4px; font-size: 14px; line-height: 21px; color: #61666b; max-width: 760px; }
  .sframe { margin-top: 16px; display: flex; gap: 20px; flex-wrap: wrap; }
  /* Flex items default to min-width:auto, and a row's nowrap description gives the
     panel a huge min-content width — pin the figure so the panel stays 380px. */
  .sframe figure { margin: 0; flex: 0 0 380px; min-width: 0; }
  .states .panel { width: 380px; }
  .sframe .cap { font-size: 13px; line-height: 19px; color: #61666b; margin-bottom: 8px; }
  .states .panel { box-shadow: 0 0 0 0.5px rgba(0,0,0,.14), 0 3px 8px rgba(0,0,0,.05); }
  .note {
    margin: 8px 14px 0; padding: 7px 9px; border-radius: var(--radius-sm);
    background: rgba(0, 0, 0, .05); font-size: 13px; line-height: 19px; color: var(--ink);
  }
  .note[data-bad="true"] { color: #b42318; background: rgba(180, 35, 24, .08); }
  .surface.dark .note { background: rgba(255, 255, 255, .07); }
  .surface.dark .note[data-bad="true"] { color: #ffb4a8; background: rgba(255, 90, 70, .14); }
  .empty { padding: 26px 18px; text-align: center; }
  .empty b { display: block; font-size: 14px; line-height: 20px; font-weight: 500; color: var(--ink); }
  .empty span { display: block; margin-top: 4px; font-size: 14px; line-height: 20px; color: var(--ink-2); }

  /* Below 900px the light/dark pair and the three state panels stack, and the
     popover keeps its grammar capped to the container. */
  @media (max-width: 900px) {
    body { padding: 22px 12px 30px; }
    .stage { flex-direction: column; gap: 20px; }
    .notes { flex-direction: column; gap: 16px; }
    .col { width: 100%; }
    .panel { width: 100%; }
    .sframe figure { flex: 1 1 100%; }
    .states .panel { width: 100%; }
  }
"""

STATES_JS = """
<script>
(() => {
  const apply = (panel) => {
    const mode = panel.dataset.mode || 'default';
    const input = panel.querySelector('.search input');
    const note = panel.querySelector('.note');
    const list = panel.querySelector('.list');
    const empty = panel.querySelector('.empty');
    if (!input || !list) return;
    const groups = [...list.querySelectorAll('.group')];
    const rows = [...list.querySelectorAll('[data-name]')];

    if (mode === 'filter') {
      input.value = 'cloud';
      groups.forEach(g => {
        let hits = 0;
        [...g.querySelectorAll('[data-name]')].forEach(r => {
          const hit = (r.dataset.name || '').includes('cloud');
          r.hidden = !hit;
          if (hit) hits += 1;
        });
        g.hidden = hits === 0;
      });
      if (note) note.hidden = true;
      if (empty) empty.hidden = true;
      return;
    }

    if (mode === 'empty') {
      input.value = 'zzz';
      groups.forEach(g => { g.hidden = true; });
      if (note) note.hidden = true;
      if (empty) empty.hidden = false;
      return;
    }

    groups.forEach(g => { g.hidden = false; });
    rows.forEach(r => { r.hidden = false; });
    if (empty) empty.hidden = true;
    input.value = '';
    if (note) note.hidden = mode !== 'fail';
  };

  document.querySelectorAll('.state-panel').forEach(apply);
})();
</script>
"""


def page(title: str, kicker: str, note: str, panel_html: str, notes_html: str,
         states_html: str = '') -> str:
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>{TOKENS}{STATES_CSS}
</style>
</head>
<body>
  <header class="page-head">
    <div class="page-kicker">{kicker}</div>
    <h1 class="page-title">{title}</h1>
    <p class="page-note">{note}</p>
  </header>

  <div class="stage">
    <div class="col">
      <div class="colcap"><b>亮色</b>DSH 默认主题</div>
      <div class="surface">{panel_html}</div>
    </div>
    <div class="col">
      <div class="colcap"><b>暗色</b>data-ds-dark-theme</div>
      <div class="surface dark">{panel_html}</div>
    </div>
  </div>

  {states_html}

  <dl class="notes">{notes_html}</dl>
{STATES_JS}</body>
</html>
"""


def states_section(panel_html):
    """The panel's other three states, side by side.

    A popover with only a designed happy path is half designed: an empty search, a
    narrowed search, and a failed Host write all already exist in the shipped
    plugin (the note/mask code is there), so they get the same treatment as the
    resting state. Rendered as three fixed panels — no switcher needed, and no
    fourth copy of the default state.
    """
    def fixed(mode, caption):
        return (f'<figure><div class="cap">{caption}</div>'
                f'<div class="state-panel" data-mode="{mode}">{panel_html}</div></figure>')

    return f"""  <section class="states">
    <h2>同一版的另外三个状态</h2>
    <p>搜索把列表收窄、搜不到、Host 写入失败要回滚——这三个状态在现在的插件里都已经存在，
    所以它们和默认态用同一套骨架，只换内容。</p>
    <div class="sframe">
      {fixed('filter', '筛选中：只留匹配的组与行')}
      {fixed('empty', '无匹配：说清搜的是什么，并给出出路')}
      {fixed('fail', '切换失败：错误落在列表与底栏之间，列表不动')}
    </div>
  </section>"""


def notes(items):
    return ''.join(f'<div><dt>{k}</dt><dd>{v}</dd></div>' for k, v in items)


# ---------------------------------------------------------------- direction A

def build_a():
    def row(r):
        return f"""        <div class="a-row" data-name="{r['name']}" data-on="{str(r['on']).lower()}">
          <span class="a-mono">{r['mono']}</span>
          <span class="a-body"><span class="name">{r['name']}</span><span class="desc">{r['desc']}</span></span>
          <button class="sw" role="switch" aria-checked="{str(r['on']).lower()}" aria-label="{'关闭' if r['on'] else '加载'} {r['name']}"><i></i></button>
        </div>"""

    body = []
    for g in groups:
        all_on = g['on'] == g['total']
        state = 'all' if all_on else ('none' if g['on'] == 0 else 'mixed')
        body.append(f"""      <section class="a-group group">
        <div class="a-ghead">
          <button class="a-gbox" data-state="{state}" role="checkbox" aria-checked="{'true' if all_on else 'false'}" aria-label="{g['key']} 全部加载"></button>
          <span class="a-gname">{g['key']}</span>
          <span class="a-gcount">{g['on']}/{g['total']}</span>
        </div>
{chr(10).join(row(r) for r in g['rows'])}
      </section>""")

    panel = f"""      <div class="panel a-panel">
        <div class="head">
          <span class="title">技能</span>
          <span class="a-readout">{LOADED}<span>/{TOTAL}</span></span>
          <button class="x" aria-label="关闭">×</button>
        </div>
        <label class="search"><input type="search" placeholder="筛选技能" aria-label="筛选技能"></label>
        <div class="list grow">
{chr(10).join(body)}
          <div class="empty" hidden><b>没有匹配的技能</b><span>换个词试试，或清空筛选看全部 26 个。</span></div>
        </div>
        <div class="note" data-bad="true" hidden>切换失败：Host 写入失败。已恢复上一个状态。</div>
        <div class="foot">
          {'<button class="textbtn">全部加载</button>' if LOADED < TOTAL else ''}
          {'<button class="textbtn">全部关闭</button>' if LOADED > 0 else ''}
          <span class="ws">{WORKSPACE}</span>
        </div>
      </div>"""

    extra_css = """
  /* ---- A: every row gets a face ---- */
  .a-readout {
    font-size: 12px; line-height: 18px; color: var(--ink-2);
    font-variant-numeric: tabular-nums; letter-spacing: .01em;
  }
  .a-readout span { color: var(--ink-2); }
  .a-group { padding: 2px 8px 6px; }
  /* The group control sits in the glyph column, not on the switch column: the
     right-hand axis carries exactly one kind of control, and a select-all box
     aligned with the row handles reads as "this whole block". */
  .a-ghead { display: flex; align-items: center; gap: 10px; padding: 9px 6px 3px; }
  .a-gbox {
    width: 26px; height: 18px; border: none; background: transparent; cursor: pointer;
    display: grid; place-items: center; padding: 0; border-radius: 5px;
  }
  .a-gbox::before {
    content: ""; width: 14px; height: 14px; border-radius: 4px;
    box-shadow: inset 0 0 0 1.5px var(--line-3); background: transparent;
  }
  .a-gbox[data-state="all"]::before { background: var(--brand); box-shadow: inset 0 0 0 1.5px var(--brand); }
  .a-gbox[data-state="all"]::after {
    content: ""; position: absolute; width: 7px; height: 4px; margin-top: -2px;
    border-left: 1.5px solid var(--brand-ink); border-bottom: 1.5px solid var(--brand-ink);
    transform: rotate(-45deg);
  }
  .a-gbox[data-state="mixed"]::before { box-shadow: inset 0 0 0 1.5px var(--line-3); background: transparent; }
  .a-gbox[data-state="mixed"]::after {
    content: ""; position: absolute; width: 7px; height: 1.5px; background: var(--ink-2); border-radius: 1px;
  }
  .a-gbox { position: relative; }
  .a-gname { font-size: 13px; line-height: 18px; font-weight: 600; color: var(--ink); }
  .a-gcount { font-size: 12px; line-height: 18px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
  .a-row {
    display: flex; align-items: center; gap: 10px;
    padding: 7px 6px; border-radius: var(--radius-sm);
  }
  .a-row:hover { background: var(--hover); }
  .a-mono {
    flex: none; width: 26px; height: 26px; border-radius: 7px; display: grid; place-items: center;
    font-size: 12px; line-height: 1; font-weight: 600; letter-spacing: .01em;
    background: var(--brand); color: var(--brand-ink);
  }
  .a-row[data-on="false"] .a-mono {
    background: transparent; color: var(--ink-2); box-shadow: inset 0 0 0 1px var(--line-2);
  }
  .a-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .a-row .sw { margin-left: 2px; }
"""
    panel = panel.replace('<div class="panel a-panel">', '<div class="panel a-panel">')
    html = page(
        '方向 A：每行一张脸',
        '技能加载面板重设计 / 方向 A / 六选三',
        'Susan Kare 的做法：每个控件都该一眼可辨。这里把它用在「26 个抽象标识符」上——'
        '每行左边一枚双字母字形块做扫描锚点，名字下面直接给出那句能帮你做决定的话；'
        '状态只由开关和字形块的实/虚表达，整列「已加载」被删掉。',
        panel,
        notes([
            ('骨架', '标题加读数一行 → 搜索 → 按上游分组 → 行 = 字形块 + 名字 + 描述 + 开关'),
            ('胆量', '把 description 从 title 属性提到行内做主信息；整列状态词删掉，一个比特只说一次'),
            ('取舍', '行高 54px，一屏 7 行；26 条要滚，靠搜索和分组收敛。组头是全选方框，不是「全部加载」文字按钮'),
        ]),
        states_section(panel),
    )
    html = html.replace('</style>', extra_css + '</style>')
    return html


# ---------------------------------------------------------------- direction B

def build_b():
    ticks = ''.join(
        f'<i class="{"on" if r["on"] else ""}" title="{r["name"]}"></i>' for r in rows)

    def mini(g):
        return ''.join(f'<i class="{"on" if r["on"] else ""}"></i>' for r in g['rows'])

    def row(r):
        return f"""        <div class="b-row" data-name="{r['name']}" data-on="{str(r['on']).lower()}">
          <span class="b-body"><span class="name">{r['name']}</span><span class="desc">{r['desc']}</span></span>
          <button class="sw" role="switch" aria-checked="{str(r['on']).lower()}" aria-label="{'关闭' if r['on'] else '加载'} {r['name']}"><i></i></button>
        </div>"""

    body = []
    for g in groups:
        state = 'all' if g['on'] == g['total'] else ('none' if g['on'] == 0 else 'mixed')
        body.append(f"""      <section class="b-group group">
        <div class="b-ghead">
          <span class="b-gname">{g['key']}</span>
          <span class="b-gmeter">{mini(g)}</span>
          <span class="b-gcount">{g['on']}/{g['total']}</span>
          <button class="b-gsw" data-state="{state}" role="switch" aria-checked="{'true' if g['on'] > 0 else 'false'}" aria-label="{g['key']} 全部加载"><i></i></button>
        </div>
{chr(10).join(row(r) for r in g['rows'])}
      </section>""")

    panel = f"""      <div class="panel b-panel">
        <div class="head">
          <span class="title">技能</span>
          <button class="x" aria-label="关闭">×</button>
        </div>
        <div class="b-readout">
          <span class="b-num">{LOADED}</span>
          <span class="b-of">/{TOTAL} 已加载</span>
          <span class="b-acts"><button class="textbtn">全部加载</button><button class="textbtn">全部关闭</button></span>
        </div>
        <div class="b-meter">{ticks}</div>
        <label class="search"><input type="search" placeholder="筛选技能" aria-label="筛选技能"></label>
        <div class="list grow">
{chr(10).join(body)}
          <div class="empty" hidden><b>没有匹配的技能</b><span>换个词试试，或清空筛选看全部 26 个。</span></div>
        </div>
        <div class="note" data-bad="true" hidden>切换失败：Host 写入失败。已恢复上一个状态。</div>
        <div class="foot"><span>{WORKSPACE}</span><span class="ws">按工作区保存</span></div>
      </div>"""

    extra_css = """
  /* ---- B: read the state before you read the list ---- */
  .b-panel .head { gap: 8px; }
  .b-readout { display: flex; align-items: baseline; gap: 7px; padding: 8px 14px 0; }
  .b-acts { margin-left: auto; display: flex; gap: 10px; align-self: center; }
  .b-num {
    font-size: 26px; line-height: 30px; font-weight: 500; color: var(--ink);
    font-variant-numeric: tabular-nums; letter-spacing: -.02em;
  }
  .b-of { font-size: 12px; line-height: 18px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
  .b-meter { display: flex; gap: 2px; height: 14px; padding: 0 14px; margin: 10px 0 2px; }
  .b-meter i { flex: 1 1 0; min-width: 0; border-radius: 1.5px; background: var(--line-3); }
  .b-meter i.on { background: var(--ink); }
  .b-group { padding: 0 8px 4px; }
  .b-ghead { display: flex; align-items: center; gap: 8px; padding: 9px 6px 3px; }
  .b-gname { font-size: 13px; line-height: 18px; font-weight: 600; color: var(--ink); }
  .b-gmeter { margin-left: auto; display: flex; gap: 1.5px; height: 9px; align-items: stretch; }
  .b-gmeter i { width: 3px; border-radius: 1px; background: var(--line-3); }
  .b-gmeter i.on { background: var(--ink); }
  .b-gcount { font-size: 12px; line-height: 18px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
  .b-gsw {
    position: relative; width: 26px; height: 15px; border: none; border-radius: 8px;
    background: var(--line-3); cursor: pointer;
  }
  .b-gsw i {
    position: absolute; top: 2px; left: 2px; width: 11px; height: 11px; border-radius: 50%;
    background: var(--knob); box-shadow: var(--knob-shadow); transition: transform 120ms ease;
  }
  .b-gsw[data-state="all"] { background: var(--brand); }
  .b-gsw[data-state="all"] i { transform: translateX(11px); }
  .b-gsw[data-state="mixed"] { background: transparent; box-shadow: inset 0 0 0 1px var(--line-3); }
  .b-gsw[data-state="mixed"] i {
    left: 7px; width: 12px; height: 3px; border-radius: 1.5px; top: 6px; box-shadow: none;
    background: var(--ink-2);
  }
  .b-row { display: flex; align-items: center; gap: 10px; padding: 7px 6px; border-radius: var(--radius-sm); }
  .b-row:hover { background: var(--hover); }
  .b-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
"""
    html = page(
        '方向 B：读数带',
        '技能加载面板重设计 / 方向 B / 六选三',
        'Braun 控制面板的做法：先给读数，再给操作件。26 个技能本身就是一条 26 段的开关阵列，'
        '所以顶部先画一条刻度——哪几路通着，不用读一行字；每个组头带一条自己的微型刻度，'
        '右侧那枚三态小开关负责整组。',
        panel,
        notes([
            ('骨架', '标题 → 大号读数 + 26 段刻度 → 搜索 → 分组列表（组头带微型刻度与三态组开关）'),
            ('胆量', '把 26 个技能画成一条刻度：它同时替代了现在重复三遍的计数，并让「通了哪几路」一眼可见'),
            ('取舍', '刻度占掉约 44px 高度；26 段在 380px 里每段 11px，超过 60 个技能时要改成两行或省略号'),
        ]),
        states_section(panel),
    )
    html = html.replace('</style>', extra_css + '</style>')
    return html


# ---------------------------------------------------------------- direction C

def build_c():
    def row(r):
        return f"""        <div class="c-row" data-name="{r['name']}" data-on="{str(r['on']).lower()}">
          <span class="c-body"><span class="name">{r['name']}</span><span class="desc">{r['desc']}</span></span>
          <button class="sw" role="switch" aria-checked="{str(r['on']).lower()}" aria-label="{'关闭' if r['on'] else '加载'} {r['name']}"><i></i></button>
        </div>"""

    body = []
    for g in groups:
        body.append(f"""      <div class="c-sec group">
        <div class="c-slabel">{g['key']}<span>{g['on']}/{g['total']}</span></div>
{chr(10).join(row(r) for r in g['rows'])}
      </div>""")

    panel = f"""      <div class="panel c-panel">
        <div class="head">
          <span class="title">技能</span>
          <button class="x" aria-label="关闭">×</button>
        </div>
        <label class="search"><input type="search" placeholder="筛选技能" aria-label="筛选技能"><span class="c-count">{LOADED}/{TOTAL}</span></label>
        <div class="c-chips">
          <button class="c-chip" aria-pressed="true">全部<span>{TOTAL}</span></button>
          <button class="c-chip" aria-pressed="false">cloudflare<span>14</span></button>
          <button class="c-chip" aria-pressed="false">mattpocock<span>8</span></button>
          <button class="c-chip" aria-pressed="false">其他<span>4</span></button>
        </div>
        <div class="c-scopebar">
          <span class="c-scope">全部 26 个</span>
          <button class="textbtn">全部加载</button>
          <button class="textbtn">全部关闭</button>
        </div>
        <div class="list grow">
{chr(10).join(body)}
          <div class="empty" hidden><b>没有匹配的技能</b><span>换个词试试，或清空筛选看全部 26 个。</span></div>
        </div>
        <div class="note" data-bad="true" hidden>切换失败：Host 写入失败。已恢复上一个状态。</div>
        <div class="foot">
          <span>{WORKSPACE}</span>
          <span class="ws">按工作区保存</span>
        </div>
      </div>"""

    extra_css = """
  /* ---- C: filter by the batch you installed, then read one flat list ---- */
  .c-panel .search { margin-bottom: 8px; }
  .c-count { font-size: 12px; line-height: 18px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
  .c-chips { display: flex; gap: 6px; padding: 0 14px; overflow: hidden; }
  .c-chip {
    display: flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px;
    border: 1px solid var(--line-2); border-radius: var(--radius-sm);
    background: transparent; cursor: pointer;
    font: inherit; font-size: 12px; line-height: 18px; color: var(--ink-2); white-space: nowrap;
  }
  .c-chip span { font-variant-numeric: tabular-nums; }
  .c-chip[aria-pressed="true"] { background: var(--brand); border-color: var(--brand); color: var(--brand-ink); }
  .c-scopebar {
    display: flex; align-items: center; gap: 12px; padding: 10px 14px 6px;
    border-bottom: 1px solid var(--line-1);
  }
  .c-scope { font-size: 12px; line-height: 18px; color: var(--ink-2); }
  .c-scopebar .textbtn:first-of-type { margin-left: auto; }
  .c-sec { padding: 0 8px 6px; }
  .c-slabel {
    display: flex; align-items: center; gap: 8px; padding: 9px 6px 3px;
    font-size: 12px; line-height: 18px; font-weight: 600; color: var(--ink-2);
  }
  .c-slabel span { margin-left: auto; font-weight: 400; font-variant-numeric: tabular-nums; }
  .c-row { display: flex; align-items: center; gap: 10px; padding: 7px 6px; border-radius: var(--radius-sm); }
  .c-row:hover { background: var(--hover); }
  .c-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .c-row[data-on="false"] .name { color: var(--ink-2); font-weight: 400; }
"""
    html = page(
        '方向 C：作用域筛选',
        '技能加载面板重设计 / 方向 C / 六选三',
        'VS Code 扩展视图的做法：同一种问题（已安装的能力，逐个启用）已经有一个成熟答案——'
        '一行两段文字，关掉的行整行降级，筛选器是主控件。这里把「上游仓库」变成作用域筛选器，'
        '于是整棵可折叠分组树连同它的记忆状态一起消失，列表永远只有一个真相。',
        panel,
        notes([
            ('骨架', '标题 → 搜索（右侧嵌读数）→ 作用域 chip → 当前作用域的批量条 → 扁平列表（分组只做小标题）'),
            ('胆量', '删掉折叠树：现在的「全关即折叠 + 手动折叠带 allOff 戳记」是一台状态机，换成作用域筛选后它整体消失'),
            ('取舍', '扁平列表里组标题只做分隔，长列表靠 sticky 标题保上下文；chip 超过 6 个时要变成可横向滚动'),
        ]),
        states_section(panel),
    )
    html = html.replace('</style>', extra_css + '</style>')
    return html


def export_collector():
    """Copy design_lint's COLLECT_JS verbatim so probe.mjs measures exactly what
    the skill's own checker measures."""
    import importlib.util
    import sys
    src = Path.home() / '.agents/skills/huashu-design/scripts/design_lint.py'
    spec = importlib.util.spec_from_file_location('design_lint', src)
    module = importlib.util.module_from_spec(spec)
    sys.modules['design_lint'] = module
    spec.loader.exec_module(module)
    (HERE / '.collect.js').write_text(
        '// Generated from ~/.agents/skills/huashu-design/scripts/design_lint.py (COLLECT_JS).\n'
        '// Regenerate with: python3 design-demos/build_demos.py --export-collector\n'
        '// Keeping the collector verbatim means probe.mjs measures exactly what design_lint measures.\n'
        'const COLLECT_JS = ' + json.dumps(module.COLLECT_JS) + ';\n',
        encoding='utf-8',
    )
    print('wrote .collect.js')


if __name__ == '__main__':
    if '--export-collector' in sys.argv:
        export_collector()
        raise SystemExit(0)
    (HERE / 'dir-1.html').write_text(build_a(), encoding='utf-8')
    (HERE / 'dir-2.html').write_text(build_b(), encoding='utf-8')
    (HERE / 'dir-3.html').write_text(build_c(), encoding='utf-8')
    print('wrote dir-1.html dir-2.html dir-3.html')
