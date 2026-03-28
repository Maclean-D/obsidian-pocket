import type PocketSyncPlugin from "../main";
import type { PocketTrackedRecord, SyncReport } from "../types";

export class SyncStateStore {
	constructor(private readonly plugin: PocketSyncPlugin) {}

	get state() {
		return this.plugin.syncState;
	}

	getRecord(recordingId: string): PocketTrackedRecord | null {
		return this.state.records[recordingId] ?? null;
	}

	getRecordsForPath(notePath: string): PocketTrackedRecord[] {
		return Object.values(this.state.records).filter((record) => record.notePath === notePath);
	}

	getTrackedRecords(): PocketTrackedRecord[] {
		return Object.values(this.state.records);
	}

	beginSync(startedAt: string): void {
		this.state.lastAttemptedSyncAt = startedAt;
		this.state.lastSyncStatus = "running";
		this.state.lastSyncMessage = "Pocket sync is running.";
	}

	recordConnectionSuccess(at: string): void {
		this.state.lastConnectionSucceededAt = at;
	}

	completeSync(report: SyncReport): void {
		this.state.lastSyncReport = report;
		this.state.lastSyncStatus = report.errors.length > 0 ? "error" : "success";
		this.state.lastSyncMessage =
			report.errors.length > 0
				? report.errors[0] ?? "Pocket sync failed."
				: `Synced ${report.created + report.updated} Pocket note(s).`;

		if (report.errors.length === 0) {
			this.state.lastSuccessfulSyncAt = report.finishedAt;
			this.state.consecutiveFailures = 0;
		} else {
			this.state.consecutiveFailures += 1;
		}
	}

	failSync(message: string): void {
		this.state.lastSyncStatus = "error";
		this.state.lastSyncMessage = message;
		this.state.consecutiveFailures += 1;
	}

	upsertRecords(records: PocketTrackedRecord[]): void {
		for (const record of records) {
			this.state.records[record.id] = record;
		}
	}

	markArchived(recordIds: string[], archivedAt: string, archivePath: string): void {
		for (const recordId of recordIds) {
			const existing = this.state.records[recordId];
			if (!existing) {
				continue;
			}

			existing.archivedAt = archivedAt;
			existing.notePath = archivePath;
		}
	}

	markDryRunNextSync(enabled: boolean): void {
		this.state.dryRunNextSync = enabled;
	}

	consumeDryRunNextSync(): boolean {
		const current = this.state.dryRunNextSync;
		this.state.dryRunNextSync = false;
		return current;
	}

	resetCursor(): void {
		this.state.lastAttemptedSyncAt = null;
		this.state.lastSuccessfulSyncAt = null;
		this.state.lastSyncStatus = "idle";
		this.state.lastSyncMessage = "Pocket Sync cursor reset.";
		this.state.consecutiveFailures = 0;
	}

	async persist(): Promise<void> {
		await this.plugin.savePluginData();
	}
}

