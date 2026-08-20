import type { App } from "obsidian";

export type SingleNoteRecoveryIndex = Map<string, string[]>;

export function buildSingleNoteRecoveryIndex(app: App): SingleNoteRecoveryIndex {
	const pathsByRecordingId: SingleNoteRecoveryIndex = new Map();

	for (const file of app.vault.getMarkdownFiles()) {
		const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
		const recordingId = frontmatter?.recording_id;
		if (typeof recordingId !== "string") {
			continue;
		}

		const paths = pathsByRecordingId.get(recordingId) ?? [];
		paths.push(file.path);
		pathsByRecordingId.set(recordingId, paths);
	}

	return pathsByRecordingId;
}
