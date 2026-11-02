import { MANAGED_BLOCK_START, MANAGED_BLOCK_END } from "../constants";
import { ARTIFACT_LANGUAGES, artifactVocabulary } from "./artifactLanguage";
import type { ArtifactLanguage, ConversationArtifactKind } from "../types";

export type ArtifactNavigationPaths = Partial<Record<ConversationArtifactKind, string>>;
const NAV_START = "<!-- pocket-sync:navigation:start -->";
const NAV_END = "<!-- pocket-sync:navigation:end -->";

/** Obsidian decodes Markdown destinations with decodeURI, not decodeURIComponent.
 * Keep reserved punctuation such as commas literal so it resolves to the real filename.
 */
export function encodeVaultLinkPath(path: string): string {
 return encodeURI(path).replace(/#/g, "%23").replace(/\?/g, "%3F");
}

/** Planned paths, never basename resolution or inferred sibling locations, own navigation. */
export function buildArtifactNavigation(paths: ArtifactNavigationPaths, language: ArtifactLanguage = "en", includeMarkers = true): string {
 const labels = artifactVocabulary(language).labels;
 const links: string[] = [];
 for (const kind of ["transcript", "action-items", "mindmap"] as const) {
  const path = paths[kind];
  if (!path) continue;
  if (path.startsWith("/") || path.includes("\\") || path.split("/").some(segment => !segment || segment === "." || segment === "..")) throw new Error("Invalid planned Pocket navigation path.");
  const target = encodeVaultLinkPath(path);
  links.push(`[${labels[kind]}](</${target}>)`);
 }
 return includeMarkers ? `${NAV_START}\n${links.join(" · ")}\n${NAV_END}` : links.join(" · ");
}

/** Mirror ownership comes from persisted generated navigation, never source markers/labels.
 * Empty means the plugin generated no navigation; undefined means unknown provenance.
 */
export function updateMirrorNavigation(content: string, navigation: string, previousNavigation?: string): string {
 if (previousNavigation === undefined || previousNavigation === navigation) return content;
 const heading = /^(\s*# [^\r\n]+\r?\n)(?:\r?\n)*/.exec(content);
 if (!heading) return content;
 let tail = content.slice(heading[0].length);
 if (previousNavigation) {
  const firstLine = tail.split(/\r?\n/, 1)[0] ?? "";
  // Accept only the exact generated line, or its exact Obsidian wikilink rewrite.
  const wiki = previousNavigation.replace(/\[([^\]]+)\]\(<\/([^>]+)>\)/g,
   (_match, label: string, path: string) => `[[${decodeURI(path)}|${label}]]`);
  if (firstLine !== previousNavigation && firstLine !== wiki) return content;
  tail = tail.slice(firstLine.length).replace(/^\r?\n(?:\r?\n)?/, "");
 }
 return heading[1] + "\n" + (navigation ? navigation + "\n\n" : "") + tail;
}

/** Replace navigation only at its generated position directly after the plugin H1. */
export function updateManagedNavigation(content: string, navigation: string): string {
 // Legacy managed markers are processed only for marked, managed navigation.
 if (!navigation.startsWith(NAV_START)) return content;
 const start = content.indexOf(MANAGED_BLOCK_START);
 if (start < 0) return content;
 const offset = start + MANAGED_BLOCK_START.length;
 const end = content.lastIndexOf(MANAGED_BLOCK_END);
 if (end < offset) return content;
 const body = content.slice(offset, end);
 const heading = /^(\s*# [^\r\n]+\r?\n)(?:\r?\n)*/.exec(body);
 if (!heading) return content;
 const remaining = body.slice(heading[0].length);
 let tail = remaining;
 if (remaining.startsWith(NAV_START + "\n") || remaining.startsWith(NAV_START + "\r\n")) {
  const navEnd = remaining.indexOf(NAV_END, NAV_START.length);
  if (navEnd >= 0) tail = remaining.slice(navEnd + NAV_END.length).replace(/^\r?\n(?:\r?\n)?/, "");
 } else {
  // Display labels survive Obsidian destination rewrites, including wikilinks.
  const labels = [...new Set(Object.values(ARTIFACT_LANGUAGES).flatMap(v =>
   [v.labels.transcript, v.labels["action-items"], v.labels.mindmap]))]
   .map(label => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const link = String.raw`(?:\[(?:${labels})\]\([^\r\n]*?\)|\[\[[^\r\n]*?\|(?:${labels})\]\])`;
  const firstLine = remaining.split(/\r?\n/, 1)[0] ?? "";
  if (new RegExp(`^${link}(?: · ${link})*$`).test(firstLine)) {
   tail = remaining.slice(firstLine.length).replace(/^\r?\n(?:\r?\n)?/, "");
  }
 }
 const updated = heading[1] + "\n" + navigation + "\n\n" + tail;
 return content.slice(0, offset) + updated + content.slice(end);
}
