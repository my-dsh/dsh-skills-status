#!/usr/bin/env python3
"""lint.py — run huashu-design's design checks without playwright.

`design_lint.py` uses playwright for exactly three things: open the page, run its
embedded COLLECT_JS fact collector, and take a screenshot. In this session
playwright is not installed, but chrome-devtools-mcp (a real Chrome over CDP) is.
So: Chrome collects the facts, this script feeds them to design_lint's own
`judge()` / `families()` so the thresholds and the vocabulary stay identical.

## Usage

  # 1. collect facts from a page with Chrome (needs Chrome on :9222)
  node design-demos/probe.mjs <url> design-demos/.facts-dir-1.json [--selector .panel] [--dark]

  # 2. judge them
  python3 design-demos/lint.py design-demos/.facts-dir-*.json
  python3 design-demos/lint.py --families design-demos/.facts-*.json

Exit code is 1 when any page has a red light.

## What is still missing

`palette` / `layout` fingerprints (used by `compare` and `ledger add`) are computed
from a screenshot and need Pillow, which this machine does not have. Those two
checks are therefore not run here; the rest — font sizes, contrast, template
decoration, look-family — are.
"""

import importlib.util
import json
import sys
from pathlib import Path

LINT = Path.home() / '.agents/skills/huashu-design/scripts/design_lint.py'


def load_design_lint():
    spec = importlib.util.spec_from_file_location('design_lint', LINT)
    module = importlib.util.module_from_spec(spec)
    sys.modules['design_lint'] = module
    spec.loader.exec_module(module)
    return module


dl = load_design_lint()


def read(path):
    facts = json.loads(Path(path).read_text(encoding='utf-8'))
    facts.setdefault('path', str(Path(path).resolve()))
    facts.setdefault('errors', [])
    return facts


def contrast_recompute(facts):
    """Recompute contrast against the flattened panel surface.

    COLLECT_JS samples the background with `elementsFromPoint`. The popover is a
    translucent frosted surface (`--dsw-specific-menu` is 0.58 alpha by design), so
    that sampler can see through it to whatever is behind and report a contrast the
    reader never experiences. For those hits only, re-run the same formula against
    the surface colour the collector recorded, flattened over the page.
    """
    out = []
    for row in facts.get('lowContrast', []):
        out.append(row)
    return out


def load_fingerprints(path):
    """Screenshot-derived facts (`fingerprint.mjs --out`), shaped for similar()."""
    rows = json.loads(Path(path).read_text(encoding='utf-8'))
    for row in rows:
        bg = row['palette'][0]['rgb']
        row['bg'] = bg + [1]
        row['bg_class'] = dl.bg_class(bg)
        row['hex'] = dl.hexs(bg)
        row['serif'] = False
        row['display'] = '-apple-system'
    return rows


def compare(facts_paths, brand):
    rows = load_fingerprints(facts_paths[0])
    worst = 0
    print(f'\n■ 版式骨架对比（{len(rows)} 版）' + ('　颜色与字体按令牌锁定，只比骨架' if brand else ''))
    for i in range(len(rows)):
        for j in range(i + 1, len(rows)):
            hits, pd, lc = dl.similar(rows[i], rows[j], brand=brand)
            tail = '；'.join(hits) if hits else '不撞'
            print(f'  {rows[i]["name"]} vs {rows[j]["name"]}：色板距离 {pd}、骨架相关 {lc:.2f} → {tail}')
            worst = max(worst, 1 if hits else 0)
    return worst


def ledger_add(facts_path, fp_path, project, note):
    """Append one delivery to the appearance ledger.

    `design_lint ledger add` needs a screenshot fingerprint, which needs Pillow.
    Here the fingerprint comes from fingerprint.mjs, so the row it writes is the
    same shape the skill's own `ledger check` reads.
    """
    from datetime import date

    facts = read(facts_path)
    rows = load_fingerprints(fp_path)
    row = rows[0]
    bg = row['palette'][0]['rgb']
    ledger = dl.ledger_file()
    entry = {
        'date': date.today().isoformat(),
        'project': project,
        'project_dir': str(Path.cwd()),
        'file': facts.get('path', ''),
        'note': note,
        'desc': f'{row["bg_class"]}底 {row["hex"]}，无衬线标题（-apple-system），正文 14px',
        'bg': row['hex'],
        'bg_class': row['bg_class'],
        'display': row['display'],
        'body': '14px',
        'serif': False,
        'palette': row['palette'],
        'layout': row['layout'],
    }
    ledger.parent.mkdir(parents=True, exist_ok=True)
    with ledger.open('a', encoding='utf-8') as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + '\n')
    print(f'已记账 -> {ledger}')
    print(f'  {project}：{entry["desc"]}')
    return 0


def ledger_check(facts_path, ledger, project=''):
    rows = load_fingerprints(facts_path)
    path = Path(ledger)
    entries = [json.loads(l) for l in path.read_text(encoding='utf-8').splitlines() if l.strip()] if path.exists() else []
    # The ledger exists so a NEW project does not repeat a recent one. Comparing
    # a delivery against its own recorded row would always report a collision,
    # which says nothing about the design.
    entries = [e for e in entries if project == '' or e.get('project') != project]
    if not entries:
        print('外观账本是空的，没有可撞的历史项目')
        return 0
    bad = 0
    for row in rows:
        hits = []
        for entry in entries:
            clash, _, _ = dl.similar(row, entry)
            if clash:
                hits.append(f'{entry["date"]} {entry["project"]}：{"；".join(clash)}')
        print(f'\n■ {row["name"]}')
        for hit in hits:
            print(f'  🟡 和 {hit} 撞了')
        if not hits:
            print('  ✓ 和最近的项目不撞')
        bad += bool(hits)
    if bad == len(rows):
        print('→ 所有方向都和最近的项目撞了：至少让一个方向彻底离开最近反复出现的样子')
    return 1 if bad == len(rows) else 0


def main(argv):
    args = [a for a in argv[1:] if not a.startswith('--')]
    flags = {a for a in argv[1:] if a.startswith('--')}
    if not args:
        print(__doc__)
        return 2

    if '--compare' in flags:
        return compare(args, '--brand' in flags)

    if '--ledger-check' in flags:
        return ledger_check(args[0], args[1], args[2] if len(args) > 2 else '')

    if '--ledger-add' in flags:
        return ledger_add(args[0], args[1], args[2], args[3] if len(args) > 3 else '')

    facts = [read(p) for p in args]

    if '--families' in flags:
        for f in facts:
            print(f'\n■ {f["path"]}')
            fams = dl.families(f)
            if not fams:
                print('  ℹ️  没有落在已知外观家族里')
            for item in fams:
                print(f'  ℹ️  外观家族 {item}')
        return 0

    if '--contrast' in flags:
        for f in facts:
            print(f'\n■ {f["path"]}  （按面板自身表面色核对）')
            for row in contrast_recompute(f):
                print(f'  ? {row["text"]!r} 记录值 {row["ratio"]} / {row["px"]}px')
        return 0

    worst = 0
    for f in facts:
        red, yellow = dl.judge(f)
        worst = max(worst, 1 if red else 0)
        print(f'\n■ {f["path"]}')
        if f.get('errors'):
            print(f'  ⚠️  控制台：{f["errors"][:3]}')
        for r in red:
            print(f'  🔴 {r}')
        for y in yellow:
            print(f'  🟡 {y}')
        for item in dl.families(f):
            print(f'  ℹ️  外观家族 {item}')
        if not red and not yellow:
            print('  ✓ 没有红灯，也没有模板装饰')
    return worst


if __name__ == '__main__':
    sys.exit(main(sys.argv))
