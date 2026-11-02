export { normalizeFolders, resolveRecordingOrganization, matchesOrganizationFilters } from "./folders";
import { DEFAULT_INSIGHTS_TAG } from "../constants";
import type {
	NormalizedPocketRecording,
	PocketActionItem,
	PocketActionItemSubtask,
	PocketRecordingListItem,
	PocketSummary,
	PocketSyncSettings,
	PocketTag,
	PocketTranscript,
	PocketTranscriptSegment,
} from "../types";
import { parseCommaSeparatedList } from "../utils/text";

type JsonRecord = Record<string, unknown>;

export function normalizeTag(raw: unknown): PocketTag | null {
	const value = asRecord(raw);
	if (!value) {
		return null;
	}

	const id = getString(value, "id");
	const name = getString(value, "name");

	if (!id || !name) {
		return null;
	}

	return {
		id,
		name,
		color: getNullableString(value, "color"),
		usageCount: getNumber(value, "usage_count") ?? undefined,
		createdAt: getNullableString(value, "created_at"),
		updatedAt: getNullableString(value, "updated_at"),
	};
}

export function normalizeRecordingListItem(raw: unknown): PocketRecordingListItem | null {
	const value = asRecord(raw);
	if (!value) {
		return null;
	}

	const id = getString(value, "id");
	const title = getString(value, "title") ?? getString(value, "name");
	const recordingAt = getString(value, "recording_at") ?? getString(value, "created_at");
	const createdAt = getString(value, "created_at") ?? recordingAt;
	const updatedAt = getString(value, "updated_at") ?? createdAt;

	if (!id || !title || !recordingAt || !createdAt || !updatedAt) {
		return null;
	}

	return {
		id,
		title,
        ...normalizeExplicitMetadata(value),
		durationSeconds: validDuration(value.duration),
		state: getNullableString(value, "state"),
		language: getNullableString(value, "language"),
		recordingAt,
		createdAt,
		updatedAt,
		tags: getArray(value, "tags")
			.map((item) => normalizeTag(item))
			.filter((item): item is PocketTag => item !== null),
	};
}

export function normalizeRecordingDetail(
	raw: unknown,
	fallback: PocketRecordingListItem,
	settings: PocketSyncSettings,
): NormalizedPocketRecording | null {
	const value = asRecord(raw);
	if (!value) {
		return null;
	}

	const id = getString(value, "id") ?? fallback.id;
	const title = getString(value, "title") ?? getString(value, "name") ?? fallback.title;
	const recordingAt = getString(value, "recording_at") ?? fallback.recordingAt;
	const createdAt = getString(value, "created_at") ?? fallback.createdAt;
	const updatedAt = getString(value, "updated_at") ?? fallback.updatedAt;

	if (!id || !title || !recordingAt || !createdAt || !updatedAt) {
		return null;
	}

	const tags = getArray(value, "tags")
		.map((item) => normalizeTag(item))
		.filter((item): item is PocketTag => item !== null);

	const summary = normalizeLatestSummary(value);
	const transcript = normalizeTranscript(value);
	const kind = isInsightRecording({ id, tags: Array.isArray(value.tags) ? tags : fallback.tags }, settings.insightsTag) ? "insight" : "conversation";

	return {
        ...fallback,
		id,
		title,
		kind,
        ...normalizeExplicitMetadata(value, fallback),
		state: getNullableString(value, "state") ?? fallback.state,
		durationSeconds: Object.prototype.hasOwnProperty.call(value, "duration") ? validDuration(value.duration) : fallback.durationSeconds,
		language: getNullableString(value, "language") ?? fallback.language,
		recordingAt,
		createdAt,
		updatedAt,
		tags: Array.isArray(value.tags) ? tags : fallback.tags,
		transcript,
		summary,
	};
}

export function isInsightRecording(
	recording: Pick<PocketRecordingListItem, "id" | "tags">,
	insightsTag: string,
): boolean {
	const normalizedTag = insightsTag.trim().toLowerCase() || DEFAULT_INSIGHTS_TAG;

	return (
		recording.id.startsWith("daily-highlights-") ||
		recording.tags.some((tag) => tag.name.toLowerCase() === normalizedTag || tag.id.toLowerCase() === normalizedTag)
	);
}

export function matchesTagFilters(
	recording: Pick<NormalizedPocketRecording | PocketRecordingListItem, "tags">,
	settings: Pick<PocketSyncSettings, "includeTags" | "excludeTags">,
): boolean {
	const includeTags = parseCommaSeparatedList(settings.includeTags).map((value) => value.toLowerCase());
	const excludeTags = parseCommaSeparatedList(settings.excludeTags).map((value) => value.toLowerCase());
	const tagNames = recording.tags.map((tag) => tag.name.toLowerCase());

	if (includeTags.length > 0 && !includeTags.some((tag) => tagNames.includes(tag))) {
		return false;
	}

	if (excludeTags.length > 0 && excludeTags.some((tag) => tagNames.includes(tag))) {
		return false;
	}

	return true;
}

function normalizeLatestSummary(recording: JsonRecord): PocketSummary | null {
	const summaries = asRecord(recording.summarizations);
	if (!summaries) {
		return null;
	}

	const normalized = Object.entries(summaries)
		.map(([key, value]) => normalizeSummary(value, key))
		.filter((item): item is PocketSummary => item !== null)
		.sort((left, right) => {
			const leftTime = Date.parse(left.updatedAt ?? left.createdAt ?? "");
			const rightTime = Date.parse(right.updatedAt ?? right.createdAt ?? "");
			return rightTime - leftTime;
		});

	return normalized.find((summary) => summary.processingStatus === "completed") ?? normalized[0] ?? null;
}

function normalizeSummary(raw: unknown, fallbackSummarizationId: string): PocketSummary | null {
	const value = asRecord(raw);
	if (!value) {
		return null;
	}

	const summaryRoot = asRecord(asRecord(value.v2)?.summary) ?? {};
	const actionItemsRoot = asRecord(asRecord(value.v2)?.actionItems) ?? {};
	const mindMap = asRecord(value.v2)?.mindMap ?? null;
	const summaryId = getString(value, "id") ?? fallbackSummarizationId;

	return {
		id: summaryId,
		summarizationId: getString(value, "summarizationId") ?? fallbackSummarizationId,
		processingStatus: getNullableString(value, "processingStatus"),
		title: getString(summaryRoot, "title") ?? "",
		emoji: getNullableString(summaryRoot, "emoji"),
		markdown:
			getString(summaryRoot, "markdown") ??
			getString(summaryRoot, "summary") ??
			"",
		bulletPoints: coerceStringArray(getArray(summaryRoot, "bullet_points")).length > 0
			? coerceStringArray(getArray(summaryRoot, "bullet_points"))
			: coerceStringArray(getArray(summaryRoot, "bulletPoints")),
		actionItems: normalizeActionItems(actionItemsRoot),
		mindMap,
		autoInitiated: getBoolean(value, "autoInitiated"),
		createdAt: getNullableString(value, "createdAt"),
		updatedAt: getNullableString(value, "updatedAt"),
		settings: asRecord(value.settings) ?? {},
		raw,
	};
}

function normalizeTranscript(recording: JsonRecord): PocketTranscript | null {
	const transcript = asRecord(recording.transcript);
	if (!transcript) {
		return null;
	}

	const segments = getArray(transcript, "segments")
		.map((segment) => normalizeTranscriptSegment(segment))
		.filter((item): item is PocketTranscriptSegment => item !== null);

	return {
		text: getString(transcript, "text") ?? segments.map((segment) => segment.text).join(" ").trim(),
		segments,
		metadata: asRecord(transcript.metadata) ?? {},
	};
}

function normalizeTranscriptSegment(raw: unknown): PocketTranscriptSegment | null {
	const value = asRecord(raw);
	if (!value) {
		return null;
	}

	const text = getString(value, "text");
	const start = getNumber(value, "start");
	const end = getNumber(value, "end");

	if (!text || start == null || end == null) {
		return null;
	}

	return {
		start,
		end,
		speaker: getNullableString(value, "speaker"),
		text,
		originalText: getNullableString(value, "originalText"),
	};
}

function normalizeActionItems(value: JsonRecord): PocketActionItem[] {
	const richItems = getArray(value, "actionItems")
		.map((item) => normalizeRichActionItem(item))
		.filter((item): item is PocketActionItem => item !== null);

	if (richItems.length > 0) {
		return richItems;
	}

	return getArray(value, "actions")
		.map((item) => normalizeSimpleActionItem(item))
		.filter((item): item is PocketActionItem => item !== null);
}

function normalizeRichActionItem(raw: unknown): PocketActionItem | null {
	const value = asRecord(raw);
	if (!value) {
		return null;
	}

	const id = getString(value, "id");
	const title = getString(value, "title");

	if (!id || !title) {
		return null;
	}

	return {
		id,
		title,
		description: getNullableString(value, "description"),
		assignee: getNullableString(value, "assignee"),
		status: getNullableString(value, "status"),
		priority: getNullableString(value, "priority"),
		dueDate: getNullableString(value, "dueDate"),
		category: getNullableString(value, "category"),
		completed: getBoolean(value, "isCompleted") || getBoolean(value, "is_completed"),
		type: getNullableString(value, "type"),
		subtasks: getArray(value, "subtasks")
			.map((item) => normalizeSubtask(item))
			.filter((item): item is PocketActionItemSubtask => item !== null),
	};
}

function normalizeSimpleActionItem(raw: unknown): PocketActionItem | null {
	const value = asRecord(raw);
	if (!value) {
		return null;
	}

	const id = getString(value, "id");
	const reminderPayload = asRecord(asRecord(value.payload)?.reminder);
	const title = getString(value, "label") ?? (reminderPayload ? getString(reminderPayload, "title") : null);

	if (!id || !title) {
		return null;
	}

	return {
		id,
		title,
		description: getNullableString(value, "context"),
		assignee: getNullableString(value, "assignee"),
		status: getNullableString(value, "status"),
		priority: getNullableString(value, "priority"),
		dueDate:
			getNullableString(value, "dueDate") ??
			(reminderPayload ? getNullableString(reminderPayload, "dueDateTime") : null),
		category: getNullableString(value, "category"),
		completed: getBoolean(value, "isCompleted") || getBoolean(value, "is_completed"),
		type: getNullableString(value, "type"),
		subtasks: [],
	};
}

function normalizeSubtask(raw: unknown): PocketActionItemSubtask | null {
	const value = asRecord(raw);
	if (!value) {
		return null;
	}

	const id = getString(value, "id");
	const title = getString(value, "title");

	if (!id || !title) {
		return null;
	}

	return {
		id,
		title,
		assignee: getNullableString(value, "assignee"),
		status: getNullableString(value, "status"),
		priority: getNullableString(value, "priority"),
		dueDate: getNullableString(value, "dueDate"),
		category: getNullableString(value, "category"),
		completed: getBoolean(value, "isCompleted") || getBoolean(value, "is_completed"),
	};
}

function asRecord(value: unknown): JsonRecord | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}

	return value as JsonRecord;
}

function getString(record: JsonRecord, key: string): string | null {
	const value = record[key];
	return typeof value === "string" && value.length > 0 ? value : null;
}

function getNullableString(record: JsonRecord, key: string): string | null {
	const value = record[key];
	return typeof value === "string" ? value : null;
}

function getNumber(record: JsonRecord, key: string): number | null {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getBoolean(record: JsonRecord, key: string): boolean {
	return record[key] === true;
}

function getArray(record: JsonRecord, key: string): unknown[] {
	const value = record[key];
	return Array.isArray(value) ? value : [];
}

function coerceStringArray(values: unknown[]): string[] {
	return values
		.map((item) => (typeof item === "string" ? item : ""))
		.filter(Boolean);
}


/** Only explicit API fields are accepted: no extraction of people or keywords from prose. */
function normalizeExplicitMetadata(value: JsonRecord, fallback?: PocketRecordingListItem): import("../types").PocketRecordingMetadata {
 const provenance = { ...fallback?.metadataProvenance };
 const folderId = Object.prototype.hasOwnProperty.call(value, "folder_id") ? (value.folder_id === null ? null : getString(value, "folder_id") ?? undefined) : fallback?.folderId;
 const keywords = Array.isArray(value.keywords) ? coerceStringArray(value.keywords) : fallback?.keywords;
 const participants = Array.isArray(value.participants) ? coerceStringArray(value.participants) : fallback?.participants;
 if (Array.isArray(value.keywords)) provenance.keywords = "Pocket API: keywords";
 if (Array.isArray(value.participants)) provenance.participants = "Pocket API: participants";
 if (typeof value.duration === "number" && Number.isFinite(value.duration) && value.duration >= 0) provenance.duration = "Pocket API: duration (seconds)";
 if (typeof value.recording_at === "string") provenance.recorded_at = "Pocket API: recording_at";
 else if (!fallback && typeof value.created_at === "string") provenance.recorded_at = "Pocket API: created_at (fallback)";
 return { folderId, ...(keywords !== undefined ? { keywords } : {}), ...(participants !== undefined ? { participants } : {}), ...(Object.keys(provenance).length ? { metadataProvenance: provenance } : {}) };
}

function validDuration(value: unknown): number | null {
 return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
