import { App } from "obsidian";

import { AUTO_SYNC_FAILURE_THRESHOLD, DEFAULT_FIRST_SYNC_DATE, MAX_PAGE_SIZE, SYNC_SAFETY_LOOKBACK_DAYS } from "../constants";
import { archivePocketNote, upsertPocketNote } from "../notes/upsertNote";
import { buildArchivePath, buildConversationPath, buildDailyHighlightGroupKey, buildDailyHighlightPath } from "../notes/pathStrategy";
import { renderConversationNote } from "../notes/renderConversation";
import { renderDailyHighlightsNote } from "../notes/renderDailyHighlights";
import { PocketApi, PocketApiError } from "../pocket/api";
import { isDailyHighlightRecording, matchesTagFilters, normalizeRecordingDetail, normalizeRecordingListItem } from "../pocket/mappers";
import type {
	NormalizedPocketRecording,
	PocketRecordingListItem,
	PocketSyncSettings,
	PocketTrackedRecord,
	SyncNoteSpec,
	SyncOptions,
	SyncReport,
} from "../types";
import { subtractDays, toPocketDateString } from "../utils/date";
import { SyncStateStore } from "./stateStore";

interface SyncWindow {
	startDate: string;
	endDate: string;
}

export class SyncService {
	private activeSync: Promise<SyncReport> | null = null;

	constructor(
		private readonly app: App,
		private readonly getSettings: () => PocketSyncSettings,
		private readonly stateStore: SyncStateStore,
	) {}

	async testConnection(): Promise<{ tagCount: number }> {
		const settings = this.getSettings();
		const api = new PocketApi(settings);
		const result = await api.testConnection();
		this.stateStore.recordConnectionSuccess(new Date().toISOString());
		await this.stateStore.persist();
		return result;
	}

	async runSync(options: SyncOptions): Promise<SyncReport> {
		if (this.activeSync) {
			return this.activeSync;
		}

		this.activeSync = this.runSyncInternal(options);

		try {
			return await this.activeSync;
		} finally {
			this.activeSync = null;
		}
	}

	shouldPauseAutoSync(settings: PocketSyncSettings): boolean {
		return settings.pauseAutoSyncAfterFailures && this.stateStore.state.consecutiveFailures >= AUTO_SYNC_FAILURE_THRESHOLD;
	}

	private async runSyncInternal(options: SyncOptions): Promise<SyncReport> {
		const settings = this.getSettings();
		const syncStartedAt = new Date().toISOString();
		const dryRun = options.dryRun ?? false;
		const syncWindow = this.computeSyncWindow(settings, options);
		const report: SyncReport = {
			startedAt: syncStartedAt,
			finishedAt: syncStartedAt,
			scope: options.scope,
			reason: options.reason,
			dryRun,
			created: 0,
			updated: 0,
			skipped: 0,
			archived: 0,
			errors: [],
			warnings: [],
			processedIds: [],
			windowStart: syncWindow.startDate,
			windowEnd: syncWindow.endDate,
		};

		this.stateStore.beginSync(syncStartedAt);

		try {
			if (!settings.apiKey.trim()) {
				throw new PocketApiError("Add a Pocket API key in the Pocket Sync settings before running sync.");
			}

			if (!settings.syncConversations && !settings.syncDailyHighlights) {
				report.warnings.push("Both conversation sync and daily highlight sync are disabled.");
				report.finishedAt = new Date().toISOString();
				this.stateStore.completeSync(report);
				await this.stateStore.persist();
				return report;
			}

			const api = new PocketApi(settings);
			await api.testConnection();
			this.stateStore.recordConnectionSuccess(syncStartedAt);

			const rawRecordings = await api.listAllRecordings({
				startDate: syncWindow.startDate,
				endDate: syncWindow.endDate,
				limit: MAX_PAGE_SIZE,
			});

			const listItems = rawRecordings
				.map((item) => normalizeRecordingListItem(item))
				.filter((item): item is PocketRecordingListItem => item !== null);
			const seenIds = new Set<string>();
			const recordsToPersist: PocketTrackedRecord[] = [];
			const hydratedRecordings: NormalizedPocketRecording[] = [];

			for (const listItem of listItems) {
				if (!this.shouldProcessListItem(listItem, settings, options.scope)) {
					continue;
				}

				if (!matchesTagFilters(listItem, settings)) {
					continue;
				}

				seenIds.add(listItem.id);
				const trackedRecord = this.stateStore.getRecord(listItem.id);

				if (!this.shouldFetchDetails(listItem, trackedRecord, settings, options.forceFullScan ?? false)) {
					if (trackedRecord) {
						recordsToPersist.push({
							...trackedRecord,
							lastSeenAt: syncStartedAt,
							archivedAt: null,
						});
					}
					report.skipped += 1;
					continue;
				}

				try {
					const detail = await api.getRecordingDetails(listItem.id, {
						includeTranscript: settings.importTranscriptWhenAvailable && settings.includeTranscript,
						includeSummarizations: true,
					});
					const normalized = normalizeRecordingDetail(detail, listItem, settings);

					if (!normalized) {
						report.warnings.push(`Skipped Pocket recording ${listItem.id} because the details payload was incomplete.`);
						report.skipped += 1;
						continue;
					}

					if (settings.onlyImportCompletedSummaries && normalized.summary?.processingStatus !== "completed") {
						report.skipped += 1;
						report.warnings.push(`Skipped "${normalized.title}" because Pocket has not finished the summary yet.`);
						continue;
					}

					if (!settings.importTranscriptWhenAvailable) {
						normalized.transcript = null;
					}

					hydratedRecordings.push(normalized);
				} catch (error) {
					const message = this.describeError(error);
					report.errors.push(`Failed to fetch Pocket details for "${listItem.title}": ${message}`);
				}
			}

			const noteSpecs = this.buildNoteSpecs(hydratedRecordings, settings);
			for (const noteSpec of noteSpecs) {
				const primaryRecording = noteSpec.recordings[0];
				if (!primaryRecording) {
					continue;
				}

				const rendered = noteSpec.kind === "conversation"
					? renderConversationNote(primaryRecording, settings, syncStartedAt)
					: renderDailyHighlightsNote(noteSpec.recordings, settings, syncStartedAt);
				const result = await upsertPocketNote({
					app: this.app,
					targetPath: noteSpec.targetPath,
					previousPath: noteSpec.previousPath,
					rendered,
					noteManagementMode: settings.noteManagementMode,
					includeFrontmatter: settings.includeFrontmatter,
					dryRun,
				});

				if (result.action === "created") {
					report.created += 1;
				} else if (result.action === "updated") {
					report.updated += 1;
				} else {
					report.skipped += 1;
				}

				for (const recording of noteSpec.recordings) {
					report.processedIds.push(recording.id);
					recordsToPersist.push({
						id: recording.id,
						kind: recording.kind,
						notePath: result.finalPath,
						groupKey: noteSpec.groupKey,
						recordingAt: recording.recordingAt,
						lastSeenAt: syncStartedAt,
						lastSourceUpdatedAt: recording.updatedAt,
						archivedAt: null,
					});
				}
			}

			if (settings.deletedRecordingBehavior === "archive") {
				const archiveCount = await this.archiveMissingNotes({
					api,
					dryRun,
					report,
					seenIds,
					settings,
					startedAt: syncStartedAt,
					syncWindow,
					scope: options.scope,
				});
				report.archived += archiveCount;
			}

			this.stateStore.upsertRecords(recordsToPersist);
			report.finishedAt = new Date().toISOString();
			this.stateStore.completeSync(report);
			await this.stateStore.persist();
			return report;
		} catch (error) {
			const message = this.describeError(error);
			report.errors.push(message);
			report.finishedAt = new Date().toISOString();
			this.stateStore.failSync(message);
			this.stateStore.state.lastSyncReport = report;
			await this.stateStore.persist();
			return report;
		}
	}

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
			`- Sync daily highlights: ${settings.syncDailyHighlights}`,
			`- Daily highlights tag: ${settings.dailyHighlightsTag}`,
			`- Base folder: ${settings.baseFolder}`,
			`- Conversation folder: ${settings.conversationFolder}`,
			`- Daily highlights folder: ${settings.dailyHighlightsFolder}`,
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

	private async archiveMissingNotes(params: {
		api: PocketApi;
		dryRun: boolean;
		report: SyncReport;
		seenIds: Set<string>;
		settings: PocketSyncSettings;
		startedAt: string;
		syncWindow: SyncWindow;
		scope: SyncOptions["scope"];
	}): Promise<number> {
		const missingByPath = new Map<string, PocketTrackedRecord[]>();
		const windowStart = Date.parse(`${params.syncWindow.startDate}T00:00:00.000Z`);

		for (const trackedRecord of this.stateStore.getTrackedRecords()) {
			if (params.seenIds.has(trackedRecord.id) || trackedRecord.archivedAt) {
				continue;
			}

			if (!this.scopeMatchesKind(params.scope, trackedRecord.kind)) {
				continue;
			}

			if (Date.parse(trackedRecord.recordingAt) < windowStart) {
				continue;
			}

			const groupedRecords = missingByPath.get(trackedRecord.notePath) ?? [];
			groupedRecords.push(trackedRecord);
			missingByPath.set(trackedRecord.notePath, groupedRecords);
		}

		let archivedCount = 0;

		for (const [notePath, records] of missingByPath.entries()) {
			if (this.stateStore.getRecordsForPath(notePath).some((record) => params.seenIds.has(record.id))) {
				continue;
			}

			let allMissing = true;
			for (const record of records) {
				try {
					await params.api.getRecordingDetails(record.id, {
						includeTranscript: false,
						includeSummarizations: false,
					});
					allMissing = false;
					break;
				} catch (error) {
					if (!(error instanceof PocketApiError) || error.status !== 404) {
						allMissing = false;
						break;
					}
				}
			}

			if (!allMissing) {
				continue;
			}

			const archivePath = buildArchivePath(notePath, params.settings);
			const archived = await archivePocketNote(this.app, notePath, archivePath, params.dryRun);
			if (!archived) {
				continue;
			}

			archivedCount += 1;
			this.stateStore.markArchived(
				records.map((record) => record.id),
				params.startedAt,
				archivePath,
			);
		}

		return archivedCount;
	}

	private buildNoteSpecs(recordings: NormalizedPocketRecording[], settings: PocketSyncSettings): SyncNoteSpec[] {
		const noteSpecs: SyncNoteSpec[] = [];
		const highlightGroups = new Map<string, NormalizedPocketRecording[]>();

		for (const recording of recordings) {
			if (recording.kind === "conversation") {
				const trackedRecord = this.stateStore.getRecord(recording.id);
				noteSpecs.push({
					kind: "conversation",
					targetPath: buildConversationPath(this.app.vault, recording, settings, trackedRecord),
					previousPath: trackedRecord?.notePath ?? null,
					groupKey: recording.id,
					trackingIds: [recording.id],
					recordings: [recording],
				});
				continue;
			}

			const groupKey = buildDailyHighlightGroupKey(recording, settings.dailyHighlightMode, settings.highlightDateSource);
			const group = highlightGroups.get(groupKey) ?? [];
			group.push(recording);
			highlightGroups.set(groupKey, group);
		}

		for (const [groupKey, groupedRecordings] of highlightGroups.entries()) {
			const trackedRecord =
				groupedRecordings
					.map((recording) => this.stateStore.getRecord(recording.id))
					.find((record): record is PocketTrackedRecord => record !== null) ?? null;
			noteSpecs.push({
				kind: "daily-highlight",
				targetPath: buildDailyHighlightPath(this.app.vault, groupedRecordings, settings, trackedRecord),
				previousPath: trackedRecord?.notePath ?? null,
				groupKey,
				trackingIds: groupedRecordings.map((recording) => recording.id),
				recordings: groupedRecordings,
			});
		}

		return noteSpecs;
	}

	private shouldProcessListItem(
		recording: PocketRecordingListItem,
		settings: PocketSyncSettings,
		scope: SyncOptions["scope"],
	): boolean {
		const isHighlight = isDailyHighlightRecording(recording, settings.dailyHighlightsTag);
		if (isHighlight) {
			return settings.syncDailyHighlights && this.scopeMatchesKind(scope, "daily-highlight");
		}

		return settings.syncConversations && this.scopeMatchesKind(scope, "conversation");
	}

	private shouldFetchDetails(
		recording: PocketRecordingListItem,
		trackedRecord: PocketTrackedRecord | null,
		settings: PocketSyncSettings,
		forceFullScan: boolean,
	): boolean {
		if (forceFullScan || !trackedRecord) {
			return true;
		}

		if (trackedRecord.archivedAt) {
			return true;
		}

		if (!settings.updateExistingNotes) {
			return false;
		}

		if (trackedRecord.lastSourceUpdatedAt !== recording.updatedAt) {
			return true;
		}

		if (!this.app.vault.getAbstractFileByPath(trackedRecord.notePath)) {
			return true;
		}

		return false;
	}

	private computeSyncWindow(settings: PocketSyncSettings, options: SyncOptions): SyncWindow {
		const now = new Date();

		if (options.backfillDays != null) {
			const backfillDays = Math.max(1, Math.min(options.backfillDays, settings.maxDaysPerSyncRun));
			return {
				startDate: toPocketDateString(subtractDays(now, backfillDays)),
				endDate: toPocketDateString(now),
			};
		}

		if (options.forceFullScan) {
			return {
				startDate: DEFAULT_FIRST_SYNC_DATE,
				endDate: toPocketDateString(now),
			};
		}

		if (!this.stateStore.state.lastSuccessfulSyncAt) {
			return {
				startDate: DEFAULT_FIRST_SYNC_DATE,
				endDate: toPocketDateString(now),
			};
		}

		const incrementalStart = subtractDays(new Date(this.stateStore.state.lastSuccessfulSyncAt), SYNC_SAFETY_LOOKBACK_DAYS);
		const maxWindowStart = subtractDays(now, settings.maxDaysPerSyncRun);
		const startDate = incrementalStart < maxWindowStart ? maxWindowStart : incrementalStart;

		return {
			startDate: toPocketDateString(startDate),
			endDate: toPocketDateString(now),
		};
	}

	private scopeMatchesKind(scope: SyncOptions["scope"], kind: NormalizedPocketRecording["kind"]): boolean {
		if (scope === "all") {
			return true;
		}

		if (scope === "conversations") {
			return kind === "conversation";
		}

		return kind === "daily-highlight";
	}

	private describeError(error: unknown): string {
		if (error instanceof PocketApiError) {
			return error.message;
		}

		if (error instanceof Error) {
			return error.message;
		}

		return "Unknown Pocket Sync error.";
	}
}

