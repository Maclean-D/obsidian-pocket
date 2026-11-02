import { artifactVocabulary, isArtifactFilename, trackedArtifactKinds } from "../notes/artifactLanguage";
import { App, TFile } from "obsidian";
import { AUTO_SYNC_FAILURE_THRESHOLD, DEFAULT_FIRST_SYNC_DATE, MAX_PAGE_SIZE, MANAGED_BLOCK_START, MANAGED_BLOCK_END } from "../constants";
import { PathReservations, safePath } from "../core/paths";
import { archivePocketNote, upsertPocketNote, buildFinalContent, type UpsertPocketNoteParams } from "../notes/upsertNote";
import { buildArchivePath, buildConversationArtifactPath, buildInsightGroupKey, buildInsightPath, findTrackedArtifactPath } from "../notes/pathStrategy";
import { renderConversationArtifactBody, renderConversationArtifactNote } from "../notes/renderConversation";
import { buildArtifactNavigation, updateManagedNavigation, updateMirrorNavigation } from "../notes/navigation";
import { renderInsightNote } from "../notes/renderInsight";
import { renderFolderIndex, type FolderIndexEntry } from "../notes/renderFolderIndex";
import { PocketApi, PocketApiError } from "../pocket/api";
import { isInsightRecording, matchesTagFilters, matchesOrganizationFilters, normalizeRecordingDetail, normalizeRecordingListItem, resolveRecordingOrganization } from "../pocket/mappers";
import type { ConversationArtifactKind, NormalizedPocketRecording, PocketRecordingListItem, PocketSyncSettings, PocketTrackedRecord, SyncNoteSpec, SyncOptions, SyncReport } from "../types";
import { SyncStateStore } from "./stateStore";
import { beginOperation, finishOperation, recoverOperations, type JournalOperation } from "./journal";

const ARTIFACTS: ConversationArtifactKind[] = ["summary", "transcript", "action-items", "mindmap"];
interface PlannedNote {
	spec: SyncNoteSpec;
	params: UpsertPocketNoteParams;
	metadataOnly: boolean;
	previousContent: string;
	expectedContent: string;
}
interface ArchivePlan { source: string; target: string; ids: string[] }

export class SyncService {
	private activeSync: Promise<SyncReport> | null = null;
	private ownedRename = false;
	constructor(private readonly app: App, private readonly getSettings: () => PocketSyncSettings, private readonly stateStore: SyncStateStore) {}

	async testConnection(): Promise<{ tagCount: number }> {
		const result = await new PocketApi(this.getSettings()).testConnection();
		this.stateStore.recordConnectionSuccess(new Date().toISOString());
		await this.stateStore.persist();
		return result;
	}

	async runSync(options: SyncOptions): Promise<SyncReport> {
		if (this.activeSync) return this.activeSync;
		this.activeSync = this.runSyncInternal(options);
		try { return await this.activeSync; } finally { this.activeSync = null; }
	}

	shouldPauseAutoSync(settings: PocketSyncSettings): boolean {
		return settings.pauseAutoSyncAfterFailures && this.stateStore.state.consecutiveFailures >= AUTO_SYNC_FAILURE_THRESHOLD;
	}

	async handleRename(oldPath: string, newPath: string): Promise<void> {
		if (this.ownedRename) return;
		this.stateStore.handleRename(oldPath, newPath, this.getSettings().localMovePolicy === "keep-local");
		await this.stateStore.persist();
	}

	private async runSyncInternal(options: SyncOptions): Promise<SyncReport> {
		const settings = { ...this.getSettings() };
		const started = new Date().toISOString();
		const dryRun = options.dryRun ?? false;
		const report: SyncReport = {
			startedAt: started, finishedAt: started, scope: options.scope, reason: options.reason, dryRun,
			created: 0, updated: 0, skipped: 0, archived: 0, moved: 0, propertiesUpdated: 0, pending: 0, conflicts: 0,
			errors: [], warnings: [], processedIds: [], plan: [], windowStart: DEFAULT_FIRST_SYNC_DATE, windowEnd: started.slice(0, 10),
		};
		try {
			safePath(settings.baseFolder);
			if (!settings.apiKey.trim()) throw new Error("Add a Pocket API key before syncing.");
			if (!settings.syncConversations && !settings.syncInsights) {
				report.warnings.push("Both conversation sync and insight sync are disabled.");
				return report;
			}
			const api = new PocketApi(settings);
			// Fetch complete catalog and tree before any mutation, even on organization-only runs.
			const folders = await api.listFolders();
			const raw = await api.listAllRecordings({ limit: MAX_PAGE_SIZE });
			const all = raw.map(normalizeRecordingListItem);
			if (all.some((item) => item === null)) throw new Error("Pocket catalog contains invalid entries; no notes were changed.");
			const list = all as PocketRecordingListItem[];
			if (new Set(list.map((item) => item.id)).size !== list.length) throw new Error("Pocket catalog contains duplicate IDs; retry sync.");
			if (dryRun && (this.stateStore.state.pendingOperations?.length ?? 0) > 0) {
				report.warnings.push("An interrupted sync needs recovery. Preview is blocked until a real sync recovers it; state was not changed.");
				return report;
			}
			if (!dryRun) await recoverOperations(this.app, this.stateStore);
			const seenIds = new Set(list.map((item) => item.id));
			const recordings: NormalizedPocketRecording[] = [];
			const metadataOnlyIds = new Set<string>();
			const fetchedIds = new Set<string>();
			for (const item of list) {
				const kind = isInsightRecording(item, settings.insightsTag) ? "insight" : "conversation";
				if (!this.scopeMatches(options.scope, kind) || !(kind === "insight" ? settings.syncInsights : settings.syncConversations)) continue;
				let organization = resolveRecordingOrganization(item.folderId, folders);
				const priorOrganization = this.stateStore.getRecord(item.id)?.organization;
				if (settings.organizationMode !== "pocket" && organization.status === "unknown" && priorOrganization) {
					report.warnings.push(`Unknown folder for ${item.id}; preserving last known organization.`);
					organization = priorOrganization;
				}
				const catalogRecording: NormalizedPocketRecording = { ...item, kind, transcript: null, summary: null, organization };
				if (!matchesTagFilters(item, settings) || !matchesOrganizationFilters(catalogRecording, settings)) continue;
				if (settings.organizationMode === "pocket" && organization.status === "unknown") {
					report.warnings.push(`Unknown folder for ${item.id}; existing files and metadata are preserved.`);
					report.conflicts = (report.conflicts ?? 0) + 1;
					continue;
				}
				const tracked = this.stateStore.getRecord(item.id);
				let recording: NormalizedPocketRecording = { ...(tracked?.cachedRecording ?? catalogRecording), ...item, kind, organization, metadataProvenance: { ...tracked?.cachedRecording?.metadataProvenance, ...item.metadataProvenance } };
				const fetch = !options.organizationOnly && this.shouldFetch(item, tracked, settings, options);
				if (fetch) {
					try {
						const detail = await api.getRecordingDetails(item.id, { includeTranscript: settings.importTranscriptWhenAvailable && settings.includeTranscript, includeSummarizations: true });
						const normalized = normalizeRecordingDetail(detail, item, settings);
						if (!normalized) throw new Error("Incomplete recording details.");
						recording = { ...normalized, title: item.title, folderId: item.folderId, organization };
						fetchedIds.add(item.id);
					} catch (error) {
						report.errors.push(`Could not fetch ${item.id}: ${this.describeError(error)}`);
						continue;
					}
				} else {
					metadataOnlyIds.add(item.id);
				}
				if (settings.onlyImportCompletedSummaries && recording.summary?.processingStatus !== "completed") {
					report.pending = (report.pending ?? 0) + 1;
					if (tracked) metadataOnlyIds.add(item.id);
				}
				recordings.push(recording);
			}
			const reservations = new PathReservations(this.app.vault);
			const specs = this.buildNoteSpecs(recordings, settings, metadataOnlyIds, reservations);
			const navigationById = new Map<string, Partial<Record<ConversationArtifactKind, string>>>();
			for (const spec of specs) {
				if (spec.kind !== "conversation") continue;
				const id = spec.trackingIds[0];
				if (!id) continue;
				navigationById.set(id, { ...navigationById.get(id), [spec.artifactKind]: spec.targetPath });
			}
			const plans: PlannedNote[] = [];
			for (const spec of specs) {
				const recording = spec.recordings[0];
				if (!recording) continue;
				const metadataOnly = spec.recordings.every((r) => metadataOnlyIds.has(r.id));
				const rendered = spec.kind === "conversation" ? renderConversationArtifactNote(recording, settings, started, spec.artifactKind as ConversationArtifactKind, navigationById.get(recording.id)) : renderInsightNote(spec.recordings, settings, started);
				if (metadataOnly && !this.stateStore.getRecord(recording.id)?.cachedRecording) {
					// Legacy state has no content metadata; don't invent pending status or erase detail-only properties.
					delete rendered.frontmatter.pocket_summary_status;
				}
				const params: UpsertPocketNoteParams = { app: this.app, targetPath: spec.targetPath, previousPath: spec.previousPath, rendered,
					noteManagementMode: settings.noteManagementMode, includeFrontmatter: settings.includeFrontmatter || settings.organizationMode === "pocket", dryRun: true,
					metadataOnly, previousNavigation: this.stateStore.getRecord(recording.id)?.mirrorNavigation, baselineBody: this.stateStore.getRecord(recording.id)?.generatedBodies?.[spec.artifactKind],
					navigation: spec.artifactKind === "summary" ? buildArtifactNavigation(navigationById.get(recording.id) ?? {}, settings.artifactLanguage, settings.noteManagementMode !== "mirror") : undefined };
                if (metadataOnly && settings.noteManagementMode === "mirror" && spec.artifactKind === "summary" && params.previousNavigation === undefined) {
                    report.warnings.push(`Mirror navigation provenance unknown for ${spec.targetPath}; navigation was preserved. A full content refresh is required to establish ownership.`);
                }
				// Full preflight: read and merge every file before applying any of this plan.
				const preview = await upsertPocketNote(params);
				const source = spec.previousPath ? this.app.vault.getAbstractFileByPath(spec.previousPath) : null;
				const previousContent = source instanceof TFile ? await this.app.vault.read(source) : "";
				const expectedContent = buildFinalContent(previousContent, rendered, params.noteManagementMode, params.includeFrontmatter, metadataOnly, params.baselineBody, params.navigation, params.previousNavigation);
                if (metadataOnly && settings.noteManagementMode === "mirror" && params.previousNavigation !== undefined && params.previousNavigation !== params.navigation && expectedContent === buildFinalContent(previousContent, rendered, params.noteManagementMode, params.includeFrontmatter, true)) {
                    report.warnings.push(`Mirror navigation does not match its generated baseline for ${spec.targetPath}; content was preserved. Review or refresh content before repairing navigation.`);
                    params.previousNavigation = undefined;
                }
				plans.push({ spec, params, metadataOnly, previousContent, expectedContent });
				report.plan?.push({ action: preview.moved ? "move" : preview.action === "updated" && metadataOnly ? "properties" : preview.action, recordingIds: spec.trackingIds, sourcePath: spec.previousPath, targetPath: spec.targetPath });
				if (preview.preservedLegacy) report.warnings.push(`Preserved pre-migration content in ${spec.targetPath}; review it before removing it manually.`);
			}
			const archives = settings.deletedRecordingBehavior === "archive" ? await this.planArchives(api, seenIds, settings, options, reservations, report) : [];
			const projected = new Map(this.stateStore.getTrackedRecords().map((record) => [record.id, { ...record, artifactPaths: [...record.artifactPaths] }]));
			if (!dryRun) this.stateStore.beginSync(started);
			for (const plan of plans) {
				const nextRecords = plan.spec.recordings.map((recording) => {
                    const next = this.nextRecord(projected.get(recording.id) ?? null, recording, plan.spec, started);
                    if (settings.noteManagementMode === "mirror" && plan.spec.artifactKind === "summary") {
                        if (!plan.metadataOnly || plan.params.previousNavigation !== undefined) next.mirrorNavigation = plan.params.navigation;
                    } else if (plan.spec.artifactKind === "summary" && !plan.metadataOnly) delete next.mirrorNavigation;
                    return next;
                });
				const operation: JournalOperation = { id: `${started}:${plan.spec.targetPath}`, recordingIds: plan.spec.trackingIds, sourcePath: plan.spec.previousPath, targetPath: plan.spec.targetPath, kind: "write", nextRecords, expectedContent: plan.expectedContent, previousContent: plan.previousContent };
				if (!dryRun) await beginOperation(this.stateStore, operation);
				this.ownedRename = true;
				let result;
				try { result = await upsertPocketNote({ ...plan.params, dryRun }); } finally { this.ownedRename = false; }
				if (result.action === "created") report.created += 1;
				else if (result.action === "updated") report.updated += 1;
				else report.skipped += 1;
				if (result.moved) report.moved = (report.moved ?? 0) + 1;
				if (plan.metadataOnly && result.action === "updated") report.propertiesUpdated = (report.propertiesUpdated ?? 0) + 1;
				for (const record of nextRecords) projected.set(record.id, record);
				if (!dryRun) await finishOperation(this.stateStore, operation);
			}
			if (!dryRun && settings.noteManagementMode !== "mirror") {
				for (const plan of plans.filter((entry) => entry.spec.artifactKind === "summary")) {
					const file = this.app.vault.getAbstractFileByPath(plan.spec.targetPath);
					if (!(file instanceof TFile)) throw new Error(`Summary disappeared: ${plan.spec.targetPath}`);
					const previousContent = await this.app.vault.read(file);
					const expectedContent = buildFinalContent(previousContent, plan.params.rendered, settings.noteManagementMode, plan.params.includeFrontmatter, true, undefined, plan.params.navigation);
					if (previousContent === expectedContent) continue;
					const repair: JournalOperation = { id: `${started}:navigation:${file.path}`, recordingIds: plan.spec.trackingIds, sourcePath: file.path, targetPath: file.path, kind: "write", previousContent, expectedContent };
					await beginOperation(this.stateStore, repair);
					await upsertPocketNote({ ...plan.params, previousPath: plan.spec.targetPath, metadataOnly: true, dryRun: false });
					await finishOperation(this.stateStore, repair);
				}
			}
			for (const recording of recordings) {
				const record = projected.get(recording.id) ?? this.catalogRecord(recording, started);
				record.lastSeenAt = started;
				record.organization = recording.organization;
				record.recordingTitle = recording.title;
				if (record.generatedBodies?.summary && navigationById.has(record.id)) {
					const navigation = buildArtifactNavigation(navigationById.get(record.id) ?? {}, settings.artifactLanguage, settings.noteManagementMode !== "mirror");
                    const oldNavigation = plans.find(plan => plan.spec.artifactKind === "summary" && plan.spec.trackingIds.includes(record.id))?.params.previousNavigation;
                    record.generatedBodies = { ...record.generatedBodies, summary: settings.noteManagementMode === "mirror"
                        ? updateMirrorNavigation(record.generatedBodies.summary, navigation, oldNavigation)
                        : updateManagedNavigation(`${MANAGED_BLOCK_START}\n${record.generatedBodies.summary}\n${MANAGED_BLOCK_END}`, navigation).slice(MANAGED_BLOCK_START.length, -MANAGED_BLOCK_END.length).trim() };
				}
				if (fetchedIds.has(recording.id) && !metadataOnlyIds.has(recording.id)) {
					record.cachedRecording = recording;
					record.lastSourceUpdatedAt = recording.updatedAt;
					record.lastContentSyncedAt = started;
					const bodies = { ...record.generatedBodies };
					for (const plan of plans.filter((p) => p.spec.trackingIds.includes(record.id))) bodies[plan.spec.artifactKind] = plan.params.rendered.body;
					record.generatedBodies = bodies;
				}
				projected.set(record.id, record);
				report.processedIds.push(record.id);
			}
			for (const archive of archives) {
				const nextRecords = archive.ids.map((id) => projected.get(id)).filter((r): r is PocketTrackedRecord => Boolean(r)).map((r) => ({ ...r, notePath: r.notePath === archive.source ? archive.target : r.notePath, artifactPaths: r.artifactPaths.map((p) => p === archive.source ? archive.target : p), artifactPathsByKind: Object.fromEntries(Object.entries(trackedArtifactKinds(r)).map(([kind, path]) => [kind, path === archive.source ? archive.target : path])), archivedAt: started }));
				const archiveSource = this.app.vault.getAbstractFileByPath(archive.source);
				if (!(archiveSource instanceof TFile)) throw new Error(`Archive source disappeared: ${archive.source}`);
				const operation: JournalOperation = { id: `${started}:archive:${archive.target}`, recordingIds: archive.ids, sourcePath: archive.source, targetPath: archive.target, kind: "archive", nextRecords, previousContent: await this.app.vault.read(archiveSource) };
				if (!dryRun) await beginOperation(this.stateStore, operation);
				this.ownedRename = true;
				try { if (await archivePocketNote(this.app, archive.source, archive.target, dryRun)) report.archived += 1; } finally { this.ownedRename = false; }
				for (const record of nextRecords) projected.set(record.id, record);
				if (!dryRun) await finishOperation(this.stateStore, operation);
			}
			if (!dryRun) {
				this.stateStore.upsertRecords([...projected.values()]);
				await this.stateStore.persist();
			}
			if (settings.generateFolderIndex && report.errors.length === 0 && report.conflicts === 0) await this.writeIndex([...projected.values()], settings, report, dryRun);
		} catch (error) {
			report.errors.push(this.describeError(error));
		}
		report.finishedAt = new Date().toISOString();
		if (!dryRun) {
			this.stateStore.completeSync(report);
			await this.stateStore.persist();
		}
		return report;
	}

	private buildNoteSpecs(recordings: NormalizedPocketRecording[], settings: PocketSyncSettings, metadataOnly: Set<string>, reservations: PathReservations): SyncNoteSpec[] {
		const specs: SyncNoteSpec[] = [];
		const groups = new Map<string, NormalizedPocketRecording[]>();
		for (const recording of [...recordings].sort((a, b) => a.id.localeCompare(b.id))) {
			const tracked = this.stateStore.getRecord(recording.id);
			if (recording.kind === "insight") {
				const key = buildInsightGroupKey(recording, settings.insightMode, settings.insightDateSource, settings.timeZone);
				groups.set(key, [...(groups.get(key) ?? []), recording]);
				continue;
			}
			const artifacts = metadataOnly.has(recording.id) ? ARTIFACTS.filter((kind) => Boolean(findTrackedArtifactPath(tracked, kind))) : ARTIFACTS.filter((kind) => renderConversationArtifactBody(recording, settings, kind).trim());
			if (!artifacts.length) continue;
			const first = artifacts[0] as ConversationArtifactKind;
			const desired = buildConversationArtifactPath(this.app.vault, recording, settings, first, tracked);
			const parent = desired.split("/").slice(0, -1).join("/");
			const oldParent = tracked?.notePath ? tracked.notePath.slice(0, tracked.notePath.lastIndexOf("/")) : null;
			// Reuse empty previous organization folders and partially migrated folders.
            // Individual artifacts still reserve their destination against foreign files.
            const ownedPaths = new Set(tracked?.artifactPaths ?? []);
            const reusable = tracked && this.app.vault.getAllLoadedFiles().filter(file => file instanceof TFile && file.path.startsWith(`${parent}/`)).every(file => ownedPaths.has(file.path));
            const folder = parent ? reservations.reserve(parent, recording.id, reusable ? parent : oldParent) : "";
			for (const artifact of artifacts) {
				const previousPath = findTrackedArtifactPath(tracked, artifact);
				// Keep manually pinned artifacts at their own paths, including split folders.
				const artifactFolder = tracked?.pinnedLocalPath && previousPath ? previousPath.split("/").slice(0, -1).join("/") : folder;
                const filename = artifactVocabulary(settings.artifactLanguage).filenames[artifact];
                const customPinnedName = tracked?.pinnedLocalPath && previousPath && !isArtifactFilename(previousPath, artifact);
                const desiredPath = customPinnedName ? previousPath : `${artifactFolder ? `${artifactFolder}/` : ""}${filename}`;
				const targetPath = reservations.reserve(desiredPath, recording.id, previousPath);
				specs.push({ kind: "conversation", artifactKind: artifact, targetPath, previousPath, groupKey: recording.id, trackingIds: [recording.id], recordings: [recording] });
			}
		}
		for (const [groupKey, group] of groups) {
			const tracked = group.map((r) => this.stateStore.getRecord(r.id)).find(Boolean) ?? null;
			if (group.every((r) => metadataOnly.has(r.id)) && !tracked?.notePath) continue;
			// A daily note must include cached siblings, not just changed recordings.
			if (settings.insightMode === "per-day" && group.some((r) => !r.summary) && group.some((r) => !metadataOnly.has(r.id))) throw new Error(`Refresh content for the complete insight group ${groupKey} before updating it.`);
			const previousPath = tracked?.notePath || null;
			const desired = buildInsightPath(this.app.vault, group, settings, tracked);
			specs.push({ kind: "insight", artifactKind: "insight", targetPath: reservations.reserve(desired, `insight-${groupKey}`, previousPath), previousPath, groupKey, trackingIds: group.map((r) => r.id), recordings: group });
		}
		return specs;
	}

	private catalogRecord(recording: NormalizedPocketRecording, at: string): PocketTrackedRecord {
		return { id: recording.id, kind: recording.kind, notePath: "", artifactPaths: [], groupKey: recording.id, recordingAt: recording.recordingAt, lastSeenAt: at, lastSourceUpdatedAt: "", archivedAt: null, recordingTitle: recording.title, organization: recording.organization };
	}

	private nextRecord(old: PocketTrackedRecord | null, recording: NormalizedPocketRecording, spec: SyncNoteSpec, at: string): PocketTrackedRecord {
		const record = { ...(old ?? this.catalogRecord(recording, at)) };
		const paths = record.artifactPaths.length ? record.artifactPaths : record.notePath ? [record.notePath] : [];
		record.artifactPathsByKind = trackedArtifactKinds(record);
        if (spec.artifactKind !== "insight") record.artifactPathsByKind[spec.artifactKind] = spec.targetPath;
        record.artifactPaths = Array.from(new Set([...paths.filter((path) => path !== spec.previousPath), spec.targetPath]));
        record.notePath = findTrackedArtifactPath(record, "summary") ?? record.artifactPaths[0] ?? spec.targetPath;
		record.groupKey = spec.groupKey;
		record.archivedAt = null;
		return record;
	}

	private shouldFetch(item: PocketRecordingListItem, tracked: PocketTrackedRecord | null, settings: PocketSyncSettings, options: SyncOptions): boolean {
		if (!tracked || !tracked.notePath || tracked.archivedAt || options.forceContentRefresh || options.forceFullScan) return true;
		if ((tracked.artifactPaths.length ? tracked.artifactPaths : [tracked.notePath]).some((path) => !this.app.vault.getAbstractFileByPath(path))) return true;
		if (!settings.updateExistingNotes) return false;
		if (tracked.lastSourceUpdatedAt !== item.updatedAt) return true;
		if (tracked.cachedRecording && tracked.cachedRecording.summary?.processingStatus !== "completed") return true;
		const age = tracked.lastContentSyncedAt ? Date.now() - Date.parse(tracked.lastContentSyncedAt) : Infinity;
		return settings.contentRefreshDays > 0 && age >= settings.contentRefreshDays * 86400000;
	}

	private async planArchives(api: PocketApi, seen: Set<string>, settings: PocketSyncSettings, options: SyncOptions, reservations: PathReservations, report: SyncReport): Promise<ArchivePlan[]> {
		const plans = new Map<string, ArchivePlan>();
		for (const record of this.stateStore.getTrackedRecords()) {
			if (seen.has(record.id) || record.archivedAt || !this.scopeMatches(options.scope, record.kind)) continue;
			if (!(record.kind === "conversation" ? settings.syncConversations : settings.syncInsights)) continue;
			try { await api.getRecordingDetails(record.id, { includeTranscript: false, includeSummarizations: false }); continue; }
			catch (error) { if (!(error instanceof PocketApiError) || error.status !== 404) { report.warnings.push(`Could not confirm deletion of ${record.id}; preserved.`); continue; } }
			for (const source of record.artifactPaths.length ? record.artifactPaths : [record.notePath]) {
				if (!source || !(this.app.vault.getAbstractFileByPath(source) instanceof TFile)) continue;
				// Shared insight notes must remain if any live recording still references them.
				if (this.stateStore.getRecordsForPath(source).some((r) => seen.has(r.id))) continue;
				const prior = plans.get(source);
				if (prior) { prior.ids.push(record.id); continue; }
				const target = reservations.reserve(buildArchivePath(source, settings), `archive-${record.id}`);
				plans.set(source, { source, target, ids: [record.id] });
				report.plan?.push({ action: "archive", recordingIds: [record.id], sourcePath: source, targetPath: target });
			}
		}
		return [...plans.values()];
	}

	private async writeIndex(records: PocketTrackedRecord[], settings: PocketSyncSettings, report: SyncReport, dryRun: boolean): Promise<void> {
		const entries: FolderIndexEntry[] = records.filter((record) => !record.archivedAt && record.kind === "conversation").map((record) => {
			const path = findTrackedArtifactPath(record, "summary");
			const summaryPath = path && (this.app.vault.getAbstractFileByPath(path) instanceof TFile || dryRun && report.plan?.some((p) => p.targetPath === path)) ? path : null;
			return { id: record.id, title: record.recordingTitle ?? record.cachedRecording?.title ?? record.id, recordingAt: record.recordingAt, summaryPath, organization: record.organization, pendingSummary: !summaryPath };
		});
		const indexTitle = artifactVocabulary(settings.artifactLanguage).folderIndex.title;
		const targetPath = safePath(`${settings.baseFolder}/${indexTitle}.md`);
		const existing = this.app.vault.getAbstractFileByPath(targetPath);
		const oldIndex = existing instanceof TFile ? await this.app.vault.read(existing) : "";
		const indexStart = oldIndex.indexOf(MANAGED_BLOCK_START);
		const indexEnd = oldIndex.indexOf(MANAGED_BLOCK_END, indexStart + MANAGED_BLOCK_START.length);
		const baselineBody = indexStart >= 0 && indexEnd > indexStart ? oldIndex.slice(indexStart + MANAGED_BLOCK_START.length, indexEnd).trim() : undefined;
		await upsertPocketNote({ app: this.app, targetPath, previousPath: existing ? targetPath : null, rendered: { title: indexTitle, body: renderFolderIndex(entries, settings.timeZone, settings.artifactLanguage, settings.noteManagementMode !== "mirror"), frontmatter: {} }, noteManagementMode: settings.noteManagementMode === "mirror" ? "mirror" : "managed-block", includeFrontmatter: false, dryRun, baselineBody });
		report.plan?.push({ action: "index", recordingIds: [], sourcePath: existing ? targetPath : null, targetPath });
	}

	private scopeMatches(scope: SyncOptions["scope"], kind: NormalizedPocketRecording["kind"]): boolean {
		return scope === "all" || scope === "conversations" && kind === "conversation" || scope === "insights" && kind === "insight";
	}
	private describeError(error: unknown): string { return error instanceof Error ? error.message : "Unknown Pocket Sync error."; }
	async createDiagnosticReport(): Promise<string> {
		const settings = this.getSettings();
		const report = this.stateStore.state.lastSyncReport;
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const folder = `${settings.baseFolder}/Diagnostics`;
		const path = `${folder}/Pocket Sync diagnostic ${timestamp}.md`;
		const content = [
			"# Pocket Sync diagnostic report",
			"",
			"## Sync status",
			`- Last sync status: ${this.stateStore.state.lastSyncStatus}`,
			`- Last sync message: ${this.stateStore.state.lastSyncMessage}`,
			`- Last attempted sync: ${this.stateStore.state.lastAttemptedSyncAt ?? "Never"}`,
			`- Last successful sync: ${this.stateStore.state.lastSuccessfulSyncAt ?? "Never"}`,
			`- Last connection success: ${this.stateStore.state.lastConnectionSucceededAt ?? "Never"}`,
			`- Consecutive failures: ${this.stateStore.state.consecutiveFailures}`,
			"",
			"## Settings snapshot",
			`- Auto sync enabled: ${settings.autoSyncEnabled}`,
			`- Sync conversations: ${settings.syncConversations}`,
			`- Sync insights: ${settings.syncInsights}`,
			`- Insights tag: ${settings.insightsTag}`,
			`- Base folder: ${settings.baseFolder}`,
			`- Conversation folder: ${settings.conversationFolder}`,
			`- Insights folder: ${settings.insightsFolder}`,
			`- Note mode: ${settings.noteManagementMode}`,
			"",
			"## Last sync report",
			report
				? [
					`- Started at: ${report.startedAt}`,
					`- Finished at: ${report.finishedAt}`,
					`- Scope: ${report.scope}`,
					`- Reason: ${report.reason}`,
					`- Dry run: ${report.dryRun}`,
					`- Created: ${report.created}`,
					`- Updated: ${report.updated}`,
					`- Skipped: ${report.skipped}`,
					`- Archived: ${report.archived}`,
					`- Window start: ${report.windowStart}`,
					`- Window end: ${report.windowEnd}`,
				].join("\n")
				: "- No sync report is available yet.",
			"",
			"## Notes",
			"- API key intentionally omitted.",
		].join("\n");

		await this.app.vault.adapter.mkdir(folder).catch(() => undefined);
		await this.app.vault.create(path, `${content}\n`);
		return path;
	}

}
