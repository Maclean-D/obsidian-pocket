import { App, normalizePath, TFile } from "obsidian";

import { MANAGED_BLOCK_END, MANAGED_BLOCK_START } from "../constants";
import type { NoteManagementMode, RenderedPocketNote } from "../types";
import { escapeRegExp } from "../utils/text";
import { applyFrontmatter } from "./frontmatter";

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
	let targetExistsOnDisk = existingFile ? false : await isExistingFile(app, normalizedTargetPath);
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
		await vault.modify(existingFile, normalizedNextContent);
		return {
			action: "updated",
			finalPath: existingFile.path,
		};
	}

	if (targetExistsOnDisk) {
		await vault.adapter.write(normalizedTargetPath, normalizedNextContent);
		return {
			action: "updated",
			finalPath: normalizedTargetPath,
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

