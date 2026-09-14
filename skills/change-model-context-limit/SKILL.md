---
name: change-model-context-limit
description: Use this skill whenever changing, debugging, or checking an OMP model's context window. Find the provider's source-of-truth metadata, update the correct generated-config source, and verify OMP reports the requested limit; do not hand-edit a generated file when a sync script will overwrite it.
hide: true
---

# Change an OMP model context limit

Use this playbook for requests to raise, lower, or inspect a model's context window in OMP. Treat the context window as model metadata used by compaction and request sizing; changing it does not change the provider's actual server-side limit.

## Workflow

1. **Identify the exact model and provider.**
   - Use the full OMP model name, such as `foundry/claude-fable-5-1`.
   - Inspect the active model list before editing:
     ```sh
     omp models find <provider>/<model-id>
     ```
   - Use the exact deployment ID shown in the provider config. Do not normalize punctuation or assume a display name is the ID.

2. **Locate the provider's source of truth.**
   - For the personal Otto Foundry integration, the runtime file is `~/.omp/agent/models.yml`, but it is generated and must not be the only edit.
   - The source is `~/.omp/agent/extensions/otto/scripts/foundry-sync.py` when Otto is linked locally. If Otto was installed as a plugin, use the corresponding script under `~/.omp/plugins/node_modules/otto/` instead; prefer the linked personal extension when it is the configured extension.
   - For another provider, inspect its provider entry and existing conventions before changing anything.

3. **Choose the narrowest metadata change.**
   - If every deployment in a model family shares the same published limit, update that family's tuple in `FAMILIES`.
   - If only one deployment differs, add or update an exact lowercase deployment entry in `OVERRIDES`. Exact overrides must be checked before family-prefix matching.
   - Keep the existing max-output-token, reasoning, and image capabilities unless the request explicitly changes them.
   - Store the context window as an integer token count: `1_000_000` in Python and `1000000` in YAML.

   Example for one Foundry deployment:
   ```python
   OVERRIDES = {
       "claude-fable-5-1": (1_000_000, 64_000, True, True),
   }
   ```

4. **Regenerate the runtime model file.**
   - Run the provider's sync command without exposing credentials:
     ```sh
     python3 ~/.omp/agent/extensions/otto/scripts/foundry-sync.py
     ```
   - If the sync requires credentials, use the existing environment or `.env`; never print, paste, or commit secret values.
   - Do not commit `~/.omp/agent/models.yml` as the source of truth. It is generated output.

5. **Verify the exact result.**
   ```sh
   omp models find <provider>/<model-id>
   ```
   Confirm the target row shows the requested context value and that unrelated model capabilities are unchanged. Restart OMP or start a fresh session because model metadata is loaded at session start.

## Guardrails

- Never change all models merely because one deployment needs a different window.
- Never infer a provider's server-side capability from OMP metadata; record uncertainty if the published limit is not authoritative.
- Never modify credentials or include them in output, diffs, commits, or reports.
- If the model list reports a different deployment ID than expected, use the reported ID and update the exact override key accordingly.
