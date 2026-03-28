import type { NormalizedPocketRecording, PocketSyncSettings, RenderedPocketNote } from "../types";
import { formatLocalDate } from "../utils/date";
import { buildInlineTagLine, buildMetadataSection, buildPocketFrontmatter, buildSummarySection, buildTranscriptSection } from "./renderShared";

export function renderDailyHighlightsNote(
	recordings: NormalizedPocketRecording[],
	settings: PocketSyncSettings,
	syncedAt: string,
): RenderedPocketNote {
	const first = recordings[0];
	const titleDate = first ? formatLocalDate(first.recordingAt) : formatLocalDate(new Date().toISOString());
	const title =
		settings.dailyHighlightMode === "per-day"
			? `${titleDate} Daily highlights`
			: first?.title ?? "Daily highlights";

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
			recordingSections.push("_Pocket has not generated this daily highlight yet._");
		}

		sections.push(recordingSections.join("\n\n"));
	}

	if (recordings.length === 0) {
		sections.push("_No daily highlights were available for this note._");
	}

	return {
		title,
		body: sections.filter(Boolean).join("\n\n").trim(),
		frontmatter: buildPocketFrontmatter(recordings, settings, syncedAt),
	};
}

