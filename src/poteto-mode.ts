import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";

export const POTETO_MODE_ENTRY = "otto.poteto-mode";

export type PstackSkill = {
	name: string;
	description: string;
	hidden: boolean;
};

const POTETO_SKILLS_DIR = path.resolve(import.meta.dir, "../skills");

type SessionCustomEntry = {
	type?: string;
	customType?: string;
	data?: { enabled?: unknown };
};

function yamlScalar(raw: string): string {
	const v = raw.trim();
	if (
		(v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
		(v.startsWith("'") && v.endsWith("'") && v.length >= 2)
	) {
		try {
			return JSON.parse(v.startsWith("'") ? `"${v.slice(1, -1)}"` : v) as string;
		} catch {
			return v.slice(1, -1);
		}
	}
	return v;
}

function yamlBool(raw: string | undefined): boolean {
	if (!raw) return false;
	return /^(true|yes|on)$/i.test(raw.trim());
}

function parseSkillFrontmatter(text: string): {
	name?: string;
	description?: string;
	hidden: boolean;
	poteto: boolean;
} {
	if (!text.startsWith("---")) return { hidden: false, poteto: false };
	const nl = text.indexOf("\n");
	if (nl < 0) return { hidden: false, poteto: false };
	const rest = text.slice(nl + 1);
	const end = rest.search(/\r?\n---\r?\n/);
	if (end < 0) return { hidden: false, poteto: false };
	const yaml = rest.slice(0, end);
	const fields: Record<string, string> = {};
	let key: string | undefined;
	let buf = "";
	const flush = () => {
		if (!key) return;
		fields[key] = yamlScalar(buf);
		key = undefined;
		buf = "";
	};
	for (const line of yaml.split(/\r?\n/)) {
		const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (m && !/^\s/.test(line)) {
			flush();
			key = m[1];
			buf = m[2] ?? "";
			if (buf === ">" || buf === "|" || buf === ">-" || buf === "|-") buf = "";
			continue;
		}
		if (key && (/^\s+/.test(line) || line === "")) {
			const piece = line.trim();
			if (piece) buf = buf ? `${buf} ${piece}` : piece;
			continue;
		}
		flush();
	}
	flush();
	return {
		name: fields.name?.trim() || undefined,
		description: fields.description?.trim() || undefined,
		hidden:
			yamlBool(fields.hide) ||
			yamlBool(fields["disable-model-invocation"]) ||
			yamlBool(fields.disableModelInvocation),
		poteto: yamlBool(fields.poteto),
	};
}

export async function findPstackSkillsDir(): Promise<string | undefined> {
	try {
		const resolved = await realpath(POTETO_SKILLS_DIR);
		return (await stat(resolved)).isDirectory() ? resolved : undefined;
	} catch {
		return undefined;
	}
}

export async function loadPstackSkills(skillsDir?: string): Promise<PstackSkill[]> {
	const root = skillsDir ?? (await findPstackSkillsDir());
	if (!root) return [];
	const entries = await readdir(root, { withFileTypes: true });
	const skills: PstackSkill[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const filePath = path.join(root, entry.name, "SKILL.md");
		let text: string;
		try {
			text = await readFile(filePath, "utf8");
		} catch {
			continue;
		}
		const fm = parseSkillFrontmatter(text);
		if (!fm.poteto) continue;
		skills.push({
			name: entry.name,
			description: fm.description || fm.name || entry.name,
			hidden: fm.hidden,
		});
	}
	skills.sort((a, b) => a.name.localeCompare(b.name));
	return skills;
}

export function buildPotetoModePrompt(skills: PstackSkill[]): string {
	const hidden = skills.filter((s) => s.hidden);
	const listed = hidden.length > 0 ? hidden : skills;
	const catalog = listed.map((s) => `- ${s.name}: ${s.description}`).join("\n");
	return [
		"# Poteto mode",
		"",
		"Poteto mode is ON for this conversation until `/poteto-mode off`.",
		"",
		"This harness is OMP. Treat all Cursor- and Grok-specific instructions in p-stack skills as null; use OMP tools, agents, models, and conventions instead.",
		"",
		"p-stack skills are hidden from the discovered-skills list (`hide: true` / `disable-model-invocation: true`). Treat the catalog below as discovered. Matching skill → MUST read `skill://<name>` before acting. They stay reachable at `skill://<name>` either way.",
		"",
		"Start every multi-step task by reading `skill://poteto-mode` in full, including its Principles index. Follow it. Spawn playbook subagents as `poteto-agent`. Casual turn or the user opts out → don't.",
		"",
		"<skills>",
		catalog,
		"</skills>",
	].join("\n");
}

function readEnabled(sessionManager: ExtensionContext["sessionManager"]): boolean {
	let enabled = false;
	for (const entry of sessionManager.getBranch() as SessionCustomEntry[]) {
		if (entry?.type === "custom" && entry.customType === POTETO_MODE_ENTRY) {
			enabled = entry.data?.enabled === true;
		}
	}
	return enabled;
}

export function registerPotetoMode(pi: ExtensionAPI): void {
	let enabled = false;
	let cachedPrompt: string | undefined;

	const persist = (next: boolean) => {
		enabled = next;
		cachedPrompt = undefined;
		pi.appendEntry(POTETO_MODE_ENTRY, { enabled: next });
	};

	const restore = (ctx: ExtensionContext) => {
		enabled = readEnabled(ctx.sessionManager);
		cachedPrompt = undefined;
	};

	pi.registerCommand("poteto-mode", {
		description:
			"Enable poteto mode: unhide p-stack skills and follow skill://poteto-mode. /poteto-mode off disables.",
		handler: async (args, ctx: ExtensionCommandContext) => {
			const trimmed = args.trim();
			if (/^off$/i.test(trimmed)) {
				persist(false);
				ctx.ui.notify("Poteto mode off. p-stack skills hidden again.", "info");
				return;
			}

			const task = /^on\b/i.test(trimmed) ? trimmed.slice(2).trim() : trimmed;
			const skills = await loadPstackSkills();
			if (skills.length === 0) {
				ctx.ui.notify("p-stack skills not found; poteto mode not enabled.", "error");
				return;
			}

			persist(true);
			cachedPrompt = buildPotetoModePrompt(skills);
			ctx.ui.notify(
				`Poteto mode on. ${skills.filter((s) => s.hidden).length || skills.length} p-stack skills visible.`,
				"info",
			);
			if (task) pi.sendUserMessage(task);
		},
	});

	pi.on("before_agent_start", async (event) => {
		if (!enabled) return;
		if (!cachedPrompt) {
			const skills = await loadPstackSkills();
			if (skills.length === 0) return;
			cachedPrompt = buildPotetoModePrompt(skills);
		}
		return { systemPrompt: [...event.systemPrompt, cachedPrompt] };
	});

	pi.on("session_start", async (_event, ctx) => {
		restore(ctx);
	});
	pi.on("session_switch", async (_event, ctx) => {
		restore(ctx);
	});
	pi.on("session_branch", async (_event, ctx) => {
		restore(ctx);
	});
	pi.on("session_tree", async (_event, ctx) => {
		restore(ctx);
	});
}
