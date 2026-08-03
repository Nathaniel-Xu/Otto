# Otto

A personal [oh-my-pi](https://github.com/oh-my-pi) extension.

## Features

- `/save` — save the current conversation context as a repo-local preset.
- `/new-context` — start a new session, optionally seeded from a saved preset. `/new` and `/clear` transparently show the preset picker when presets exist.
- **skillify** skill — turns a described workflow into a new skill or prompt template for this extension.

## Install

```
omp plugin install github:Nathaniel-Xu/Otto
```

## Local development

```
omp plugin link /path/to/this/repo
```

## Layout

```
otto/
  package.json      # omp.extensions -> ./src/main.ts
  src/               # extension module (tools/commands/events)
  skills/            # skills bundled with the extension (skillify)
  prompts/           # prompt templates (loaded when installed via extensions:/-e)
```
