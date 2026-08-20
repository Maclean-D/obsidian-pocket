import type PocketSyncPlugin from "../main";
import type { PocketTrackedRecord, SyncReport } from "../types";

interface TrackedPathRedirect {
	recordId: string;
	oldPath: string;
	newPath: string;
	isFolder: boolean;
}

export class SyncStateStore {
	private readonly pathRedirects: TrackedPathRedirect[] = [];

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

	updateSyncMessage(message: string): void {
		this.state.lastSyncMessage = message;
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
			this.state.records[record.id] = this.applyPathRedirects(record);
		}
	}

	replaceTrackedPath(oldPath: string, newPath: string, isFolder: boolean): boolean {
		let changed = false;
		for (const record of this.getTrackedRecords()) {
			if (this.replaceTrackedPathForRecord(record.id, oldPath, newPath, isFolder)) {
				changed = true;
			}
		}
		return changed;
	}

	replaceTrackedPathForRecord(recordId: string, oldPath: string, newPath: string, isFolder: boolean): boolean {
		const record = this.state.records[recordId];
		if (!record || !replaceRecordPaths(record, oldPath, newPath, isFolder)) {
			return false;
		}

		this.pathRedirects.push({ recordId, oldPath, newPath, isFolder });
		return true;
	}

	markArchived(
		recordIds: string[],
		archivedAt: string,
		archivePath: string,
		artifactPaths: string[] = [archivePath],
		sourcePaths: string[] = [],
	): void {
		for (const recordId of recordIds) {
			const existing = this.state.records[recordId];
			if (!existing) {
				continue;
			}

			existing.archivedAt = archivedAt;
			if (artifactPaths.length === 0) {
				continue;
			}
			existing.notePath = archivePath;
			existing.artifactPaths = artifactPaths;
			if (existing.kind === "conversation" && existing.activeOutputFormat === "single-note") {
				existing.singleNotePath = archivePath;
			} else if (existing.kind === "conversation" && existing.separateFilePaths) {
				for (const [artifactKind, path] of Object.entries(existing.separateFilePaths)) {
					const pathIndex = sourcePaths.indexOf(path);
					if (pathIndex >= 0 && artifactPaths[pathIndex]) {
						existing.separateFilePaths[artifactKind as keyof typeof existing.separateFilePaths] = artifactPaths[pathIndex];
					}
				}
			}
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

	private applyPathRedirects(record: PocketTrackedRecord): PocketTrackedRecord {
		for (const redirect of this.pathRedirects) {
			if (redirect.recordId === record.id) {
				replaceRecordPaths(record, redirect.oldPath, redirect.newPath, redirect.isFolder);
			}
		}
		return record;
	}
}

function replaceRecordPaths(record: PocketTrackedRecord, oldPath: string, newPath: string, isFolder: boolean): boolean {
	let changed = false;
	const replace = (path: string): string => {
		const nextPath = replacePath(path, oldPath, newPath, isFolder);
		changed = changed || nextPath !== path;
		return nextPath;
	};

	record.notePath = replace(record.notePath);
	record.artifactPaths = record.artifactPaths.map(replace);
	if (record.singleNotePath) {
		record.singleNotePath = replace(record.singleNotePath);
	}
	if (record.separateFilePaths) {
		for (const [artifactKind, path] of Object.entries(record.separateFilePaths)) {
			if (path) {
				record.separateFilePaths[artifactKind as keyof typeof record.separateFilePaths] = replace(path);
			}
		}
	}
	return changed;
}

function replacePath(path: string, oldPath: string, newPath: string, isFolder: boolean): string {
	if (path === oldPath) {
		return newPath;
	}
	if (isFolder && path.startsWith(`${oldPath}/`)) {
		return `${newPath}${path.slice(oldPath.length)}`;
	}
	return path;
}
