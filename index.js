/**
 * Host half of the skills status bundle.
 *
 * The bundle answers one question for its composer-toolbar button: which
 * skills are loaded for the workspace the current Session belongs to. It
 * persists that answer per workspace in SQLite, so reopening a workspace
 * restores exactly the skills the user left loaded.
 *
 * **Where the state lives.** One `node:sqlite` database holds a
 * `skill_state(workspace, skill, enabled)` table keyed by the workspace's
 * canonical directory. A skill with no row is loaded, which is the shipped
 * behaviour and keeps the database empty until the user turns something off.
 *
 * **How a disabled skill stops loading.** The skill registry merges its global
 * layer with the viewing Agent's scope chain, and the nearest layer wins a name
 * outright. The bundle therefore registers, inside each live Agent's own
 * scope, a runtime skill carrying the disabled name and
 * `{ modelInvocable: false, userInvocable: false }`. Every consumer — the
 * model catalog, the `skill` tool, the `/` menu, and the `/name` gesture —
 * filters on that policy, so the skill disappears from all of them while the
 * registry keeps the original definition for when the toggle comes back.
 *
 * **Live changes.** A toggle writes the database and re-syncs every live Agent
 * of that workspace, so the next step's catalog is rebuilt without a restart.
 * `skills/change` re-syncs too, because a newly discovered skill must be
 * masked when the workspace already turned it off.
 *
 * Only Node builtins are imported, so the bundle declares no dependencies.
 *
 * @module @my-dsh/dsh-skills-status
 */

import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * Services the bundle reads directly. Cordis only exposes a service on `ctx`
 * when the plugin declares it, so every required access is listed here.
 */
export const inject = ['agents', 'skills', 'workingDirectory']

/** Exact Fetch routes on the authenticated shared API channel. */
const LIST_PATH = '/api/skills-status.list'
const SET_PATH = '/api/skills-status.set'

/** The public skill-name grammar, mirrored from the registry. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Provider label carried by the runtime skill that masks a disabled one. */
const MASK_PROVIDER = 'skills-status'

/** Source bucket reported for a mask, so the panel can label it. */
const MASK_SOURCE = 'skills-status'

/** Body kept on a mask; no consumer reads it because the policy forbids loading. */
const MASK_CONTENT = 'This skill is disabled for the current workspace.'

/**
 * Discovery sources the panel hides by default. `custom` is the
 * `customSkillDirs` root, which the shipped preset composition points at the
 * skills bundled inside the DSH installation itself, so hiding it leaves the
 * skills you actually installed. Override with the row's `hiddenSources`.
 */
const DEFAULT_HIDDEN_SOURCES = Object.freeze(['custom'])

/** Upstream label for a skill no install record names, such as a project-local one. */
const LOCAL_UPSTREAM = 'local'

/** Upstream label for a skill whose install record carries no source. */
const UNKNOWN_UPSTREAM = 'unknown'

/**
 * Read the upstream a skill declares in its own frontmatter.
 *
 * Not every installed skill carries a `.skill-lock.json` record — a repository
 * cloned straight into the skills root, or a skill installed by another tool,
 * has only its `SKILL.md`. The provider's `metadata` object is not projected
 * into the catalog summary, so the file is read here; `path` is the absolute
 * instruction file the summary does carry.
 * @param path - absolute `SKILL.md` path from the skill summary.
 * @returns `{ upstream, url }`, or undefined when nothing declares one.
 */
function upstreamFromFrontmatter(path) {
  if (typeof path !== 'string' || path === '') return undefined
  let text
  try {
    if (!existsSync(path)) return undefined
    text = readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
  const open = text.indexOf('---')
  if (open !== 0 && text.slice(0, open).trim() !== '') return undefined
  const close = text.indexOf('\n---', open + 3)
  if (close === -1) return undefined
  const frontmatter = text.slice(open + 3, close)

  // Only the `metadata:` block matters, and only two of its keys. Scanning
  // lines keeps this independent of a YAML dependency the bundle must not add.
  // `repository` wins over `homepage`: a homepage can be an author profile,
  // which is not the upstream a skill came from.
  const block = frontmatter.split(/^metadata:/m)[1] ?? ''
  const declared = /^\s+repository:\s*["']?([^"'\n]+)["']?\s*$/m.exec(block)
    ?? /^\s+homepage:\s*["']?([^"'\n]+)["']?\s*$/m.exec(block)
  if (declared === null) return undefined
  const value = declared[1].trim()
  if (value === '') return undefined
  const repo = /github\.com[/:]([^/\s]+)\/([^/\s#?]+)/i.exec(value)
  return {
    upstream: repo === null ? value : `${repo[1]}/${repo[2].replace(/\.git$/, '')}`,
    url: value,
  }
}

/**
 * Read one `.skill-lock.json` and index its entries by skill name.
 *
 * The lock file is the only place an installed skill's upstream repository is
 * recorded; a scan root says where a file sits, not who authored it. A missing
 * or malformed file is not an error: skills can exist without ever having been
 * installed through the CLI.
 * @param path - absolute lock file path.
 * @param into - map receiving `skill name → { upstream, url }`.
 */
function readSkillLock(path, into) {
  let parsed
  try {
    if (!existsSync(path)) return
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return
  }
  const skills = parsed?.skills
  if (skills === null || typeof skills !== 'object') return
  for (const [name, record] of Object.entries(skills)) {
    if (record === null || typeof record !== 'object') continue
    // `source` is the `<owner>/<repo>` slug the CLI installed from.
    const upstream = typeof record.source === 'string' && record.source !== ''
      ? record.source
      : typeof record.pluginName === 'string' && record.pluginName !== ''
        ? record.pluginName
        : UNKNOWN_UPSTREAM
    into.set(name, {
      upstream,
      url: typeof record.sourceUrl === 'string' ? record.sourceUrl : undefined,
    })
  }
}

/**
 * Default database file under the DSH home directory.
 * @returns the absolute database path.
 */
function defaultDatabasePath() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  return join(home, 'skills-status', 'skills-status.db')
}

/**
 * Validate the row's raw config.
 * @param config - raw `config` from the profile patch.
 * @returns the resolved options.
 * @throws {TypeError} when a field has an unsupported value.
 */
function resolveOptions(config) {
  const raw = config !== null && typeof config === 'object' ? config : {}
  const databasePath = raw.databasePath ?? defaultDatabasePath()
  if (typeof databasePath !== 'string' || databasePath === '') {
    throw new TypeError('skills-status: databasePath must be a non-empty string')
  }
  const hiddenSources = raw.hiddenSources ?? DEFAULT_HIDDEN_SOURCES
  if (!Array.isArray(hiddenSources) || hiddenSources.some(source => typeof source !== 'string')) {
    throw new TypeError('skills-status: hiddenSources must be an array of discovery-source names')
  }
  return { databasePath, hiddenSources: new Set(hiddenSources) }
}

/**
 * Build one JSON response with no caching.
 * @param status - HTTP status code.
 * @param body - lossless JSON payload.
 * @returns the Fetch response.
 */
function json(status, body) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

/**
 * Canonicalize a directory the way the workspace registry does, so a
 * symlinked Session directory still matches its workspace.
 * @param path - absolute directory.
 * @returns the real path, or the input when it cannot be resolved.
 */
function canonical(path) {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/**
 * Open the per-workspace toggle database, creating parent and file owner-only.
 * @param path - absolute database path.
 * @returns the store with its queries and the close operation.
 */
function openStore(path) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(`CREATE TABLE IF NOT EXISTS skill_state (
    workspace TEXT NOT NULL,
    skill TEXT NOT NULL,
    enabled INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace, skill)
  )`)
  // Description, source and upstream cache the catalog row, so a workspace
  // reopened cold (no live Agent to ask) can still list a skill it turned off
  // instead of silently dropping it from the panel — and, for the upstream,
  // without moving it to another group just because the switch is off.
  for (const column of ['description TEXT', 'source TEXT', 'upstream TEXT', 'upstream_url TEXT']) {
    try {
      db.exec(`ALTER TABLE skill_state ADD COLUMN ${column}`)
    } catch {
      // Already present: CREATE TABLE above covers a fresh database.
    }
  }
  const selectAll = db.prepare(
    'SELECT skill, enabled, description, source, upstream, upstream_url FROM skill_state WHERE workspace = ?',
  )
  const upsert = db.prepare(`INSERT INTO skill_state
      (workspace, skill, enabled, description, source, upstream, upstream_url, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace, skill) DO UPDATE SET
      enabled = excluded.enabled,
      description = COALESCE(excluded.description, skill_state.description),
      source = COALESCE(excluded.source, skill_state.source),
      upstream = COALESCE(excluded.upstream, skill_state.upstream),
      upstream_url = COALESCE(excluded.upstream_url, skill_state.upstream_url),
      updated_at = excluded.updated_at`)
  const drop = db.prepare('DELETE FROM skill_state WHERE workspace = ? AND skill = ?')
  // Older databases carry a disabled row without a group. The repair only ever
  // fills a NULL/empty upstream, so a group the user can see never flips.
  const backfill = db.prepare(`UPDATE skill_state SET upstream = ?, upstream_url = ?
    WHERE workspace = ? AND skill = ? AND (upstream IS NULL OR upstream = '')`)
  let closed = false
  return {
    /**
     * Every row recorded for one workspace, keyed by skill name.
     * @param workspace - workspace key.
     * @returns the recorded rows.
     */
    read(workspace) {
      const rows = new Map()
      for (const row of selectAll.all(workspace)) {
        rows.set(String(row.skill), {
          enabled: row.enabled !== 0,
          description: typeof row.description === 'string' ? row.description : undefined,
          source: typeof row.source === 'string' ? row.source : undefined,
          upstream: typeof row.upstream === 'string' ? row.upstream : undefined,
          upstreamUrl: typeof row.upstream_url === 'string' ? row.upstream_url : undefined,
        })
      }
      return rows
    },
    /**
     * The disabled names recorded for one workspace.
     * @param workspace - workspace key.
     * @returns the disabled names.
     */
    disabled(workspace) {
      const names = new Set()
      for (const row of selectAll.all(workspace)) {
        if (row.enabled === 0) names.add(String(row.skill))
      }
      return names
    },
    /**
     * Record one skill's state; a loaded skill drops its row so the table
     * stays empty for the shipped default.
     * @param workspace - workspace key.
     * @param skill - skill name.
     * @param enabled - whether the skill should load.
     * @param meta - the catalog row kept beside a disabled entry.
     */
    write(workspace, skill, enabled, meta) {
      if (enabled) drop.run(workspace, skill)
      else {
        upsert.run(
          workspace, skill, 0,
          meta?.description ?? null,
          meta?.source ?? null,
          meta?.upstream ?? null,
          meta?.upstreamUrl ?? null,
          new Date().toISOString(),
        )
      }
    },
    /**
     * Fill in the upstream of a row recorded before the column existed.
     *
     * A row written by an older version carries a switch and a description but
     * no group, so its skill would fall to the catch-all bucket the moment it
     * is hidden. The Agent is the only place the real instruction path is still
     * visible (the mask hides it from the catalog), so the repair happens here.
     * Only a missing value is written: a recorded group is never overwritten.
     * @param workspace - workspace key.
     * @param skill - skill name.
     * @param upstream - resolved upstream label.
     * @param url - resolved upstream URL, when one is known.
     * @returns whether a row was repaired.
     */
    backfillUpstream(workspace, skill, upstream, url) {
      if (typeof upstream !== 'string' || upstream === '') return false
      const result = backfill.run(upstream, url ?? null, workspace, skill)
      return result.changes > 0
    },
    /** Close the connection once. */
    close() {
      if (closed) return
      closed = true
      db.close()
    },
  }
}

/**
 * Summarize the upstream groups in one catalog projection.
 * @param rows - the panel's skill rows, each carrying `upstream` and `enabled`.
 * @returns one entry per upstream: its label, skill count, loaded count, and
 *   the URL when an install record supplied one.
 */
function groupUpstreams(rows) {
  const groups = new Map()
  for (const row of rows) {
    const group = groups.get(row.upstream) ?? {
      upstream: row.upstream,
      url: row.upstreamUrl,
      total: 0,
      enabled: 0,
    }
    group.total += 1
    if (row.enabled) group.enabled += 1
    if (group.url === undefined && row.upstreamUrl !== undefined) group.url = row.upstreamUrl
    groups.set(row.upstream, group)
  }
  const catchAll = new Set([LOCAL_UPSTREAM, UNKNOWN_UPSTREAM])
  return [...groups.values()].sort((left, right) => {
    // Real upstreams alphabetically first; the catch-all buckets last.
    const leftTail = catchAll.has(left.upstream)
    const rightTail = catchAll.has(right.upstream)
    if (leftTail !== rightTail) return leftTail ? 1 : -1
    return left.upstream.localeCompare(right.upstream)
  })
}

/**
 * Activate the skills status panel: its authenticated routes, the per-Agent
 * masking that makes a toggle real, and the database teardown.
 * @param ctx - plugin context.
 * @param config - raw row config.
 */
export function apply(ctx, config) {
  const options = resolveOptions(config)

  /** Lazily opened store, so a disk problem surfaces in the panel instead of blocking activation. */
  let store
  let storeError
  const getStore = () => {
    if (store !== undefined) return store
    if (storeError !== undefined) throw storeError
    try {
      store = openStore(options.databasePath)
      return store
    } catch (error) {
      storeError = error instanceof Error ? error : new Error(String(error))
      throw storeError
    }
  }

  /**
   * Masks per live Agent: the runtime registration that hides a disabled
   * skill, plus the real summary it replaced so the panel can still describe
   * and re-enable it.
   * @type {Map<object, Map<string, { disposer: () => void, summary: object }>>}
   */
  const masks = new Map()
  /** Re-entrancy guard: our own registrations emit `skills/change`. */
  let applying = 0
  /** Coalesced re-sync request. */
  let resyncQueued = false

  /**
   * Resolve the workspace a directory belongs to: the deepest registered
   * workspace containing it, or the directory itself when none does.
   * @param cwd - the Session's effective directory.
   * @returns the workspace key plus its display fields.
   */
  const workspaceFor = (cwd) => {
    const registry = ctx.get('workspaceRegistry')
    const workspaces = registry === undefined ? [] : registry.list()
    const target = canonical(cwd)
    let best
    for (const workspace of workspaces) {
      const base = canonical(workspace.path)
      const rel = relative(base, target)
      const inside = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
      if (!inside) continue
      if (best === undefined || base.length > best.base.length) best = { base, workspace }
    }
    if (best !== undefined) {
      const { workspace, base } = best
      return { key: base, id: String(workspace.id), title: workspace.title, path: workspace.path }
    }
    return { key: target, id: null, title: basename(target), path: cwd }
  }

  /**
   * Read a Session's effective directory and preset without requiring a live Agent.
   * @param sessionId - Session identity.
   * @returns the absolute directory and the recorded preset id.
   */
  const contextOf = async (sessionId) => {
    const live = ctx.agents.get(sessionId)
    if (live !== undefined) {
      return { cwd: await ctx.workingDirectory.ensure(live), agentPreset: undefined }
    }
    const query = ctx.get('sessionQuery')
    if (query === undefined) return { cwd: ctx.workingDirectory.defaultDirectory, agentPreset: undefined }
    try {
      const observation = await query.observeSession(sessionId)
      try {
        const projected = observation.projections?.values?.workingDirectory
        const header = observation.header?.cwd
        const preset = observation.projections?.values?.agentPreset
        const cwd = typeof projected === 'string' && projected !== ''
          ? projected
          : typeof header === 'string' && header !== ''
            ? header
            : ctx.workingDirectory.defaultDirectory
        return { cwd, agentPreset: typeof preset === 'string' ? preset : undefined }
      } finally {
        const dispose = observation[Symbol.dispose]
        if (typeof dispose === 'function') dispose.call(observation)
      }
    } catch (error) {
      ctx.logger.warn('skills-status: could not inspect %s: %s', sessionId, String(error))
      return { cwd: ctx.workingDirectory.defaultDirectory, agentPreset: undefined }
    }
  }

  /**
   * The scope a Session's catalog is read through: its live Agent, or a lease
   * on the standing preset composition when the Agent is cold.
   * @param sessionId - Session identity.
   * @param agentPreset - the recorded preset id for a cold Session.
   * @returns the scope key and an optional lease to release.
   */
  const scopeOfSession = async (sessionId, agentPreset) => {
    const live = ctx.agents.get(sessionId)
    if (live !== undefined) return { scope: live, lease: undefined }
    const presets = ctx.get('agentPresets')
    if (presets === undefined) return { scope: undefined, lease: undefined }
    try {
      const lease = await presets.acquireScope(agentPreset)
      return { scope: lease.key, lease }
    } catch {
      return { scope: undefined, lease: undefined }
    }
  }

  /**
   * Reconcile one live Agent's masks with the workspace's recorded state.
   * Registers a mask only for a name the Agent can currently see, so the
   * registry never gains phantom entries for skills that do not exist.
   * @param agent - the live Agent.
   */
  const syncAgent = async (agent) => {
    const cwd = await ctx.workingDirectory.ensure(agent)
    const workspace = workspaceFor(cwd)
    const disabled = getStore().disabled(workspace.key)
    const current = masks.get(agent) ?? new Map()

    // Unmask what the workspace now loads again.
    for (const [name, entry] of [...current]) {
      if (disabled.has(name)) continue
      current.delete(name)
      applying += 1
      try {
        entry.disposer()
      } catch (error) {
        ctx.logger.warn('skills-status: could not unmask %s: %s', name, String(error))
      } finally {
        applying -= 1
      }
    }

    const wanted = [...disabled].filter(name => !current.has(name))
    if (wanted.length === 0) {
      masks.set(agent, current)
      return
    }

    let visible
    try {
      visible = await ctx.skills.list({ cwd, scope: agent })
    } catch (error) {
      ctx.logger.warn('skills-status: could not list skills for %s: %s', agent.id, String(error))
      masks.set(agent, current)
      return
    }
    const byName = new Map(visible.map(skill => [skill.name, skill]))
    const upstreams = upstreamIndex(cwd)

    for (const name of wanted) {
      const summary = byName.get(name)
      // A mask is not a skill: it must never be mistaken for the real entry.
      if (summary === undefined || summary.provider === MASK_PROVIDER) continue
      // The real entry is visible exactly once, here. Record its group before
      // the mask hides the instruction path the frontmatter fallback needs, so
      // a row written by an older version (no group column) heals itself and a
      // cold reopen still files the skill under the right upstream.
      const known = upstreams.get(name) ?? upstreamFromFrontmatter(summary.path)
      if (known !== undefined) {
        try {
          getStore().backfillUpstream(workspace.key, name, known.upstream, known.url)
        } catch (error) {
          ctx.logger.warn('skills-status: could not record the group of %s: %s', name, String(error))
        }
      }
      applying += 1
      try {
        // The Agent scope inherits only the services its minting plugin injected,
        // so read the required registry through the strict global lookup.
        const disposer = agent.ctx.get('skills').register({
          name,
          description: summary.description,
          source: MASK_SOURCE,
          provider: MASK_PROVIDER,
          content: MASK_CONTENT,
          invocation: { modelInvocable: false, userInvocable: false },
        })
        current.set(name, {
          disposer,
          summary: {
            name,
            description: summary.description,
            source: summary.source,
            whenToUse: summary.whenToUse,
            path: summary.path,
          },
        })
      } catch (error) {
        ctx.logger.warn('skills-status: could not mask %s: %s', name, String(error))
      } finally {
        applying -= 1
      }
    }
    masks.set(agent, current)
  }

  /** Reconcile every live Agent. */
  const resyncAll = async () => {
    for (const agent of ctx.agents.list()) {
      try {
        await syncAgent(agent)
      } catch (error) {
        ctx.logger.warn('skills-status: could not sync %s: %s', agent.id, String(error))
      }
    }
  }

  /** Request one coalesced re-sync. */
  const scheduleResync = () => {
    if (resyncQueued) return
    resyncQueued = true
    queueMicrotask(() => {
      resyncQueued = false
      if (applying > 0) return
      void resyncAll()
    })
  }

  /** Drop one Agent's masks when it leaves the registry. */
  const forget = (agent) => {
    const current = masks.get(agent)
    masks.delete(agent)
    if (current === undefined) return
    for (const entry of current.values()) {
      try {
        entry.disposer()
      } catch {
        // The Agent's own scope teardown already removed the registration.
      }
    }
  }

  /**
   * Index every install record that can describe this catalog's skills.
   *
   * Two lock files matter: the user one under the agents home, and the project
   * one beside the workspace's own `.agents/skills` root. Both are read on each
   * projection — they are small, and a freshly installed skill must be grouped
   * correctly on the next read without a restart.
   * @param cwd - the Session's effective directory, used to locate a project lock.
   * @returns skill name → `{ upstream, url }`.
   */
  const upstreamIndex = (cwd) => {
    const index = new Map()
    const home = typeof process.env.AGENTS_HOME === 'string' && process.env.AGENTS_HOME !== ''
      ? process.env.AGENTS_HOME
      : join(homedir(), '.agents')
    readSkillLock(join(home, '.skill-lock.json'), index)
    // A project root is the nearest ancestor holding `.git`, the same rule the
    // filesystem provider uses to find project skills.
    for (let directory = canonical(cwd); ; directory = dirname(directory)) {
      if (existsSync(join(directory, '.git'))) {
        readSkillLock(join(directory, '.agents', '.skill-lock.json'), index)
        break
      }
      if (dirname(directory) === directory) break
    }
    return index
  }

  /**
   * Project the panel's list for one Session.
   * @param sessionId - Session identity.
   * @returns the workspace, the skills, and the counts.
   */
  const list = async (sessionId) => {
    const { cwd, agentPreset } = await contextOf(sessionId)
    const workspace = workspaceFor(cwd)
    const recorded = getStore().read(workspace.key)
    const disabled = new Set([...recorded].filter(([, row]) => !row.enabled).map(([name]) => name))
    const upstreams = upstreamIndex(cwd)
    const { scope, lease } = await scopeOfSession(sessionId, agentPreset)
    try {
      const catalog = await ctx.skills.list({ cwd, scope })
      const rows = []
      const seen = new Set()
      // Hidden sources stay out of the panel and out of the counts, but keep
      // their recorded switches: the row is still read on the next sync, so a
      // skill hidden here is not silently re-enabled.
      let hidden = 0
      for (const skill of catalog) {
        // The mask only exists to hide the real entry; the panel reports the
        // real one from its stored summary below.
        if (skill.provider === MASK_PROVIDER) continue
        seen.add(skill.name)
        if (options.hiddenSources.has(skill.source)) {
          hidden += 1
          continue
        }
        // The lock file wins; a skill it never recorded falls back to whatever
        // its own frontmatter declares before it lands in the local bucket.
        const known = upstreams.get(skill.name) ?? upstreamFromFrontmatter(skill.path)
        rows.push({
          name: skill.name,
          description: skill.description,
          source: skill.source,
          upstream: known?.upstream ?? LOCAL_UPSTREAM,
          upstreamUrl: known?.url,
          modelInvocable: skill.invocation.modelInvocable,
          userInvocable: skill.invocation.userInvocable,
          enabled: !disabled.has(skill.name),
        })
      }
      // A disabled skill is shadowed out of the catalog, so it is restored from
      // the row recorded at toggle time — the mask's summary while the Agent is
      // live, the persisted description and source once it has gone cold.
      for (const name of disabled) {
        if (seen.has(name)) continue
        const agent = ctx.agents.get(sessionId)
        const entry = agent === undefined ? undefined : masks.get(agent)?.get(name)
        const meta = recorded.get(name) ?? {}
        const source = entry?.summary.source ?? meta.source ?? MASK_SOURCE
        if (options.hiddenSources.has(source)) continue
        // The upstream must not depend on the switch: a skill that is merely
        // shadowed would otherwise fall to `local` and appear to change group
        // the moment it is turned off. The mask keeps the real instruction path,
        // so the same frontmatter fallback the visible branch uses still works;
        // the persisted value covers a mask that has gone cold.
        const known = upstreams.get(name) ?? upstreamFromFrontmatter(entry?.summary.path)
        rows.push({
          name,
          description: entry?.summary.description ?? meta.description ?? '',
          source,
          upstream: known?.upstream ?? meta.upstream ?? LOCAL_UPSTREAM,
          upstreamUrl: known?.url ?? meta.upstreamUrl,
          modelInvocable: true,
          userInvocable: true,
          enabled: false,
        })
      }
      rows.sort((left, right) => left.name.localeCompare(right.name))
      return {
        workspace,
        skills: rows,
        enabled: rows.filter(row => row.enabled).length,
        total: rows.length,
        hidden,
        // Group keys in display order: the shipped/local bucket last, because
        // it is the catch-all rather than an author.
        upstreams: groupUpstreams(rows),
      }
    } finally {
      if (lease !== undefined) {
        try {
          await lease[Symbol.asyncDispose]?.()
        } catch {
          // A lease released by teardown needs no second release.
        }
      }
    }
  }

  /**
   * Record one toggle and apply it to every live Agent of that workspace.
   * @param sessionId - Session identity selecting the workspace.
   * @param skill - skill name.
   * @param enabled - whether the skill should load.
   * @returns the compact result.
   */
  const set = async (sessionId, skill, enabled) => {
    if (!SKILL_NAME.test(skill)) return { ok: false, reason: 'invalid-skill' }
    const { cwd, agentPreset } = await contextOf(sessionId)
    const workspace = workspaceFor(cwd)
    // Record the catalog row beside the switch so the panel can still name,
    // describe and group the skill after the workspace is reopened with no live
    // Agent. The upstream belongs here: the mask hides the catalog entry, so the
    // group has to survive on its own or the row would jump to `local`.
    let meta
    if (!enabled) {
      const upstreams = upstreamIndex(cwd)
      const { scope, lease } = await scopeOfSession(sessionId, agentPreset)
      try {
        const catalog = await ctx.skills.list({ cwd, scope })
        const match = catalog.find(entry => entry.name === skill && entry.provider !== MASK_PROVIDER)
        if (match !== undefined) {
          const known = upstreams.get(skill) ?? upstreamFromFrontmatter(match.path)
          meta = {
            description: match.description,
            source: match.source,
            upstream: known?.upstream,
            upstreamUrl: known?.url,
          }
        }
      } catch (error) {
        ctx.logger.warn('skills-status: could not describe %s: %s', skill, String(error))
      } finally {
        if (lease !== undefined) {
          try {
            await lease[Symbol.asyncDispose]?.()
          } catch {
            // A lease released by teardown needs no second release.
          }
        }
      }
      // A skill the catalog could not describe (already masked, cold preset)
      // still deserves its recorded group rather than a silent `local`.
      if (meta === undefined) {
        const known = upstreams.get(skill)
        if (known !== undefined) meta = { description: undefined, source: undefined, upstream: known.upstream, upstreamUrl: known.url }
      }
    }
    getStore().write(workspace.key, skill, enabled, meta)
    for (const agent of ctx.agents.list()) {
      try {
        const agentCwd = await ctx.workingDirectory.ensure(agent)
        if (workspaceFor(agentCwd).key !== workspace.key) continue
        await syncAgent(agent)
      } catch (error) {
        ctx.logger.warn('skills-status: could not apply %s: %s', skill, String(error))
      }
    }
    return { ok: true, application: 'applied', workspace: workspace.key, skill, enabled }
  }

  // Per-Agent masking is registered on the Agent's own context, so its teardown
  // unwinds it; the plugin keeps the disposers too, so a toggle can undo one.
  ctx.on('agent/created', async ({ agent }) => {
    try {
      await syncAgent(agent)
    } catch (error) {
      ctx.logger.warn('skills-status: initial sync failed for %s: %s', agent.id, String(error))
    }
  })
  ctx.on('agent/disposed', ({ agent }) => { forget(agent) })
  ctx.on('skills/change', () => {
    if (applying > 0) return
    scheduleResync()
  })

  ctx.effect(() => () => {
    for (const agent of [...masks.keys()]) forget(agent)
    if (store !== undefined) {
      try {
        store.close()
      } catch {
        // Closing an already-closed handle is not an error worth reporting.
      }
    }
  }, 'skills-status: teardown')

  ctx.inject(['connection'], (scope) => {
    scope.effect(() => scope.connection.fetch.register({
      path: LIST_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const sessionId = new URL(request.url).searchParams.get('sessionId')
        if (sessionId === null || sessionId === '') return json(400, { ok: false, reason: 'invalid-session' })
        try {
          return json(200, { ok: true, ...await list(sessionId) })
        } catch (error) {
          return json(500, { ok: false, reason: 'read-failed', diagnostic: String(error?.message ?? error) })
        }
      },
    }), 'skills-status: list route')

    scope.effect(() => scope.connection.fetch.register({
      path: SET_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        let body
        try {
          const text = await request.text()
          body = text.trim() === '' ? undefined : JSON.parse(text)
        } catch {
          return json(400, { ok: false, reason: 'invalid-json' })
        }
        if (body === null || typeof body !== 'object') return json(400, { ok: false, reason: 'invalid-body' })
        if (typeof body.sessionId !== 'string' || body.sessionId === '') {
          return json(400, { ok: false, reason: 'invalid-session' })
        }
        if (typeof body.skill !== 'string' || body.skill === '') return json(400, { ok: false, reason: 'invalid-skill' })
        try {
          const result = await set(body.sessionId, body.skill, body.enabled === true)
          return json(result.ok ? 200 : 400, result)
        } catch (error) {
          return json(500, { ok: false, reason: 'write-failed', diagnostic: String(error?.message ?? error) })
        }
      },
    }), 'skills-status: set route')
  })

  // A plugin installed while Agents are already live must mask them too.
  scheduleResync()
}
