import type {
	FrontmatterValueMap,
	NoteKind,
	NormalizedPocketRecording,
	PocketActionItem,
	PocketActionItemSubtask,
	PocketSyncSettings,
} from "../types";
import { formatDisplayDateTime, formatDurationSeconds, formatTranscriptTimestamp } from "../utils/date";
import { dedupeStrings, parseCommaSeparatedList, sanitizeTag, toCustomObsidianTag, toObsidianTag } from "../utils/text";

/**
 * Single source of truth for the user-configured additional tags applied to a
 * note. Combines the shared "all notes" tags with the note-kind-specific tags,
 * then parses, normalizes, drops empties (e.g. `!!!` sanitizes to nothing), and
 * dedupes so inline and frontmatter output always represent the same identities.
 */
export function buildAdditionalTags(
	settings: Pick<PocketSyncSettings, "additionalTags" | "additionalConversationTags" | "additionalInsightTags">,
	kind: NoteKind,
): string[] {
	const kindSpecific = kind === "conversation" ? settings.additionalConversationTags : settings.additionalInsightTags;
	const sanitized = parseCommaSeparatedList([settings.additionalTags, kindSpecific].join(","))
		.map(sanitizeTag)
		.filter(Boolean);
	return dedupeStrings(sanitized);
}

export function buildInlineTagLine(
	recordings: NormalizedPocketRecording[],
	settings: Pick<PocketSyncSettings, "includeInlineObsidianTags" | "additionalTagsInline">,
	customTags: string[] = [],
): string {
	const tags: string[] = [];

	if (settings.includeInlineObsidianTags) {
		tags.push(...recordings.flatMap((recording) => recording.tags.map((tag) => toObsidianTag(tag.name))));
	}

	if (settings.additionalTagsInline && customTags.length > 0) {
		tags.push(...customTags.map(toCustomObsidianTag));
	}

	const dedupedTags = dedupeStrings(tags);
	return dedupedTags.length > 0 ? `${dedupedTags.join(" ")}\n` : "";
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

export function buildSummaryMarkdownBody(
	recording: NormalizedPocketRecording,
	settings: Pick<PocketSyncSettings, "includeSummaryMarkdown" | "includeBulletHighlights">,
): string {
	const summary = recording.summary;
	if (!summary) {
		return "";
	}

	const sections: string[] = [];
	if (settings.includeSummaryMarkdown && summary.markdown.trim()) {
		sections.push(summary.markdown.trim());
	}

	if (settings.includeBulletHighlights && summary.bulletPoints.length > 0) {
		sections.push(`# Highlights\n\n${summary.bulletPoints.map((point) => `- ${point}`).join("\n")}`);
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

export function buildTranscriptMarkdownBody(
	recording: NormalizedPocketRecording,
	settings: Pick<PocketSyncSettings, "includeTranscript" | "includeTranscriptTimestamps">,
): string {
	if (!settings.includeTranscript || !recording.transcript) {
		return "";
	}

	if (recording.transcript.segments.length === 0) {
		return recording.transcript.text.trim();
	}

	return recording.transcript.segments
		.map((segment) => {
			const speaker = segment.speaker ?? "SPEAKER";
			const timestamp = settings.includeTranscriptTimestamps ? `[${formatTranscriptTimestamp(segment.start)}] ` : "";
			const text = (segment.text || segment.originalText || "").trim();
			return `${timestamp}${speaker}: ${text}`;
		})
		.filter((line) => !line.endsWith(": "))
		.join("\n");
}

export function buildActionItemsMarkdownBody(
	recording: NormalizedPocketRecording,
	settings: Pick<
		PocketSyncSettings,
		"renderActionItemsAsChecklist" | "includeActionItemDueDate" | "includeActionItemStatus" | "hideCompletedActionItems"
	>,
): string {
	if (!recording.summary || recording.summary.actionItems.length === 0) {
		return "";
	}

	return renderActionItems(recording.summary.actionItems, settings);
}

export function buildMindMapMarkdownBody(
	recording: NormalizedPocketRecording,
	settings: Pick<PocketSyncSettings, "includeMindMap">,
): string {
	if (!settings.includeMindMap || !recording.summary?.mindMap) {
		return "";
	}

	return formatMindMapMarkdown(recording.summary.mindMap);
}

export function buildPocketFrontmatter(
	recordings: NormalizedPocketRecording[],
	settings: Pick<
		PocketSyncSettings,
		"includeTagsInFrontmatter" | "includeExtendedFrontmatterMetadata" | "addSourceFrontmatterField" | "additionalTagsInFrontmatter"
	>,
	syncedAt: string,
	customTags: string[] = [],
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

	if (settings.additionalTagsInFrontmatter && customTags.length > 0) {
		frontmatter.tags = customTags;
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

export function renderActionItems(
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

function formatMindMapMarkdown(mindMap: unknown): string {
	if (!mindMap) {
		return "";
	}

	if (typeof mindMap === "string") {
		return mindMap.trim();
	}

	const nodes = getMindMapNodes(mindMap);
	if (nodes.length === 0) {
		try {
			return ["```json", JSON.stringify(mindMap, null, 2), "```"].join("\n");
		} catch {
			return "[Invalid mind map data]";
		}
	}

	const nodesById = new Map(nodes.map((node) => [node.id, node]));
	const childrenByParentId = new Map<string, typeof nodes>();

	for (const node of nodes) {
		if (!node.parentId || !nodesById.has(node.parentId)) {
			continue;
		}
		const children = childrenByParentId.get(node.parentId) ?? [];
		children.push(node);
		childrenByParentId.set(node.parentId, children);
	}

	const roots = nodes.filter((node) => !node.parentId || !nodesById.has(node.parentId));
	const lines: string[] = [];
	const visited = new Set<string>();

	const renderNode = (node: (typeof nodes)[number], depth: number) => {
		if (visited.has(node.id)) {
			return;
		}
		visited.add(node.id);
		lines.push(`${"  ".repeat(depth)}- ${node.title}`);
		for (const child of childrenByParentId.get(node.id) ?? []) {
			renderNode(child, depth + 1);
		}
	};

	for (const root of roots) {
		renderNode(root, 0);
	}

	for (const node of nodes) {
		renderNode(node, 0);
	}

	return lines.join("\n");
}

function getMindMapNodes(mindMap: unknown): Array<{ id: string; parentId: string | null; title: string }> {
	if (!mindMap || typeof mindMap !== "object") {
		return [];
	}

	const value = mindMap as Record<string, unknown>;
	const rawNodes = Array.isArray(value.nodes)
		? value.nodes
		: Array.isArray(value.mnodes)
			? value.mnodes
			: Array.isArray(value.items)
				? value.items
				: null;

	if (!rawNodes) {
		return [];
	}

	const parentIdsByNodeId = new Map<string, string>();
	if (Array.isArray(value.edges)) {
		for (const edge of value.edges) {
			const edgeRecord = asRecord(edge);
			if (!edgeRecord) {
				continue;
			}
			const source = stringifyMindMapValue(edgeRecord.source ?? edgeRecord.from ?? edgeRecord.parent ?? edgeRecord.sourceId);
			const target = stringifyMindMapValue(edgeRecord.target ?? edgeRecord.to ?? edgeRecord.child ?? edgeRecord.targetId);
			if (source && target) {
				parentIdsByNodeId.set(target, source);
			}
		}
	}

	return rawNodes.map((node, index) => {
		const nodeRecord = asRecord(node) ?? ({} as Record<string, unknown>);
		const id = getMindMapNodeId(nodeRecord, index);
		return {
			id,
			parentId: getMindMapNodeParentId(nodeRecord) ?? parentIdsByNodeId.get(id) ?? null,
			title: getMindMapNodeTitle(nodeRecord),
		};
	});
}

function getMindMapNodeId(node: Record<string, unknown>, index: number): string {
	return stringifyMindMapValue(node.id ?? node.node_id ?? node.nodeId ?? node.key) ?? `node-${index}`;
}

function getMindMapNodeTitle(node: Record<string, unknown>): string {
	return stringifyMindMapValue(node.title ?? node.label ?? node.name ?? node.text ?? node.content)?.trim() || "Untitled";
}

function getMindMapNodeParentId(node: Record<string, unknown>): string | null {
	const parentId = node.parent_node_id ?? node.parentNodeId ?? node.parentId ?? node.parent;
	return stringifyMindMapValue(parentId);
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringifyMindMapValue(value: unknown): string | null {
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}

	return null;
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

