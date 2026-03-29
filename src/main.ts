import { Notice, Plugin } from "obsidian";

import { registerCommands } from "./commands";
import type { PluginData, PocketSyncSettings, PocketSyncState, SyncOptions, SyncReport } from "./types";
import { DEFAULT_SETTINGS, DEFAULT_SYNC_STATE } from "./types";
import { PocketSyncSettingTab, sanitizeSettings } from "./settings";
import { SyncStateStore } from "./sync/stateStore";
import { SyncService } from "./sync/syncService";
import { SyncReportModal } from "./ui/SyncReportModal";

export default class PocketSyncPlugin extends Plugin {
	settings: PocketSyncSettings = { ...DEFAULT_SETTINGS };
	syncState: PocketSyncState = { ...DEFAULT_SYNC_STATE, records: {} };

	private autoSyncIntervalId: number | null = null;
	private settingTab: PocketSyncSettingTab | null = null;
	private stateStore!: SyncStateStore;
	private syncService!: SyncService;

	async onload(): Promise<void> {
		await this.loadPluginData();
		this.stateStore = new SyncStateStore(this);
		this.syncService = new SyncService(this.app, () => this.settings, this.stateStore);

		this.addRibbonIcon("refresh-cw", "Sync Pocket now", () => {
			void this.runSync({
				scope: "all",
				reason: "manual",
			});
		});
		registerCommands(this);
		this.settingTab = new PocketSyncSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.refreshAutoSyncRegistration();

		if (this.settings.runOnStartup && this.settings.apiKey.trim()) {
			void this.runSync({
				scope: "all",
				reason: "startup",
			});
		}
	}

	onunload(): void {
		this.clearAutoSyncInterval();
	}

	async loadPluginData(): Promise<void> {
		const loadedData = (await this.loadData()) as PluginData | null;
		this.settings = sanitizeSettings({
			...DEFAULT_SETTINGS,
			...(loadedData?.settings ?? {}),
		});
		this.syncState = {
			...DEFAULT_SYNC_STATE,
			...(loadedData?.state ?? {}),
			records: {
				...DEFAULT_SYNC_STATE.records,
				...(loadedData?.state?.records ?? {}),
			},
		};
	}

	async savePluginData(): Promise<void> {
		await this.saveData({
			settings: this.settings,
			state: this.syncState,
		});
	}

	async updateSettings(partial: Partial<PocketSyncSettings>): Promise<void> {
		this.settings = sanitizeSettings({
			...this.settings,
			...partial,
		});
		await this.savePluginData();
		this.refreshAutoSyncRegistration();
		this.settingTab?.display();
	}

	async runSync(options: SyncOptions): Promise<SyncReport> {
		new Notice("Pocket sync started. This may take a few minutes.", 4000);
		const report = await this.syncService.runSync(options);
		if (report.errors.length > 0) {
			new Notice(report.errors[0] ?? "Pocket sync failed.", 8000);
		} else {
			new Notice(
				report.dryRun
					? `Pocket sync dry run complete: ${report.created} create, ${report.updated} update, ${report.archived} archive.`
					: `Pocket sync complete: ${report.created} created, ${report.updated} updated, ${report.archived} archived.`,
				5000,
			);
		}
		this.refreshAutoSyncRegistration();
		this.settingTab?.display();
		return report;
	}

	async testPocketConnection(): Promise<void> {
		try {
			const result = await this.syncService.testConnection();
			new Notice(`Pocket connection succeeded. ${result.tagCount} tags are available.`, 5000);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Pocket connection failed.";
			new Notice(message, 8000);
		}
		this.settingTab?.display();
	}

	openLastSyncReport(): void {
		const report = this.syncState.lastSyncReport;
		if (!report) {
			new Notice("Pocket sync has not produced a report yet.");
			return;
		}

		new SyncReportModal(this.app, report).open();
	}

	async exportDiagnosticReport(): Promise<void> {
		try {
			const path = await this.syncService.createDiagnosticReport();
			new Notice(`Pocket diagnostic report created at ${path}.`, 6000);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Could not export diagnostic report.";
			new Notice(message, 8000);
		}
	}

	private refreshAutoSyncRegistration(): void {
		this.clearAutoSyncInterval();

		if (!this.settings.autoSyncEnabled || !this.settings.apiKey.trim()) {
			return;
		}

		if (this.syncService.shouldPauseAutoSync(this.settings)) {
			return;
		}

		this.autoSyncIntervalId = window.setInterval(() => {
			void this.runSync({
				scope: "all",
				reason: "interval",
			});
		}, this.settings.syncIntervalMinutes * 60 * 1000);
		this.registerInterval(this.autoSyncIntervalId);
	}

	private clearAutoSyncInterval(): void {
		if (this.autoSyncIntervalId == null) {
			return;
		}

		window.clearInterval(this.autoSyncIntervalId);
		this.autoSyncIntervalId = null;
	}
}
