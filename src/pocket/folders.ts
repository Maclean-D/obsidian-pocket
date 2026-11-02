import type { PocketFolder, PocketOrganization, PocketRecordingMetadata, PocketSyncSettings } from "../types";

/** A malformed catalog is an error, never evidence that recordings are unfiled. */
export function normalizeFolders(raw: unknown[]): PocketFolder[] {
 const result = new Map<string, PocketFolder>();
 const visit = (item: unknown, parent: string | null, inheritedSpace: string | null): void => {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid Pocket folder entry.");
  const value = item as Record<string, unknown>;
  if (typeof value.id !== "string" || !value.id || typeof value.name !== "string" || !value.name.trim()) throw new Error("Pocket folder is missing its identity or name.");
  const kind = typeof value.kind === "string" ? value.kind : null;
  const folder: PocketFolder = {
   id: value.id, name: value.name, kind,
   parentFolderId: typeof value.parent_folder_id === "string" ? value.parent_folder_id : parent,
   spaceId: typeof value.space_id === "string" ? value.space_id : kind === "space" ? value.id : inheritedSpace,
  };
  const prior = result.get(folder.id);
  if (prior && JSON.stringify(prior) !== JSON.stringify(folder)) throw new Error("Conflicting Pocket folder identities.");
  result.set(folder.id, folder);
  if (value.children != null && !Array.isArray(value.children)) throw new Error("Invalid Pocket folder children.");
  for (const child of (value.children ?? []) as unknown[]) visit(child, folder.id, folder.spaceId);
 };
 for (const item of raw) visit(item, null, null);
 return [...result.values()];
}

export function resolveRecordingOrganization(folderId: string | null | undefined, folders: PocketFolder[]): PocketOrganization {
 const result: PocketOrganization = { status: folderId === null ? "unfiled" : "unknown", folderId: folderId ?? null, spaceId: null, spaceName: null, folderName: null, folderPath: [], fingerprint: "" };
 const byId = new Map(folders.map(folder => [folder.id, folder]));
 const chain: PocketFolder[] = [];
 const seen = new Set<string>();
 let next = folderId;
 while (next) {
  if (seen.has(next)) return { ...result, fingerprint: `unknown:${folderId ?? ""}` };
  seen.add(next);
  const folder = byId.get(next);
  if (!folder) return { ...result, fingerprint: `unknown:${folderId ?? ""}` };
  chain.unshift(folder);
  next = folder.parentFolderId;
  if (!next && folder.spaceId && folder.spaceId !== folder.id) next = folder.spaceId;
 }
 if (chain.length) {
  result.status = "resolved";
  const leaf = chain[chain.length - 1]!;
  const space = chain.find(folder => folder.kind === "space" || folder.id === leaf.spaceId);
  result.spaceId = space?.id ?? leaf.spaceId;
  result.spaceName = space?.name ?? null;
  result.folderName = leaf.name;
  result.folderPath = chain.map(folder => folder.name);
 }
 result.fingerprint = JSON.stringify([result.status, ...chain.map(folder => [folder.id, folder.name, folder.parentFolderId, folder.spaceId])]);
 return result;
}

export function matchesOrganizationFilters(recording: PocketRecordingMetadata, settings: Pick<PocketSyncSettings, "includeFolderIds" | "excludeFolderIds" | "includeSpaceIds" | "excludeSpaceIds">): boolean {
 const split = (value: string): string[] => value.split(",").map(part => part.trim()).filter(Boolean);
 const folder = recording.organization?.folderId ?? recording.folderId;
 const space = recording.organization?.spaceId ?? recording.spaceId;
 const includesFolder = split(settings.includeFolderIds);
 const includesSpace = split(settings.includeSpaceIds);
 // An unresolved location cannot safely satisfy exclusions either.
 if (recording.organization?.status === "unknown" && [settings.includeFolderIds, settings.excludeFolderIds, settings.includeSpaceIds, settings.excludeSpaceIds].some(value => value.trim())) return false;
 return (!includesFolder.length || !!folder && includesFolder.includes(folder))
  && (!includesSpace.length || !!space && includesSpace.includes(space))
  && !(folder && split(settings.excludeFolderIds).includes(folder))
  && !(space && split(settings.excludeSpaceIds).includes(space));
}
