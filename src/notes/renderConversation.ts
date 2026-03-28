import type { NormalizedPocketRecording, PocketSyncSettings, RenderedPocketNote } from "../types";
import { buildInlineTagLine, buildMetadataSection, buildPocketFrontmatter, buildSummarySection, buildTranscriptSection } from "./renderShared";

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

