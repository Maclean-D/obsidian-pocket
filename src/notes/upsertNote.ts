import { App, normalizePath, parseYaml, TFile } from "obsidian";

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
] as const;

export interface UpsertPocketNoteParams {
	app: App;
	targetPath: string;
	previousPath: string | null;
	rendered: RenderedPocketNote;
	noteManagementMode: NoteManagementMode;
	includeFrontmatter: boolean;
	dryRun: boolean;
	requiredTargetIdentity?: {
		recordingId: string;
	};
}

export interface UpsertPocketNoteResult {
	action: "created" | "updated" | "skipped";
	finalPath: string;
}

export class PocketNoteTargetConflictError extends Error {}

export async function upsertPocketNote(params: UpsertPocketNoteParams): Promise<UpsertPocketNoteResult> {
	const { app, targetPath, previousPath, rendered, noteManagementMode, includeFrontmatter, dryRun, requiredTargetIdentity } = params;
	const vault = app.vault;
	const normalizedTargetPath = normalizePath(targetPath);
	await ensureFolder(app, normalizedTargetPath);

	let existingFile = getFileByPath(app, normalizedTargetPath);
	let targetExistsOnDisk = existingFile ? false : await isExistingFile(app, normalizedTargetPath);
	if (
		(existingFile || targetExistsOnDisk) &&
		requiredTargetIdentity &&
		!await targetHasIdentity(app, existingFile, normalizedTargetPath, requiredTargetIdentity)
	) {
		throw new PocketNoteTargetConflictError(`Refusing to overwrite an unowned note at ${normalizedTargetPath}.`);
	}
	if (!existingFile && !targetExistsOnDisk && previousPath) {
		const previousFile = getFileByPath(app, previousPath);
		if (previousFile && previousFile.path !== normalizedTargetPath && !dryRun) {
			await ensureFolder(app, normalizedTargetPath);
			await vault.rename(previousFile, normalizedTargetPath);
			existingFile = getFileByPath(app, normalizedTargetPath);
			targetExistsOnDisk = existingFile ? false : await isExistingFile(app, normalizedTargetPath);
		} else if (previousFile) {
			existingFile = previousFile;
		}
	}

	const existingContent = existingFile
		? await vault.read(existingFile)
		: targetExistsOnDisk
			? await vault.adapter.read(normalizedTargetPath)
			: "";
	const nextContent = buildFinalContent(existingContent, rendered, noteManagementMode, includeFrontmatter);
	const normalizedExistingContent = existingContent.trimEnd();
	const normalizedNextContent = nextContent.trimEnd();

	if (normalizedExistingContent === normalizedNextContent) {
		return {
			action: "skipped",
			finalPath: existingFile?.path ?? normalizedTargetPath,
		};
	}

	if (dryRun) {
		return {
			action: existingFile || targetExistsOnDisk ? "updated" : "created",
			finalPath: existingFile?.path ?? normalizedTargetPath,
		};
	}

	if (existingFile) {
		if (requiredTargetIdentity && !await targetHasIdentity(app, existingFile, normalizedTargetPath, requiredTargetIdentity)) {
			throw new PocketNoteTargetConflictError(`The note at ${normalizedTargetPath} changed ownership before Pocket Sync could update it.`);
		}
		await vault.modify(existingFile, normalizedNextContent);
		return {
			action: "updated",
			finalPath: existingFile.path,
		};
	}

	if (targetExistsOnDisk) {
		if (requiredTargetIdentity && !await targetHasIdentity(app, null, normalizedTargetPath, requiredTargetIdentity)) {
			throw new PocketNoteTargetConflictError(`The note at ${normalizedTargetPath} changed ownership before Pocket Sync could update it.`);
		}
		await vault.adapter.write(normalizedTargetPath, normalizedNextContent);
		return {
			action: "updated",
			finalPath: normalizedTargetPath,
		};
	}

	try {
		await vault.create(normalizedTargetPath, normalizedNextContent);
	} catch (error) {
		if (requiredTargetIdentity && await isExistingFile(app, normalizedTargetPath)) {
			throw new PocketNoteTargetConflictError(`A note appeared at ${normalizedTargetPath} before Pocket Sync could create it.`);
		}
		throw error;
	}
	return {
		action: "created",
		finalPath: normalizedTargetPath,
	};
}

async function targetHasIdentity(
	app: App,
	file: TFile | null,
	path: string,
	requiredIdentity: NonNullable<UpsertPocketNoteParams["requiredTargetIdentity"]>,
): Promise<boolean> {
	if (file && file.extension !== "md") {
		return false;
	}

	const content = file ? await app.vault.read(file) : await app.vault.adapter.read(path);
	const frontmatterBody = extractFrontmatter(content).frontmatterBody;
	if (!frontmatterBody) {
		return false;
	}

	let frontmatter: unknown;
	try {
		frontmatter = parseYaml(frontmatterBody) as unknown;
	} catch {
		return false;
	}
	if (!frontmatter || typeof frontmatter !== "object") {
		return false;
	}

	const properties = frontmatter as Record<string, unknown>;
	return properties.recording_id === requiredIdentity.recordingId;
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
	await app.vault.rename(file, normalizePath(archivePath));
	return true;
}

function buildFinalContent(
	existingContent: string,
	rendered: RenderedPocketNote,
	noteManagementMode: NoteManagementMode,
	includeFrontmatter: boolean,
): string {
	const body = noteManagementMode === "entire-note"
		? `${rendered.body.trim()}\n`
		: injectManagedBlock(stripManagedBlock(existingContent), rendered.body.trim());

	return applyFrontmatter(body, rendered.frontmatter, includeFrontmatter, rendered.requiredFrontmatter).trimEnd() + "\n";
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

function stripManagedBlock(content: string): string {
	return content.replace(new RegExp(`${escapeRegExp(MANAGED_BLOCK_START)}[\\s\\S]*?${escapeRegExp(MANAGED_BLOCK_END)}\\n?`, "m"), "").trim();
}

function applyFrontmatter(
	content: string,
	frontmatter: FrontmatterValueMap,
	includeFrontmatter: boolean,
	requiredFrontmatter: FrontmatterValueMap | undefined,
): string {
	const extracted = extractFrontmatter(content);
	const cleanedBody = extracted.body.trimStart();
	const existingBody = extracted.frontmatterBody;
	const nextFrontmatter = includeFrontmatter
		? upsertPocketFrontmatter(existingBody, frontmatter)
		: requiredFrontmatter
			? upsertPocketFrontmatter(existingBody, requiredFrontmatter)
			: removePocketFrontmatter(existingBody);

	if (!nextFrontmatter) {
		return cleanedBody;
	}

	return `---\n${nextFrontmatter.trim()}\n---\n\n${cleanedBody}`.trim();
}

function extractFrontmatter(content: string): { frontmatterBody: string | null; body: string } {
	const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
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
	const renderedBlock = renderFrontmatterEntries(frontmatter);
	const cleanedFrontmatter = removePocketFrontmatter(existingFrontmatter);
	return [cleanedFrontmatter, renderedBlock].filter(Boolean).join("\n").trim();
}

function removePocketFrontmatter(existingFrontmatter: string | null): string {
	if (!existingFrontmatter) {
		return "";
	}

	let nextFrontmatter = existingFrontmatter
		.replace(new RegExp(`(^|\\n)${FRONTMATTER_BLOCK_KEY}:\\n(?:  .*\\n?)*`, "m"), "")
		.trim();

	for (const key of MANAGED_FRONTMATTER_KEYS) {
		nextFrontmatter = nextFrontmatter
			.replace(new RegExp(`(^|\\n)${escapeRegExp(key)}:\\n(?:  - .*\\n?)*`, "m"), "")
			.replace(new RegExp(`(^|\\n)${escapeRegExp(key)}: .*\\n?`, "m"), "")
			.trim();
	}

	return nextFrontmatter;
}

function renderFrontmatterEntries(frontmatter: FrontmatterValueMap): string {
	return Object.entries(frontmatter)
		.filter(([, value]) => value !== undefined)
		.map(([key, value]) => {
			if (Array.isArray(value)) {
				return `${key}:\n${renderFrontmatterValue(value, 1)}`;
			}

			if (value && typeof value === "object") {
				return `${key}: ${quoteScalar(JSON.stringify(value))}`;
			}

			return `${key}: ${quoteScalar(value)}`;
		})
		.join("\n");
}

function renderFrontmatterValue(value: FrontmatterValueMap[] | string[] | string | number | boolean | null, depth: number): string {
	const indent = "  ".repeat(depth);

	if (Array.isArray(value)) {
		return value
			.map((item) => {
				if (typeof item === "string") {
					return `${indent}- ${quoteScalar(item)}`;
				}

				return `${indent}- ${quoteScalar(JSON.stringify(item))}`;
			})
			.join("\n");
	}

	return `${indent}${quoteScalar(value)}`;
}

function quoteScalar(value: string | number | boolean | null | undefined): string {
	if (value == null) {
		return "null";
	}

	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}

	return `'${value.replace(/'/g, "''")}'`;
}

async function ensureFolder(app: App, notePath: string): Promise<void> {
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
