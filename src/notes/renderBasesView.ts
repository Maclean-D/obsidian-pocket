/** Use canonical note.* identifiers consistently for display metadata and view columns.
 * Syntax: https://help.obsidian.md/bases/syntax
 */
export function renderBasesView(baseFolder: string): string {
 // JSON quoting is valid YAML and safely escapes a vault path inside the formula.
 const folderFilter = `file.inFolder(${JSON.stringify(baseFolder)})`;
 return [
  "# pocket-sync:bases-view",
  "filters:", "  and:",
  `    - ${JSON.stringify(folderFilter)}`,
  `    - ${JSON.stringify('artifact == "summary"')}`,
  "properties:",
  "  note.recording_title:", '    displayName: "Grabación"',
  "  note.pocket_space:", '    displayName: "Espacio"',
  "  note.pocket_folder_path:", '    displayName: "Carpeta"',
  "  note.recorded_date:", '    displayName: "Fecha"',
  "  note.recorded_time:", '    displayName: "Hora"',
  "  note.pocket_tags:", '    displayName: "Etiquetas"',
  "  note.pocket_summary_status:", '    displayName: "Estado del resumen"',
  "views:", "  - type: table", '    name: "Grabaciones por carpeta"',
  "    order:", "      - note.recording_title", "      - note.pocket_space", "      - note.pocket_folder_path", "      - note.recorded_date", "      - note.recorded_time", "      - note.pocket_tags", "      - note.pocket_summary_status",
  "    sort:", "      - property: note.recorded_at", "        direction: DESC", "",
 ].join("\n");
}
