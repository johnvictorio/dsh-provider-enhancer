/**
 * provider-enhancer — Host half.
 *
 * Keeps every `dsh-llm-pi-ai` (`llm-pi-ai`) route's model list up to date:
 *
 * 1. Auto-updated model lists. When `providers.<route>.autoUpdateModels` is on,
 *    the plugin periodically interrogates the route's endpoint through
 *    `ctx.llm.discoverModels` and merges the advertised models into that
 *    route's `models` list. Bumping a route's `refreshNonce` asks for one
 *    immediate refresh — that is what the card's "refresh models" button does;
 *    the nonce is reset once the request has been served.
 *
 * 2. Reasoning effort sets live in `llm-pi-ai` itself
 *    (`providers.<route>.models[].reasoningEfforts` /
 *    `providers.<route>.modelOverrides.<id>.reasoningEfforts`). The companion
 *    client card writes them straight through the shared settings forms, so the
 *    adapter picks a change up per request and nothing has to be mirrored here.
 *    Discovery therefore preserves every field of an entry it already knows —
 *    including the efforts a user configured — and only refreshes the facts an
 *    endpoint actually reports.
 *
 * Configuration here is therefore just this plugin's own state: the refresh
 * interval and the per-route auto-update switch plus its refresh request.
 */

import z from '@deepseek-ai/schemastery'
import { appendFileSync, statSync, writeFileSync } from 'node:fs'

export const name = 'provider-enhancer'
/**
 * Every service this plugin reaches, declared rather than merely looked up:
 * `ctx.get(name)` does not resolve a service the calling fiber never injected,
 * which is how an earlier revision became a silent no-op that still reported
 * itself as active.
 */
export const inject = ['llm', 'settings', 'timer']

/**
 * Where this plugin records what it decided and why.
 *
 * A Host-side failure would otherwise be invisible: the harness logs to its own
 * terminal, so a refresh that discovers nothing leaves no trace a user — or an
 * assistant helping them — can read back. The file stays bounded, truncating
 * once it grows past {@link LOG_LIMIT}.
 */
const LOG_PATH = '/tmp/provider-enhancer.log'
const LOG_LIMIT = 256 * 1024

/** Append one diagnostic line; a debug log must never break the plugin. */
const note = (message) => {
  try {
    try {
      if (statSync(LOG_PATH).size > LOG_LIMIT) writeFileSync(LOG_PATH, '')
    } catch {
      // No log yet: appendFileSync creates it.
    }
    appendFileSync(LOG_PATH, `${new Date().toISOString()} ${message}\n`)
  } catch {
    // Losing a diagnostic line is never worth failing a refresh over.
  }
}

/** Settings namespace of the pi-ai adapter this plugin maintains. */
const LLM_NS = 'llm-pi-ai'
/** This plugin's own settings namespace; the fiber id is preferred when it resolves. */
const FALLBACK_NS = 'provider-enhancer'

export const Config = z.object({
  /** Minutes between automatic model-list refreshes. */
  refreshIntervalMinutes: z.number().step(1).min(1).max(1440).default(10).volatile(),
  /** Per-route state written by the companion client card. */
  providers: z.dict(z.object({
    /** Periodically re-discover this route's model list. */
    autoUpdateModels: z.boolean().default(false),
    /** Consumer asks for one immediate discovery by bumping this. */
    refreshNonce: z.number().step(1).min(0).default(0),
    /** Model ids a refresh must never add back, and must drop when present. */
    blocked: z.array(z.string()).default([]),
  }), z.string()).default({}).volatile(),
})

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Read one config field. A volatile schema node resolves to a live wrapper
 * exposing `get()`, while an ordinary field resolves to its plain value, so
 * both shapes are accepted here rather than assuming one of them.
 */
const field = (node, fallback) => {
  if (node !== null && typeof node === 'object' && typeof node.get === 'function') {
    const live = node.get()
    return live === undefined ? fallback : live
  }
  return node === undefined ? fallback : node
}

/** Resolve one reference inside a flattened schemastery envelope (ids index `refs`). */
const deref = (env, node) => (typeof node === 'number' ? env.refs?.[node] : node)

/**
 * The thinking levels pi-ai itself accepts, read from the adapter's serialized
 * Config schema — the `reasoningEfforts` key union under
 * `providers.<route>.models[]`. Nothing here is a spelling this plugin invented.
 */
const acceptedLevels = (env) => {
  if (env === null || typeof env !== 'object' || env.refs === undefined) return []
  const dictWithKey = (node, depth) => {
    const resolved = deref(env, node)
    if (resolved === null || resolved === undefined || depth > 4) return undefined
    if (resolved.type === 'dict' && resolved.sKey !== undefined) return resolved
    for (const branch of resolved.list ?? []) {
      const found = dictWithKey(branch, depth + 1)
      if (found !== undefined) return found
    }
    return undefined
  }
  const root = deref(env, env.uid)
  const providers = deref(env, root?.dict?.providers)
  const profileSchema = deref(env, providers?.inner)
  const models = deref(env, profileSchema?.dict?.models)
  const modelEntry = deref(env, models?.inner)
  const efforts = dictWithKey(modelEntry?.dict?.reasoningEfforts, 0)
  const key = deref(env, efforts?.sKey)
  const names = []
  for (const item of key?.list ?? []) {
    const value = deref(env, item)?.value
    if (typeof value === 'string' && !names.includes(value)) names.push(value)
  }
  return names
}

/**
 * Foreign reasoning tokens an endpoint may advertise, mapped onto pi-ai's own
 * levels. The advertised token stays the spelling dispatch sends — a gateway
 * that says "on" keeps receiving "on"; pi-ai simply carries it on a level it
 * knows. Anything neither a pi-ai level nor a known alias is dropped.
 */
const LEVEL_ALIASES = {
  none: 'off',
  disabled: 'off',
  off: 'off',
  on: 'medium',
  adaptive: 'medium',
  enabled: 'medium',
  default: 'medium',
}

/**
 * Translate advertised tokens into one model's `reasoningEfforts`.
 * @returns `{ wire }` when a usable set exists, otherwise `{ dropped }`.
 */
const translateEfforts = (tokens, accepted) => {
  const wire = {}
  const dropped = []
  for (const token of tokens) {
    if (typeof token !== 'string' || token.length === 0) continue
    const lower = token.toLowerCase()
    const level = accepted.includes(lower) ? lower : LEVEL_ALIASES[lower]
    if (level === undefined || !accepted.includes(level)) {
      dropped.push(token)
      continue
    }
    wire[level] = level === 'off' ? null : token
  }
  // pi-ai refuses a set offering nothing beyond "off", so such a model keeps
  // whatever it had rather than being declared non-reasoning by accident.
  if (!Object.keys(wire).some((level) => level !== 'off')) return { dropped: dropped.length > 0 ? dropped : [...tokens] }
  return { wire, dropped }
}

export function apply(ctx, config) {
  const settings = ctx.get('settings')
  const timerSvc = ctx.get('timer')
  // Logged before the guard on purpose: a service that failed to resolve leaves
  // no other trace, and "active but doing nothing" is the hardest state to see.
  note(`apply: llm=${ctx.llm !== undefined} settings=${settings !== undefined} timer=${timerSvc !== undefined}`)
  if (settings === undefined || ctx.llm === undefined || timerSvc === undefined) return

  const descriptorFor = (ns) => {
    try {
      return (settings.describe() ?? []).find((descriptor) => descriptor.ns === ns)
    } catch {
      return undefined
    }
  }

  // The settings namespace is the profile entry id. Resolve it from what the
  // settings service actually serves instead of trusting one spelling: a
  // mismatched id silently disabled every reaction in an earlier revision.
  const fiberId = ctx.fiber?.entry?.options?.id
  const ENTRY = [fiberId, FALLBACK_NS].find((ns) => typeof ns === 'string' && descriptorFor(ns) !== undefined)
    ?? (typeof fiberId === 'string' ? fiberId : FALLBACK_NS)

  let disposed = false
  const seenNonce = new Map()
  const seenBlocked = new Map()
  const inFlight = new Set()
  note(`apply: fiber=${fiberId ?? '(none)'} ns=${ENTRY}`)
  let timer

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  // Optional: the hmr service owns the transaction every configuration write
  // runs inside. Its AsyncLocalStorage store follows this fiber's async chains
  // out of the write that triggered them, so a follow-up write started from a
  // settings event would be refused as nested forever. Its exit() runs work
  // outside that store. Declared softly, so a deployment without hmr still
  // runs this plugin — writes simply lose the escape hatch.
  let hmr
  try {
    hmr = ctx.get('hmr')
  } catch {
    hmr = undefined
  }
  if (hmr === undefined && typeof ctx.inject === 'function') {
    ctx.inject(['hmr'], (sub) => {
      hmr = sub.get('hmr')
    })
  }

  /**
   * Perform one settings write, retrying while the config editor still holds its
   * transaction.
   *
   * A refresh is triggered from inside a configuration write, and the editor
   * rejects any write issued from that event's async chain with "HMR
   * transactions cannot be nested" — the chain carries the transaction's store
   * across every await, so retrying in place can never succeed. Each attempt
   * therefore runs through the hmr service's exit(), which detaches the store;
   * the write then queues behind the ongoing transaction like any other caller.
   */
  const writeSettled = async (label, write) => {
    const escape = hmr?.executing && typeof hmr.executing.exit === 'function'
      ? (work) => hmr.executing.exit(work)
      : (work) => work()
    let lastError = ''
    for (let attempt = 0; attempt < 8; attempt++) {
      if (disposed) return false
      try {
        await escape(write)
        return true
      } catch (error) {
        lastError = String(error?.message ?? error)
        if (!lastError.includes('transaction')) {
          note(`${label}: REFUSED ${lastError}`)
          return false
        }
        await sleep(150 * (attempt + 1))
      }
    }
    note(`${label}: write still refused after 8 attempt(s): ${lastError}`)
    return false
  }

  /**
   * This plugin's live per-route state. A volatile config field resolves to a
   * live reference the loader commits into in place, so it is read first; the
   * settings descriptor is the fallback when that reference is unavailable.
   */
  const routeState = () => {
    const live = field(config.providers, undefined)
    if (live !== null && typeof live === 'object') return live
    const served = descriptorFor(ENTRY)?.value?.providers
    if (served !== null && served !== undefined && typeof served === 'object') return served
    return {}
  }
  note(`apply: routes=${JSON.stringify(Object.keys(routeState()))}`)

  // Optional: the credentials service supplies an endpoint key for the raw
  // listing read below. Declared softly, so a deployment without it still runs
  // this plugin — enrichment is simply skipped and logged.
  let credentials
  try {
    credentials = ctx.get('credentials')
  } catch {
    credentials = undefined
  }
  if (credentials === undefined && typeof ctx.inject === 'function') {
    ctx.inject(['credentials'], (sub) => {
      credentials = sub.get('credentials')
    })
  }

  /**
   * Read the endpoint's own model listing.
   *
   * Discovery answers with the adapter's normalized candidates, which carry no
   * reasoning facts — a gateway usually advertises them beside the model, so
   * they are read here without disturbing the adapter's own view.
   */
  const fetchListing = async (profile) => {
    const base = typeof profile?.baseURL === 'string' ? profile.baseURL.replace(/\/+$/, '') : ''
    if (base.length === 0) return undefined
    const url = base.endsWith('/models') ? base : `${base}/models`
    const headers = { accept: 'application/json' }
    for (const [name, value] of Object.entries(profile?.headers ?? {})) {
      if (typeof value === 'string') headers[name] = value
    }
    const ref = profile?.apiKeyEnv
    if (typeof ref === 'string' && ref.length > 0 && credentials !== undefined) {
      try {
        const resolved = await credentials.resolve(ref)
        const key = resolved?.value
        if (typeof key === 'string' && key.length > 0) {
          if (profile?.api === 'anthropic-messages') headers['x-api-key'] = key
          else headers.authorization = `Bearer ${key}`
        }
      } catch (error) {
        note(`listing ${url}: credential "${ref}" unresolved (${error?.message ?? error})`)
      }
    }
    try {
      const response = await fetch(url, { headers })
      if (!response.ok) {
        note(`listing ${url}: HTTP ${response.status}`)
        return undefined
      }
      const body = await response.json()
      if (Array.isArray(body?.data)) return body.data
      if (Array.isArray(body?.models)) return body.models
      note(`listing ${url}: neither a data array nor a models array`)
      return undefined
    } catch (error) {
      note(`listing ${url}: FAILED ${error?.message ?? error}`)
      return undefined
    }
  }

  /** What the endpoint says each model's reasoning offers, keyed by model id. */
  const advertisedFor = async (profile) => {
    const listing = await fetchListing(profile)
    if (listing === undefined) return undefined
    const accepted = acceptedLevels(descriptorFor(LLM_NS)?.schema)
    if (accepted.length === 0) {
      note('listing: the adapter published no level vocabulary, so nothing was translated')
      return undefined
    }
    const advertised = new Map()
    let droppedTokens = 0
    for (const raw of listing) {
      const id = typeof raw?.id === 'string' ? raw.id : undefined
      if (id === undefined) continue
      // Two advertisement shapes read so far: `reasoning_efforts.levels`
      // (plain tokens) and Charm Hyper's `reasoning.effort_levels`
      // ({ value, display } rows). Only the token itself travels on the wire.
      const effortList = raw?.reasoning?.effort_levels ?? raw?.reasoning_efforts?.levels
      if (Array.isArray(effortList)) {
        const tokens = effortList
          .map((entry) => (entry !== null && typeof entry === 'object' ? entry.value : entry))
          .filter((token) => typeof token === 'string' && token.length > 0)
        const { wire, dropped } = translateEfforts(tokens, accepted)
        droppedTokens += dropped.length
        if (wire === undefined) {
          note(`reasoning ${id}: unusable levels ${JSON.stringify(effortList)}`)
          continue
        }
        advertised.set(id, wire)
      } else if (raw?.capabilities?.reasoning === false
        || (raw?.reasoning === undefined && raw?.capabilities !== undefined)) {
        // An endpoint that describes capabilities but leaves reasoning out is
        // declaring a non-reasoning model, not an unknown one.
        advertised.set(id, false)
      }
    }
    note(`listing: ${listing.length} model(s), ${advertised.size} with reasoning facts${droppedTokens > 0 ? `, ${droppedTokens} advertised token(s) had no pi-ai level` : ''}`)
    return advertised
  }

  /**
   * Merge discovery results into the route's current entries: an entry keeps
   * every field it already carries (manual fields, reasoning efforts) while the
   * facts an endpoint reports are refreshed, and models the endpoint advertises
   * that the list does not know yet are appended.
   *
   * `advertised` carries what the endpoint says about reasoning per model id —
   * a level map, or `false` for a model it declares non-reasoning. It only ever
   * fills a gap: an effort set this user chose is never overwritten.
   */
  const mergeModels = (existing, discovered, advertised, blocked) => {
    const excluded = new Set(Array.isArray(blocked) ? blocked : [])
    const list = []
    const byId = new Map()
    for (const entry of existing ?? []) {
      if (!entry || typeof entry.id !== 'string' || excluded.has(entry.id)) continue
      const copy = { ...entry }
      byId.set(copy.id, copy)
      list.push(copy)
    }
    for (const model of discovered ?? []) {
      if (!model || typeof model.id !== 'string' || excluded.has(model.id)) continue
      let entry = byId.get(model.id)
      if (entry === undefined) {
        entry = { id: model.id }
        byId.set(model.id, entry)
        list.push(entry)
      }
      if (typeof model.name === 'string' && model.name.length > 0) entry.name = model.name
      if (Number.isInteger(model.contextWindow)) entry.contextWindow = model.contextWindow
      if (Number.isInteger(model.maxTokens)) entry.maxTokens = model.maxTokens
      if (Array.isArray(model.inputModalities)) entry.input = [...model.inputModalities]
    }
    for (const [id, value] of advertised ?? []) {
      const entry = byId.get(id)
      if (entry === undefined || entry.reasoningEfforts !== undefined) continue
      entry.reasoningEfforts = value
    }
    return list
  }

  /**
   * Recompute and persist one route's `models` list; `discover` interrogates
   * the endpoint first. One discovery per route runs at a time: a pending
   * request and an automatic refresh can name the same route at startup.
   */
  const reconcile = async (route, { discover }) => {
    if (disposed) return false
    if (!discover) return reconcileRoute(route, { discover: false })
    if (inFlight.has(route)) return false
    inFlight.add(route)
    try {
      return await reconcileRoute(route, { discover: true })
    } finally {
      inFlight.delete(route)
    }
  }

  const reconcileRoute = async (route, { discover }) => {
    const descriptor = descriptorFor(LLM_NS)
    if (descriptor === undefined) return false
    const profile = descriptor.value?.providers?.[route]
    if (profile === undefined && !discover) return false
    const existing = Array.isArray(profile?.models) ? profile.models : undefined
    if (discover && existing === undefined) {
      const overrides = profile?.modelOverrides
      if (overrides !== undefined && Object.keys(overrides).length > 0) {
        note(`merge ${route}: route declares modelOverrides, so a discovered models list would be rejected; leaving it alone`)
        ctx.logger?.warn?.(`provider-enhancer: route "${route}" declares modelOverrides, so a discovered models list would be rejected; leaving it alone`)
        return false
      }
    }
    if (!discover && existing === undefined) return false

    let discovered = existing
    if (discover) {
      // Discovery describes a draft: a route pi-ai ships no catalog for is only
      // interrogated when the request carries its endpoint. The stored profile
      // supplies the credential and headers, so naming the route is enough for
      // authentication as long as the endpoint travels with it.
      const request = { provider: route }
      if (typeof profile?.baseURL === 'string' && profile.baseURL.length > 0) request.baseURL = profile.baseURL
      if (typeof profile?.api === 'string' && profile.api.length > 0) request.api = profile.api
      note(`discover ${route}: baseURL=${request.baseURL ?? '(none)'} api=${request.api ?? '(default)'}`)
      try {
        discovered = await ctx.llm.discoverModels(LLM_NS, request)
        note(`discover ${route}: endpoint advertised ${discovered.length} model(s)`)
      } catch (error) {
        note(`discover ${route}: FAILED ${error?.message ?? error}`)
        ctx.logger?.warn?.(`provider-enhancer: model discovery failed for "${route}": ${error?.message ?? error}`)
        return false
      }
      if (disposed) return false
    }

    // Reasoning facts live beside the model in the endpoint's own listing, so
    // they are read separately and only fill gaps this user has not filled.
    const advertised = discover ? await advertisedFor(profile) : undefined
    if (disposed) return false

    const state = routeState()?.[route] ?? {}
    const blocked = Array.isArray(state.blocked) ? state.blocked : []
    if (blocked.length > 0) note(`merge ${route}: excluding ${blocked.length} blocked model(s)`)
    const merged = mergeModels(existing, discovered, advertised, blocked)
    if (sameJson(merged, existing ?? [])) {
      note(`merge ${route}: unchanged at ${merged.length} model(s)`)
      return false
    }
    const wrote = await writeSettled(`merge ${route}`, () => settings.mutate(LLM_NS, [
      { op: 'set', path: ['providers', route, 'models'], value: merged },
    ]))
    if (wrote) note(`merge ${route}: wrote ${merged.length} model(s) into ${LLM_NS}`)
    return wrote
  }

  const autoRoutes = () => Object.entries(routeState())
    .filter(([, profile]) => profile?.autoUpdateModels === true)
    .map(([route]) => route)

  const refreshAutoRoutes = () => {
    for (const route of autoRoutes()) void reconcile(route, { discover: true })
  }

  const armTimer = () => {
    if (timer !== undefined) {
      timer()
      timer = undefined
    }
    if (disposed) return
    const minutes = Number(field(config.refreshIntervalMinutes, 10))
    const ms = Math.max(1, Number.isFinite(minutes) && minutes > 0 ? minutes : 10) * 60000
    timer = timerSvc.interval(() => refreshAutoRoutes(), ms)
  }

  /** Serve one route's pending refresh request, then clear it. */
  const serveRefresh = async (route) => {
    note(`refresh ${route}: start`)
    await reconcile(route, { discover: true })
    if (disposed) return
    const cleared = await writeSettled(`refresh ${route}`, () => settings.mutate(ENTRY, [
      { op: 'set', path: ['providers', route, 'refreshNonce'], value: 0 },
    ]))
    note(cleared ? `refresh ${route}: done, request cleared` : `refresh ${route}: request left pending`)
  }

  /** Routes whose `refreshNonce` moved since it was last observed. */
  const pendingRefreshes = () => {
    const requested = []
    for (const [route, profile] of Object.entries(routeState())) {
      const nonce = Number(profile?.refreshNonce) || 0
      if (seenNonce.get(route) === nonce) continue
      note(`nonce ${route}: ${seenNonce.get(route) ?? '(unseen)'} -> ${nonce}`)
      seenNonce.set(route, nonce)
      if (nonce > 0) requested.push(route)
    }
    return requested
  }

  /**
   * React to this plugin's own configuration moving.
   *
   * A change confined to volatile fields does not remount the fiber: the loader
   * commits the new values into the live references and announces them with
   * `loader/volatile-update` on this fiber's context. The settings document
   * event can arrive before that commit, so both feed the same check, and a slow
   * poll covers a deployment where neither reaches this fiber.
   */
  /** Routes whose blacklist moved since it was last observed. */
  const blockedMoved = () => {
    const changed = []
    for (const [route, profile] of Object.entries(routeState())) {
      const list = Array.isArray(profile?.blocked) ? profile.blocked : []
      const signature = JSON.stringify([...list].sort())
      if (seenBlocked.get(route) === signature) continue
      seenBlocked.set(route, signature)
      changed.push(route)
    }
    return changed
  }

  const onConfigMoved = (source) => {
    if (disposed) return
    const requested = pendingRefreshes()
    if (requested.length > 0) note(`${source}: serving ${requested.join(', ')}`)
    for (const route of requested) void serveRefresh(route)
    // A blacklist edit needs no endpoint call: it only drops entries, so the
    // stored list is re-materialized without discovery.
    const blacklisted = blockedMoved()
    if (blacklisted.length > 0) note(`${source}: re-merging ${blacklisted.join(', ')} for blacklist state`)
    for (const route of blacklisted) void reconcile(route, { discover: false })
    armTimer()
  }

  ctx.on('loader/volatile-update', () => onConfigMoved('volatile-update'))
  ctx.on('settings/document-updated', () => onConfigMoved('document-updated'))

  const disposeAdaptersListener = ctx.on('llm/adapters-updated', () => {
    if (!disposed) refreshAutoRoutes()
  })

  // A backstop for a deployment where neither configuration event reaches this
  // fiber: a pending request is still honoured, just later.
  const poll = timerSvc.interval(() => onConfigMoved('poll'), 30000)

  ctx.effect(() => () => {
    disposed = true
    disposeAdaptersListener()
    poll()
    if (timer !== undefined) timer()
  }, 'provider-enhancer: stop timers and listeners')

  // A request recorded before this fiber started (a click served by no one yet)
  // is still a request: serve it now, then keep the automatic routes fresh.
  onConfigMoved('startup')
  refreshAutoRoutes()
}

