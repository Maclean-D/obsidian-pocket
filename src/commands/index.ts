import type PocketSyncPlugin from "../main";
import { DEFAULT_BACKFILL_DAYS } from "../constants";
import { NumberPromptModal } from "../ui/NumberPromptModal";

export function registerCommands(plugin: PocketSyncPlugin): void {
	plugin.addCommand({
		id: "sync-pocket-now",
		name: "Sync now",
		callback: () => {
			void plugin.runSync({
				scope: "all",
				reason: "manual",
			});
		},
	});

	plugin.addCommand({
		id: "sync-pocket-conversations-now",
		name: "Sync conversations now",
		callback: () => {
			void plugin.runSync({
				scope: "conversations",
				reason: "manual",
			});
		},
	});

	plugin.addCommand({
		id: "sync-pocket-daily-highlights-now",
		name: "Sync daily highlights now",
		callback: () => {
			void plugin.runSync({
				scope: "daily-highlights",
				reason: "manual",
			});
		},
	});

	plugin.addCommand({
		id: "backfill-pocket-previous-days",
		name: "Backfill previous days",
		callback: () => {
			new NumberPromptModal(plugin.app, {
				title: "Backfill notes",
				description: "Choose how many days of Pocket history to sync.",
				initialValue: DEFAULT_BACKFILL_DAYS,
				onSubmit: (days) => {
					void plugin.runSync({
						scope: "all",
						reason: "backfill",
						backfillDays: days,
					});
				},
			}).open();
		},
	});

	plugin.addCommand({
		id: "open-last-sync-report",
		name: "Open last sync report",
		callback: () => {
			plugin.openLastSyncReport();
		},
	});

	plugin.addCommand({
		id: "test-pocket-connection",
		name: "Test connection",
		callback: () => {
			void plugin.testPocketConnection();
		},
	});

	plugin.addCommand({
		id: "export-pocket-diagnostic-report",
		name: "Export diagnostic report",
		callback: () => {
			void plugin.exportDiagnosticReport();
		},
	});
}

