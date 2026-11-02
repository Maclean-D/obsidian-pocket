import { artifactVocabulary } from "./artifactLanguage";
import { buildArtifactNavigation, type ArtifactNavigationPaths } from "./navigation";
import type { ConversationArtifactKind, NormalizedPocketRecording, PocketSyncSettings, RenderedPocketNote } from "../types";
import {
	buildActionItemsMarkdownBody,
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
	const sections: string[] = [];
	const inlineTags = buildInlineTagLine([recording], settings);
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
		frontmatter: buildPocketFrontmatter([recording], settings, syncedAt),
	};
}

export function renderConversationArtifactNote(
	recording: NormalizedPocketRecording,
	settings: PocketSyncSettings,
	syncedAt: string,
	artifactKind: ConversationArtifactKind,
 artifactPaths: ArtifactNavigationPaths = {},
): RenderedPocketNote {
	const label = settings.artifactLanguage === "en" || !settings.artifactLanguage ? artifactTitle(artifactKind) : artifactVocabulary(settings.artifactLanguage).labels[artifactKind];
	const title = `${recording.title} ${label}`;
	const content = renderConversationArtifactBody(recording, settings, artifactKind);
 const navigation = artifactKind === "summary" ? buildArtifactNavigation(artifactPaths, settings.artifactLanguage, settings.noteManagementMode !== "mirror") : "";
 const metadata = settings.includeMetadataSection ? buildMetadataSection([recording], settings, syncedAt).trim() : "";
 const body = [`# ${recording.title.replace(/[\r\n]+/g, " ")}`, navigation, metadata, content || "_Pocket has not generated this content yet._"].filter(Boolean).join("\n\n");
	return {
		title,
		body,
		frontmatter: {
			...buildPocketFrontmatter([recording], settings, syncedAt),
			artifact: artifactKind,
            aliases: [artifactKind === "summary" ? recording.title : title],
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

