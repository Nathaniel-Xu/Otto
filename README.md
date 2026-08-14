# Otto

A personal [oh-my-pi](https://github.com/oh-my-pi) extension.

## Features

- `/save` — save the current conversation context as a repo-local preset.
- `/new-context` — start a new session, optionally seeded from a saved preset. `/new` and `/clear` transparently show the preset picker when presets exist.
- **skillify** skill — turns a described workflow into a new skill or prompt template for this extension.
- `config/overnight.yml` — retry-policy overlay for unattended overnight runs (see below).
- `scripts/foundry-sync.py` — expose every Azure AI Foundry deployment to omp as a `foundry/*` model (see below).

## Install

```
omp plugin install github:Nathaniel-Xu/Otto
```

## Local development

```
omp plugin link /path/to/this/repo
```

## Overnight retry policy

`config/overnight.yml` raises `retry.maxDelayMs` so long unattended runs sleep through
provider quota exhaustion instead of failing fast. It is a config overlay, not extension
code: `ExtensionAPI` has no settings surface, and the plugin capability scan only picks up
`skills/`, `hooks/`, `tools/`, `commands/`, `rules/`, `prompts/`, and `.mcp.json` — never
settings. So it cannot be applied from `src/` and must be pointed at explicitly.

### Simplest: no overlay at all

One command per machine, persisted to `~/.omp/agent/config.yml`, nothing to keep exported:

```sh
omp config set retry.maxDelayMs 21600000
```

### Or apply the overlay

`export` only lives for the current shell, so this belongs in `~/.bashrc`. The path depends
on how Otto was installed:

```sh
# omp plugin install github:Nathaniel-Xu/Otto
export PI_CONFIG_FILES="$HOME/.omp/plugins/node_modules/otto/config/overnight.yml"

# checkout referenced from config.yml `extensions:` or `omp plugin link`
export PI_CONFIG_FILES="$HOME/.omp/agent/extensions/otto/config/overnight.yml"
```

`PI_CONFIG_FILES` is a `:`-separated list, so append with `:` to stack overlays. Per run
instead, `omp --config <path>` takes the same file (a root flag, not a `omp config`
subcommand flag).

Precedence is `defaults <- global config.yml <- project <- PI_CONFIG_FILES <- --config`,
so the overlay wins over `~/.omp/agent/config.yml`. Keep the values in one place or the
other, not both.

## Azure AI Foundry models

`scripts/foundry-sync.py` registers every deployment on an Azure AI Foundry resource as an
omp model under a `foundry/` prefix. Like `config/overnight.yml` this is a shipped asset,
not extension code: provider config lives in `models.yml`, and the plugin capability scan
never reads it, so `src/` cannot register it.

### Setup

```sh
# omp plugin install github:Nathaniel-Xu/Otto
python3 "$HOME/.omp/plugins/node_modules/otto/scripts/foundry-sync.py" \
    --endpoint https://<resource>.services.ai.azure.com --set-key <foundry-api-key>

# checkout referenced from config.yml `extensions:` or `omp plugin link`
python3 "$HOME/.omp/agent/extensions/otto/scripts/foundry-sync.py" \
    --endpoint https://<resource>.services.ai.azure.com --set-key <foundry-api-key>
```

That writes `~/.omp/agent/.env` (mode `600`) with `AZURE_FOUNDRY_ENDPOINT` and
`AZURE_OPENAI_API_KEY`, lists the resource's deployments, and regenerates the `foundry`
provider in `~/.omp/agent/models.yml`. Restart omp, then select models as
`foundry/<deployment-name>` — `omp models find foundry` lists them.

Re-run bare (no flags) after adding or removing deployments; credentials are then read from
the environment or `~/.omp/agent/.env`. Requires only the Python 3 standard library.

### Rotating the key

```sh
python3 scripts/foundry-sync.py --set-key <new-key>
```

`models.yml` stores `apiKey: AZURE_OPENAI_API_KEY`, which omp resolves as an *env-var name*
rather than a literal, so no secret is written there and rotation needs no regeneration —
`--set-key` only rewrites `.env` (preserving the endpoint) and re-lists deployments, which
fails loudly on a bad key. Validate a key before storing it with
`omp --model foundry/gpt-5-mini --api-key <new-key> --no-session -p 'Reply with only: OK'`;
`--api-key` outranks `.env`.

Two precedence traps: a shell-exported `AZURE_OPENAI_API_KEY` beats every `.env` file, and
`<cwd>/.env` beats `~/.omp/agent/.env`. If a rotation seems not to take, check
`printenv AZURE_OPENAI_API_KEY` first.

### How it works

All deployments are reached through the Foundry v1 Responses surface, a single URL and a
single `api-key` header that serves OpenAI, Anthropic, xAI, Moonshot, DeepSeek and Mistral
deployments alike:

```
POST {endpoint}/openai/v1/responses
```

That is exactly the URL omp's `azure-openai-responses` transport builds, so the generated
provider is plain config with no custom transport. Notes on the choices:

- The bundled `azure` provider is deliberately **not** reused: its catalog filters to
  OpenAI-family ids and drops third-party Foundry models, hiding Claude/Grok/Kimi.
- A custom provider id means model ids are the literal deployment names, so
  `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` is unnecessary — worth avoiding, as omp's own docs
  disagree on its delimiter (`=` vs `:`).
- `compat` restores the three Azure flags that URL auto-detection misses on a
  `services.ai.azure.com` host: `strictResponsesPairing` (the backend rejects unpaired tool
  results), `supportsDeveloperRole`, and `supportsStore: false`.
- Never set `AZURE_OPENAI_API_VERSION`. The provider needs the default `v1`; a dated version
  would rewrite the URL and break it. Only `/openai/v1/responses` serves all model families —
  `/openai/v1/chat/completions` is OpenAI-family only, and the deployment-scoped
  `/openai/deployments/.../chat/completions` route rejects Anthropic deployments outright.
- `contextWindow` / `maxTokens` are family-based estimates in the script's `FAMILIES` table;
  Azure's deployment list does not report them. They drive compaction timing, so correct any
  that matter and re-run.
- Known quirk: a deployment named `<base>-reasoning` collapses into `<base>`, which inherits
  its thinking levels (omp reads the suffix as a thinking variant). Observed with
  `Phi-4-reasoning`; `*-reasoning`/`*-non-reasoning` pairs such as Grok's survive intact.

`models.yml` is generated — do not hand-edit or copy it between machines; re-run the script
instead. Only `scripts/foundry-sync.py` is worth version-controlling, and it holds no secret.
PyYAML is optional: when installed, unrelated providers in an existing `models.yml` are
preserved; without it the script refuses to overwrite a file it did not generate.

## Layout

```
otto/
  package.json      # omp.extensions -> ./src/main.ts
  config/            # config.yml-style overlays (overnight retry policy)
  scripts/           # standalone setup scripts (Foundry model sync)
  src/               # extension module (tools/commands/events)
  skills/            # skills bundled with the extension (skillify)
  prompts/           # prompt templates (loaded when installed via extensions:/-e)
```
