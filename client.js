window.__ModuleLoader__.load({
  id: 'dsh-provider-enhancer',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** This plugin's own settings namespace (auto-update state). */
    const NS = 'provider-enhancer'
    /** The pi-ai adapter namespace this card maintains. */
    const LLM_NS = 'llm-pi-ai'

    const css = `
.pe-root { font-family: var(--dsw-font-family); font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 10px; border-top: 1px dashed var(--dsw-alias-border-l2); padding-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.pe-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pe-title { font-weight: 600; color: var(--dsw-alias-label-primary); }
.pe-route { font-family: var(--dsw-font-family-mono, monospace); font-size: 11px; }
.pe-spacer { flex: 1; }
.pe-button { cursor: pointer; color: var(--dsw-alias-label-primary); background: transparent; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 2px 10px; font-size: 12px; line-height: 18px; font-family: inherit; }
.pe-button:hover:not(:disabled) { border-color: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2)); }
.pe-button:disabled { opacity: .55; cursor: default; }
.pe-toggle { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; user-select: none; }
.pe-chip { border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; padding: 0 7px; line-height: 16px; font-size: 11px; white-space: nowrap; }
.pe-model { border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.pe-model-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.pe-model-name { font-weight: 600; color: var(--dsw-alias-label-primary); font-size: 12px; }
.pe-model-id { font-family: var(--dsw-font-family-mono, monospace); font-size: 11px; color: var(--dsw-alias-label-dimmed, var(--dsw-alias-label-secondary)); }
.pe-modes { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
/* A native select paints its popup from the CSS color-scheme property, which the
   shell sets on :root only in its boot stylesheet — an in-app theme switch
   repaints the tokens (scoped to body[data-ds-dark-theme]) without revisiting
   it, leaving a white list under a dark card. Both the control and its options
   are therefore themed here, and color-scheme is keyed to the same attribute the
   palette uses. */
.pe-select { font-family: inherit; font-size: 12px; color: var(--dsw-alias-label-primary); background-color: var(--dsw-alias-bg-layer-2); color-scheme: light; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 1px 6px; }
body[data-ds-dark-theme] .pe-select { color-scheme: dark; }
.pe-select option { background-color: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); }
.pe-filter { font-family: inherit; font-size: 12px; color: var(--dsw-alias-label-primary); background-color: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 1px 8px; min-width: 170px; }
.pe-levels { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 3px 12px; padding-left: 2px; }
.pe-level { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
.pe-level-name { color: var(--dsw-alias-label-primary); min-width: 52px; }
.pe-wire { width: 88px; font-family: inherit; font-size: 11px; color: var(--dsw-alias-label-primary); background-color: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 0 5px; }
.pe-wire-note { font-size: 11px; color: var(--dsw-alias-label-dimmed, var(--dsw-alias-label-secondary)); }
.pe-hint { font-size: 11px; color: var(--dsw-alias-label-dimmed, var(--dsw-alias-label-secondary)); }
.pe-warn { font-size: 11px; color: var(--dsw-alias-state-warning-primary, #b7791f); }
.pe-error { font-size: 11px; color: var(--dsw-alias-state-error-primary, #c0392b); }
.pe-status { font-size: 11px; color: var(--dsw-alias-state-success-primary, #2ecc71); }
.pe-mini { padding: 0 6px; font-size: 11px; line-height: 16px; }
.pe-blocked { display: flex; flex-direction: column; gap: 3px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 10px; padding: 6px 10px; }
.pe-blocked-row { display: flex; align-items: center; gap: 8px; }
.pe-blocked-id { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--dsw-font-family-mono, monospace); font-size: 11px; color: var(--dsw-alias-label-primary); }
`

    /** Resolve one flattened schema-envelope reference (ids index `refs`). */
    const deref = (env, node) => (typeof node === 'number' ? env.refs?.[node] : node)

    /**
     * Read the thinking levels pi-ai itself accepts straight out of the
     * adapter's serialized Config schema: the `reasoningEfforts` dict declares
     * its levels as the key union of `providers.<route>.models[]`. Nothing here
     * is a spelling this plugin invented.
     */
    function levelNames(env) {
      if (env === null || typeof env !== 'object' || env.refs === undefined) return []
      const effortsDict = (node, depth) => {
        const resolved = deref(env, node)
        if (resolved === null || resolved === undefined || depth > 4) return undefined
        if (resolved.type === 'dict' && resolved.sKey !== undefined) return resolved
        for (const branch of resolved.list ?? []) {
          const found = effortsDict(branch, depth + 1)
          if (found !== undefined) return found
        }
        return undefined
      }
      const root = deref(env, env.uid)
      const providers = deref(env, root?.dict?.providers)
      const profile = deref(env, providers?.inner)
      const models = deref(env, profile?.dict?.models)
      const modelEntry = deref(env, models?.inner)
      const efforts = effortsDict(modelEntry?.dict?.reasoningEfforts, 0)
      const key = deref(env, efforts?.sKey)
      const names = []
      for (const item of key?.list ?? []) {
        const value = deref(env, item)?.value
        if (typeof value === 'string' && !names.includes(value)) names.push(value)
      }
      return names
    }

    /** Human summary of the efforts a provider currently carries for one model. */
    function describeEfforts(efforts) {
      if (efforts === false) return 'non-reasoning'
      if (efforts !== null && typeof efforts === 'object') {
        const keys = Object.keys(efforts)
        return keys.length === 0 ? 'none declared' : keys.join(' · ')
      }
      return 'catalog default'
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      const configForms = ctx.get('configForms')
      if (slots === undefined || configForms === undefined) return
      const pe = configForms.get(NS)
      const llm = configForms.get(LLM_NS)
      if (pe === undefined || llm === undefined) return
      const describe = typeof configForms.describe === 'function' ? configForms.describe() : undefined

      const namespaceView = (ns) => {
        try {
          return describe?.getSnapshot?.()?.view?.namespaces?.find((entry) => entry.ns === ns)
        } catch {
          return undefined
        }
      }

      /**
       * Where one model's efforts live inside `llm-pi-ai`. An explicit `models`
       * list replaces the installed catalog, so its entries carry the field;
       * a catalog-served route is reshaped through `modelOverrides` instead —
       * pi-ai refuses both spellings at once.
       */
      function effortsPath(route, profile, modelId) {
        const models = Array.isArray(profile?.models) ? profile.models : []
        if (models.length > 0) {
          const index = models.findIndex((model) => model !== null && typeof model === 'object' && model.id === modelId)
          return index < 0 ? null : ['providers', route, 'models', String(index), 'reasoningEfforts']
        }
        return ['providers', route, 'modelOverrides', modelId, 'reasoningEfforts']
      }

      function ModelBlock({ model, levels, override, disabled, pending, onWrite, onBlock }) {
        // While the user composes an explicit set the draft owns the field, so
        // a half-finished selection never reaches the adapter: pi-ai refuses an
        // empty `reasoningEfforts` and a set offering nothing beyond "off".
        const [draft, setDraft] = React.useState(null)
        const stored = override !== null && typeof override === 'object' ? override : {}
        const dict = draft ?? stored
        const mode = draft !== null ? 'custom' : override === undefined ? 'default' : override === false ? 'none' : 'custom'
        const current = model.reasoningEfforts
        const selected = Object.keys(dict)
        const onlyOff = mode === 'custom' && selected.length > 0 && selected.every((level) => level === 'off')
        const invalid = mode === 'custom' && (selected.length === 0 || onlyOff)

        const choose = (next) => {
          if (next === 'default') {
            setDraft(null)
            return onWrite(undefined)
          }
          if (next === 'none') {
            setDraft(null)
            return onWrite(false)
          }
          // Compose locally from what the provider already carries, so the wire
          // spellings a gateway accepts survive the edit.
          setDraft({ ...stored })
        }

        const commit = (next) => {
          setDraft(next)
          if (Object.keys(next).length === 0) {
            setDraft(null)
            return onWrite(undefined)
          }
          if (Object.keys(next).every((level) => level === 'off')) return undefined
          return onWrite(next)
        }

        const toggleLevel = (level, checked) => {
          const next = { ...dict }
          if (checked) next[level] = level === 'off' ? null : level
          else delete next[level]
          return commit(next)
        }

        const setWire = (level, wire) => commit({ ...dict, [level]: wire })

        return h('div', { className: 'pe-model' },
          h('div', { className: 'pe-model-head' },
            h('span', { className: 'pe-model-name' }, model.name || model.id),
            model.name && model.name !== model.id ? h('span', { className: 'pe-model-id' }, model.id) : null,
            h('span', { className: 'pe-chip', title: 'Reasoning efforts this provider currently declares for the model.' }, `now: ${describeEfforts(current)}`),
            pending ? h('span', { className: 'pe-status' }, 'saving…') : null,
            h('span', { className: 'pe-spacer' }),
            h('button', {
              type: 'button',
              className: 'pe-button pe-mini',
              disabled,
              onClick: () => onBlock(model.id),
              title: 'Blacklist this model: a refresh will not add it back, and it leaves the list now.',
            }, 'block'),
          ),
          h('div', { className: 'pe-modes' },
            h('span', null, 'reasoning:'),
            h('select', {
              className: 'pe-select',
              value: mode,
              disabled,
              onChange: (event) => choose(event.target.value),
            },
              h('option', { value: 'default' }, 'provider default'),
              h('option', { value: 'none' }, 'non-reasoning'),
              h('option', { value: 'custom' }, 'choose levels…'),
            ),
            mode === 'none'
              ? h('span', { className: 'pe-hint' }, 'declares this model as carrying no thinking at all')
              : null,
            mode === 'default'
              ? h('span', { className: 'pe-hint' }, 'keeps whatever the profile or the installed catalog declares')
              : null,
          ),
          mode === 'custom'
            ? (levels.length === 0
              ? h('div', { className: 'pe-hint' }, 'The provider has not published its level vocabulary yet.')
              : h('div', { className: 'pe-levels' }, levels.map((level) => {
                const checked = Object.hasOwn(dict, level)
                return h('label', { key: level, className: 'pe-level' },
                  h('input', {
                    type: 'checkbox',
                    checked,
                    disabled,
                    onChange: () => toggleLevel(level, !checked),
                  }),
                  h('span', { className: 'pe-level-name' }, level),
                  checked && level !== 'off'
                    ? h('input', {
                      className: 'pe-wire',
                      value: typeof dict[level] === 'string' ? dict[level] : '',
                      placeholder: level,
                      disabled,
                      title: 'Spelling dispatch sends on the wire for this level — rename it when a gateway uses its own vocabulary.',
                      onChange: (event) => setWire(level, event.target.value),
                    })
                    : null,
                  checked && level === 'off'
                    ? h('span', { className: 'pe-wire-note' }, 'sends nothing')
                    : null,
                )
              })))
            : null,
          onlyOff
            ? h('div', { className: 'pe-warn' }, 'At least one level besides "off" is required, or use non-reasoning.')
            : null,
          mode === 'custom' && selected.length === 0
            ? h('div', { className: 'pe-warn' }, 'Check the levels this model should offer; nothing is written until one is chosen.')
            : null,
          mode === 'custom' && !onlyOff && levels.length > 0
            ? h('div', { className: 'pe-hint' }, 'Each checked level is offered to the model picker; the value beside it is the spelling sent on the wire.')
            : null,
        )
      }

      function Card(owner) {
        const route = owner?.provider?.provider
        const [peSnap, setPeSnap] = React.useState(() => pe.getSnapshot())
        const [llmSnap, setLlmSnap] = React.useState(() => llm.getSnapshot())
        const [pending, setPending] = React.useState('')
        const [error, setError] = React.useState('')
        const [notice, setNotice] = React.useState('')
        const [filter, setFilter] = React.useState('')
        const [expanded, setExpanded] = React.useState(false)
        const [page, setPage] = React.useState(0)
        const [showBlocked, setShowBlocked] = React.useState(false)

        React.useEffect(() => pe.subscribe(() => setPeSnap(pe.getSnapshot())), [])
        React.useEffect(() => llm.subscribe(() => setLlmSnap(llm.getSnapshot())), [])
        React.useEffect(() => {
          try {
            describe?.ensure?.()
          } catch { /* the shared mirror reads on its own otherwise */ }
        }, [])

        if (typeof route !== 'string' || route.length === 0) return null

        const peValue = peSnap.value !== null && typeof peSnap.value === 'object' ? peSnap.value : {}
        const routeCfg = (peValue.providers && peValue.providers[route]) || {}
        const autoUpdate = routeCfg.autoUpdateModels === true
        const interval = Number(peValue.refreshIntervalMinutes)
        const peWritable = peSnap.writable === true && peSnap.status !== 'unavailable'
        const llmWritable = llmSnap.writable === true && llmSnap.status !== 'unavailable'
        // Reasoning efforts are written straight into the adapter's namespace,
        // so they stay usable even while this plugin's own Host half (which
        // owns model-list refresh) is unavailable.
        const writable = llmWritable
        const listWritable = llmWritable && peWritable

        const llmValue = llmSnap.value !== null && typeof llmSnap.value === 'object' ? llmSnap.value : {}
        const profile = (llmValue.providers && llmValue.providers[route]) || {}
        const models = Array.isArray(profile.models) ? profile.models.filter((model) => model !== null && typeof model === 'object' && typeof model.id === 'string') : []
        const overrides = profile.modelOverrides !== null && typeof profile.modelOverrides === 'object' ? profile.modelOverrides : {}
        const levels = levelNames(namespaceView(LLM_NS)?.schema)

        const run = async (key, work) => {
          setPending(key)
          setError('')
          setNotice('')
          try {
            const accepted = await work()
            if (accepted === false) setError('The host refused the change; see the plugin log for the adapter diagnostic.')
            else setNotice('saved')
          } catch (err) {
            setError(String((err && err.message) || err))
          } finally {
            setPending('')
          }
        }

        const writeEfforts = (modelId, value) => {
          const path = effortsPath(route, profile, modelId)
          if (path === null) {
            setError(`"${modelId}" is not listed in this route's models, so its efforts cannot be set here.`)
            return Promise.resolve(false)
          }
          return run(modelId, () => (value === undefined
            ? llm.mutate([{ op: 'unset', path }])
            : llm.mutate([{ op: 'set', path, value }])))
        }

        const toggleAuto = () => void run('auto', () => pe.mutate([
          { op: 'set', path: ['providers', route, 'autoUpdateModels'], value: !autoUpdate },
        ]))

        const blocked = Array.isArray(routeCfg.blocked) ? routeCfg.blocked : []

        const blockModel = (id) => void run(`block:${id}`, () => pe.mutate([
          { op: 'set', path: ['providers', route, 'blocked'], value: [...new Set([...blocked, id])] },
        ]))

        const allowModel = (id) => void run(`allow:${id}`, () => pe.mutate([
          { op: 'set', path: ['providers', route, 'blocked'], value: blocked.filter((entry) => entry !== id) },
        ]))

        const refreshNow = () => void run('refresh', () => pe.mutate([
          { op: 'set', path: ['providers', route, 'refreshNonce'], value: (Number(routeCfg.refreshNonce) || 0) + 1 },
        ]))

        // A route with an explicit models list carries efforts on its entries;
        // a catalog-served route carries them under modelOverrides. pi-ai
        // refuses both spellings at once, so exactly one of these applies.
        // A blacklisted id leaves the card the moment it is blocked, rather than
        // waiting for the Host to prune the stored list.
        const blockedSet = new Set(blocked)
        const rows = models.length > 0
          ? models.filter((model) => !blockedSet.has(model.id)).map((model) => ({ model, override: model.reasoningEfforts }))
          : Object.entries(overrides).filter(([id]) => !blockedSet.has(id)).map(([id, entry]) => ({
            model: {
              id,
              name: entry !== null && typeof entry === 'object' && typeof entry.name === 'string' ? entry.name : undefined,
              reasoningEfforts: entry !== null && typeof entry === 'object' ? entry.reasoningEfforts : undefined,
            },
            override: entry !== null && typeof entry === 'object' ? entry.reasoningEfforts : undefined,
          }))

        // A discovered list can hold well over a hundred models, so the blocks
        // are paged — the page count is always visible and every page reachable.
        const PAGE_SIZE = 20
        const needle = filter.trim().toLowerCase()
        const matched = needle === ''
          ? rows
          : rows.filter(({ model }) => model.id.toLowerCase().includes(needle)
            || (typeof model.name === 'string' && model.name.toLowerCase().includes(needle)))
        const pageCount = Math.max(1, Math.ceil(matched.length / PAGE_SIZE))
        // A refresh can shrink the list out from under the current page.
        const current = Math.min(page, pageCount - 1)
        const first = current * PAGE_SIZE
        const visible = matched.slice(first, first + PAGE_SIZE)
        const tuned = rows.filter(({ override }) => override !== undefined && override !== false).length
        const declared = rows.filter(({ model }) => {
          const efforts = model.reasoningEfforts
          return efforts !== undefined && (efforts === false || (efforts !== null && typeof efforts === 'object' && Object.keys(efforts).length > 0))
        }).length

        return h('div', { className: 'pe-root' },
          h('style', null, css),
          h('div', { className: 'pe-header' },
            h('span', { className: 'pe-title' }, 'Provider Enhancer'),
            h('span', { className: 'pe-route' }, route),
            h('label', {
              className: 'pe-toggle',
              title: 'Periodically re-fetch this route\'s model list from its endpoint.',
            },
              h('input', { type: 'checkbox', checked: autoUpdate, disabled: !listWritable || pending !== '', onChange: toggleAuto }),
              `auto-update models${autoUpdate && Number.isFinite(interval) && interval > 0 ? ` (every ${interval} min)` : ''}`,
            ),
            h('button', {
              type: 'button',
              className: 'pe-button',
              disabled: !listWritable || pending !== '',
              onClick: refreshNow,
              title: 'Fetch this route\'s model list from its endpoint now.',
            }, pending === 'refresh' ? '…' : 'refresh models'),
            h('span', { className: 'pe-spacer' }),
            notice !== '' ? h('span', { className: 'pe-status' }, notice) : null,
            peSnap.status !== 'ready' || llmSnap.status !== 'ready'
              ? h('span', { className: 'pe-chip' }, `sync: ${peSnap.status} / ${llmSnap.status}`)
              : null,
            rows.length > 0
              ? h('button', {
                type: 'button',
                className: 'pe-button',
                onClick: () => setExpanded(!expanded),
                'aria-expanded': expanded,
                title: expanded ? 'Collapse the per-model reasoning settings.' : 'Expand the per-model reasoning settings.',
              }, expanded ? 'hide models' : `models (${rows.length})${tuned > 0 ? ` · ${tuned} tuned` : ''}${blocked.length > 0 ? ` · ${blocked.length} blocked` : ''}`)
              : null,
          ),
          error !== '' ? h('div', { className: 'pe-error', role: 'alert' }, error) : null,
          !peWritable && llmWritable
            ? h('div', { className: 'pe-hint' }, 'Reasoning efforts save straight into the provider. Model-list refresh and auto-update belong to this plugin\'s Host half, which is not running right now.')
            : null,
          rows.length === 0
            ? h('div', { className: 'pe-hint' }, 'This route serves models from the installed catalog, so it has no explicit list to annotate yet. Press "refresh models" to pull the endpoint\'s list in and configure reasoning efforts per model.')
            : null,
          expanded && rows.length > 0
            ? h('div', { className: 'pe-header' },
              h('input', {
                className: 'pe-filter',
                placeholder: 'filter models…',
                value: filter,
                onChange: (event) => {
                  setFilter(event.target.value)
                  setPage(0)
                },
              }),
              h('button', {
                type: 'button',
                className: 'pe-button',
                disabled: current === 0,
                onClick: () => setPage(current - 1),
                title: 'Previous page of models.',
              }, '‹ prev'),
              h('span', { className: 'pe-hint' }, matched.length === 0
                ? `no model matches "${filter.trim()}"`
                : `page ${current + 1} of ${pageCount} · models ${first + 1}–${first + visible.length} of ${matched.length}${needle === '' ? '' : ` matching "${filter.trim()}"`}`),
              h('button', {
                type: 'button',
                className: 'pe-button',
                disabled: current >= pageCount - 1,
                onClick: () => setPage(current + 1),
                title: 'Next page of models.',
              }, 'next ›'),
              h('span', { className: 'pe-spacer' }),
              h('span', { className: 'pe-hint' }, `${declared} declaring efforts · ${tuned} tuned by you`),
            )
            : null,
          blocked.length > 0
            ? h('div', { className: 'pe-header' },
              h('button', {
                type: 'button',
                className: 'pe-button',
                onClick: () => setShowBlocked(!showBlocked),
                'aria-expanded': showBlocked,
                title: 'Models a refresh never adds back.',
              }, showBlocked ? 'hide blacklist' : `blacklist (${blocked.length})`),
              showBlocked ? null : h('span', { className: 'pe-hint' }, 'these ids are skipped on every refresh'),
            )
            : null,
          showBlocked
            ? h('div', { className: 'pe-blocked' }, blocked.map((id) => h('div', { key: id, className: 'pe-blocked-row' },
              h('span', { className: 'pe-blocked-id' }, id),
              h('button', {
                type: 'button',
                className: 'pe-button pe-mini',
                disabled: !listWritable || pending !== '',
                onClick: () => allowModel(id),
                title: 'Remove this model from the blacklist; a refresh may add it again.',
              }, 'allow'),
            )))
            : null,
          expanded
            ? visible.map(({ model, override }) => h(ModelBlock, {
              key: model.id,
              model,
              levels,
              override,
              disabled: !writable || pending !== '',
              pending: pending === model.id,
              onWrite: (value) => writeEfforts(model.id, value),
              onBlock: (id) => blockModel(id),
            }))
            : null,
        )
      }

      slots.inject('settings.models.provider-card', () => slots.register({
        name: 'settings.models.provider-card',
        key: LLM_NS,
      }, (owner) => h(Card, owner ?? {})))
    }

    return {
      inject: ['slots', 'configForms'],
      apply,
    }
  },
})
