import { artifactVocabulary, trackedArtifactKinds } from "./artifactLanguage";
import { normalizePath, Vault } from "obsidian";

import { safePath, safeSegment } from "../core/paths";
import { DEFAULT_ARCHIVE_FOLDER } from "../constants";
import type {
	ConversationArtifactKind,
	InsightDateSource,
	InsightMode,
	NormalizedPocketRecording,
	PocketSyncSettings,
	PocketTrackedRecord,
} from "../types";
import { formatRecordingDate as formatLocalDate, formatRecordingYearMonth as formatLocalYearMonth } from "./metadata";
import { normalizeFolderPath, sanitizeFileComponent, truncate } from "../utils/text";

export const CONVERSATION_ARTIFACT_FILENAMES: Record<ConversationArtifactKind, string> = artifactVocabulary("en").filenames;

export function buildConversationArtifactPath(
	vault: Vault,
	recording: NormalizedPocketRecording,
	settings: PocketSyncSettings,
	artifactKind: ConversationArtifactKind,
	trackedRecord: PocketTrackedRecord | null,
): string {
	const folderPath = resolveConversationFolderPath(vault, recording, settings, trackedRecord);
	return normalizePath(`${folderPath ? `${folderPath}/` : ""}${artifactVocabulary(settings.artifactLanguage).filenames[artifactKind]}`);
}

export function findTrackedArtifactPath(trackedRecord: PocketTrackedRecord | null, artifactKind: ConversationArtifactKind): string | null {
	if (!trackedRecord) {
		return null;
	}

	return trackedArtifactKinds(trackedRecord)[artifactKind] ?? null;
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

	const targetDate = getInsightDate(recordings, settings.insightMode, settings.insightDateSource, settings.timeZone);
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
	timeZone = "Europe/Madrid",
): string {
	if (mode === "per-recording") {
		return recording.id;
	}

	return getInsightDate([recording], mode, dateSource, timeZone);
}

function resolveConversationFolderPath(
	vault: Vault,
	recording: NormalizedPocketRecording,
	settings: PocketSyncSettings,
	trackedRecord: PocketTrackedRecord | null,
): string {
	if (trackedRecord?.notePath && trackedRecord.pinnedLocalPath) {
		return normalizePath(trackedRecord.notePath.split("/").slice(0, -1).join("/"));
	}

	const desiredFolderPath = buildConversationFolderPath(recording, settings);
	return desiredFolderPath;
}

function buildConversationFolderPath(recording: NormalizedPocketRecording, settings: PocketSyncSettings): string {
	const baseFolder = safePath(normalizeFolderPath(settings.baseFolder));
	const featureFolder = safePath(normalizeFolderPath(settings.conversationFolder));
	if (settings.organizationMode === "pocket") {
		if (!recording.organization || recording.organization.status === "unknown") throw new Error(`Unknown Pocket folder for ${recording.id}`);
		const segments = recording.organization.folderPath.length ? recording.organization.folderPath.map(safeSegment) : ["Sin carpeta"];
		const date = formatLocalDate(recording.recordingAt, settings.timeZone);
		const yearMonth = formatLocalYearMonth(recording.recordingAt, settings.timeZone);
		const grouping = settings.groupByYearMonth ? `/${yearMonth.year}/${yearMonth.month}` : "";
		const day = settings.groupByYearMonth && settings.groupByDay ? `/${date.split("-")[2] ?? "Unknown"}` : "";
		return safePath(`${baseFolder}/${featureFolder}/${segments.join("/")}${grouping}${day}/${safeSegment(`${date} ${recording.title}`)}`);
	}
	const dateFolder = getRecordingDatePrefix(recording, settings.timeZone);
	const folderName = buildTemplateValue(
		recording,
		settings,
		settings.conversationFolderTemplate,
		dateFolder,
		recording.title,
	);
	let folderPath = normalizeFolderPath(`${baseFolder}/${featureFolder}/${dateFolder}/${folderName}`);

	if (settings.groupByYearMonth) {
		const yearMonth = formatLocalYearMonth(recording.recordingAt, settings.timeZone);
		const dateSegment = settings.groupByDay ? dateFolder.split("-")[2] ?? "Unknown" : dateFolder;
		folderPath = normalizeFolderPath(`${baseFolder}/${featureFolder}/${yearMonth.year}/${yearMonth.month}/${dateSegment}/${folderName}`);
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
	const baseFolder = safePath(normalizeFolderPath(settings.baseFolder));
	const featureFolder = safePath(normalizeFolderPath(folderSetting));
	const noteDate = explicitDate ?? formatLocalDate(recording.recordingAt, settings.timeZone);
	const finalFileName = truncate(buildTemplateValue(recording, settings, template, noteDate, explicitTitle ?? recording.title), 120);
	let folderPath = normalizeFolderPath(`${baseFolder}/${featureFolder}`);

	if (settings.groupByYearMonth) {
		if (settings.groupByDay) {
			folderPath = normalizeFolderPath(`${folderPath}/${noteDate.split("-").join("/")}`);
		} else {
			const yearMonth = formatLocalYearMonth(recording.recordingAt, settings.timeZone);
			folderPath = normalizeFolderPath(`${folderPath}/${yearMonth.year}/${yearMonth.month}`);
		}
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

	return safeSegment(resolvedTemplate);
}

function resolveTrackedOrUniquePath(
	vault: Vault,
	desiredPath: string,
	recordingId: string,
	settings: PocketSyncSettings,
	trackedRecord: PocketTrackedRecord | null,
): string {
	if (trackedRecord?.notePath && trackedRecord.pinnedLocalPath) {
		return normalizePath(trackedRecord.notePath);
	}

	return desiredPath;
}

function getInsightDate(
	recordings: NormalizedPocketRecording[],
	mode: InsightMode,
	dateSource: InsightDateSource,
	timeZone = "Europe/Madrid",
): string {
	const sourceRecording = recordings[0];
	if (!sourceRecording) {
		return formatLocalDate(new Date().toISOString(), timeZone);
	}

	if (mode === "per-day") {
		return getRecordingDatePrefix(sourceRecording, timeZone);
	}

	if (dateSource === "summary-date" && sourceRecording.summary?.updatedAt) {
		return formatLocalDate(sourceRecording.summary.updatedAt, timeZone);
	}

	return getRecordingDatePrefix(sourceRecording, timeZone);
}

function getRecordingDatePrefix(recording: NormalizedPocketRecording, timeZone = "Europe/Madrid"): string {
	if (recording.kind === "insight") {
		const match = recording.id.match(/(\d{4}-\d{2}-\d{2})$/);
		if (match?.[1]) {
			return match[1];
		}
	}

	return formatLocalDate(recording.recordingAt, timeZone);
}

