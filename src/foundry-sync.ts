import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";

const SYNC_SCRIPT = path.resolve(import.meta.dir, "../scripts/foundry-sync.py");
const PROVIDER_ID = process.env.FOUNDRY_PROVIDER_ID || "foundry";
const SYNC_TIMEOUT_MS = 60_000;

function providerModelIds(ctx: ExtensionCommandContext): Set<string> {
	return new Set(
		ctx.modelRegistry
			.getAll()
			.filter((model) => model.provider === PROVIDER_ID)
			.map((model) => model.id),
	);
}

function describeChange(before: Set<string>, after: Set<string>): string {
	const added = [...after].filter((id) => !before.has(id)).sort();
	const removed = [...before].filter((id) => !after.has(id)).sort();
	const lines = [`${after.size} ${PROVIDER_ID} models loaded.`];
	if (added.length > 0) lines.push(`Added: ${added.join(", ")}`);
	if (removed.length > 0) lines.push(`Removed: ${removed.join(", ")}`);
	if (added.length === 0 && removed.length === 0) lines.push("No deployments added or removed.");
	return lines.join("\n");
}

async function handleFoundrySync(ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
	ctx.ui.notify("Syncing Azure AI Foundry deployments…", "info");
	const before = providerModelIds(ctx);
	const result = await pi.exec("python3", [SYNC_SCRIPT], { timeout: SYNC_TIMEOUT_MS });
	if (result.code !== 0 || result.killed) {
		const detail = (result.stderr || result.stdout).trim() || `exit code ${result.code}`;
		pi.logger.error(`[otto] foundry-sync failed: ${detail}`);
		ctx.ui.notify(`Foundry sync failed: ${detail}`, "error");
		return;
	}
	await ctx.modelRegistry.refresh("offline");
	ctx.ui.notify(describeChange(before, providerModelIds(ctx)), "info");
}

export function registerFoundrySync(pi: ExtensionAPI): void {
	pi.registerCommand("foundry-sync", {
		description: "Re-sync Azure AI Foundry deployments into models.yml and reload them without restarting omp.",
		handler: async (_args, ctx) => {
			await handleFoundrySync(ctx, pi);
		},
	});
}
