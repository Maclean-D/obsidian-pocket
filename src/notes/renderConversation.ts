import type { ConversationArtifactKind, NormalizedPocketRecording, PocketSyncSettings, RenderedPocketNote } from "../types";
import {
	buildActionItemsMarkdownBody,
	buildInlineTagLine,
	buildMetadataSection,
	buildMindMapMarkdownBody,
	buildPocketFrontmatter,
	buildSummaryMarkdownBody,
	buildTranscriptMarkdownBody,
} from "./renderShared";

const COMBINED_CONVERSATION_SECTIONS: Array<{
	heading: string;
	render: (recording: NormalizedPocketRecording, settings: PocketSyncSettings) => string;
}> = [
	{
		heading: "Summary",
		render: (recording, settings) => buildSummaryMarkdownBody(recording, settings, { highlightsHeadingLevel: 3 }),
	},
	{
		heading: "Action items",
		render: (recording, settings) => settings.includeActionItems
			? buildActionItemsMarkdownBody(recording, settings)
			: "",
	},
	{
		heading: "Mind map",
		render: buildMindMapMarkdownBody,
	},
	{
		heading: "Transcript",
		render: buildTranscriptMarkdownBody,
	},
];

export function renderConversationNote(
	recording: NormalizedPocketRecording,
	settings: PocketSyncSettings,
	syncedAt: string,
): RenderedPocketNote {
	const sections: string[] = [];
	const inlineTags = buildInlineTagLine([recording], settings);

	sections.push(`# ${recording.title}`);

	if (inlineTags) {
		sections.push(inlineTags.trim());
	}

	const metadataSection = buildMetadataSection([recording], settings, syncedAt);
	if (metadataSection) {
		sections.push(metadataSection.trim());
	}

	let renderedSectionCount = 0;
	for (const section of COMBINED_CONVERSATION_SECTIONS) {
		const body = section.render(recording, settings).trim();
		if (!body) {
			continue;
		}

		sections.push(`## ${section.heading}\n${body}`);
		renderedSectionCount += 1;
	}

	if (renderedSectionCount === 0) {
		sections.push("_Pocket content is not available for this recording yet._");
	}

	return {
		title: recording.title,
		body: sections.filter(Boolean).join("\n\n").trim(),
		frontmatter: buildPocketFrontmatter([recording], settings, syncedAt),
		requiredFrontmatter: {
			recording_id: recording.id,
		},
	};
}

export function renderConversationArtifactNote(
	recording: NormalizedPocketRecording,
	settings: PocketSyncSettings,
	syncedAt: string,
	artifactKind: ConversationArtifactKind,
): RenderedPocketNote {
	const title = `${recording.title} ${artifactTitle(artifactKind)}`;
	const body = renderConversationArtifactBody(recording, settings, artifactKind);
	return {
		title,
		body,
		frontmatter: {
			...buildPocketFrontmatter([recording], settings, syncedAt),
			artifact: artifactKind,
		},
	};
}

export function renderConversationArtifactBody(
	recording: NormalizedPocketRecording,
	settings: PocketSyncSettings,
	artifactKind: ConversationArtifactKind,
): string {
	if (artifactKind === "transcript") {
		return buildTranscriptMarkdownBody(recording, settings).trim();
	}

	if (artifactKind === "summary") {
		return buildSummaryMarkdownBody(recording, settings).trim();
	}

	if (artifactKind === "action-items") {
		return buildActionItemsMarkdownBody(recording, settings).trim();
	}

	return buildMindMapMarkdownBody(recording, settings).trim();
}

function artifactTitle(artifactKind: ConversationArtifactKind): string {
	if (artifactKind === "action-items") {
		return "action items";
	}

	if (artifactKind === "mindmap") {
		return "mind map";
	}

	return artifactKind;
}
