import { normalizePath, Vault } from "obsidian";

import { DEFAULT_ARCHIVE_FOLDER } from "../constants";
import type {
	DailyHighlightMode,
	HighlightDateSource,
	NormalizedPocketRecording,
	PocketSyncSettings,
	PocketTrackedRecord,
} from "../types";
import { formatLocalDate, formatLocalYearMonth } from "../utils/date";
import { normalizeFolderPath, sanitizeFileComponent, truncate } from "../utils/text";

export function buildConversationPath(
	vault: Vault,
	recording: NormalizedPocketRecording,
	settings: PocketSyncSettings,
	trackedRecord: PocketTrackedRecord | null,
): string {
	const desiredPath = buildPathFromTemplate(
		recording,
		settings,
		settings.conversationFolder,
		settings.conversationFilenameTemplate,
	);

	return resolveTrackedOrUniquePath(vault, desiredPath, recording.id, settings, trackedRecord);
}

export function buildDailyHighlightPath(
	vault: Vault,
	recordings: NormalizedPocketRecording[],
	settings: PocketSyncSettings,
	trackedRecord: PocketTrackedRecord | null,
): string {
	const representative = recordings[0];
	if (!representative) {
		return normalizePath(`${settings.baseFolder}/${settings.dailyHighlightsFolder}/Daily highlights.md`);
	}

	const targetDate = getHighlightDate(recordings, settings.dailyHighlightMode, settings.highlightDateSource);
	const titleSeed =
		settings.dailyHighlightMode === "per-day"
			? "Daily highlights"
			: representative.title;
	const desiredPath = buildPathFromTemplate(
		representative,
		settings,
		settings.dailyHighlightsFolder,
		settings.dailyHighlightFilenameTemplate,
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

export function buildDailyHighlightGroupKey(
	recording: NormalizedPocketRecording,
	mode: DailyHighlightMode,
	dateSource: HighlightDateSource,
): string {
	if (mode === "per-recording") {
		return recording.id;
	}

	return getHighlightDate([recording], mode, dateSource);
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
	const dateParts = noteDate.split("-");
	const title = explicitTitle ?? recording.title;
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

	const finalFileName = truncate(sanitizeFileComponent(resolvedTemplate), 120);
	let folderPath = normalizeFolderPath(`${baseFolder}/${featureFolder}`);

	if (settings.groupByYearMonth) {
		const yearMonth = formatLocalYearMonth(recording.recordingAt);
		folderPath = normalizeFolderPath(`${folderPath}/${yearMonth.year}/${yearMonth.month}`);
	}

	return normalizePath(`${folderPath}/${finalFileName}.md`);
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

function getHighlightDate(
	recordings: NormalizedPocketRecording[],
	mode: DailyHighlightMode,
	dateSource: HighlightDateSource,
): string {
	const sourceRecording = recordings[0];
	if (!sourceRecording) {
		return formatLocalDate(new Date().toISOString());
	}

	if (mode === "per-day") {
		return formatLocalDate(sourceRecording.recordingAt);
	}

	if (dateSource === "summary-date" && sourceRecording.summary?.updatedAt) {
		return formatLocalDate(sourceRecording.summary.updatedAt);
	}

	return formatLocalDate(sourceRecording.recordingAt);
}

