window.__ModuleLoader__.load({
  id: '@my-dsh/dsh-skills-status',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const h = React.createElement

    /** Locale namespace owned by this plugin; the slot registration supplies `t`. */
    const NS = 'skillsStatus'

    /** Document-relative authenticated routes registered by the Host half. */
    const LIST_ROUTE = 'api/skills-status.list'
    const SET_ROUTE = 'api/skills-status.set'

    /** Chinese copy; keys are the one vocabulary the component reads. */
    const zh = {
      'trigger.loading': '技能',
      'trigger.none': '技能 0',
      'trigger.summary': '技能 {on}/{total}',
      'trigger.aria': '技能加载：{on}/{total} 已加载，点击查看',
      'panel.title': '技能',
      'panel.close': '关闭',
      'panel.refresh': '刷新',
      'panel.loading': '读取中…',
      'panel.error': '读取失败，请重试。',
      'panel.empty': '这个工作区没有可加载的技能。',
      'panel.emptyVisible': '这个工作区没有已安装的技能（内置技能已隐藏）。',
      'panel.workspace': '工作区：{name}',
      'panel.filter': '筛选技能',
      'panel.hidden': '已隐藏 {count} 个内置技能',
      'group.count': '{on}/{total}',
      'group.onAll': '加载 {name} 的全部技能',
      'group.offAll': '关闭 {name} 的全部技能',
      'group.sources': '{count} 个来源',
      'panel.allOn': '全部加载',
      'panel.allOff': '全部关闭',
      'panel.noneMatch': '没有匹配的技能',
      'panel.noneMatchHint': '换个词试试，或清空筛选看全部 {total} 个。',
      'state.userOnly': '仅手动',
      'toggle.on': '关闭 {name}',
      'toggle.off': '加载 {name}',
      'source.bundled': '内置',
      'source.project-dsh': '项目 .dsh',
      'source.project-agents': '项目 .agents',
      'source.user-dsh': '用户 .dsh',
      'source.user-agents': '用户 .agents',
      'source.custom': '自定义目录',
      'source.runtime': '运行时',
      'failure.failed': '切换失败：{reason}',
      'reason.invalid-skill': '技能名无效。',
      'reason.invalid-session': '会话无效。',
      'reason.read-failed': 'Host 读取失败。',
      'reason.write-failed': 'Host 写入失败。',
      'reason.operation-error': 'Host 报告了错误。',
    }

    /** English copy, key-for-key with {@link zh}. */
    const en = {
      'trigger.loading': 'Skills',
      'trigger.none': 'Skills 0',
      'trigger.summary': 'Skills {on}/{total}',
      'trigger.aria': 'Skill loading: {on} of {total} loaded. Open the panel',
      'panel.title': 'Skills',
      'panel.close': 'Close',
      'panel.refresh': 'Refresh',
      'panel.loading': 'Reading…',
      'panel.error': 'Could not read the skills. Try again.',
      'panel.empty': 'This workspace has no loadable skills.',
      'panel.emptyVisible': 'This workspace has no installed skills (bundled ones are hidden).',
      'panel.workspace': 'Workspace: {name}',
      'panel.filter': 'Filter skills',
      'panel.hidden': '{count} bundled skills hidden',
      'group.count': '{on}/{total}',
      'group.onAll': 'Load every skill in {name}',
      'group.offAll': 'Turn off every skill in {name}',
      'group.sources': '{count} sources',
      'panel.allOn': 'Load all',
      'panel.allOff': 'Turn all off',
      'panel.noneMatch': 'No skill matches',
      'panel.noneMatchHint': 'Try another word, or clear the filter to see all {total}.',
      'state.userOnly': 'Manual only',
      'toggle.on': 'Turn off {name}',
      'toggle.off': 'Load {name}',
      'source.bundled': 'Bundled',
      'source.project-dsh': 'Project .dsh',
      'source.project-agents': 'Project .agents',
      'source.user-dsh': 'User .dsh',
      'source.user-agents': 'User .agents',
      'source.custom': 'Custom root',
      'source.runtime': 'Runtime',
      'failure.failed': 'Could not switch: {reason}',
      'reason.invalid-skill': 'The skill name is invalid.',
      'reason.invalid-session': 'The Session is invalid.',
      'reason.read-failed': 'The Host could not read the state.',
      'reason.write-failed': 'The Host could not write the state.',
      'reason.operation-error': 'The Host reported an error.',
    }

    /** Panel styles, rendered as an element so unmounting removes them. */
    const CSS = `
.dshsk-root { display: inline-flex; flex: none; }
/* Matches the sibling MCP chip in the same .tools row: 28px tall, radius-sm,
   13px/20px text, and the same hover fill, so the row reads as one group. */
.dshsk-trigger {
  display: inline-flex; align-items: center; gap: 4px; flex: none;
  height: 28px; padding: 0 8px; border: none;
  border-radius: var(--dsw-radius-sm);
  outline: none; background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-family: inherit; font-size: 13px; line-height: 20px; font-weight: 500;
  font-variant-numeric: tabular-nums;
  white-space: nowrap; cursor: pointer;
}
@media (hover: hover) {
  .dshsk-trigger:hover, .dshsk-trigger[aria-expanded='true'] {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.dshsk-trigger:focus-visible {
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.dshsk-dot {
  width: 7px; height: 7px; border-radius: 50%; flex: none;
  box-sizing: border-box; background: transparent;
  box-shadow: inset 0 0 0 1.5px var(--dsw-alias-label-secondary);
}
.dshsk-dot[data-live='true'] { background: var(--dsw-alias-state-success-primary); box-shadow: none; }
.dshsk-dot[data-bad='true'] { background: var(--dsw-alias-state-error-primary); box-shadow: none; }

/* ---- the popover -------------------------------------------------------
   Body text is 14px/20px: the readability floor. Only the small counters and
   the group label sit at 12px, and nothing uses label-tertiary (#81858c
   measures 3.61:1 on this surface — below the 4.5:1 floor).               */
.dshsk-panel {
  position: fixed; z-index: 1100; box-sizing: border-box;
  display: flex; flex-direction: column;
  width: min(380px, calc(100vw - 24px));
  max-height: min(560px, calc(100vh - 96px)); padding: 12px;
  border: 0; border-radius: var(--dsw-radius-lg);
  background: var(--dsw-specific-menu); backdrop-filter: var(--dsw-menu-backdrop-filter);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-prominent);
  font-size: 14px; line-height: 20px; color: var(--dsw-alias-label-secondary); cursor: default;
}
.dshsk-head { display: flex; align-items: center; gap: 8px; padding: 0 2px; }
.dshsk-title {
  font-weight: 600; color: var(--dsw-alias-label-primary);
  font-size: 15px; line-height: 22px; letter-spacing: -.005em;
}
.dshsk-readout {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px; line-height: 18px; font-variant-numeric: tabular-nums;
}
.dshsk-actions { margin-left: auto; display: flex; align-items: center; gap: 2px; }
/* Icon buttons only: the header carries close, nothing else. */
.dshsk-iconbtn {
  display: grid; place-items: center; flex: none;
  width: 26px; height: 26px; padding: 0; border: none; border-radius: var(--dsw-radius-sm);
  background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 15px; line-height: 1; cursor: pointer;
}
@media (hover: hover) {
  .dshsk-iconbtn:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary);
  }
}
.dshsk-iconbtn:disabled { cursor: progress; opacity: .5; }
.dshsk-iconbtn:focus-visible {
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.dshsk-search {
  display: flex; align-items: center; gap: 8px; flex: none;
  box-sizing: border-box; height: 30px; margin: 10px 2px 2px; padding: 0 9px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm);
}
.dshsk-search:focus-within { border-color: var(--dsw-alias-brand-primary); }
.dshsk-search input {
  flex: 1 1 auto; min-width: 0; border: none; outline: none; background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: inherit; font-size: 13px; line-height: 18px;
}
.dshsk-search input::placeholder { color: var(--dsw-alias-label-secondary); }
.dshsk-list {
  flex: 1 1 auto; min-height: 0;
  max-height: min(392px, calc(100vh - 190px)); overflow-y: auto; overscroll-behavior: contain;
  padding: 2px 0 0;
  scrollbar-width: thin; scrollbar-color: var(--dsw-alias-border-l3) transparent;
}
.dshsk-list::-webkit-scrollbar { width: 8px; }
.dshsk-list::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-border-l3); border-radius: 4px;
  border: 2px solid transparent; background-clip: content-box;
}
.dshsk-group { padding: 2px 0 4px; }
.dshsk-grouphead { display: flex; align-items: center; gap: 10px; padding: 8px 4px 2px; }
/* The group control sits in the glyph column, so the right-hand axis carries
   exactly one kind of control: the per-row switch. */
.dshsk-grouptoggle {
  position: relative; display: grid; place-items: center; flex: none;
  width: 26px; height: 18px; padding: 0; border: none; border-radius: 5px;
  background: transparent; cursor: pointer;
}
.dshsk-grouptoggle::before {
  content: ''; width: 14px; height: 14px; border-radius: 4px;
  box-shadow: inset 0 0 0 1.5px var(--dsw-alias-border-l3); background: transparent;
}
.dshsk-grouptoggle[data-state='all']::before {
  background: var(--dsw-alias-brand-primary); box-shadow: inset 0 0 0 1.5px var(--dsw-alias-brand-primary);
}
.dshsk-grouptoggle[data-state='all']::after {
  content: ''; position: absolute; width: 7px; height: 4px; margin-top: -2px;
  border-left: 1.5px solid var(--dsw-alias-label-primary-foreground);
  border-bottom: 1.5px solid var(--dsw-alias-label-primary-foreground);
  transform: rotate(-45deg);
}
.dshsk-grouptoggle[data-state='mixed']::after {
  content: ''; position: absolute; width: 7px; height: 1.5px; border-radius: 1px;
  background: var(--dsw-alias-label-secondary);
}
.dshsk-grouptoggle:disabled { cursor: progress; opacity: .5; }
.dshsk-grouptoggle:focus-visible {
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.dshsk-grouplabel {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--dsw-alias-label-primary); font-weight: 600; font-size: 13px; line-height: 18px;
}
.dshsk-groupcount {
  flex: none; color: var(--dsw-alias-label-secondary);
  font-size: 12px; line-height: 18px; font-variant-numeric: tabular-nums;
}
.dshsk-groupurl {
  margin-left: auto; flex: none; color: var(--dsw-alias-label-secondary);
  font-size: 12px; line-height: 18px;
}
.dshsk-row {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 4px; border-radius: var(--dsw-radius-sm);
}
@media (hover: hover) {
  .dshsk-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
}
/* A row handle, not an icon: the shortest prefix of the name that no other
   skill in the catalog shares, so two rows never carry the same mark. */
.dshsk-glyph {
  display: grid; place-items: center; flex: none;
  width: 26px; height: 26px; border-radius: 7px;
  background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary-foreground);
  font-size: 12px; line-height: 1; font-weight: 600; letter-spacing: -.02em;
  font-variant-numeric: tabular-nums;
}
.dshsk-row[data-on='false'] .dshsk-glyph {
  background: transparent; color: var(--dsw-alias-label-secondary);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2);
}
.dshsk-body-wrap { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; }
.dshsk-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.dshsk-name {
  color: var(--dsw-alias-label-primary); font-weight: 500;
  font-size: 14px; line-height: 20px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dshsk-tag {
  margin-left: 6px; padding: 0 5px; border-radius: var(--dsw-radius-xs);
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px; line-height: 17px; font-weight: 400;
  vertical-align: 1px; white-space: nowrap;
}
.dshsk-desc {
  color: var(--dsw-alias-label-secondary);
  font-size: 14px; line-height: 19px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dshsk-switch {
  flex: none; position: relative; width: 34px; height: 20px; padding: 0;
  border: none; border-radius: 10px; cursor: pointer;
  background: var(--dsw-alias-border-l3); transition: background 120ms ease;
}
.dshsk-switch[aria-checked='true'] { background: var(--dsw-alias-brand-primary); }
.dshsk-switch:disabled { cursor: progress; opacity: .6; }
.dshsk-switch:focus-visible {
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.dshsk-knob {
  position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, .25);
  transition: transform 120ms ease;
}
/* brand-primary is near-black in light and near-white in dark, so the knob has
   to flip with the checked state: the token that is "the text on brand" is
   exactly the knob on the brand-filled track. */
.dshsk-switch[aria-checked='true'] .dshsk-knob {
  transform: translateX(14px);
  background: var(--dsw-alias-label-primary-inverted);
}
.dshsk-note {
  flex: none; margin: 8px 2px 0; padding: 7px 9px; border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 19px;
}
.dshsk-note[data-bad='true'] {
  color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-interactive-bg-hover-danger);
}
.dshsk-empty { padding: 26px 10px; text-align: center; }
.dshsk-empty b {
  display: block; color: var(--dsw-alias-label-primary);
  font-size: 14px; line-height: 20px; font-weight: 500;
}
.dshsk-empty span {
  display: block; margin-top: 4px;
  color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 20px;
}
.dshsk-foot {
  display: flex; align-items: center; gap: 12px; flex: none;
  margin: 8px 2px 0; padding-top: 9px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px;
}
.dshsk-textbtn {
  padding: 0; border: none; background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 12px; line-height: 18px;
}
@media (hover: hover) {
  .dshsk-textbtn:hover:not(:disabled) {
    color: var(--dsw-alias-label-primary);
    text-decoration: underline; text-underline-offset: 2px;
  }
}
.dshsk-textbtn:disabled { cursor: progress; opacity: .5; text-decoration: none; }
.dshsk-textbtn:focus-visible {
  border-radius: var(--dsw-radius-xs);
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.dshsk-hiddennote { flex: none; color: var(--dsw-alias-label-secondary); }
.dshsk-workspace {
  margin-left: auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
}
`

    /** Keep a fixed-position panel anchored above its trigger. */
    function useAnchoredPosition(open, anchorRef, panelRef) {
      const [position, setPosition] = React.useState(null)
      React.useLayoutEffect(() => {
        if (!open) {
          setPosition(null)
          return undefined
        }
        const place = () => {
          const rect = anchorRef.current && anchorRef.current.getBoundingClientRect()
          if (!rect) return
          const panel = panelRef.current
          const width = panel ? panel.offsetWidth : 0
          const height = panel ? panel.offsetHeight : 0
          const margin = 12
          let left = rect.right - width
          let top = rect.top - 8 - height
          if (width > 0) left = Math.min(Math.max(left, margin), window.innerWidth - width - margin)
          if (height > 0) top = Math.min(Math.max(top, margin), window.innerHeight - height - margin)
          setPosition({ left, top })
        }
        place()
        window.addEventListener('scroll', place, true)
        window.addEventListener('resize', place)
        let observer = null
        if (typeof ResizeObserver !== 'undefined' && panelRef.current) {
          observer = new ResizeObserver(place)
          observer.observe(panelRef.current)
        }
        return () => {
          if (observer) observer.disconnect()
          window.removeEventListener('scroll', place, true)
          window.removeEventListener('resize', place)
        }
      }, [open, anchorRef, panelRef])
      return position
    }

    /** Close the panel when a pointer lands outside both the trigger and the portal. */
    function useDismiss(rootRef, panelRef, open, setOpen) {
      React.useEffect(() => {
        if (!open) return undefined
        const onPointerDown = (event) => {
          if (!(event.target instanceof Node)) return
          const inRoot = rootRef.current && rootRef.current.contains(event.target)
          const inPanel = panelRef.current && panelRef.current.contains(event.target)
          if (!inRoot && !inPanel) setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown)
        return () => document.removeEventListener('pointerdown', onPointerDown)
      }, [open, rootRef, panelRef, setOpen])
    }

    /** Read the Host's skill list for one Session. */
    async function readList(sessionId, signal) {
      const response = await fetch(
        LIST_ROUTE + '?sessionId=' + encodeURIComponent(sessionId),
        { signal, headers: { accept: 'application/json' } },
      )
      if (!response.ok) throw new Error('HTTP ' + response.status)
      return await response.json()
    }

    /** Switch one skill; resolves to the Host's compact result. */
    async function writeSkill(sessionId, skill, enabled) {
      const response = await fetch(SET_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, skill, enabled }),
      })
      try {
        return await response.json()
      } catch {
        return { ok: false, reason: 'operation-error' }
      }
    }

    /** Human label for a skill's discovery source, falling back to the raw id. */
    function sourceLabel(source, t) {
      const key = 'source.' + source
      const text = t(key)
      // The locale lookup returns the key itself when nothing is registered.
      return text === key ? source : text
    }

    /**
     * A short mark per skill name, unique within the catalog.
     *
     * Two-letter initials collide constantly — `cloudflare-one` and
     * `cloudflare-one-migrations` are both "co" — and a row handle that two rows
     * share is not a handle. So: initials of the first three hyphen segments
     * (`cloudflare-one-migrations` -> "com"), falling back to the shortest
     * distinguishing prefix when even that collides. Computed over the whole
     * catalog so filtering never re-letters the list under the reader.
     */
    function glyphCodes(names) {
      const codes = Object.create(null)
      const seen = Object.create(null)
      for (const name of names) {
        const parts = String(name).split('-').filter(Boolean)
        let code = parts.length >= 2 ? parts.slice(0, 3).map(part => part[0]).join('') : String(name).slice(0, 2)
        if (code.length < 2) code = String(name).slice(0, 2)
        codes[name] = code.toLowerCase()
        const bucket = seen[codes[name]] ?? []
        bucket.push(name)
        seen[codes[name]] = bucket
      }
      for (const code of Object.keys(seen)) {
        const owners = seen[code]
        if (owners.length < 2) continue
        for (const name of owners) {
          for (let length = 3; length <= name.length; length += 1) {
            const prefix = name.slice(0, length).toLowerCase()
            if (names.filter(other => String(other).toLowerCase().startsWith(prefix)).length === 1) {
              codes[name] = prefix
              break
            }
          }
        }
      }
      return codes
    }

    /** The composer-toolbar trigger and its skill panel. */
    function SkillsStatus(props) {
      const t = props.t
      const sessionId = props.sessionId
      const [open, setOpen] = React.useState(false)
      const [snapshot, setSnapshot] = React.useState(null)
      const [error, setError] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState(null)
      const [query, setQuery] = React.useState('')
      const rootRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const position = useAnchoredPosition(open, rootRef, panelRef)
      useDismiss(rootRef, panelRef, open, setOpen)

      const reload = React.useCallback(async (signal) => {
        if (sessionId === undefined) return
        try {
          const next = await readList(sessionId, signal)
          if (signal && signal.aborted) return
          if (next && next.ok === false) {
            setError(true)
            return
          }
          setSnapshot(next)
          setError(false)
        } catch (cause) {
          if (cause && cause.name === 'AbortError') return
          setError(true)
        }
      }, [sessionId])

      // One read on mount so the closed trigger can show a summary.
      React.useEffect(() => {
        const controller = new AbortController()
        void reload(controller.signal)
        return () => controller.abort()
      }, [reload])

      // Refresh only while the panel is open; a closed panel costs nothing.
      React.useEffect(() => {
        if (!open) return undefined
        const controller = new AbortController()
        void reload(controller.signal)
        const timer = setInterval(() => { void reload(controller.signal) }, 5000)
        return () => {
          clearInterval(timer)
          controller.abort()
        }
      }, [open, reload])

      React.useEffect(() => {
        if (!open) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
      }, [open])

      const skills = snapshot && Array.isArray(snapshot.skills) ? snapshot.skills : []
      const loaded = skills.filter(row => row.enabled === true).length
      const hidden = snapshot && typeof snapshot.hidden === 'number' ? snapshot.hidden : 0
      // Before the first answer the trigger must not claim an empty catalog:
      // an unread list is not an empty one.
      const summary = snapshot === null && !error
        ? t('trigger.loading')
        : skills.length === 0
          ? t('trigger.none')
          : t('trigger.summary', { on: loaded, total: skills.length })

      const toggle = async (row, next) => {
        setBusy(true)
        setNote(null)
        try {
          const result = await writeSkill(sessionId, row.name, next === undefined ? row.enabled !== true : next)
          if (!result.ok) {
            const reason = result.reason !== undefined ? t('reason.' + result.reason) : String(result.reason || 'unknown')
            setNote({ text: t('failure.failed', { reason }), bad: true })
          }
        } catch (cause) {
          const message = cause && cause.message ? cause.message : String(cause)
          setNote({ text: t('failure.failed', { reason: message }), bad: true })
        } finally {
          setBusy(false)
          await reload()
        }
      }

      /** Turn every row in `subset` on or off, one request per changed skill. */
      const applyTo = async (subset, enabled) => {
        setBusy(true)
        setNote(null)
        try {
          for (const row of subset) {
            if (row.enabled === enabled) continue
            await writeSkill(sessionId, row.name, enabled)
          }
        } catch (cause) {
          const message = cause && cause.message ? cause.message : String(cause)
          setNote({ text: t('failure.failed', { reason: message }), bad: true })
        } finally {
          setBusy(false)
          await reload()
        }
      }

      const bulk = async (enabled) => applyTo(skills, enabled)

      const needle = query.trim().toLowerCase()
      const visible = needle === ''
        ? skills
        : skills.filter(row => row.name.toLowerCase().includes(needle)
          || String(row.description || '').toLowerCase().includes(needle))

      // Each row gets a mark that no other row in the catalog shares. A handle
      // two rows share is not a handle, so the code is the shortest prefix of
      // the name (by hyphen segments) that is unique — computed from the whole
      // catalog rather than the filtered rows, so a search cannot re-letter the
      // list under the reader.
      const codes = React.useMemo(() => glyphCodes(skills.map(row => row.name)), [skills])
      // Where a batch came from only carries information when the catalog mixes
      // sources; with one source the header would repeat the same word on every
      // group.
      const mixedSources = React.useMemo(
        () => new Set(skills.map(row => row.source)).size > 1,
        [skills],
      )

      /** One skill row: glyph, name, the sentence that decides it, and a switch. */
      const renderRow = (row) => {
        const manual = row.modelInvocable !== true
        const desc = String(row.description || '').trim()
        return h('div', {
          key: row.name,
          className: 'dshsk-row',
          'data-on': row.enabled === true,
        }, [
          h('span', { key: 'glyph', className: 'dshsk-glyph', 'aria-hidden': 'true' }, codes[row.name] || ''),
          h('span', { key: 'body', className: 'dshsk-body' }, [
            h('span', { key: 'name', className: 'dshsk-name' }, [
              row.name,
              manual ? h('span', { key: 'manual', className: 'dshsk-tag' }, t('state.userOnly')) : null,
            ]),
            // The description is the only thing that tells you whether to flip
            // this switch, so it lives in the row instead of a title tooltip.
            h('span', {
              key: 'desc',
              className: 'dshsk-desc',
              title: desc === '' ? undefined : desc,
            }, desc === '' ? sourceLabel(row.source, t) : desc),
          ]),
          h('button', {
            key: 'switch',
            type: 'button',
            className: 'dshsk-switch',
            role: 'switch',
            'aria-checked': row.enabled === true,
            'aria-label': t(row.enabled === true ? 'toggle.on' : 'toggle.off', { name: row.name }),
            disabled: busy,
            onClick: () => { void toggle(row) },
          }, h('span', { key: 'knob', className: 'dshsk-knob' })),
        ])
      }

      // Group by upstream repository. Groups are plain sections, always open:
      // the panel scrolls, and a fold state that has to remember whether the
      // user or the all-off rule closed it is a state machine nobody can see.
      const groups = new Map()
      for (const row of visible) {
        const key = row.upstream || 'local'
        const group = groups.get(key) ?? { upstream: key, url: row.upstreamUrl, rows: [], sources: new Set() }
        group.rows.push(row)
        group.sources.add(row.source)
        if (group.url === undefined && row.upstreamUrl !== undefined) group.url = row.upstreamUrl
        groups.set(key, group)
      }
      const catchAll = new Set(['local', 'unknown'])
      const ordered = [...groups.values()].sort((left, right) => {
        const leftTail = catchAll.has(left.upstream)
        const rightTail = catchAll.has(right.upstream)
        if (leftTail !== rightTail) return leftTail ? 1 : -1
        return left.upstream.localeCompare(right.upstream)
      })

      const renderGroup = (group) => {
        const on = group.rows.filter(row => row.enabled === true).length
        const total = group.rows.length
        const state = on === total ? 'all' : on === 0 ? 'none' : 'mixed'
        // Where the batch came from is a property of the batch, not of each
        // row, so it belongs on the group header — and only when it is uniform.
        const sources = [...group.sources]
        const sourceText = !mixedSources
          ? ''
          : sources.length === 1
            ? sourceLabel(sources[0], t)
            : t('group.sources', { count: sources.length })
        return h('div', { key: group.upstream, className: 'dshsk-group' }, [
          h('div', { key: 'head', className: 'dshsk-grouphead' }, [
            h('button', {
              key: 'toggle',
              type: 'button',
              className: 'dshsk-grouptoggle',
              'data-state': state,
              role: 'checkbox',
              'aria-checked': on === total,
              'aria-label': t(on === total ? 'group.offAll' : 'group.onAll', { name: group.upstream }),
              title: t(on === total ? 'group.offAll' : 'group.onAll', { name: group.upstream }),
              disabled: busy,
              onClick: () => { void applyTo(group.rows, on !== total) },
            }),
            h('span', { key: 'label', className: 'dshsk-grouplabel', title: group.url }, group.upstream),
            h('span', { key: 'count', className: 'dshsk-groupcount' }, t('group.count', { on, total })),
            sourceText === '' ? null : h('span', { key: 'source', className: 'dshsk-groupurl' }, sourceText),
          ]),
          h('div', { key: 'rows' }, group.rows.map(renderRow)),
        ])
      }

      const body = snapshot === null && !error
        ? h('div', { key: 'loading', className: 'dshsk-empty' }, t('panel.loading'))
        : error
          ? h('div', { key: 'error', className: 'dshsk-note', 'data-bad': true }, t('panel.error'))
          : skills.length === 0
            ? h('div', { key: 'empty', className: 'dshsk-empty' },
              h('span', null, t(hidden > 0 ? 'panel.emptyVisible' : 'panel.empty')))
            : h('div', { key: 'body', className: 'dshsk-body-wrap' }, [
              h('label', { key: 'search', className: 'dshsk-search' }, [
                h('input', {
                  key: 'input',
                  type: 'search',
                  value: query,
                  placeholder: t('panel.filter'),
                  'aria-label': t('panel.filter'),
                  onChange: (event) => { setQuery(event.target.value) },
                }),
                h('span', { key: 'count', className: 'dshsk-readout' },
                  t('group.count', { on: loaded, total: skills.length })),
              ]),
              visible.length === 0
                ? h('div', { key: 'none', className: 'dshsk-empty' }, [
                  h('b', { key: 'b' }, t('panel.noneMatch')),
                  h('span', { key: 's' }, t('panel.noneMatchHint', { total: skills.length })),
                ])
                : h('div', { key: 'list', className: 'dshsk-list' }, ordered.map(renderGroup)),
            ])

      const workspaceName = snapshot && snapshot.workspace ? snapshot.workspace.title : ''

      return h('span', { ref: rootRef, className: 'dshsk-root' }, [
        h('style', { key: 'css' }, CSS),
        h('button', {
          key: 'trigger',
          type: 'button',
          className: 'dshsk-trigger',
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'aria-label': t('trigger.aria', { on: loaded, total: skills.length }),
          onClick: () => { setOpen(!open) },
        }, [
          h('span', {
            key: 'dot',
            className: 'dshsk-dot',
            'data-live': skills.length > 0 && loaded === skills.length,
            'data-bad': error,
          }),
          h('span', { key: 'label' }, summary),
        ]),
        open ? createPortal(h('div', {
          key: 'panel',
          ref: panelRef,
          className: 'dshsk-panel',
          style: position || { visibility: 'hidden', left: 0, top: 0 },
          role: 'dialog',
          'aria-label': t('panel.title'),
        }, [
          h('div', { key: 'head', className: 'dshsk-head' }, [
            h('span', { key: 'title', className: 'dshsk-title' }, t('panel.title')),
            h('span', { key: 'readout', className: 'dshsk-readout' },
              t('group.count', { on: loaded, total: skills.length })),
            h('div', { key: 'actions', className: 'dshsk-actions' }, [
              h('button', {
                key: 'close',
                type: 'button',
                className: 'dshsk-iconbtn',
                'aria-label': t('panel.close'),
                title: t('panel.close'),
                onClick: () => { setOpen(false) },
              }, '×'),
            ]),
          ]),
          body,
          note ? h('div', { key: 'note', className: 'dshsk-note', 'data-bad': note.bad === true }, note.text) : null,
          h('div', { key: 'foot', className: 'dshsk-foot' }, [
            loaded < skills.length
              ? h('button', {
                key: 'allon',
                type: 'button',
                className: 'dshsk-textbtn',
                disabled: busy,
                onClick: () => { void bulk(true) },
              }, t('panel.allOn'))
              : null,
            loaded > 0
              ? h('button', {
                key: 'alloff',
                type: 'button',
                className: 'dshsk-textbtn',
                disabled: busy,
                onClick: () => { void bulk(false) },
              }, t('panel.allOff'))
              : null,
            h('button', {
              key: 'refresh',
              type: 'button',
              className: 'dshsk-textbtn',
              disabled: busy,
              onClick: () => { void reload() },
            }, t('panel.refresh')),
            hidden > 0
              ? h('span', { key: 'hidden', className: 'dshsk-hiddennote' },
                t('panel.hidden', { count: hidden }))
              : null,
            h('span', {
              key: 'ws',
              className: 'dshsk-workspace',
              title: snapshot && snapshot.workspace ? snapshot.workspace.path : undefined,
            }, workspaceName === '' ? '' : t('panel.workspace', { name: workspaceName })),
          ]),
        ]), document.body) : null,
      ])
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'skills-status: dictionaries')
        // `conversation.input.left` is the list seat inside the composer's
        // `.tools` flex row, the one holding the "+" button, the permission
        // chip, and the MCP chip. Order 1 renders immediately after the MCP
        // chip (order 0), which is the requested position: to its right.
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'skills-status-toolbar',
          order: 1,
          locale: NS,
        }, SkillsStatus))
      },
    }
  },
})
