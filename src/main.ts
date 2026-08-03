import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import {
	createContextPickerComponent,
	type ContextPickerResult,
} from "./context-picker.ts";
import {
	deleteSavedContext,
	formatConversationTranscript,
	getSessionMessages,
	listSavedContextSlugs,
	listSavedContexts,
	saveContextFile,
	savedContextExists,
	slugifyName,
	wrapSavedContext,
	type SavedContextFile,
} from "./saved-contexts.ts";

/** Command that runs the saved-context picker (also target of /new|/clear rewrite). */
const NEW_CONTEXT_COMMAND = "new-context";

const slugCache: { cwd: string; slugs: string[] } = { cwd: "", slugs: [] };

async function refreshSlugCache(cwd: string): Promise<void> {
	try {
		slugCache.slugs = await listSavedContextSlugs(cwd);
		slugCache.cwd = cwd;
	} catch {
		// ignore completion cache failures
	}
}

function sessionManagerEnsureOnDisk(
	sessionManager: ExtensionCommandContext["sessionManager"],
): Promise<void> {
	const sm = sessionManager as { ensureOnDisk?: () => Promise<void> };
	return sm.ensureOnDisk?.() ?? Promise.resolve();
}

async function handleSave(args: string, ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
	const name = args.trim();
	if (!name) {
		ctx.ui.notify("Usage: /save {name}", "warning");
		return;
	}

	await ctx.waitForIdle();

	const messages = getSessionMessages(ctx.sessionManager as Parameters<typeof getSessionMessages>[0]);
	if (messages.length === 0) {
		ctx.ui.notify("Nothing to save (empty session)", "warning");
		return;
	}

	const content = formatConversationTranscript(messages);
	if (!content) {
		ctx.ui.notify("Nothing to save (empty session)", "warning");
		return;
	}

	const slug = slugifyName(name);
	if (!slug) {
		ctx.ui.notify("Invalid name: produces empty slug", "error");
		return;
	}

	try {
		if (await savedContextExists(ctx.cwd, slug)) {
			const ok = await ctx.ui.confirm("Overwrite saved context?", `Replace "${name.trim()}"?`);
			if (!ok) {
				ctx.ui.notify("Cancelled", "info");
				return;
			}
		}

		const result = await saveContextFile(ctx.cwd, name, content);
		if ("error" in result) {
			ctx.ui.notify(result.error, "error");
			return;
		}
		await refreshSlugCache(ctx.cwd);
		ctx.ui.notify(`Saved context "${result.file.name}"`, "info");
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		pi.logger.error(`[otto] /save failed: ${message}`);
		ctx.ui.notify(`Failed to save context: ${message}`, "error");
	}
}

async function pickContext(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	presets: SavedContextFile[],
): Promise<ContextPickerResult> {
	// Prefer custom picker (Backspace/Delete → confirm delete). Fall back to ui.select.
	if (typeof ctx.ui.custom === "function") {
		return ctx.ui.custom<ContextPickerResult>((tui, theme, _keybindings, done) => {
			return createContextPickerComponent({
				tui,
				theme,
				presets,
				onDelete: async (preset) => {
					await deleteSavedContext(ctx.cwd, preset.slug);
					await refreshSlugCache(ctx.cwd);
					pi.logger.info(`[otto] deleted saved context ${preset.slug}`);
				},
				done,
			});
		});
	}

	// Headless / no custom UI: plain select without delete.
	const nameCounts = new Map<string, number>();
	for (const p of presets) {
		nameCounts.set(p.name, (nameCounts.get(p.name) ?? 0) + 1);
	}
	const byLabel = new Map<string, SavedContextFile>();
	const options: Array<{ label: string; description?: string }> = [
		{ label: "Empty session", description: "Start blank (default /new)" },
	];
	for (const preset of presets) {
		const dup = (nameCounts.get(preset.name) ?? 0) > 1;
		const label = dup ? `${preset.name} (${preset.slug})` : preset.name;
		byLabel.set(label, preset);
		options.push({ label, description: preset.savedAt || preset.slug });
	}
	const selected = await ctx.ui.select("New session context", options);
	if (selected === undefined) return { action: "cancel" };
	if (selected === "Empty session") return { action: "empty" };
	const preset = byLabel.get(selected);
	if (!preset) return { action: "cancel" };
	return { action: "select", preset };
}

async function handleNewWithPresets(ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
	let presets: SavedContextFile[];
	try {
		presets = await listSavedContexts(ctx.cwd, (file, err) => {
			pi.logger.warn(`[otto] skipping corrupt saved context ${file}: ${err}`);
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		pi.logger.error(`[otto] list saved contexts failed: ${message}`);
		ctx.ui.notify(`Failed to list saved contexts: ${message}`, "error");
		return;
	}

	if (presets.length === 0) {
		// Should not normally happen (input rewrite only when presets exist).
		// Start a blank session to match /new.
		await ctx.waitForIdle();
		await ctx.newSession();
		return;
	}

	await ctx.waitForIdle();

	const result = await pickContext(ctx, pi, presets);

	if (result.action === "cancel") {
		ctx.ui.notify("Cancelled", "info");
		return;
	}

	if (result.action === "empty") {
		await ctx.newSession();
		return;
	}

	const preset = result.preset;
	const parent = ctx.sessionManager.getSessionFile() ?? undefined;
	const { cancelled } = await ctx.newSession({
		parentSession: parent,
	});
	if (cancelled) return;

	// Seed after newSession returns (controller already finished resetTranscript).
	const body = wrapSavedContext(preset.content, preset.name);
	pi.sendMessage(
		{
			customType: "saved-context",
			content: body,
			display: true,
			attribution: "agent",
		},
		{ triggerTurn: false },
	);

	await sessionManagerEnsureOnDisk(ctx.sessionManager);
	ctx.ui.notify(`New session with context "${preset.name}"`, "info");
}

export default function otto(pi: ExtensionAPI) {
	pi.registerCommand("save", {
		description:
			"Save current conversation context for /new presets (repo-local). Slash /new and /clear show a picker when presets exist; keybinding app.session.new stays blank.",
		getArgumentCompletions: (argumentPrefix) => {
			const prefix = argumentPrefix.trim().toLowerCase();
			const matches = slugCache.slugs.filter(
				(s) => !prefix || s.startsWith(prefix) || s.includes(prefix),
			);
			if (matches.length === 0) return null;
			return matches.map((s) => ({ value: s, label: s }));
		},
		handler: async (args, ctx) => {
			await handleSave(args, ctx, pi);
		},
	});

	// Full ExtensionCommandContext (newSession/waitForIdle); no 30s input-handler timeout.
	// Also reachable directly as /new-context.
	pi.registerCommand(NEW_CONTEXT_COMMAND, {
		description:
			"Start a new session with an optional repo-local saved-context preset (same picker as /new when presets exist). Backspace deletes a preset.",
		handler: async (_args, ctx) => {
			await handleNewWithPresets(ctx, pi);
		},
	});

	// Override /new and /clear before builtin slash dispatch when presets exist.
	// Input handlers only receive ExtensionContext (no newSession) and are capped
	// at 30s, so we rewrite to /new-context which runs with command ctx.
	//
	// Why /clear too? Builtin `/new` registers alias `clear` (see builtin-registry:
	// name "new", aliases: ["clear"]). Both start a blank session; intercept both
	// so the preset picker is consistent whether users type /new or /clear.
	pi.on("input", async (event, ctx) => {
		if (event.source !== "interactive") return;
		const raw = event.text.trim();
		if (raw !== "/new" && raw !== "/clear") return;

		let presets: SavedContextFile[];
		try {
			presets = await listSavedContexts(ctx.cwd, (file, err) => {
				pi.logger.warn(`[otto] skipping corrupt saved context ${file}: ${err}`);
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			pi.logger.error(`[otto] list saved contexts failed: ${message}`);
			// Fall through to builtin on unexpected IO errors
			return undefined;
		}

		if (presets.length === 0) {
			// No presets → builtin /new or /clear
			return undefined;
		}

		return { text: `/${NEW_CONTEXT_COMMAND}` };
	});

	pi.on("session_start", async (_event, ctx) => {
		void refreshSlugCache(ctx.cwd);
	});
}
