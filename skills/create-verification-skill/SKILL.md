---
name: create-verification-skill
poteto: true
description: "Generate a project-local verification skill that drives your app the way a user does — any language, framework, or platform. Use for /create-verification-skill, \"make a control skill for this repo\", or when a project has no scripted way to prove UI/CLI/service behavior."
disable-model-invocation: true
---

# Create a verification skill

Every serious project needs a scripted way to drive the real app and prove behavior: launch it, exercise a feature the way a user would, and capture evidence. This skill generates that as a project-local OMP skill (`<project>/.omp/skills/verify-<app>/`) tailored to the repo. You write the generator's output for the next agent, not for a human: it will be read cold, mid-task, by an agent that has never seen the app.

`<project>` is the directory the user runs omp from, i.e. the session cwd, not necessarily the app's git root. OMP discovers `<ancestor>/.omp/skills/<name>/SKILL.md` exactly one level under `skills/`, so never nest it deeper. When the app lives in a sibling checkout, the skill resolves it relative to its own directory and exposes an env override (e.g. `APP_DIR`).

## OMP harness primitives

Build the generated skill on these. Do not use ad-hoc shell backgrounding, cursor-style MCP browsers, or bare Playwright installs.

- **Long-running processes** (dev servers, watchers, emulators): `hub op=start name=verify-<app>-<target> application=… args=[…] cwd=… env={…} ready={"log":"…","port":N,"timeout":S}`, with teardown `hub op=stop name=…`. Never `cmd &`, `nohup`, or `pkill <name>`. Hub names are project-scoped, so the name is the ownership proof.
- **Web and Electron UI**: the eval `browser` global (`eval language=js`). `browser.open({name, url, viewport})` runs omp's hidden, shared headless Chromium, so no window appears and the user's focus is not stolen. That is the default and should stay the default. Ship drive helpers as a JS file that attaches functions to `globalThis`, loaded with `eval code="%load <path>"`. Use `tab.run(fn, {args})` for raw Puppeteer (CDP sessions, cookies, `page.evaluate`). `tab.screenshot()` writes to a temp dir, so copy the returned path into the evidence dir.
- **The user's real browser** (`app: { relay: true }`, the OMP Browser Relay extension): this is the user's logged-in session, and relay tabs are visible, focused windows. Use it only to *read* state the headless browser lacks, typically SSO cookies via `Network.getCookies` on an attached tab with no `url`. Import them into the headless tab with `Network.setCookies`, and scrub them on close. Never drive the app UI in relay tabs, never navigate the user's tabs, and never print cookie values. Browsers on the Windows host of a WSL machine can run the relay extension, because WSL localhost forwarding carries its `ws://127.0.0.1:9224`.
- **CLI/TUI**: `hub op=start … pty=true`, plus `hub op=send` (text/keys) and `hub op=logs` for transcripts. Use one hub name per isolated session.
- **Human-only steps** (MFA, extension install): do them once during generation with the `ask` tool, then design runs so they never need a human again. The user's bar is "runs autonomously in the background". If a step truly requires a human every run, say so in the skill and why.

Verify each harness assumption before writing it down. Real failures from past runs: Next 16 allows one `next dev` per directory (`.next/dev/lock`); Turbopack rejects a `node_modules` symlink that points outside the project; a server-side redirect drops query-string markers, so use fragments; locked, app-bound-encrypted browser cookie DBs cannot be copied off disk.

## 1. Interview the repo, not the user

Answer these from the codebase and only ask the user what you cannot observe:

- **Surface:** what does a user actually touch? A web UI, a CLI/TUI, a desktop app, an API, a mobile app, a library? A repo can have several; pick the primary one and note the rest.
- **Run:** how does the app start locally? Prefer the repo's own documented dev command (package scripts, Makefile, README quickstart). Note ports, env vars, seed data, auth.
- **Drive:** how can an agent interact with it programmatically? Existing harnesses first — Playwright/Cypress specs, expect scripts, PTY helpers, curl-able endpoints, a debug port. Only then pick a generic recipe: browser/CDP for web and Electron, a tmux/PTY harness for CLI/TUI, plain HTTP for services.
- **Observe:** what evidence can be captured? Screenshots, terminal transcripts, response bodies, logs, exit codes, DB state.
- **Isolate:** can two instances run side by side (ports, data dirs, profiles)? If not, say so in the generated skill: refusing to double-drive a shared instance beats corrupting the user's session.

If the checkout doesn't build or start as-is, fix that first (or report it precisely) before generating; a skill written against a broken base teaches wrong steps. When an irrelevant missing asset blocks startup (a static dir the API never serves, a sample config), the generated skill may create it, clearly marked as verification scaffolding, and remove it in cleanup.

## 2. Generate the skill

Write `<project>/.omp/skills/verify-<app>/SKILL.md` with YAML frontmatter (`name: verify-<app>` and a `description` that names the app, the surface, the targets such as local/staging/prod, and when to reach for it). OMP's native provider **requires** `description`, and a skill without one is silently skipped. Put helpers in `scripts/` beside it, chmod +x, and invoke them by project-relative path. Then add these sections, each grounded in what the interview actually found (no placeholders left):

- **Launch:** the exact command that starts the app for verification, and how to tell it's ready (a log line, a port answering, a prompt). Include teardown. For a short-lived CLI or TUI there is no server to keep alive: launch means build the binary (or install deps) once, then start each drive in its own isolated PTY or tmux session.
- **Doctor:** one read-only check that answers "is this instance worth driving?" — process up, right version/build, port owned by us, auth valid. An agent runs this first whenever anything looks off.
- **Drive:** the harness recipe with real selectors/commands from this repo, not examples. Prefer stable handles (ARIA labels, data attributes, prompt strings, route paths) over coordinates and tab order.
- **Evidence:** what to capture for a proof and where it goes. State the proof standards: exercise the real user path, not internal setters or test-only endpoints; capture the action and the resulting state, not just the final screen; verify side effects (files written, rows inserted, messages sent) alongside what's visible; mocks only where a production boundary already isolates the external system. When the safe path is a dry-run or test mode, verify what it actually skips by observing (files, network, git refs) rather than trusting its name: some dry-runs still touch the network or open a browser.
- **Cleanup:** how to tear down instances the run created: `hub op=stop` by name, `browser.close({name})`, and scratch dirs by exact path. Never kill by process name; kill what you started. Cleanup removes instances and scratch state, never the evidence: proof artifacts survive the teardown, in `<project>/.omp/verify-evidence/<app>/<timestamp>-<target>-<feature>/` (never `/tmp`).
- **Targets:** if the app is deployed (staging/prod), cover it as well as local: auth without human input, the side-effect read-back path (the app's own API, not the database), and prod safety rules (create only named `VERIFY-*` resources, delete them, no shared-config writes, no sensitive data in prompts).
- **Helpers:** any script the skill ships is executable and its invocation is shown in the skill body. A helper the reader has to reverse-engineer is not a helper.

## 3. Seed the feature map

Create `<project>/.omp/skills/verify-<app>/features/README.md` plus one file per user-facing feature you can identify (aim for the top 3-5 to start, from routes, commands, menus, or docs). Follow the shape in [`references/feature-map-example/`](references/feature-map-example/), with a README index and one file per feature. Each file answers, from the user's point of view: what the feature is, how to reach it, how to drive it with the harness, and what observable end state proves it works. The four H2s are `Sub-features`, `How to get to it (user POV)`, `Driving it with <harness>`, and `Gotchas`. The map is the repo's maintained verification source; a proof that drives one convenient entry point is incomplete when the map lists others. Probe every selector against the live DOM before writing it (component libraries often drop `aria-label`/`role` props), and mark which selectors were verified.

## 4. Prove the generated skill before handing it over

Run its own instructions end to end once, on every target it documents: launch, doctor, drive ONE mapped feature (one is enough; the map exists so later runs can cover the rest), capture evidence, clean up. After cleanup, confirm the evidence still exists at the named location — a cleanup that eats the proof fails this step. Fix what fails, and run the generated cleanup after every failed iteration too, so broken attempts don't strand hub processes, tabs, ports, or deployed test data. Also confirm the skill registers: `read skill://verify-<app>` resolves, which requires a new session if it was created mid-session. A generated skill that was never executed is a draft, not a deliverable.

## 5. Offer the maintenance loop

Point the user at `/maintain-verification-skill` for keeping the map honest as the app changes. Suggest a cadence only if they ask.
