---
name: skillify
description: Use when the user wants to create a new skill or prompt template for the Otto extension, or codify a conversation's workflow/process into one. Trigger proactively whenever the user says things like "turn this into a skill" or describes a repeatable process worth saving.
---

The user wants to create a new skill or prompt template in the Otto extension, or codify a process into one.

Your job is to synthesize the workflow or process into a set of instructions for a skill, or a prompt body for a prompt template, and save it in the user's `otto` extension.

## 1. Capture Intent

Start by understanding the user's intent. The current conversation might already contain a workflow the user wants to capture (e.g., they say "turn this into a skill"). If so, extract answers from the conversation history first.

1. What should this do?
2. Is it a skill (background instructions/playbook) or a prompt template (a slash command)?
3. What is the trigger or command name?
4. What's the expected output format?

Proactively ask questions about edge cases, input/output formats, example files, and success criteria.

## 2. Writing a Skill

If writing a skill, fill in these components based on the interview:

- **name**: Skill identifier
- **description**: When to trigger, what it does. This is the primary triggering mechanism. Make the skill descriptions a little bit "pushy" to ensure the agent uses it when relevant.
- hide: yes/no. Default to yes.

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

## 3. Writing a Prompt Template

If writing a prompt template, create a markdown file.

**Location**: Prompt templates in the Otto extension MUST be placed in `~/.omp/agent/extensions/otto/prompts/<name>.md`.

Anatomy:
The file uses YAML frontmatter and a markdown body.

```markdown
---
name: skillify
description: One-line summary shown in autocomplete.
---

[Body of the prompt template]
Positional args are $1, $2, etc. The joined remainder is $@ or $ARGUMENTS.
```

When writing the prompt template, explain to the model why things are important. Include examples if necessary.
