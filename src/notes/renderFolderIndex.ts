import { FOLDER_INDEX_MARKER } from "../constants";
import type { PocketOrganization } from "../types";
import { artifactVocabulary } from "./artifactLanguage";
import { formatRecordingDate } from "./metadata";
import { encodeVaultLinkPath } from "./navigation";

export interface FolderIndexEntry {
 id: string;
 title: string;
 recordingAt: string;
 summaryPath: string | null;
 organization?: PocketOrganization;
 pendingSummary?: boolean;
}

function label(value: string): string { return value.replace(/[\r\n]+/g, " ").replace(/[\\`*_{}[\]()#+.!|<>]/g, "\\$&"); }

/** Caller supplies only paths which exist after the successful sync. No filesystem effects. */
export function renderFolderIndex(entries: FolderIndexEntry[], timeZone: string, language: unknown): string {
 const strings = artifactVocabulary(language).folderIndex;
 const groups = new Map<string, FolderIndexEntry[]>();
 for (const entry of entries) {
  const org = entry.organization;
  const group = org?.status === "resolved" ? org.folderPath.join(" / ") : org?.status === "unfiled" ? strings.unfiled : strings.unknown;
  groups.set(group, [...(groups.get(group) ?? []), entry]);
 }
 const lines = [`# ${strings.title}`, "", FOLDER_INDEX_MARKER, "", strings.generated, ""];
 for (const [group, items] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, strings.locale))) {
  lines.push(`## ${label(group)}`, "");
  items.sort((a, b) => (Date.parse(b.recordingAt) || 0) - (Date.parse(a.recordingAt) || 0) || a.id.localeCompare(b.id));
  for (const item of items) {
   const title = label(item.title);
   // Absolute vault-relative Markdown links avoid ambiguous basename resolution.
   const link = item.summaryPath ? `[${title}](</${encodeVaultLinkPath(item.summaryPath)}>)` : title;
   lines.push(`- ${formatRecordingDate(item.recordingAt, timeZone)} — ${link}${item.pendingSummary ? ` — ${strings.pending}` : ""}`);
  }
  lines.push("");
 }
 if (!entries.length) lines.push(strings.empty, "");
 return lines.join("\n");
}
