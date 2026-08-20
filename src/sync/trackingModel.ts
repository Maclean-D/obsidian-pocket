import type {
	ConversationArtifactKind,
	ConversationSeparateFilePaths,
	PocketTrackedRecord,
} from "../types";

const ARTIFACT_KIND_BY_FILENAME: Record<string, ConversationArtifactKind> = {
	"transcript.md": "transcript",
	"summary.md": "summary",
	"action-items.md": "action-items",
	"mindmap.md": "mindmap",
};

export function normalizeTrackedRecord(record: PocketTrackedRecord): PocketTrackedRecord {
	const artifactPaths = Array.isArray(record.artifactPaths)
		? record.artifactPaths
		: record.notePath
			? [record.notePath]
			: [];

	if (record.kind !== "conversation") {
		return {
			...record,
			artifactPaths,
		};
	}

	return {
		...record,
		artifactPaths,
		activeOutputFormat: isConversationOutputFormat(record.activeOutputFormat)
			? record.activeOutputFormat
			: "separate-files",
		singleNotePath: typeof record.singleNotePath === "string" ? record.singleNotePath : null,
		separateFilePaths: normalizeSeparateFilePaths(record.separateFilePaths, artifactPaths),
	};
}

export function getActiveTrackedPaths(record: PocketTrackedRecord): string[] {
	if (record.kind !== "conversation") {
		return normalizedCompatibilityPaths(record);
	}

	if (record.activeOutputFormat === "single-note") {
		return record.singleNotePath ? [record.singleNotePath] : [];
	}

	const separatePaths = Object.values(record.separateFilePaths ?? {}).filter(
		(path): path is string => typeof path === "string" && path.length > 0,
	);
	return separatePaths.length > 0 ? Array.from(new Set(separatePaths)) : normalizedCompatibilityPaths(record);
}

function normalizeSeparateFilePaths(
	storedPaths: ConversationSeparateFilePaths | undefined,
	artifactPaths: string[],
): ConversationSeparateFilePaths {
	const separateFilePaths: ConversationSeparateFilePaths = { ...storedPaths };

	for (const path of artifactPaths) {
		const filename = path.split("/").pop();
		const artifactKind = filename ? ARTIFACT_KIND_BY_FILENAME[filename] : undefined;
		if (artifactKind && !separateFilePaths[artifactKind]) {
			separateFilePaths[artifactKind] = path;
		}
	}

	return separateFilePaths;
}

function isConversationOutputFormat(value: unknown): value is PocketTrackedRecord["activeOutputFormat"] {
	return value === "separate-files" || value === "single-note";
}

function normalizedCompatibilityPaths(record: PocketTrackedRecord): string[] {
	const paths = record.artifactPaths.length > 0 ? record.artifactPaths : [record.notePath];
	return paths.filter(Boolean);
}
