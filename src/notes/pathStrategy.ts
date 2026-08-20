import { App, normalizePath, TFile, Vault } from "obsidian";

import { DEFAULT_ARCHIVE_FOLDER } from "../constants";
import type {
	ConversationArtifactKind,
	InsightDateSource,
	InsightMode,
	NormalizedPocketRecording,
	PocketSyncSettings,
	PocketTrackedRecord,
} from "../types";
import { formatLocalDate, formatLocalYearMonth } from "../utils/date";
import { normalizeFolderPath, sanitizeFileComponent, truncate } from "../utils/text";

export const CONVERSATION_ARTIFACT_FILENAMES: Record<ConversationArtifactKind, string> = {
	transcript: "transcript.md",
	summary: "summary.md",
	"action-items": "action-items.md",
	mindmap: "mindmap.md",
};

export interface NewConversationSingleNotePath {
	targetPath: string;
	previousPath: null;
}

export async function resolveNewConversationSingleNotePath(
	app: App,
	recording: NormalizedPocketRecording,
	settings: PocketSyncSettings,
	excludedPaths: ReadonlySet<string> = new Set(),
): Promise<NewConversationSingleNotePath> {
	const folderPath = normalizeFolderPath(`${settings.baseFolder}/${settings.conversationFolder}`);
	const noteDate = formatLocalDate(recording.recordingAt);
	const filenameStem = truncate(
		buildTemplateValue(recording, settings, settings.conversationFolderTemplate, noteDate, recording.title),
		120,
	);
	const suffixes = buildSingleNoteCollisionSuffixes(recording.id);
	const candidatePaths = [
		normalizePath(`${folderPath}/${filenameStem}.md`),
		...suffixes.map((suffix) => buildSuffixedMarkdownPath(folderPath, filenameStem, suffix)),
	];

	for (const candidatePath of candidatePaths) {
		if (excludedPaths.has(candidatePath)) {
			continue;
		}
		const availability = await inspectSingleNoteCandidate(app, candidatePath, recording.id);
		if (availability !== "occupied-by-other") {
			return { targetPath: candidatePath, previousPath: null };
		}
	}

	const fullIdSuffix = suffixes[suffixes.length - 1] ?? "pocket-recording";
	for (let sequence = 2; ; sequence += 1) {
		const candidatePath = buildSuffixedMarkdownPath(folderPath, filenameStem, `${fullIdSuffix} ${sequence}`);
		if (excludedPaths.has(candidatePath)) {
			continue;
		}
		const availability = await inspectSingleNoteCandidate(app, candidatePath, recording.id);
		if (availability !== "occupied-by-other") {
			return { targetPath: candidatePath, previousPath: null };
		}
	}
}

export function buildConversationArtifactPath(
	vault: Vault,
	recording: NormalizedPocketRecording,
	settings: PocketSyncSettings,
	artifactKind: ConversationArtifactKind,
	trackedRecord: PocketTrackedRecord | null,
): string {
	const folderPath = resolveConversationFolderPath(vault, recording, settings, trackedRecord);
	return normalizePath(`${folderPath}/${CONVERSATION_ARTIFACT_FILENAMES[artifactKind]}`);
}

export function findTrackedArtifactPath(trackedRecord: PocketTrackedRecord | null, artifactKind: ConversationArtifactKind): string | null {
	if (!trackedRecord) {
		return null;
	}

	const fileName = CONVERSATION_ARTIFACT_FILENAMES[artifactKind];
	return (
		trackedRecord.artifactPaths.find((path) => path.endsWith(`/${fileName}`)) ??
		(trackedRecord.notePath.endsWith(`/${fileName}`) ? trackedRecord.notePath : null)
	);
}

export function buildInsightPath(
	vault: Vault,
	recordings: NormalizedPocketRecording[],
	settings: PocketSyncSettings,
	trackedRecord: PocketTrackedRecord | null,
): string {
	const representative = recordings[0];
	if (!representative) {
		return normalizePath(`${settings.baseFolder}/${settings.insightsFolder}/Insights.md`);
	}

	const targetDate = getInsightDate(recordings, settings.insightMode, settings.insightDateSource);
	const titleSeed =
		settings.insightMode === "per-day"
			? "Insights"
			: representative.title;
	const desiredPath = buildPathFromTemplate(
		representative,
		settings,
		settings.insightsFolder,
		settings.insightFilenameTemplate,
		targetDate,
		titleSeed,
	);

	return resolveTrackedOrUniquePath(vault, desiredPath, representative.id, settings, trackedRecord);
}

export function buildArchivePath(notePath: string, settings: PocketSyncSettings): string {
	const normalizedBase = normalizeFolderPath(settings.baseFolder);
	const archiveBase = normalizeFolderPath(`${normalizedBase}/${DEFAULT_ARCHIVE_FOLDER}`);

	if (notePath.startsWith(`${normalizedBase}/`)) {
		return normalizePath(`${archiveBase}/${notePath.slice(normalizedBase.length + 1)}`);
	}

	const fileName = notePath.split("/").pop() ?? "Pocket note.md";
	return normalizePath(`${archiveBase}/${fileName}`);
}

export function buildInsightGroupKey(
	recording: NormalizedPocketRecording,
	mode: InsightMode,
	dateSource: InsightDateSource,
): string {
	if (mode === "per-recording") {
		return recording.id;
	}

	return getInsightDate([recording], mode, dateSource);
}

function resolveConversationFolderPath(
	vault: Vault,
	recording: NormalizedPocketRecording,
	settings: PocketSyncSettings,
	trackedRecord: PocketTrackedRecord | null,
): string {
	if (trackedRecord?.notePath) {
		return normalizePath(trackedRecord.notePath.split("/").slice(0, -1).join("/"));
	}

	const desiredFolderPath = buildConversationFolderPath(recording, settings);
	if (!vault.getAbstractFileByPath(desiredFolderPath)) {
		return desiredFolderPath;
	}

	if (settings.duplicateFilenamePolicy === "frontmatter") {
		return desiredFolderPath;
	}

	return `${desiredFolderPath} ${recording.id.slice(0, 8)}`;
}

function buildConversationFolderPath(recording: NormalizedPocketRecording, settings: PocketSyncSettings): string {
	const baseFolder = normalizeFolderPath(settings.baseFolder);
	const featureFolder = normalizeFolderPath(settings.conversationFolder);
	const dateFolder = getRecordingDatePrefix(recording);
	const folderName = buildTemplateValue(
		recording,
		settings,
		settings.conversationFolderTemplate,
		dateFolder,
		recording.title,
	);
	let folderPath = normalizeFolderPath(`${baseFolder}/${featureFolder}/${dateFolder}/${folderName}`);

	if (settings.groupByYearMonth) {
		const yearMonth = formatLocalYearMonth(recording.recordingAt);
		folderPath = normalizeFolderPath(`${baseFolder}/${featureFolder}/${yearMonth.year}/${yearMonth.month}/${dateFolder}/${folderName}`);
	}

	return normalizePath(folderPath);
}

function buildPathFromTemplate(
	recording: NormalizedPocketRecording,
	settings: PocketSyncSettings,
	folderSetting: string,
	template: string,
	explicitDate?: string,
	explicitTitle?: string,
): string {
	const baseFolder = normalizeFolderPath(settings.baseFolder);
	const featureFolder = normalizeFolderPath(folderSetting);
	const noteDate = explicitDate ?? formatLocalDate(recording.recordingAt);
	const finalFileName = truncate(buildTemplateValue(recording, settings, template, noteDate, explicitTitle ?? recording.title), 120);
	let folderPath = normalizeFolderPath(`${baseFolder}/${featureFolder}`);

	if (settings.groupByYearMonth) {
		const yearMonth = formatLocalYearMonth(recording.recordingAt);
		folderPath = normalizeFolderPath(`${folderPath}/${yearMonth.year}/${yearMonth.month}`);
	}

	return normalizePath(`${folderPath}/${finalFileName}.md`);
}

function buildTemplateValue(
	recording: NormalizedPocketRecording,
	settings: PocketSyncSettings,
	template: string,
	noteDate: string,
	title: string,
): string {
	const dateParts = noteDate.split("-");
	const safeTitle = settings.normalizeFileNames ? sanitizeFileComponent(title) : title;
	const safeDate = settings.normalizeFileNames ? sanitizeFileComponent(noteDate) : noteDate;
	const replacements: Record<string, string> = {
		"{{date}}": safeDate,
		"{{title}}": safeTitle,
		"{{id}}": recording.id,
		"{{yyyy}}": dateParts[0] ?? "",
		"{{MM}}": dateParts[1] ?? "",
		"{{dd}}": dateParts[2] ?? "",
	};
	const resolvedTemplate = Object.entries(replacements).reduce((currentTemplate, [token, replacement]) => {
		return currentTemplate.split(token).join(replacement);
	}, template);

	return sanitizeFileComponent(resolvedTemplate);
}

function buildSingleNoteCollisionSuffixes(recordingId: string): string[] {
	const safeRecordingId = truncate(sanitizeFileComponent(recordingId, "pocket-recording"), 80);
	return Array.from(new Set([safeRecordingId.slice(0, 8), safeRecordingId])).filter(Boolean);
}

function buildSuffixedMarkdownPath(folderPath: string, filenameStem: string, suffix: string): string {
	const safeSuffix = sanitizeFileComponent(suffix, "pocket-recording");
	const availableStemLength = Math.max(1, 120 - safeSuffix.length - 1);
	const fittedStem = truncate(filenameStem, availableStemLength);
	return normalizePath(`${folderPath}/${fittedStem} ${safeSuffix}.md`);
}

async function inspectSingleNoteCandidate(
	app: App,
	candidatePath: string,
	recordingId: string,
): Promise<"available" | "owned" | "occupied-by-other"> {
	const abstractFile = app.vault.getAbstractFileByPath(candidatePath);
	if (!abstractFile) {
		return await app.vault.adapter.exists(candidatePath) ? "occupied-by-other" : "available";
	}

	if (!(abstractFile instanceof TFile) || abstractFile.extension !== "md") {
		return "occupied-by-other";
	}

	const frontmatter = app.metadataCache.getFileCache(abstractFile)?.frontmatter;
	return frontmatter?.recording_id === recordingId
		? "owned"
		: "occupied-by-other";
}

function resolveTrackedOrUniquePath(
	vault: Vault,
	desiredPath: string,
	recordingId: string,
	settings: PocketSyncSettings,
	trackedRecord: PocketTrackedRecord | null,
): string {
	if (trackedRecord?.notePath) {
		return normalizePath(trackedRecord.notePath);
	}

	if (!vault.getAbstractFileByPath(desiredPath)) {
		return desiredPath;
	}

	if (settings.duplicateFilenamePolicy === "frontmatter") {
		return desiredPath;
	}

	const suffix = recordingId.slice(0, 8);
	return desiredPath.replace(/\.md$/, ` ${suffix}.md`);
}

function getInsightDate(
	recordings: NormalizedPocketRecording[],
	mode: InsightMode,
	dateSource: InsightDateSource,
): string {
	const sourceRecording = recordings[0];
	if (!sourceRecording) {
		return formatLocalDate(new Date().toISOString());
	}

	if (mode === "per-day") {
		return getRecordingDatePrefix(sourceRecording);
	}

	if (dateSource === "summary-date" && sourceRecording.summary?.updatedAt) {
		return formatLocalDate(sourceRecording.summary.updatedAt);
	}

	return getRecordingDatePrefix(sourceRecording);
}

function getRecordingDatePrefix(recording: NormalizedPocketRecording): string {
	if (recording.kind === "insight") {
		const match = recording.id.match(/(\d{4}-\d{2}-\d{2})$/);
		if (match?.[1]) {
			return match[1];
		}
	}

	return formatLocalDate(recording.recordingAt);
}
