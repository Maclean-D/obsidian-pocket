import { App, normalizePath, TFile, parseYaml, stringifyYaml } from "obsidian";

import { updateManagedNavigation, updateMirrorNavigation } from "./navigation";
import { POCKET_METADATA_KEYS } from "./metadata";
import { safePath } from "../core/paths";
import { FRONTMATTER_BLOCK_KEY, MANAGED_BLOCK_END, MANAGED_BLOCK_START } from "../constants";
import type { FrontmatterValueMap, NoteManagementMode, RenderedPocketNote } from "../types";

const MANAGED_FRONTMATTER_KEYS = [
	"kind",
	"artifact",
	"source",
	"recording_id",
	"recording_ids",
	"recording_title",
	"recorded_at",
	"pocket_created_at",
	"pocket_updated_at",
	"pocket_summary_updated_at",
	"duration_seconds",
	"state",
	"language",
	"pocket_tags",
	"synced_at",
	"pocket_space",
	"pocket_space_id",
	"pocket_folder",
	"pocket_folder_id",
	"pocket_folder_path",
	"pocket_keywords",
	"pocket_participants",
	"pocket_metadata_provenance",
] as const;

export interface UpsertPocketNoteParams {
	app: App;
	targetPath: string;
	previousPath: string | null;
	rendered: RenderedPocketNote;
	noteManagementMode: NoteManagementMode;
	includeFrontmatter: boolean;
	dryRun: boolean;
	metadataOnly?: boolean;
	baselineBody?: string;
	navigation?: string;
	previousNavigation?: string;
}

export interface UpsertPocketNoteResult {
	action: "created" | "updated" | "skipped";
	finalPath: string;
	moved?: boolean;
	preservedLegacy?: boolean;
}

export async function upsertPocketNote(params: UpsertPocketNoteParams): Promise<UpsertPocketNoteResult> {
	const { app, previousPath, rendered, dryRun } = params;
	const targetPath = safePath(params.targetPath);
	if (previousPath) safePath(previousPath);
	const target = getFileByPath(app, targetPath);
	const previous = getFileByPath(app, previousPath);
	const targetOnDisk = target ? true : await isExistingFile(app, targetPath);
	if (previousPath !== targetPath && targetOnDisk) {
		throw new Error(`Conflict: destination already exists: ${targetPath}`);
	}
	if (previousPath && !previous && previousPath !== targetPath && await pathExists(app, previousPath)) {
		throw new Error(`Source is not loaded in Obsidian: ${previousPath}`);
	}
	const file = previous ?? target;
	if (params.metadataOnly && !file) throw new Error(`Cannot update organization for missing artifact ${previousPath ?? targetPath}; refresh content first.`);
	const existing = file ? await app.vault.read(file) : targetOnDisk ? await app.vault.adapter.read(targetPath) : "";
	const moved = Boolean(previous && previous.path !== targetPath);
	const next = buildFinalContent(existing, rendered, params.noteManagementMode, params.includeFrontmatter, params.metadataOnly, params.baselineBody, params.navigation, params.previousNavigation);
	const changed = existing.trimEnd() !== next.trimEnd();
	const preservedLegacy = Boolean(params.noteManagementMode !== "mirror" && existing && !params.metadataOnly && !existing.includes(MANAGED_BLOCK_START));
	const action = !file && !targetOnDisk ? "created" : changed || moved ? "updated" : "skipped";
	if (dryRun || action === "skipped") return { action, finalPath: targetPath, moved, preservedLegacy };
	await ensureFolder(app, targetPath);
	if (moved && previous) await app.fileManager.renameFile(previous, targetPath);
	if (file) {
		if (changed) await app.vault.modify(file, next);
	} else if (targetOnDisk) {
		// Unloaded files are not safe to update through FileManager or link tracking.
		throw new Error(`Target is not loaded in Obsidian: ${targetPath}`);
	} else {
		await app.vault.create(targetPath, next);
	}
	return { action, finalPath: targetPath, moved, preservedLegacy };
}

export async function archivePocketNote(
	app: App,
	notePath: string,
	archivePath: string,
	dryRun: boolean,
): Promise<boolean> {
	const file = getFileByPath(app, notePath);
	if (!file) {
		return false;
	}

	if (dryRun) {
		return true;
	}

	await ensureFolder(app, archivePath);
	if (await pathExists(app, archivePath)) throw new Error(`Archive destination exists: ${archivePath}`);
	await app.fileManager.renameFile(file, safePath(archivePath));
	return true;
}

export function buildFinalContent(
	existingContent: string,
	rendered: RenderedPocketNote,
	noteManagementMode: NoteManagementMode,
	includeFrontmatter: boolean,
	metadataOnly = false,
	baselineBody?: string,
	navigation?: string,
	previousNavigation?: string,
): string {
	const extracted = extractFrontmatter(existingContent);
	const previousProperties = parseFrontmatter(extracted.frontmatterBody);
	const properties = metadataOnly ? { ...previousProperties, ...rendered.frontmatter } as FrontmatterValueMap : rendered.frontmatter;
	let body = extracted.body;
	if (metadataOnly && navigation !== undefined) {
		if (noteManagementMode === "mirror") {
			body = updateMirrorNavigation(body, navigation, previousNavigation);
		} else body = updateManagedNavigation(body, navigation);
	}
	if (!metadataOnly && noteManagementMode === "mirror") {
		body = rendered.body;
	} else if (!metadataOnly) {
		const pattern = new RegExp(`${escapeRegExp(MANAGED_BLOCK_START)}\\n?([\\s\\S]*?)${escapeRegExp(MANAGED_BLOCK_END)}`, "m");
		const oldBlock = body.match(pattern);
		if (oldBlock && normalizeChecks(oldBlock[1]?.trim() ?? "") !== normalizeChecks((baselineBody ?? rendered.body).trim())) {
			// Never silently discard edits made inside a generated section.
			body = body.replace(pattern, `## Preserved local version\n\n${oldBlock[1]?.trim() ?? ""}\n`);
		} else if (!oldBlock && body.trim()) {
			body = `## Preserved pre-migration content\n\n${body.trim()}\n`;
		}
		body = injectManagedBlock(body, preserveTaskChecks(extracted.body, rendered.body.trim()));
	}
	const fmPrefix = extracted.frontmatterBody === null ? "" : `---\n${extracted.frontmatterBody}\n---\n`;
	let next = applyFrontmatter(fmPrefix + body, properties, includeFrontmatter);
	// A sync timestamp alone must never create a write on every run.
	const oldFm = extracted.frontmatterBody ? parseYaml(extracted.frontmatterBody) as Record<string, unknown> : {};
	if (oldFm && typeof oldFm.synced_at === "string") {
		const stable = applyFrontmatter(fmPrefix + body, { ...properties, synced_at: oldFm.synced_at }, includeFrontmatter);
		if (stable.trimEnd() === existingContent.trimEnd()) next = stable;
	}
	return next.trimEnd() + "\n";
}

function normalizeChecks(body: string): string {
	return body.replace(/^(.*?- \[)[ xX](\].*?<!-- pocket-action:[^ ]+ -->.*)$/gm, "$1 $2");
}

function preserveTaskChecks(existing: string, incoming: string): string {
	const checked = new Map<string, string>();
	const pattern = /^(.*?- \[)([ xX])(\].*?<!-- pocket-action:([^ ]+) -->.*)$/gm;
	existing.replace(pattern, (line: string, _prefix: string, check: string, _tail: string, id: string) => { checked.set(id, check); return line; });
	return incoming.replace(pattern, (_line: string, prefix: string, check: string, tail: string, id: string) => `${prefix}${checked.get(id) ?? check}${tail}`);
}

function injectManagedBlock(existingContent: string, managedContent: string): string {
	const block = `${MANAGED_BLOCK_START}\n${managedContent}\n${MANAGED_BLOCK_END}`;
	const managedBlockPattern = new RegExp(`${escapeRegExp(MANAGED_BLOCK_START)}[\\s\\S]*?${escapeRegExp(MANAGED_BLOCK_END)}`, "m");

	if (managedBlockPattern.test(existingContent)) {
		return existingContent.replace(managedBlockPattern, block);
	}

	const trimmed = existingContent.trim();
	if (!trimmed) {
		return `${block}\n`;
	}

	return `${trimmed}\n\n${block}\n`;
}

function applyFrontmatter(content: string, frontmatter: FrontmatterValueMap, includeFrontmatter: boolean): string {
	const extracted = extractFrontmatter(content);
	const cleanedBody = extracted.body.trimStart();
	const existingBody = extracted.frontmatterBody;
	const nextFrontmatter = includeFrontmatter
		? upsertPocketFrontmatter(existingBody, frontmatter)
		: removePocketFrontmatter(existingBody);

	if (!nextFrontmatter) {
		return cleanedBody;
	}

	return `---\n${nextFrontmatter.trim()}\n---\n\n${cleanedBody}`.trim();
}

function extractFrontmatter(content: string): { frontmatterBody: string | null; body: string } {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (!match) {
		return {
			frontmatterBody: null,
			body: content,
		};
	}

	return {
		frontmatterBody: match[1] ?? null,
		body: content.slice(match[0].length),
	};
}

function upsertPocketFrontmatter(existingFrontmatter: string | null, frontmatter: FrontmatterValueMap): string {
	const existing = parseFrontmatter(existingFrontmatter);
	const aliases = existing.aliases;
	for (const key of [...MANAGED_FRONTMATTER_KEYS, ...POCKET_METADATA_KEYS]) delete existing[key];
	delete existing[FRONTMATTER_BLOCK_KEY];
	const merged = { ...existing, ...frontmatter };
	if (aliases !== undefined) merged.aliases = aliases;
	return stringifyYaml(Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)))).trim();
}

function parseFrontmatter(value: string | null): Record<string, unknown> {
	if (!value) return {};
	const parsed: unknown = parseYaml(value);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Cannot safely merge malformed note properties.");
	return parsed as Record<string, unknown>;
}

function removePocketFrontmatter(existingFrontmatter: string | null): string {
	const existing = parseFrontmatter(existingFrontmatter);
	for (const key of [...MANAGED_FRONTMATTER_KEYS, ...POCKET_METADATA_KEYS]) delete existing[key];
	delete existing[FRONTMATTER_BLOCK_KEY];
	return Object.keys(existing).length ? stringifyYaml(existing).trim() : "";
}

export async function ensureFolder(app: App, notePath: string): Promise<void> {
	const folderPath = notePath.split("/").slice(0, -1).join("/");
	if (!folderPath) {
		return;
	}

	const parts = folderPath.split("/");
	for (let index = 0; index < parts.length; index += 1) {
		const partialPath = normalizePath(parts.slice(0, index + 1).join("/"));
		if (!app.vault.getAbstractFileByPath(partialPath) && !(await pathExists(app, partialPath))) {
			await app.vault.adapter.mkdir(partialPath);
		}
	}
}

async function isExistingFile(app: App, path: string): Promise<boolean> {
	const stat = await app.vault.adapter.stat(normalizePath(path));
	if (!stat) {
		return false;
	}

	if (stat.type === "file") {
		return true;
	}

	throw new Error(`Cannot write Pocket note because "${path}" already exists and is not a file.`);
}

async function pathExists(app: App, path: string): Promise<boolean> {
	return (await app.vault.adapter.stat(normalizePath(path))) !== null;
}

function getFileByPath(app: App, path: string | null): TFile | null {
	if (!path) {
		return null;
	}

	const file = app.vault.getAbstractFileByPath(normalizePath(path));
	return file instanceof TFile ? file : null;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

