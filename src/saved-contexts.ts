import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type SavedContextFile = {
	version: 1;
	name: string;
	slug: string;
	savedAt: string;
	cwd: string;
	content: string;
};

const EMPTY_SESSION_LABEL = "Empty session";

export function getSavedContextsRoot(cwd: string): string {
	return path.join(cwd, ".omp", "saved-contexts");
}

export function slugifyName(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) return "";
	return trimmed
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export function escapeXmlAttr(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function wrapSavedContext(content: string, name: string): string {
	return [
		`<saved-context name="${escapeXmlAttr(name)}">`,
		content.trim(),
		`</saved-context>`,
		``,
		`The above is saved context ("${name}") loaded into a new session. Continue from this base. Do not ask the user to restate it unless it is incomplete for the new task.`,
	].join("\n");
}

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}…[truncated]`;
}

function contentBlocksToText(content: unknown): { text: string; hasImage: boolean } {
	if (typeof content === "string") {
		return { text: content, hasImage: false };
	}
	if (!Array.isArray(content)) {
		return { text: "", hasImage: false };
	}

	const parts: string[] = [];
	let hasImage = false;
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const b = block as Record<string, unknown>;
		if (b.type === "text" && typeof b.text === "string") {
			parts.push(b.text);
		} else if (b.type === "image") {
			hasImage = true;
		}
	}
	return { text: parts.join("\n"), hasImage };
}

function formatToolArgs(args: unknown): string {
	try {
		const raw = JSON.stringify(args ?? {});
		return truncate(raw, 500);
	} catch {
		return "{}";
	}
}

function customContentText(content: unknown): string {
	const { text, hasImage } = contentBlocksToText(content);
	if (text.trim()) return text;
	if (hasImage) return "[image]";
	return "";
}

/** Format session messages into a conversation-only markdown transcript. */
export function formatConversationTranscript(messages: unknown[]): string {
	const sections: string[] = [];

	for (const raw of messages) {
		if (!raw || typeof raw !== "object") continue;
		const msg = raw as Record<string, unknown>;
		const role = msg.role;

		if (role === "user" || role === "developer") {
			const { text, hasImage } = contentBlocksToText(msg.content);
			const body = [text.trim(), hasImage ? "[image]" : ""].filter(Boolean).join("\n");
			if (!body) continue;
			sections.push(`## ${role === "user" ? "User" : "Developer"}\n${body}`);
			continue;
		}

		if (role === "assistant") {
			const content = Array.isArray(msg.content) ? msg.content : [];
			const textParts: string[] = [];
			const toolLines: string[] = [];
			for (const block of content) {
				if (!block || typeof block !== "object") continue;
				const b = block as Record<string, unknown>;
				if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
					textParts.push(b.text);
				} else if (b.type === "toolCall" && typeof b.name === "string") {
					toolLines.push(`\`${b.name}\` ${formatToolArgs(b.arguments)}`);
				}
			}
			if (textParts.length === 0 && toolLines.length === 0) continue;
			const body = [...textParts, ...toolLines].join("\n").trim();
			if (!body) continue;
			sections.push(`## Assistant\n${body}`);
			continue;
		}

		if (role === "toolResult") {
			const toolName = typeof msg.toolName === "string" ? msg.toolName : "tool";
			const { text, hasImage } = contentBlocksToText(msg.content);
			let body = text.trim();
			if (hasImage) body = body ? `${body}\n[image]` : "[image]";
			body = truncate(body, 4000);
			if (!body) continue;
			sections.push(`### Tool Result: ${toolName}\n${body}`);
			continue;
		}

		if (role === "bashExecution" || role === "pythonExecution") {
			if (msg.excludeFromContext === true) continue;
			const header = role === "bashExecution" ? "Bash" : "Python";
			const source =
				role === "bashExecution"
					? typeof msg.command === "string"
						? msg.command
						: ""
					: typeof msg.code === "string"
						? msg.code
						: "";
			const output = typeof msg.output === "string" ? msg.output : "";
			const body = truncate(
				[`\`${source.trim()}\``, output.trim()].filter(Boolean).join("\n"),
				4000,
			);
			if (!body.trim()) continue;
			sections.push(`## ${header}\n${body}`);
			continue;
		}

		if (role === "custom" || role === "hookMessage") {
			const customType = typeof msg.customType === "string" ? msg.customType : "custom";
			const display = msg.display;
			const include =
				display !== false || customType === "handoff" || customType === "saved-context";
			if (!include) continue;
			const body = customContentText(msg.content).trim();
			if (!body) continue;
			sections.push(`## Context (${customType})\n${body}`);
			continue;
		}

		if (role === "branchSummary" || role === "compactionSummary") {
			const summary = typeof msg.summary === "string" ? msg.summary.trim() : "";
			if (!summary) continue;
			sections.push(`## Summary\n${summary}`);
			continue;
		}

		if (role === "fileMention") {
			const files = Array.isArray(msg.files) ? msg.files : [];
			const paths = files
				.map((f) =>
					f && typeof f === "object" && typeof (f as { path?: unknown }).path === "string"
						? (f as { path: string }).path
						: null,
				)
				.filter((p): p is string => Boolean(p));
			if (paths.length === 0) continue;
			sections.push(`## Files\n${paths.map((p) => `- ${p}`).join("\n")}`);
			continue;
		}
	}

	return sections.join("\n\n").trim();
}

export async function listSavedContexts(
	cwd: string,
	onCorrupt?: (file: string, err: string) => void,
): Promise<SavedContextFile[]> {
	const root = getSavedContextsRoot(cwd);
	let entries: string[];
	try {
		entries = await readdir(root);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException)?.code;
		if (code === "ENOENT") return [];
		throw err;
	}

	const out: SavedContextFile[] = [];
	for (const entry of entries) {
		if (!entry.endsWith(".json")) continue;
		const full = path.join(root, entry);
		try {
			const raw = await readFile(full, "utf8");
			const parsed = JSON.parse(raw) as Partial<SavedContextFile>;
			if (parsed.version !== 1) {
				onCorrupt?.(entry, `unsupported version ${String(parsed.version)}`);
				continue;
			}
			if (typeof parsed.name !== "string" || typeof parsed.content !== "string") {
				onCorrupt?.(entry, "missing name or content");
				continue;
			}
			const slug =
				typeof parsed.slug === "string" && parsed.slug
					? parsed.slug
					: path.basename(entry, ".json");
			out.push({
				version: 1,
				name: parsed.name,
				slug,
				savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
				cwd: typeof parsed.cwd === "string" ? parsed.cwd : cwd,
				content: parsed.content,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			onCorrupt?.(entry, message);
			continue;
		}
	}

	out.sort((a, b) => {
		const ta = Date.parse(a.savedAt) || 0;
		const tb = Date.parse(b.savedAt) || 0;
		return tb - ta;
	});
	return out;
}

/** List filename stems for argument completion. */
export async function listSavedContextSlugs(cwd: string): Promise<string[]> {
	const root = getSavedContextsRoot(cwd);
	try {
		const entries = await readdir(root);
		return entries
			.filter((e) => e.endsWith(".json"))
			.map((e) => path.basename(e, ".json"))
			.sort();
	} catch (err) {
		const code = (err as NodeJS.ErrnoException)?.code;
		if (code === "ENOENT") return [];
		throw err;
	}
}

export async function saveContextFile(
	cwd: string,
	name: string,
	content: string,
): Promise<{ file: SavedContextFile; path: string } | { error: string }> {
	const trimmedName = name.trim();
	if (!trimmedName) return { error: "Name is empty" };

	const slug = slugifyName(trimmedName);
	if (!slug) return { error: "Name produces an empty slug" };

	const root = getSavedContextsRoot(cwd);
	await mkdir(root, { recursive: true });
	const filePath = path.join(root, `${slug}.json`);

	const file: SavedContextFile = {
		version: 1,
		name: trimmedName,
		slug,
		savedAt: new Date().toISOString(),
		cwd,
		content,
	};

	await writeFile(filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
	return { file, path: filePath };

}

/** Delete a saved context file by slug. Missing file is success. */
export async function deleteSavedContext(cwd: string, slug: string): Promise<void> {
	const filePath = path.join(getSavedContextsRoot(cwd), `${slug}.json`);
	try {
		await unlink(filePath);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException)?.code;
		if (code === "ENOENT") return;
		throw err;
	}
}

export function savedContextExists(cwd: string, slug: string): Promise<boolean> {
	const filePath = path.join(getSavedContextsRoot(cwd), `${slug}.json`);
	return readFile(filePath, "utf8")
		.then(() => true)
		.catch((err: NodeJS.ErrnoException) => {
			if (err?.code === "ENOENT") return false;
			throw err;
		});
}

export function getSessionMessages(sessionManager: {
	buildSessionContext?: () => { messages?: unknown[] };
	getBranch?: () => Array<{ type?: string; message?: unknown; customType?: string; content?: unknown; display?: boolean; summary?: string }>;
}): unknown[] {
	if (typeof sessionManager.buildSessionContext === "function") {
		try {
			const ctx = sessionManager.buildSessionContext();
			if (Array.isArray(ctx?.messages)) return ctx.messages;
		} catch {
			// fall through
		}
	}

	// Fallback: walk branch entries and pull message-like payloads
	if (typeof sessionManager.getBranch !== "function") return [];
	const branch = sessionManager.getBranch();
	const messages: unknown[] = [];
	for (const entry of branch) {
		if (!entry || typeof entry !== "object") continue;
		if (entry.message && typeof entry.message === "object") {
			messages.push(entry.message);
			continue;
		}
		// custom_message entries sometimes surface fields on the entry itself
		if (entry.type === "custom_message" || entry.customType) {
			messages.push({
				role: "custom",
				customType: entry.customType ?? "custom",
				content: entry.content ?? "",
				display: entry.display !== false,
			});
		}
	}
	return messages;
}

export { EMPTY_SESSION_LABEL };
