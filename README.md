# dsh-provider-enhancer

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin that keeps the `llm-pi-ai` provider routes current: model lists refresh themselves from the endpoint, and each model's reasoning effort levels can be configured per model from a card in the provider's settings.

## What it solves

- **Auto-refreshing model lists.** Gateways add and remove models over time. With `autoUpdateModels` on for a route, the host polls the endpoint through `ctx.llm.discoverModels` and merges the advertised models into that route's list on an interval (default every 10 minutes). Bumping a route's `refreshNonce` requests one immediate refresh.
- **Per-model reasoning effort.** Each discovered model exposes the thinking levels pi-ai accepts, with the wire spelling the endpoint advertises mapped onto them (including `off`). Set the levels you want per model; the client card writes them through the shared settings forms and the adapter picks changes up per request. Discovery only refreshes the facts an endpoint reports and preserves everything you configured, so your effort sets survive refreshes.
- **Blocked models.** Per-route `blocked` ids are never added back by a refresh and are dropped when present.

## Install

Build a tarball and add it to your profile:

```sh
npm pack
dsh plugin --profile web add file:/absolute/path/to/dsh-provider-enhancer-1.0.0.tgz
```

Then add the bundle to the profile manifest in `~/.dsh/profiles/web/package.json`:

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-provider-enhancer"
      ]
    }
  }
}
```

Restart the profile so the host loads the plugin:

```sh
dsh web
```

## Usage

Open **Settings** and a `llm-pi-ai` provider route. The card offers:

- An **auto-update** toggle per route and a global refresh interval (1 to 1440 minutes).
- A **refresh models** button for an immediate discovery.
- Per model: which reasoning effort levels to accept and the wire token to send for each, plus a filter over the model list.
- A **blocked** section listing ids a refresh must ignore.

Diagnostics are appended to `/tmp/provider-enhancer.log` (truncated at 256 KB), so a refresh that discovers nothing leaves a trace.

## Layout

| File | Purpose |
| --- | --- |
| `host.js` | Host half: scheduled and on-demand discovery, model list merging, effort translation |
| `client.js` | Browser half: the per-route card in the provider settings |
| `cordis.patch.yml` | Bundle patch that inserts the plugin row |
| `package.json` | Package manifest, `dsh.bundle.patch`, and `dsh.client` declarations |

## License

MIT
