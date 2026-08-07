# Otto

A personal [oh-my-pi](https://github.com/oh-my-pi) extension.

## Features

- `/save` — save the current conversation context as a repo-local preset.
- `/new-context` — start a new session, optionally seeded from a saved preset. `/new` and `/clear` transparently show the preset picker when presets exist.
- **skillify** skill — turns a described workflow into a new skill or prompt template for this extension.
- `config/overnight.yml` — retry-policy overlay for unattended overnight runs (see below).

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
code — omp has no settings API for extensions, so it cannot be applied from `src/`.

Apply it to every omp invocation:

```sh
export PI_CONFIG_FILES="$HOME/.omp/agent/extensions/otto/config/overnight.yml"
```

Or per run:

```sh
omp --config ~/.omp/agent/extensions/otto/config/overnight.yml
```

Precedence is `defaults <- global config.yml <- project <- PI_CONFIG_FILES <- --config`,
so the overlay wins over `~/.omp/agent/config.yml`. Keep the values in one place or the
other, not both.

## Layout

```
otto/
  package.json      # omp.extensions -> ./src/main.ts
  config/            # config.yml-style overlays (overnight retry policy)
  src/               # extension module (tools/commands/events)
  skills/            # skills bundled with the extension (skillify)
  prompts/           # prompt templates (loaded when installed via extensions:/-e)
```
