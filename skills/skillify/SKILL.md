---
name: skillify
description: Use when the user wants to create a new skill or slash command for the Otto extension, or codify a conversation's workflow/process into one. Trigger proactively whenever the user says things like "turn this into a skill" or describes a repeatable process worth saving.
---

The user wants to create a new skill or slash command in the Otto extension, or codify a process into one.

Your job is to synthesize the workflow or process into a set of instructions for a skill, or a prompt body for a slash command, and save it in the user's `otto` extension.

## 1. Capture Intent

Start by understanding the user's intent. The current conversation might already contain a workflow the user wants to capture (e.g., they say "turn this into a skill"). If so, extract answers from the conversation history first.

1. What should this do?
2. Is it a skill (model-triggered background instructions/playbook) or a slash command (user-typed `/name`)?
3. What is the trigger or command name?
4. What's the expected output format?

Proactively ask questions about edge cases, input/output formats, example files, and success criteria.

## 2. Writing a Skill

If writing a skill, fill in these components based on the interview:

- **name**: Skill identifier
- **description**: When to trigger, what it does. This is the primary triggering mechanism. Make the skill descriptions a little bit "pushy" to ensure the agent uses it when relevant.
- **hide**: `true`/`false`. Default to `true`. `hide: true` keeps the skill out of the model's discovered-skills list; it stays reachable via `skill://<name>` and `/skill:<name>`.

**Location**: Skills in the Otto extension MUST be placed in `~/.omp/agent/extensions/otto/skills/<name>/SKILL.md`.

Anatomy:
```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (name, description required)
│   └── Markdown instructions
└── Bundled Resources (optional)
    ├── scripts/    - Executable code for deterministic tasks
    ├── references/ - Docs loaded into context as needed
```

Keep SKILL.md under 500 lines. Reference external files clearly. Use the imperative form.

## 3. Writing a Slash Command

A slash command is a markdown file in a `commands/` directory. Its body replaces the typed `/name ...` text before the prompt reaches the model. Do NOT register it programmatically with `pi.registerCommand` — that mechanism exists only for commands that need session or UI behaviour a text template cannot express (`/chain` queues a follow-up turn, `/save` writes files and opens a picker).

**Location**: `~/.omp/agent/extensions/otto/commands/<name>.md`.

**Also symlink it into the user command directory**, because otto is loaded through `config.yml` `extensions:`, which loads only the extension *module*; `commands/` under a config-declared extension directory is NOT scanned. Discovery works for `commands/*.md` under installed plugin roots (`~/.omp/plugins/node_modules/otto`, refreshed only on plugin update) and under `~/.omp/agent/commands/`:

```bash
ln -sfn ~/.omp/agent/extensions/otto/commands/<name>.md ~/.omp/agent/commands/<name>.md
```

The symlink makes the command live immediately and keeps the repo file as the single source of truth. This mirrors the existing `~/.omp/agent/commands/skillify.md` symlink.

Anatomy:

```markdown
---
name: ask
description: One-line summary shown in autocomplete.
---

[Body of the command; this text becomes the prompt]
Positional args are $1, $2, …; slices are $@[start] / $@[start:length]; the joined remainder is $@ or $ARGUMENTS.
```

Notes that matter:

- `name` overrides the filename; `description` feeds autocomplete. If `description` is absent, the first non-empty body line (truncated to 60 chars) is used.
- There is no `hide` for commands — that field is skills-only. Do not add it.
- If the body contains no argument placeholder, typed arguments are appended to the end anyway.
- Argument parsing is quote-aware splitting (`'…'`, `"…"`) with no backslash escapes.
- Names collide first-wins against built-ins, extension-registered commands, and other command directories, so avoid built-in names.

When writing the command body, explain to the model why things are important. Include examples if necessary.

## 4. Verify

Slash commands and skills are loaded at session start; there is no file watcher. Verify a new command expands by running print mode from any directory:

```bash
omp -p --mode json --no-session "/<name> sample args" | grep -o '"text":"[^"]*"' | head -2
```

The first user message must show the expanded body, not the literal `/<name> …` text.
