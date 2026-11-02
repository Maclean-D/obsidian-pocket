import { artifactVocabulary } from "./artifactLanguage";

/** Use canonical note.* identifiers consistently for display metadata and view columns.
 * Syntax: https://help.obsidian.md/bases/syntax
 */
export function renderBasesView(baseFolder: string, language: unknown): string {
 const columns = artifactVocabulary(language).basesView.columns;
 const viewName = artifactVocabulary(language).basesView.viewName;
 // JSON quoting is valid YAML and safely escapes a vault path inside the formula.
 const folderFilter = `file.inFolder(${JSON.stringify(baseFolder)})`;
 return [
  "# pocket-sync:bases-view",
  "filters:", "  and:",
  `    - ${JSON.stringify(folderFilter)}`,
  `    - ${JSON.stringify('artifact == "summary"')}`,
  "properties:",
  "  note.recording_title:", `    displayName: ${JSON.stringify(columns.title)}`,
  "  note.pocket_space:", `    displayName: ${JSON.stringify(columns.space)}`,
  "  note.pocket_folder_path:", `    displayName: ${JSON.stringify(columns.folder)}`,
  "  note.recorded_date:", `    displayName: ${JSON.stringify(columns.date)}`,
  "  note.recorded_time:", `    displayName: ${JSON.stringify(columns.time)}`,
  "  note.pocket_tags:", `    displayName: ${JSON.stringify(columns.tags)}`,
  "  note.pocket_summary_status:", `    displayName: ${JSON.stringify(columns.status)}`,
  "views:", "  - type: table", `    name: ${JSON.stringify(viewName)}`,
  "    order:", "      - note.recording_title", "      - note.pocket_space", "      - note.pocket_folder_path", "      - note.recorded_date", "      - note.recorded_time", "      - note.pocket_tags", "      - note.pocket_summary_status",
  "    sort:", "      - property: note.recorded_at", "        direction: DESC", "",
 ].join("\n");
}
