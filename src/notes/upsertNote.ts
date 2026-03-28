import { App, normalizePath, TFile } from "obsidian";

import { FRONTMATTER_BLOCK_KEY, MANAGED_BLOCK_END, MANAGED_BLOCK_START } from "../constants";
import type { FrontmatterValueMap, NoteManagementMode, RenderedPocketNote } from "../types";

const MANAGED_FRONTMATTER_KEYS = [
	"kind",
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
}

export interface UpsertPocketNoteResult {
	action: "created" | "updated" | "skipped";
	finalPath: string;
}

export async function upsertPocketNote(params: UpsertPocketNoteParams): Promise<UpsertPocketNoteResult> {
	const { app, targetPath, previousPath, rendered, noteManagementMode, includeFrontmatter, dryRun } = params;
	const vault = app.vault;
	const normalizedTargetPath = normalizePath(targetPath);
	await ensureFolder(app, normalizedTargetPath);

	let existingFile = getFileByPath(app, normalizedTargetPath);
	if (!existingFile && previousPath) {
		const previousFile = getFileByPath(app, previousPath);
		if (previousFile && previousFile.path !== normalizedTargetPath && !dryRun) {
			await ensureFolder(app, normalizedTargetPath);
			await vault.rename(previousFile, normalizedTargetPath);
			existingFile = getFileByPath(app, normalizedTargetPath);
		} else if (previousFile) {
			existingFile = previousFile;
		}
	}

	const existingContent = existingFile ? await vault.read(existingFile) : "";
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
			action: existingFile ? "updated" : "created",
			finalPath: existingFile?.path ?? normalizedTargetPath,
		};
	}

	if (existingFile) {
		await vault.modify(existingFile, normalizedNextContent);
		return {
			action: "updated",
			finalPath: existingFile.path,
		};
	}

	await vault.create(normalizedTargetPath, normalizedNextContent);
	return {
		action: "created",
		finalPath: normalizedTargetPath,
	};
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

	return applyFrontmatter(body, rendered.frontmatter, includeFrontmatter).trimEnd() + "\n";
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
		if (!app.vault.getAbstractFileByPath(partialPath)) {
			await app.vault.createFolder(partialPath);
		}
	}
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

