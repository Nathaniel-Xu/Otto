# Otto

A personal [oh-my-pi](https://github.com/oh-my-pi) extension.

## Features

- `/chain <prompt>` — queue a follow-up prompt in the current session, preserving its conversation context, after the active turn finishes.
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

Turns every deployment on an Azure AI Foundry resource into a `foundry/<deployment>` model.
Python 3 stdlib only, no dependencies.

### Setup

1. Run the script, using whichever path matches how Otto was installed:

   ```sh
   # omp plugin install github:Nathaniel-Xu/Otto
   python3 "$HOME/.omp/plugins/node_modules/otto/scripts/foundry-sync.py" \
       --endpoint https://<resource>.services.ai.azure.com --set-key <foundry-api-key>

   # omp plugin link, or a checkout in config.yml `extensions:`
   python3 "$HOME/.omp/agent/extensions/otto/scripts/foundry-sync.py" \
       --endpoint https://<resource>.services.ai.azure.com --set-key <foundry-api-key>
   ```

2. Restart omp.
3. Check it worked: `omp models find foundry`.
4. Use a model: `omp --model foundry/gpt-5-mini`.

### Rotate the key

```sh
python3 scripts/foundry-sync.py --set-key <new-key>
```

Test a key before storing it (`--api-key` beats the stored one):

```sh
omp --model foundry/gpt-5-mini --api-key <new-key> --no-session -p 'Reply with only: OK'
```

### After adding or removing deployments

```sh
python3 scripts/foundry-sync.py
```

### Porting to another machine

Copy nothing but the script — re-run step 1. `models.yml` is generated; never hand-edit it or
copy it between machines.

### Gotchas

- **Never set `AZURE_OPENAI_API_VERSION`.** It breaks the provider, which needs the default `v1`.
- **Rotation not taking effect?** Check `printenv AZURE_OPENAI_API_KEY` — a shell export beats
  every `.env` file, and `<cwd>/.env` beats `~/.omp/agent/.env`.
- **Context windows are estimates.** Azure does not report them. They drive compaction timing;
  fix any that matter in the script's `FAMILIES` table and re-run.
- **A `<base>-reasoning` deployment merges into `<base>`** and hands it its thinking levels.
  Hit `Phi-4-reasoning`; `*-reasoning`/`*-non-reasoning` pairs like Grok's are fine.
- **`pip install pyyaml` if you keep other providers in `models.yml`.** Without it the script
  won't touch a file it didn't write, to avoid clobbering them.

No secret lands in `models.yml` — it stores the *name* `AZURE_OPENAI_API_KEY`, and the value
lives in `~/.omp/agent/.env` (mode `600`). Commit `f0544a3` records why this uses a custom
provider instead of omp's bundled `azure` one, and which Foundry routes work.

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
