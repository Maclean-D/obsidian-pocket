import type { ConversationArtifactKind, NormalizedPocketRecording, PocketSyncSettings, RenderedPocketNote } from "../types";
import {
	buildActionItemsMarkdownBody,
	buildAdditionalTags,
	buildInlineTagLine,
	buildMetadataSection,
	buildMindMapMarkdownBody,
	buildPocketFrontmatter,
	buildSummaryMarkdownBody,
	buildSummarySection,
	buildTranscriptMarkdownBody,
	buildTranscriptSection,
} from "./renderShared";

export function renderConversationNote(
	recording: NormalizedPocketRecording,
	settings: PocketSyncSettings,
	syncedAt: string,
): RenderedPocketNote {
	const customTags = buildAdditionalTags(settings, "conversation");
	const sections: string[] = [];
	const inlineTags = buildInlineTagLine([recording], settings, customTags);
	const summarySection = buildSummarySection(recording, settings);
	const transcriptSection = buildTranscriptSection(recording, settings);

	sections.push(`# ${recording.title}`);

	if (inlineTags) {
		sections.push(inlineTags.trim());
	}

	const metadataSection = buildMetadataSection([recording], settings, syncedAt);
	if (metadataSection) {
		sections.push(metadataSection.trim());
	}

	if (settings.sectionOrder === "summary-first") {
		if (summarySection) {
			sections.push(summarySection);
		}
		if (transcriptSection) {
			sections.push(transcriptSection);
		}
	} else {
		if (transcriptSection) {
			sections.push(transcriptSection);
		}
		if (summarySection) {
			sections.push(summarySection);
		}
	}

	if (!summarySection && !transcriptSection) {
		sections.push("_Pocket has not generated a summary or transcript for this recording yet._");
	}

	return {
		title: recording.title,
		body: sections.filter(Boolean).join("\n\n").trim(),
		frontmatter: buildPocketFrontmatter([recording], settings, syncedAt, customTags),
	};
}

export function renderConversationArtifactNote(
	recording: NormalizedPocketRecording,
	settings: PocketSyncSettings,
	syncedAt: string,
	artifactKind: ConversationArtifactKind,
): RenderedPocketNote {
	const customTags = buildAdditionalTags(settings, "conversation");
	const title = `${recording.title} ${artifactTitle(artifactKind)}`;
	const body = renderConversationArtifactBody(recording, settings, artifactKind);
	return {
		title,
		body,
		frontmatter: {
			...buildPocketFrontmatter([recording], settings, syncedAt, customTags),
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

