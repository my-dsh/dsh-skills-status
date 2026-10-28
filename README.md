# @my-dsh/dsh-skills-status

English | [中文](README.zh.md)

A DeepSeek Harness plugin that puts a **skill loading** button in the composer toolbar, immediately to the right of the MCP connections button. It lists every skill the current workspace can load, switches each one on or off, and remembers the switches **per workspace in SQLite** — so reopening a workspace restores exactly the skills you left loaded.

## What it looks like

The trigger shows the loaded/total count (`技能 29/29`). Clicking it opens a panel:

- The header carries only the title, the count, and a close button.
- The filter box sits beside the count and matches both names and descriptions.
- The list is sectioned by upstream repository. Each skill is one row: a **glyph block** on the left (the initials of its first three hyphen segments — `cloudflare-one-migrations` → `com` — unique across the catalog) and a switch on the right.
- **The description sits directly under the name.** It is the only thing that tells you whether to flip that switch, so it is not left in a `title` tooltip.
- A row that is off keeps only an outlined glyph; there is no "Loaded"/"Off" label, because the glyph and the switch already say it once each.
- The group header holds a tri-state select-all box on the left and the group count on the right.
- The footer carries `Load all` / `Turn all off` / `Refresh` and the current workspace name. An action that cannot do anything — `Load all` when everything is already loaded — is not rendered.

## Behaviour

| Aspect | Behaviour |
|---|---|
| Storage | One SQLite database at `$DSH_HOME/skills-status/skills-status.db` (override with `databasePath`), table `skill_state(workspace, skill, enabled, description, source, upstream, upstream_url, updated_at)` |
| Workspace key | The deepest registered workspace containing the Session's directory; a directory outside every workspace keys on its own real path |
| Default | A skill with no row is **loaded** — the shipped behaviour — so the table stays empty until you turn something off |
| What it lists | Hides skills whose discovery source is `custom` (the `customSkillDirs` root, which the shipped presets point at the skills bundled inside the DSH installation), so the panel shows only the skills you actually installed. Hidden skills keep their recorded switch, so one is never silently re-enabled |
| Grouping | Sections by **upstream repository** (`cloudflare/skills`, `mattpocock/skills`, …), each showing loaded/total. **Groups do not fold**: the list scrolls, and "fold when fully off plus a manual fold" needs a record of who closed each group — a state machine the reader cannot see |
| Per-group bulk switch | The tri-state box at the left of each group header switches the whole group: on when fully on, off otherwise. It affects only that group |
| Description in the row | The second line of each row is the skill's description (single line, truncated; the full text is in `title`). A skill with no description falls back to showing where it was discovered |
| Scope | Per workspace, not per Session: every Session in a workspace shares the switches |
| Live effect | A toggle applies immediately; the next model step sees the new catalog, no restart |
| Reopen | The database is read on every catalog build, so reopening a workspace restores the saved set |

## Where the upstream grouping comes from

A skill's `source` says where it was scanned (`user-agents`, `project-agents`, …), not who authored it. The upstream is resolved in two steps:

1. **The install lock file** `~/.agents/.skill-lock.json` (and `.agents/.skill-lock.json` at the project root), which records `source` (`<owner>/<repo>`), `sourceUrl`, and the rest — the authoritative record for anything installed through the skills CLI.
2. **The skill's own frontmatter**, for a skill no lock file recorded (a direct clone, or another installer): its `SKILL.md` `metadata.repository` (preferred) or `metadata.homepage`.

A skill neither source names lands in a `local` group, sorted last.

**The group is a property of the skill, not of its switch.** A disabled skill is shadowed out of the catalog by a mask, so its row is rebuilt from what was recorded when it was turned off. That record carries `upstream` / `upstream_url` beside the description, and the mask keeps the real instruction path, so the frontmatter fallback still works while the skill is hidden. A row written by an older version (no group recorded) is repaired on the next Agent sync, which is the one moment the real entry is still visible. Without this, a skill like `huashu-design` — installed by a direct clone, so no lock-file record, upstream known only from its `SKILL.md` — would sit under `alchaincyf/huashu-design` while on and jump to `local` the moment it was switched off.

## How a disabled skill actually stops loading

The plugin does not unregister or edit anything. The skill registry (`ctx.skills`) merges its global layer with the viewing Agent's scope chain, and the **nearest layer wins a name outright**. For each disabled skill the plugin registers, inside that Agent's own scope (`agent.ctx`), a runtime skill carrying the same name with

```js
invocation: { modelInvocable: false, userInvocable: false }
```

Every consumer filters on that policy — the model-facing `<available_skills>` catalog, the `skill` tool, the `/` command menu, and the `/name` gesture — so the skill disappears from all of them at once, while the registry keeps the original definition for when the switch comes back. Turning it on disposes the mask.

Masks are installed on `agent/created` and reconciled on `skills/change`, so a skill discovered after the toggle was set is masked too.

## Install

A web surface profile is required (`dsh web` uses the profile named `web`), and both `git`
and `pnpm` must be on `PATH`.

```sh
# from GitHub
dsh plugin --profile web add github:my-dsh/dsh-skills-status

# or from a local clone
dsh plugin --profile web add /path/to/dsh-skills-status
```

Restart DSH afterwards; the button appears in the composer toolbar on the left.

You can also install the directory as a bundle through Plugin Manager. The bundle patch inserts one Host row (`skills-status`) and declares no package dependencies: only Node builtins are imported, and the client half is a plain-JavaScript module registered in `conversation.input.left` at `order: 1`, one step after the MCP button's `order: 0`.

## Configuration

```yaml
- id: skills-status
  name: '@my-dsh/dsh-skills-status'
  config:
    databasePath: /var/lib/dsh/skills-status.db   # default: $DSH_HOME/skills-status/skills-status.db
    hiddenSources: [custom]                       # default; pass [] to show every source
```

## Host routes

Both ride the authenticated shared `/api` channel and are unauthenticated-unreachable:

| Route | Method | Body / query |
|---|---|---|
| `/api/skills-status.list` | GET | `?sessionId=<id>` |
| `/api/skills-status.set` | POST | `{ "sessionId": "...", "skill": "...", "enabled": true }` |

## Files

| File | Role |
|---|---|
| [`index.js`](index.js) | Host half: SQLite store, workspace resolution, per-Agent masking, the two routes |
| [`client.js`](client.js) | Client half: the composer-toolbar button and its panel |
| [`cordis.patch.yml`](cordis.patch.yml) | Bundle patch inserting the Host row |
| [`locale/en.json`](locale/en.json), [`locale/zh.json`](locale/zh.json) | Plugin Manager title and description |
| [`icon.svg`](icon.svg) | Plugin artwork |
| [`test/upstream-stability.test.mjs`](test/upstream-stability.test.mjs) | Regression tests: the group must not move when a switch is turned off (`node --test test/*.test.mjs`) |

## Known limits

- The panel reports the catalog of the Session it was opened from. A workspace whose Sessions use different agent presets can therefore show a different skill set per Session, though the switches themselves are shared.
- A skill removed from disk keeps its stale row until it is discovered again; the panel simply stops listing it.
- `node:sqlite` emits an experimental-feature warning on Node 22, which the Harness already tolerates for its own SQLite backend.
