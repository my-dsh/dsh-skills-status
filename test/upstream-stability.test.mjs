// Regression: a skill's upstream group must not change when its switch is
// turned off.
//
// The reported symptom was `huashu-design` sitting under
// `alchaincyf/huashu-design` while loaded and jumping to `local` once disabled.
// The cause: the disabled branch of `list()` resolved the upstream only from
// the lock-file index, and the mask that hides the skill also hides the
// instruction path the frontmatter fallback needs. Both halves are exercised
// here — a cold Session (persisted row only) and a live Agent (mask summary).
//
// Run with: node --test test/
import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { apply } from '../index.js'

const SKILL = 'huashu-design'
const UPSTREAM = 'alchaincyf/huashu-design'

const SKILL_MD = `---
name: huashu-design
description: A skill that is installed straight from its repository, so no install lock records it.
metadata:
  repository: "https://github.com/alchaincyf/huashu-design"
---

# Huashu Design
`

/** @type {string} */
let root
/** @type {string} */
let cwd
/** @type {string} */
let skillPath
/** @type {string} */
let databasePath

/**
 * Build a fake Cordis context exposing only what the bundle reads.
 * @param catalog - the skills `ctx.skills.list()` reports.
 * @param agent - the live Agent, or undefined for a cold Session.
 */
function makeContext(catalog, agent) {
  const routes = []
  const teardowns = []
  // Cordis `effect()` runs its callback now and keeps the returned disposer.
  const effect = fn => {
    const dispose = fn()
    if (typeof dispose === 'function') teardowns.push(dispose)
  }
  const ctx = {
    logger: { warn() {} },
    agents: {
      get: id => (agent !== undefined && agent.id === id ? agent : undefined),
      list: () => (agent === undefined ? [] : [agent]),
    },
    workingDirectory: {
      defaultDirectory: cwd,
      ensure: async () => cwd,
    },
    skills: {
      list: async () => catalog(),
    },
    get: () => undefined,
    on: () => {},
    effect,
    inject: (_services, callback) => {
      callback({
        effect,
        connection: {
          fetch: {
            register: route => { routes.push(route) },
          },
        },
      })
    },
  }
  return { ctx, routes, teardowns }
}

/** Invoke one registered route and return its decoded JSON body. */
async function call(routes, path, init) {
  const { pathname } = new URL(`http://127.0.0.1${path}`)
  const route = routes.find(entry => entry.path === pathname)
  assert.ok(route !== undefined, `route ${pathname} was registered`)
  const response = await route.fetch(new Request(`http://127.0.0.1${path}`, init))
  return { status: response.status, body: await response.json() }
}

const listRoute = routes => call(routes, '/api/skills-status.list?sessionId=session-1', {
  method: 'GET',
  headers: { 'content-type': 'application/json' },
}).then(({ body }) => body)

const setRoute = (routes, skill, enabled) => call(routes, '/api/skills-status.set', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sessionId: 'session-1', skill, enabled }),
})

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skills-status-upstream-'))
  cwd = join(root, 'workspace')
  skillPath = join(root, 'agents', 'skills', SKILL, 'SKILL.md')
  databasePath = join(root, 'db', 'skills-status.db')
  mkdirSync(cwd, { recursive: true })
  mkdirSync(join(root, 'agents', 'skills', SKILL), { recursive: true })
  writeFileSync(skillPath, SKILL_MD)
  // A lock file that deliberately does NOT mention this skill: that is what
  // makes the frontmatter fallback load-bearing.
  writeFileSync(join(root, 'agents', '.skill-lock.json'), JSON.stringify({ skills: {} }))
  process.env.AGENTS_HOME = join(root, 'agents')
})

after(() => {
  delete process.env.AGENTS_HOME
  rmSync(root, { recursive: true, force: true })
})

test('a cold Session keeps the group of a disabled skill', async () => {
  let enabled = true
  const catalog = () => (enabled
    ? [{
      name: SKILL,
      description: 'A skill installed straight from its repository.',
      source: 'user-agents',
      provider: 'filesystem',
      path: skillPath,
      invocation: { modelInvocable: true, userInvocable: true },
    }]
    : [])

  const { ctx, routes, teardowns } = makeContext(catalog, undefined)
  apply(ctx, { databasePath })

  const first = await listRoute(routes)
  assert.equal(first.ok, true, JSON.stringify(first).slice(0, 400))
  const beforeRow = first.skills.find(row => row.name === SKILL)
  assert.equal(beforeRow.upstream, UPSTREAM, 'loaded skill groups by its frontmatter repository')

  const written = await setRoute(routes, SKILL, false)
  assert.equal(written.status, 200)
  enabled = false

  const after = await listRoute(routes)
  assert.equal(after.ok, true)
  const afterRow = after.skills.find(row => row.name === SKILL)
  assert.ok(afterRow !== undefined, 'the disabled skill is still listed')
  assert.equal(afterRow.enabled, false)
  assert.equal(afterRow.upstream, UPSTREAM, 'disabling must not move the row to `local`')
  assert.equal(afterRow.upstreamUrl, `https://github.com/${UPSTREAM}`)

  for (const teardown of teardowns) teardown()
})

test('a live Agent resolves the group from the mask summary path', async () => {
  let enabled = true
  const catalog = () => {
    const real = {
      name: SKILL,
      description: 'A skill installed straight from its repository.',
      source: 'user-agents',
      provider: 'filesystem',
      path: skillPath,
      invocation: { modelInvocable: true, userInvocable: true },
    }
    if (enabled) return [real]
    // The mask shadows the real entry; only the mask summary survives.
    return [{
      name: SKILL,
      description: real.description,
      source: 'skills-status',
      provider: 'skills-status',
      path: skillPath,
      invocation: { modelInvocable: false, userInvocable: false },
    }]
  }

  const agent = {
    id: 'session-1',
    ctx: { get: () => ({ register: () => () => {} }) },
  }
  const { ctx, routes, teardowns } = makeContext(catalog, agent)
  apply(ctx, { databasePath: join(root, 'db', 'live.db') })

  const before = await listRoute(routes)
  assert.equal(before.skills.find(row => row.name === SKILL).upstream, UPSTREAM)

  const written = await setRoute(routes, SKILL, false)
  assert.equal(written.status, 200)
  enabled = false

  const after = await listRoute(routes)
  const afterRow = after.skills.find(row => row.name === SKILL)
  assert.ok(afterRow !== undefined)
  assert.equal(afterRow.enabled, false)
  assert.equal(afterRow.upstream, UPSTREAM, 'the mask must not change the group either')

  // Turning it back on restores the visible row in the same group.
  enabled = true
  const reenabled = await setRoute(routes, SKILL, true)
  assert.equal(reenabled.status, 200)
  const restored = await listRoute(routes)
  const restoredRow = restored.skills.find(row => row.name === SKILL)
  assert.equal(restoredRow.enabled, true)
  assert.equal(restoredRow.upstream, UPSTREAM)

  for (const teardown of teardowns) teardown()
})

test('a pre-existing database without the upstream columns still opens', async () => {
  // The bundle must migrate a database created before this fix, because the
  // reported symptom predates it and every user already has such a file.
  const legacyPath = join(root, 'db', 'legacy.db')
  const { DatabaseSync } = await import('node:sqlite')
  mkdirSync(join(root, 'db'), { recursive: true })
  const legacy = new DatabaseSync(legacyPath)
  legacy.exec(`CREATE TABLE skill_state (
    workspace TEXT NOT NULL,
    skill TEXT NOT NULL,
    enabled INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace, skill)
  )`)
  legacy.prepare('INSERT INTO skill_state (workspace, skill, enabled, updated_at) VALUES (?, ?, ?, ?)')
    .run(cwd, SKILL, 0, new Date().toISOString())
  legacy.close()

  const { ctx, routes, teardowns } = makeContext(() => [], undefined)
  apply(ctx, { databasePath: legacyPath })
  const body = await listRoute(routes)
  assert.equal(body.ok, true, 'a legacy row still lists')
  const row = body.skills.find(entry => entry.name === SKILL)
  assert.ok(row !== undefined)
  assert.equal(row.upstream, 'local', 'no group was ever recorded, so the catch-all stands')

  for (const teardown of teardowns) teardown()
})

test('a legacy row heals itself when a live Agent syncs', async () => {
  // Rows written before this fix carry no group. The Agent's sync is the only
  // moment the real instruction path is visible, so it repairs the row there —
  // and the repair survives a cold reopen, which is when the bug was worst.
  const legacyPath = join(root, 'db', 'heal.db')
  const { DatabaseSync } = await import('node:sqlite')
  mkdirSync(join(root, 'db'), { recursive: true })
  const legacy = new DatabaseSync(legacyPath)
  legacy.exec(`CREATE TABLE skill_state (
    workspace TEXT NOT NULL,
    skill TEXT NOT NULL,
    enabled INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace, skill)
  )`)
  legacy.prepare('INSERT INTO skill_state (workspace, skill, enabled, updated_at) VALUES (?, ?, ?, ?)')
    .run(cwd, SKILL, 0, new Date().toISOString())
  legacy.close()

  const catalog = () => [{
    name: SKILL,
    description: 'A skill installed straight from its repository.',
    source: 'user-agents',
    provider: 'filesystem',
    path: skillPath,
    invocation: { modelInvocable: true, userInvocable: true },
  }]
  const agent = { id: 'session-1', ctx: { get: () => ({ register: () => () => {} }) } }
  const { ctx, routes, teardowns } = makeContext(catalog, agent)
  apply(ctx, { databasePath: legacyPath })
  // `agent/created` and the deferred first sync run off the microtask queue.
  await new Promise(resolve => setTimeout(resolve, 50))

  const healed = await listRoute(routes)
  const row = healed.skills.find(entry => entry.name === SKILL)
  assert.ok(row !== undefined)
  assert.equal(row.enabled, false, 'the switch itself is untouched')
  assert.equal(row.upstream, UPSTREAM, 'the sync backfilled the group')

  for (const teardown of teardowns) teardown()

  // Cold reopen: no live Agent, the persisted group has to carry the row.
  const cold = makeContext(() => [], undefined)
  apply(cold.ctx, { databasePath: legacyPath })
  const coldBody = await listRoute(cold.routes)
  const coldRow = coldBody.skills.find(entry => entry.name === SKILL)
  assert.ok(coldRow !== undefined)
  assert.equal(coldRow.upstream, UPSTREAM, 'a cold reopen keeps the healed group')
  for (const teardown of cold.teardowns) teardown()
})
