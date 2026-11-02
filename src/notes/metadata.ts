import type { FrontmatterValueMap, NormalizedPocketRecording } from "../types";

export function validTimeZone(value: string | undefined): string {
 try { new Intl.DateTimeFormat("en", { timeZone: value || "Europe/Madrid" }).format(); return value || "Europe/Madrid"; }
 catch { return "Europe/Madrid"; }
}

function dateParts(iso: string, timeZone: string): Record<string, string> | null {
 if (!iso || !Number.isFinite(Date.parse(iso))) return null;
 const parts = new Intl.DateTimeFormat("en-GB", { timeZone: validTimeZone(timeZone), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
 return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

export function formatRecordingDate(iso: string, timeZone: string): string {
 const parts = dateParts(iso, timeZone);
 return parts ? `${parts.year}-${parts.month}-${parts.day}` : "Unknown";
}

export function formatRecordingTime(iso: string, timeZone: string): string | null {
 const parts = dateParts(iso, timeZone);
 return parts ? `${parts.hour}:${parts.minute}` : null;
}

export function formatRecordingYearMonth(iso: string, timeZone: string): { year: string; month: string } {
 const parts = dateParts(iso, timeZone);
 return { year: parts?.year ?? "Unknown", month: parts?.month ?? "Unknown" };
}

export function formatRecordingDateTime(iso: string | null, timeZone: string): string {
 const parts = iso ? dateParts(iso, timeZone) : null;
 return parts ? `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} (${validTimeZone(timeZone)})` : "Unknown";
}

/** Remote-owned keys are shared with the property merge to preserve all other fields. */
export const POCKET_METADATA_KEYS = ["pocket_space", "pocket_space_id", "pocket_folder", "pocket_folder_id", "pocket_folder_path", "pocket_organization_status", "pocket_organization_fingerprint", "recorded_date", "recorded_time", "recorded_timezone", "pocket_speaker_labels", "pocket_keywords", "pocket_participants", "pocket_metadata_provenance", "pocket_summary_status"];

export function recordingMetadataProperties(recording: NormalizedPocketRecording, timeZone: string): FrontmatterValueMap {
 const org = recording.organization;
 const properties: FrontmatterValueMap = {
  recorded_at: recording.recordingAt,
  recorded_date: formatRecordingDate(recording.recordingAt, timeZone),
  recorded_time: formatRecordingTime(recording.recordingAt, timeZone),
  recorded_timezone: validTimeZone(timeZone),
  pocket_summary_status: recording.summary?.processingStatus ?? "pending",
 };
 if (org) {
  properties.pocket_organization_status = org.status;
  if (org.status !== "unknown") {
   properties.pocket_space = org.spaceName;
   properties.pocket_space_id = org.spaceId;
   properties.pocket_folder = org.folderName;
   properties.pocket_folder_id = org.folderId;
   properties.pocket_folder_path = org.folderPath.join("/");
   properties.pocket_organization_fingerprint = org.fingerprint;
  }
 } else if (recording.folderPath !== undefined) {
  properties.pocket_folder_path = recording.folderPath;
  properties.pocket_folder_id = recording.folderId ?? null;
  properties.pocket_space_id = recording.spaceId ?? null;
  if (recording.spaceName) properties.pocket_space = recording.spaceName;
  if (recording.folderName) properties.pocket_folder = recording.folderName;
 }
 const speakerLabels = [...new Set(recording.transcript?.segments.map(segment => segment.speaker).filter((speaker): speaker is string => typeof speaker === "string" && speaker.trim().length > 0) ?? [])];
 if (speakerLabels.length) properties.pocket_speaker_labels = speakerLabels;
 if (recording.keywords !== undefined) properties.pocket_keywords = recording.keywords;
 if (recording.participants !== undefined) properties.pocket_participants = recording.participants;
 if (recording.metadataProvenance && Object.keys(recording.metadataProvenance).length) properties.pocket_metadata_provenance = recording.metadataProvenance;
 return properties;
}
