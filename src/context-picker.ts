import type { SavedContextFile } from "./saved-contexts.ts";
import { EMPTY_SESSION_LABEL } from "./saved-contexts.ts";

export type ContextPickerResult =
	| { action: "empty" }
	| { action: "select"; preset: SavedContextFile }
	| { action: "cancel" };

type ThemeLike = {
	fg: (color: string, text: string) => string;
	bold: (text: string) => string;
};

type TuiLike = {
	requestRender: () => void;
};

type PickerItem =
	| { kind: "empty"; label: string; description: string }
	| { kind: "preset"; label: string; description: string; preset: SavedContextFile };

type Mode =
	| { kind: "list" }
	| { kind: "confirm-delete"; item: Extract<PickerItem, { kind: "preset" }> };

function buildItems(presets: SavedContextFile[]): PickerItem[] {
	const nameCounts = new Map<string, number>();
	for (const p of presets) {
		nameCounts.set(p.name, (nameCounts.get(p.name) ?? 0) + 1);
	}

	const items: PickerItem[] = [
		{
			kind: "empty",
			label: EMPTY_SESSION_LABEL,
			description: "Start blank (default /new)",
		},
	];

	for (const preset of presets) {
		const dup = (nameCounts.get(preset.name) ?? 0) > 1;
		items.push({
			kind: "preset",
			label: dup ? `${preset.name} (${preset.slug})` : preset.name,
			description: preset.savedAt || preset.slug,
			preset,
		});
	}
	return items;
}

/** Minimal key matching without importing pi-tui (host may not resolve extension deps). */
function isKey(data: string, name: "up" | "down" | "enter" | "escape" | "backspace" | "delete" | "ctrl+c"): boolean {
	switch (name) {
		case "up":
			return data === "\x1b[A" || data === "\x1bOA" || data === "\x1b[1;5A";
		case "down":
			return data === "\x1b[B" || data === "\x1bOB" || data === "\x1b[1;5B";
		case "enter":
			return data === "\r" || data === "\n" || data === "\x1bOM";
		case "escape":
			return data === "\x1b" || data === "\x1b\x1b";
		case "backspace":
			return data === "\x7f" || data === "\b";
		case "delete":
			// CSI 3~  (forward delete)
			return data === "\x1b[3~" || data === "\x1b[3;5~";
		case "ctrl+c":
			return data === "\x03";
		default:
			return false;
	}
}

/**
 * Interactive picker for /new with Backspace/Delete → confirm delete on presets.
 * Empty-session row is not deletable.
 *
 * Built without @oh-my-pi/* runtime imports so the otto extension loads
 * without its own node_modules (host only guarantees type erasure imports).
 */
export function createContextPickerComponent(options: {
	tui: TuiLike;
	theme: ThemeLike;
	presets: SavedContextFile[];
	onDelete: (preset: SavedContextFile) => Promise<void> | void;
	done: (result: ContextPickerResult) => void;
}): {
	render: (width: number) => readonly string[];
	invalidate: () => void;
	handleInput: (data: string) => void;
} {
	const { tui, theme, onDelete, done } = options;
	let presets = [...options.presets];
	let items = buildItems(presets);
	let selectedIndex = 0;
	let mode: Mode = { kind: "list" };
	let deleting = false;
	let statusMessage: string | undefined;
	let finished = false;

	function clampSelection(): void {
		if (items.length === 0) {
			selectedIndex = 0;
			return;
		}
		selectedIndex = Math.max(0, Math.min(selectedIndex, items.length - 1));
	}

	function finish(result: ContextPickerResult): void {
		if (finished) return;
		finished = true;
		done(result);
	}

	function requestDelete(): void {
		if (mode.kind !== "list" || deleting || finished) return;
		const item = items[selectedIndex];
		if (!item) return;
		if (item.kind !== "preset") {
			statusMessage = "Empty session cannot be deleted";
			tui.requestRender();
			return;
		}
		statusMessage = undefined;
		mode = { kind: "confirm-delete", item };
		tui.requestRender();
	}

	async function confirmDelete(): Promise<void> {
		if (mode.kind !== "confirm-delete" || deleting || finished) return;
		deleting = true;
		const { item } = mode;
		const keepSlugNearby = item.preset.slug;
		try {
			await onDelete(item.preset);
			presets = presets.filter((p) => p.slug !== item.preset.slug);
			items = buildItems(presets);
			// Keep cursor near the deleted row.
			const near = items.findIndex(
				(it) => it.kind === "preset" && it.preset.slug === keepSlugNearby,
			);
			selectedIndex = near >= 0 ? near : Math.min(selectedIndex, Math.max(0, items.length - 1));
			clampSelection();
			statusMessage = `Deleted "${item.preset.name}"`;
			mode = { kind: "list" };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			statusMessage = `Delete failed: ${message}`;
			mode = { kind: "list" };
		} finally {
			deleting = false;
			tui.requestRender();
		}
	}

	function cancelDelete(): void {
		if (mode.kind !== "confirm-delete" || deleting) return;
		mode = { kind: "list" };
		tui.requestRender();
	}

	function confirmSelection(): void {
		if (mode.kind !== "list" || finished) return;
		const item = items[selectedIndex];
		if (!item) return;
		if (item.kind === "empty") {
			finish({ action: "empty" });
			return;
		}
		finish({ action: "select", preset: item.preset });
	}

	return {
		invalidate() {},
		render(_width: number): readonly string[] {
			const lines: string[] = [];
			lines.push(theme.fg("accent", theme.bold("New session context")));
			lines.push("");

			if (mode.kind === "confirm-delete") {
				lines.push(
					theme.fg("warning", `Delete saved context "${mode.item.label}"?`),
				);
				lines.push(theme.fg("muted", `File: ${mode.item.preset.slug}.json`));
				lines.push("");
				lines.push(
					theme.fg(
						"muted",
						deleting ? "Deleting…" : "Enter confirm · Esc cancel",
					),
				);
				return lines;
			}

			if (items.length === 0) {
				lines.push(theme.fg("muted", "(no options)"));
			} else {
				for (let i = 0; i < items.length; i++) {
					const it = items[i]!;
					const cursor = i === selectedIndex ? "❯ " : "  ";
					const label =
						i === selectedIndex
							? theme.fg("accent", theme.bold(it.label))
							: theme.fg("text", it.label);
					const desc = theme.fg("muted", it.description);
					const hint =
						i === selectedIndex && it.kind === "preset"
							? theme.fg("dim", "  ⌫ delete")
							: "";
					lines.push(`${cursor}${label}  ${desc}${hint}`);
				}
			}

			lines.push("");
			lines.push(
				theme.fg(
					"muted",
					"↑↓ move · Enter select · ⌫/Del delete preset · Esc cancel",
				),
			);
			if (statusMessage) {
				lines.push(theme.fg("muted", statusMessage));
			}
			return lines;
		},
		handleInput(data: string) {
			if (finished) return;

			if (mode.kind === "confirm-delete") {
				if (deleting) return;
				if (isKey(data, "enter")) {
					void confirmDelete();
					return;
				}
				if (isKey(data, "escape") || isKey(data, "ctrl+c")) {
					cancelDelete();
					return;
				}
				return;
			}

			if (isKey(data, "up")) {
				selectedIndex = Math.max(0, selectedIndex - 1);
				statusMessage = undefined;
				tui.requestRender();
				return;
			}
			if (isKey(data, "down")) {
				selectedIndex = Math.min(items.length - 1, selectedIndex + 1);
				statusMessage = undefined;
				tui.requestRender();
				return;
			}
			if (isKey(data, "enter")) {
				confirmSelection();
				return;
			}
			if (isKey(data, "backspace") || isKey(data, "delete")) {
				requestDelete();
				return;
			}
			if (isKey(data, "escape") || isKey(data, "ctrl+c")) {
				finish({ action: "cancel" });
				return;
			}
		},
	};
}
