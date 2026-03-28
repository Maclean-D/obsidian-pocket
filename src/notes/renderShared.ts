import type {
	FrontmatterValueMap,
	NormalizedPocketRecording,
	PocketActionItem,
	PocketActionItemSubtask,
	PocketSyncSettings,
} from "../types";
import { formatDisplayDateTime, formatDurationSeconds, formatTranscriptTimestamp } from "../utils/date";
import { dedupeStrings, toObsidianTag } from "../utils/text";

export function buildInlineTagLine(
	recordings: NormalizedPocketRecording[],
	settings: Pick<PocketSyncSettings, "includeInlineObsidianTags">,
): string {
	if (!settings.includeInlineObsidianTags) {
		return "";
	}

	const tags = dedupeStrings(
		recordings.flatMap((recording) => recording.tags.map((tag) => toObsidianTag(tag.name))),
	);

	return tags.length > 0 ? `${tags.join(" ")}\n` : "";
}

export function buildMetadataSection(
	recordings: NormalizedPocketRecording[],
	settings: Pick<PocketSyncSettings, "includeMetadataSection">,
	syncedAt: string,
): string {
	if (!settings.includeMetadataSection || recordings.length === 0) {
		return "";
	}

	const lines = recordings.flatMap((recording) => {
		const recordingLines = [
			`- Recording title: ${recording.title}`,
			`- Recorded: ${formatDisplayDateTime(recording.recordingAt)}`,
			`- Updated in Pocket: ${formatDisplayDateTime(recording.updatedAt)}`,
			`- Duration: ${formatDurationSeconds(recording.durationSeconds)}`,
			`- Status: ${recording.state ?? "Unknown"}`,
		];

		if (recording.tags.length > 0) {
			recordingLines.push(`- Tags: ${recording.tags.map((tag) => tag.name).join(", ")}`);
		}

		recordingLines.push(`- Synced: ${formatDisplayDateTime(syncedAt)}`);
		return recordingLines;
	});

	return `## Pocket metadata\n${lines.join("\n")}\n`;
}

export function buildSummarySection(
	recording: NormalizedPocketRecording,
	settings: Pick<
		PocketSyncSettings,
		"includeSummaryMarkdown" | "includeBulletHighlights" | "includeActionItems" | "renderActionItemsAsChecklist" | "includeActionItemDueDate" | "includeActionItemStatus" | "hideCompletedActionItems"
	>,
): string {
	const sections: string[] = [];
	const summary = recording.summary;

	if (!summary) {
		return "";
	}

	if (settings.includeSummaryMarkdown && summary.markdown.trim()) {
		sections.push(`## Summary\n${summary.markdown.trim()}`);
	}

	if (settings.includeBulletHighlights && summary.bulletPoints.length > 0) {
		sections.push(`## Highlights\n${summary.bulletPoints.map((point) => `- ${point}`).join("\n")}`);
	}

	if (settings.includeActionItems && summary.actionItems.length > 0) {
		const actionItems = renderActionItems(summary.actionItems, settings);
		if (actionItems) {
			sections.push(`## Action items\n${actionItems}`);
		}
	}

	return sections.join("\n\n");
}

export function buildTranscriptSection(
	recording: NormalizedPocketRecording,
	settings: Pick<PocketSyncSettings, "includeTranscript" | "includeTranscriptTimestamps">,
): string {
	if (!settings.includeTranscript || !recording.transcript) {
		return "";
	}

	if (recording.transcript.segments.length === 0) {
		return recording.transcript.text.trim() ? `## Transcript\n${recording.transcript.text.trim()}` : "";
	}

	const lines = recording.transcript.segments.map((segment) => {
		const speaker = segment.speaker ? `${segment.speaker}: ` : "";
		const timestamp = settings.includeTranscriptTimestamps ? `[${formatTranscriptTimestamp(segment.start)}] ` : "";
		return `${timestamp}${speaker}${segment.text}`;
	});

	return `## Transcript\n${lines.join("\n\n")}`;
}

export function buildPocketFrontmatter(
	recordings: NormalizedPocketRecording[],
	settings: Pick<
		PocketSyncSettings,
		"includeTagsInFrontmatter" | "includeExtendedFrontmatterMetadata" | "addSourceFrontmatterField"
	>,
	syncedAt: string,
): FrontmatterValueMap {
	const first = recordings[0];
	if (!first) {
		return {};
	}

	const frontmatter: FrontmatterValueMap = {
		kind: first.kind,
		synced_at: syncedAt,
	};

	if (recordings.length === 1) {
		frontmatter.recording_id = first.id;
	} else {
		frontmatter.recording_ids = recordings.map((recording) => recording.id);
	}

	frontmatter.recording_title = recordings.length === 1 ? first.title : `${recordings.length} pocket recordings`;

	if (settings.addSourceFrontmatterField) {
		frontmatter.source = "Pocket";
	}

	if (settings.includeTagsInFrontmatter) {
		frontmatter.pocket_tags = dedupeStrings(recordings.flatMap((recording) => recording.tags.map((tag) => tag.name)));
	}

	if (settings.includeExtendedFrontmatterMetadata) {
		frontmatter.recorded_at = first.recordingAt;
		frontmatter.pocket_created_at = first.createdAt;
		frontmatter.pocket_updated_at = first.updatedAt;
		frontmatter.duration_seconds = first.durationSeconds ?? 0;
		frontmatter.state = first.state ?? "unknown";
		if (first.language) {
			frontmatter.language = first.language;
		}
		if (first.summary?.updatedAt) {
			frontmatter.pocket_summary_updated_at = first.summary.updatedAt;
		}
	}

	return frontmatter;
}

function renderActionItems(
	actionItems: PocketActionItem[],
	settings: Pick<
		PocketSyncSettings,
		"renderActionItemsAsChecklist" | "includeActionItemDueDate" | "includeActionItemStatus" | "hideCompletedActionItems"
	>,
): string {
	const lines = actionItems
		.filter((item) => !(settings.hideCompletedActionItems && item.completed))
		.flatMap((item) => renderActionItem(item, settings));

	return lines.join("\n");
}

function renderActionItem(
	actionItem: PocketActionItem,
	settings: Pick<
		PocketSyncSettings,
		"renderActionItemsAsChecklist" | "includeActionItemDueDate" | "includeActionItemStatus"
	>,
): string[] {
	const prefix = settings.renderActionItemsAsChecklist
		? actionItem.completed
			? "- [x]"
			: "- [ ]"
		: "-";
	const suffix = buildActionItemSuffix(actionItem, settings);
	const lines = [`${prefix} ${actionItem.title}${suffix}`];

	if (actionItem.description) {
		lines.push(`  - ${actionItem.description}`);
	}

	if (actionItem.subtasks.length > 0) {
		for (const subtask of actionItem.subtasks) {
			lines.push(renderSubtask(subtask, settings));
		}
	}

	return lines;
}

function renderSubtask(
	subtask: PocketActionItemSubtask,
	settings: Pick<
		PocketSyncSettings,
		"renderActionItemsAsChecklist" | "includeActionItemDueDate" | "includeActionItemStatus"
	>,
): string {
	const prefix = settings.renderActionItemsAsChecklist
		? subtask.completed
			? "  - [x]"
			: "  - [ ]"
		: "  -";

	return `${prefix} ${subtask.title}${buildActionItemSuffix(subtask, settings)}`;
}

function buildActionItemSuffix(
	actionItem: Pick<PocketActionItem, "status" | "dueDate" | "priority">,
	settings: Pick<PocketSyncSettings, "includeActionItemDueDate" | "includeActionItemStatus">,
): string {
	const metadata: string[] = [];

	if (settings.includeActionItemStatus && actionItem.status) {
		metadata.push(actionItem.status);
	}

	if (settings.includeActionItemDueDate && actionItem.dueDate) {
		metadata.push(`due ${actionItem.dueDate}`);
	}

	if (actionItem.priority) {
		metadata.push(actionItem.priority.toLowerCase());
	}

	return metadata.length > 0 ? ` (${metadata.join(", ")})` : "";
}

