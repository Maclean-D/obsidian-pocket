import { App, Notice } from "obsidian";

import type { PocketSyncSettings } from "../types";
import { artifactVocabulary } from "./artifactLanguage";
import { renderBasesView } from "./renderBasesView";

/** Create the folder database view note. Delegated from main.ts to keep the entry point lifecycle-only. */
export async function createBasesView(app: App, settings: PocketSyncSettings): Promise<void> {
 if (!settings.includeFrontmatter && settings.organizationMode !== "pocket") {
  new Notice("Enable frontmatter and update content before using the folder database view.", 7000);
  return;
 }
 const root = settings.baseFolder;
 if (!root || root.startsWith("/") || root.split("/").some(segment => !segment || segment === "." || segment === "..")) {
  new Notice("Choose a valid relative Pocket folder first."); return;
 }
 const viewTitle = artifactVocabulary(settings.artifactLanguage).folderIndex.title;
 const path = `${root}/${viewTitle}.base`;
 try {
  if (app.vault.getAbstractFileByPath(path)) { new Notice(`A file already exists at ${path}; it was preserved.`); return; }
  let parent = "";
  for (const part of root.split("/")) {
   parent = parent ? `${parent}/${part}` : part;
   if (!app.vault.getAbstractFileByPath(parent)) await app.vault.createFolder(parent);
  }
  const file = await app.vault.create(path, renderBasesView(root, settings.artifactLanguage));
  await app.workspace.getLeaf(false).openFile(file);
 } catch {
  new Notice("Could not create the folder database view. Check the destination folder.", 7000);
 }
}
