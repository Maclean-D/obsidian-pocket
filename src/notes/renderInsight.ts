import type { NormalizedPocketRecording, PocketSyncSettings, RenderedPocketNote } from "../types";
import { formatRecordingDate } from "./metadata";
import { buildInlineTagLine, buildMetadataSection, buildPocketFrontmatter, buildSummarySection, buildTranscriptSection } from "./renderShared";

export function renderInsightNote(
	recordings: NormalizedPocketRecording[],
	settings: PocketSyncSettings,
	syncedAt: string,
): RenderedPocketNote {
	const first = recordings[0];
	const titleDate = first ? formatRecordingDate(first.recordingAt, settings.timeZone) : formatRecordingDate(syncedAt, settings.timeZone);
	const title =
		settings.insightMode === "per-day"
			? `${titleDate} Insights`
			: first?.title ?? "Insights";

	const sections: string[] = [`# ${title}`];
	const inlineTags = buildInlineTagLine(recordings, settings);
	if (inlineTags) {
		sections.push(inlineTags.trim());
	}

	const metadataSection = buildMetadataSection(recordings, settings, syncedAt);
	if (metadataSection) {
		sections.push(metadataSection.trim());
	}

	for (const recording of recordings) {
		const summarySection = buildSummarySection(recording, settings);
		const transcriptSection = buildTranscriptSection(recording, settings);
		const recordingSections = [`## ${recording.title}`];

		if (summarySection) {
			recordingSections.push(summarySection);
		}

		if (transcriptSection) {
			recordingSections.push(transcriptSection);
		}

		if (!summarySection && !transcriptSection) {
			recordingSections.push("_Pocket has not generated this insight yet._");
		}

		sections.push(recordingSections.join("\n\n"));
	}

	if (recordings.length === 0) {
		sections.push("_No insights were available for this note._");
	}

	return {
		title,
		body: sections.filter(Boolean).join("\n\n").trim(),
		frontmatter: buildPocketFrontmatter(recordings, settings, syncedAt),
	};
}
