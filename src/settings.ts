import { App, PluginSettingTab, Setting } from "obsidian";

import { POCKET_API_KEYS_URL, SUPPORTED_FILENAME_TOKENS } from "./constants";
import type PocketSyncPlugin from "./main";
import type { DailyHighlightMode, PocketSyncSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { formatDisplayDateTime } from "./utils/date";
import { normalizeFolderPath } from "./utils/text";

export function sanitizeSettings(settings: Partial<PocketSyncSettings>): PocketSyncSettings {
	return {
		...DEFAULT_SETTINGS,
		...settings,
		apiKey: settings.apiKey?.trim() ?? DEFAULT_SETTINGS.apiKey,
		includeTags: settings.includeTags?.trim() ?? DEFAULT_SETTINGS.includeTags,
		excludeTags: settings.excludeTags?.trim() ?? DEFAULT_SETTINGS.excludeTags,
		dailyHighlightsTag: settings.dailyHighlightsTag?.trim() || DEFAULT_SETTINGS.dailyHighlightsTag,
		maxDaysPerSyncRun: clampNumber(settings.maxDaysPerSyncRun, 1, 365, DEFAULT_SETTINGS.maxDaysPerSyncRun),
		syncIntervalMinutes: clampNumber(settings.syncIntervalMinutes, 5, 1440, DEFAULT_SETTINGS.syncIntervalMinutes),
		baseFolder: normalizeFolderPath(settings.baseFolder ?? DEFAULT_SETTINGS.baseFolder) || DEFAULT_SETTINGS.baseFolder,
		conversationFolder:
			normalizeFolderPath(settings.conversationFolder ?? DEFAULT_SETTINGS.conversationFolder) ||
			DEFAULT_SETTINGS.conversationFolder,
		dailyHighlightsFolder:
			normalizeFolderPath(settings.dailyHighlightsFolder ?? DEFAULT_SETTINGS.dailyHighlightsFolder) ||
			DEFAULT_SETTINGS.dailyHighlightsFolder,
		conversationFilenameTemplate:
			settings.conversationFilenameTemplate?.trim() || DEFAULT_SETTINGS.conversationFilenameTemplate,
		dailyHighlightFilenameTemplate:
			settings.dailyHighlightFilenameTemplate?.trim() || DEFAULT_SETTINGS.dailyHighlightFilenameTemplate,
	};
}

export class PocketSyncSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: PocketSyncPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Overview").setHeading();
		const overviewParagraph = containerEl.createEl("p");
		overviewParagraph.appendText("Sync your recordings, summaries, action items, and daily highlights into markdown notes. ");
		overviewParagraph.appendText("Imported notes contain copies of your Pocket data, and the API key is stored in Obsidian's local plugin data without encryption.");

		this.renderStatusSection(containerEl);
		this.renderSetupActions(containerEl);
		this.renderAuthenticationSection(containerEl);
		this.renderSyncScopeSection(containerEl);
		this.renderSchedulingSection(containerEl);
		this.renderOrganizationSection(containerEl);
		this.renderContentSection(containerEl);
		this.renderWriteBehaviorSection(containerEl);
		this.renderSupportSection(containerEl);
	}

	private renderStatusSection(containerEl: HTMLElement): void {
		this.addSectionHeading(containerEl, "Status");
		const statusList = containerEl.createEl("ul");
		statusList.createEl("li", { text: `Last sync status: ${this.plugin.syncState.lastSyncStatus}` });
		statusList.createEl("li", { text: `Last sync message: ${this.plugin.syncState.lastSyncMessage}` });
		statusList.createEl("li", { text: `Last attempted sync: ${formatDisplayDateTime(this.plugin.syncState.lastAttemptedSyncAt)}` });
		statusList.createEl("li", { text: `Last successful sync: ${formatDisplayDateTime(this.plugin.syncState.lastSuccessfulSyncAt)}` });
		statusList.createEl("li", { text: `Last successful connection test: ${formatDisplayDateTime(this.plugin.syncState.lastConnectionSucceededAt)}` });
		statusList.createEl("li", { text: `Consecutive failures: ${this.plugin.syncState.consecutiveFailures}` });
	}

	private renderSetupActions(containerEl: HTMLElement): void {
		this.addSectionHeading(containerEl, "Quick actions");
		new Setting(containerEl)
			.addButton((button) =>
				button.setButtonText("Open key page").onClick(() => {
					window.open(POCKET_API_KEYS_URL, "_blank");
				}),
			)
			.addButton((button) =>
				button.setButtonText("Test connection").setCta().onClick(() => {
					void this.plugin.testPocketConnection();
				}),
			)
			.addButton((button) =>
				button.setButtonText("Sync now").onClick(() => {
					void this.plugin.runSync({
						scope: "all",
						reason: "manual",
					});
				}),
			)
			.addButton((button) =>
				button.setButtonText("Open report").onClick(() => {
					this.plugin.openLastSyncReport();
				}),
			);
	}

	private renderAuthenticationSection(containerEl: HTMLElement): void {
		this.addSectionHeading(containerEl, "Authentication and privacy");
		new Setting(containerEl)
			.setName("Pocket access key")
			.setDesc("Use your access key for direct sync.")
			.addText((text) => {
				text.setValue(this.plugin.settings.apiKey);
				text.inputEl.type = "password";
				text.onChange(async (value) => {
					await this.plugin.updateSettings({ apiKey: value });
				});
			});

		new Setting(containerEl)
			.setName("Verbose sync logging")
			.setDesc("Log sync internals to the developer console for troubleshooting.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.verboseSyncLogging).onChange(async (value) => {
					await this.plugin.updateSettings({ verboseSyncLogging: value });
				}),
			);
	}

	private renderSyncScopeSection(containerEl: HTMLElement): void {
		this.addSectionHeading(containerEl, "Sync scope");
		new Setting(containerEl)
			.setName("Sync conversations")
			.setDesc("Import standard Pocket recordings with summaries, action items, and optional transcripts.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncConversations).onChange(async (value) => {
					await this.plugin.updateSettings({ syncConversations: value });
				}),
			);

		new Setting(containerEl)
			.setName("Sync daily highlights")
			.setDesc("Import Pocket daily highlights recordings, which are usually summary-only.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncDailyHighlights).onChange(async (value) => {
					await this.plugin.updateSettings({ syncDailyHighlights: value });
				}),
			);

		new Setting(containerEl)
			.setName("Include tags")
			.setDesc("Comma-separated Pocket tag names. Leave empty to include every tag.")
			.addText((text) => {
				text.setValue(this.plugin.settings.includeTags);
				text.onChange(async (value) => {
					await this.plugin.updateSettings({ includeTags: value });
				});
			});

		new Setting(containerEl)
			.setName("Exclude tags")
			.setDesc("Comma-separated Pocket tag names to ignore.")
			.addText((text) => {
				text.setValue(this.plugin.settings.excludeTags);
				text.onChange(async (value) => {
					await this.plugin.updateSettings({ excludeTags: value });
				});
			});

		new Setting(containerEl)
			.setName("Daily highlights tag")
			.setDesc("Pocket tag name that identifies daily highlights recordings.")
			.addText((text) => {
				text.setValue(this.plugin.settings.dailyHighlightsTag);
				text.onChange(async (value) => {
					await this.plugin.updateSettings({ dailyHighlightsTag: value });
				});
			});

		this.addNumberSetting(
			containerEl,
			"Max days per sync run",
			"Guardrail that limits how much history one sync can scan.",
			this.plugin.settings.maxDaysPerSyncRun,
			async (value) => this.plugin.updateSettings({ maxDaysPerSyncRun: value }),
		);

		new Setting(containerEl)
			.setName("Only import completed summaries")
			.setDesc("Skip recordings whose summary package is still pending.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.onlyImportCompletedSummaries).onChange(async (value) => {
					await this.plugin.updateSettings({ onlyImportCompletedSummaries: value });
				}),
			);

		new Setting(containerEl)
			.setName("Re-sync updated summaries")
			.setDesc("Update notes when summaries change.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.resyncUpdatedSummaries).onChange(async (value) => {
					await this.plugin.updateSettings({ resyncUpdatedSummaries: value });
				}),
			);

		new Setting(containerEl)
			.setName("Import transcript when available")
			.setDesc("Request transcript data when it is available.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.importTranscriptWhenAvailable).onChange(async (value) => {
					await this.plugin.updateSettings({ importTranscriptWhenAvailable: value });
				}),
			);
	}

	private renderSchedulingSection(containerEl: HTMLElement): void {
		this.addSectionHeading(containerEl, "Scheduling");
		new Setting(containerEl)
			.setName("Enable auto-sync")
			.setDesc("Run sync on a schedule in the background.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoSyncEnabled).onChange(async (value) => {
					await this.plugin.updateSettings({ autoSyncEnabled: value });
				}),
			);

		new Setting(containerEl)
			.setName("Run on startup")
			.setDesc("Kick off a sync when the plugin loads.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.runOnStartup).onChange(async (value) => {
					await this.plugin.updateSettings({ runOnStartup: value });
				}),
			);

		this.addNumberSetting(
			containerEl,
			"Run every N minutes",
			"How often Pocket Sync should poll Pocket when auto-sync is enabled.",
			this.plugin.settings.syncIntervalMinutes,
			async (value) => this.plugin.updateSettings({ syncIntervalMinutes: value }),
		);

		new Setting(containerEl)
			.setName("Pause auto-sync after repeated failures")
			.setDesc("Stop scheduled syncs after three consecutive failures until a manual sync succeeds.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.pauseAutoSyncAfterFailures).onChange(async (value) => {
					await this.plugin.updateSettings({ pauseAutoSyncAfterFailures: value });
				}),
			);

	}

	private renderOrganizationSection(containerEl: HTMLElement): void {
		this.addSectionHeading(containerEl, "Note organization");
		new Setting(containerEl)
			.setName("Base Pocket folder")
			.setDesc("Root folder for everything this plugin creates.")
			.addText((text) => {
				text.setPlaceholder("Pocket");
				text.setValue(this.plugin.settings.baseFolder);
				text.onChange(async (value) => {
					await this.plugin.updateSettings({ baseFolder: value });
				});
			});

		new Setting(containerEl)
			.setName("Conversation folder")
			.setDesc("Folder under the base Pocket folder for standard recordings.")
			.addText((text) => {
				text.setPlaceholder("Conversations");
				text.setValue(this.plugin.settings.conversationFolder);
				text.onChange(async (value) => {
					await this.plugin.updateSettings({ conversationFolder: value });
				});
			});

		new Setting(containerEl)
			.setName("Daily highlights folder")
			.setDesc("Folder under the base Pocket folder for daily highlight notes.")
			.addText((text) => {
				text.setPlaceholder("Daily highlights");
				text.setValue(this.plugin.settings.dailyHighlightsFolder);
				text.onChange(async (value) => {
					await this.plugin.updateSettings({ dailyHighlightsFolder: value });
				});
			});

		new Setting(containerEl)
			.setName("Group by year and month")
			.setDesc("Add `YYYY/MM` subfolders beneath the conversation and daily highlight folders.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.groupByYearMonth).onChange(async (value) => {
					await this.plugin.updateSettings({ groupByYearMonth: value });
				}),
			);

		new Setting(containerEl)
			.setName("Conversation filename template")
			.setDesc(`Supported tokens: ${SUPPORTED_FILENAME_TOKENS.join(", ")}`)
			.addText((text) => {
				text.setPlaceholder("{{date}} {{title}}");
				text.setValue(this.plugin.settings.conversationFilenameTemplate);
				text.onChange(async (value) => {
					await this.plugin.updateSettings({ conversationFilenameTemplate: value });
				});
			});

		new Setting(containerEl)
			.setName("Daily highlight filename template")
			.setDesc(`Supported tokens: ${SUPPORTED_FILENAME_TOKENS.join(", ")}`)
			.addText((text) => {
				text.setPlaceholder("{{date}} Daily highlights");
				text.setValue(this.plugin.settings.dailyHighlightFilenameTemplate);
				text.onChange(async (value) => {
					await this.plugin.updateSettings({ dailyHighlightFilenameTemplate: value });
				});
			});

		new Setting(containerEl)
			.setName("Duplicate filename policy")
			.setDesc("Keep the tracked note path on collisions.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("append-id", "Add suffix")
					.addOption("frontmatter", "Keep tracked note path")
					.setValue(this.plugin.settings.duplicateFilenamePolicy)
					.onChange(async (value: PocketSyncSettings["duplicateFilenamePolicy"]) => {
						await this.plugin.updateSettings({ duplicateFilenamePolicy: value });
					}),
			);

		new Setting(containerEl)
			.setName("Normalize file names")
			.setDesc("Strip unsupported filesystem characters from generated note names.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.normalizeFileNames).onChange(async (value) => {
					await this.plugin.updateSettings({ normalizeFileNames: value });
				}),
			);

		new Setting(containerEl)
			.setName("Daily highlights mode")
			.setDesc("Create one note per daily highlight recording, or roll multiple highlights into one note per day.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("per-recording", "One note per recording")
					.addOption("per-day", "Roll up to one note per day")
					.setValue(this.plugin.settings.dailyHighlightMode)
					.onChange(async (value: DailyHighlightMode) => {
						await this.plugin.updateSettings({ dailyHighlightMode: value });
					}),
			);

		new Setting(containerEl)
			.setName("Highlight date source")
			.setDesc("Use the recording date or the summary update date when naming daily highlights.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("recording-date", "Recording date")
					.addOption("summary-date", "Summary date")
					.setValue(this.plugin.settings.highlightDateSource)
					.onChange(async (value: PocketSyncSettings["highlightDateSource"]) => {
						await this.plugin.updateSettings({ highlightDateSource: value });
					}),
			);
	}

	private renderContentSection(containerEl: HTMLElement): void {
		this.addSectionHeading(containerEl, "Note content");
		this.addToggleSetting(containerEl, "Include frontmatter", "Store Pocket metadata as normal Obsidian properties.", this.plugin.settings.includeFrontmatter, async (value) =>
			this.plugin.updateSettings({ includeFrontmatter: value }),
		);
		this.addToggleSetting(containerEl, "Include Pocket metadata section", "Render a Markdown section with timestamps, duration, status, and tags.", this.plugin.settings.includeMetadataSection, async (value) =>
			this.plugin.updateSettings({ includeMetadataSection: value }),
		);
		this.addToggleSetting(containerEl, "Include summary markdown", "Render Pocket's summary markdown block.", this.plugin.settings.includeSummaryMarkdown, async (value) =>
			this.plugin.updateSettings({ includeSummaryMarkdown: value }),
		);
		this.addToggleSetting(containerEl, "Include bullet highlights", "Render Pocket summary bullet points when available.", this.plugin.settings.includeBulletHighlights, async (value) =>
			this.plugin.updateSettings({ includeBulletHighlights: value }),
		);
		this.addToggleSetting(containerEl, "Include action items", "Render Pocket action items into each note.", this.plugin.settings.includeActionItems, async (value) =>
			this.plugin.updateSettings({ includeActionItems: value }),
		);
		this.addToggleSetting(containerEl, "Render action items as checklist", "Use Markdown checkboxes instead of plain bullets.", this.plugin.settings.renderActionItemsAsChecklist, async (value) =>
			this.plugin.updateSettings({ renderActionItemsAsChecklist: value }),
		);
		this.addToggleSetting(containerEl, "Include transcript", "Render transcript content when Pocket provides it.", this.plugin.settings.includeTranscript, async (value) =>
			this.plugin.updateSettings({ includeTranscript: value }),
		);
		this.addToggleSetting(containerEl, "Include transcript timestamps", "Prefix transcript segments with Pocket timestamps.", this.plugin.settings.includeTranscriptTimestamps, async (value) =>
			this.plugin.updateSettings({ includeTranscriptTimestamps: value }),
		);
		this.addToggleSetting(containerEl, "Include Pocket tags in frontmatter", "Store Pocket tags as a normal frontmatter property.", this.plugin.settings.includeTagsInFrontmatter, async (value) =>
			this.plugin.updateSettings({ includeTagsInFrontmatter: value }),
		);
		this.addToggleSetting(containerEl, "Include inline Obsidian tags", "Render Pocket tags as inline `#pocket/...` tags near the top of each note.", this.plugin.settings.includeInlineObsidianTags, async (value) =>
			this.plugin.updateSettings({ includeInlineObsidianTags: value }),
		);
		this.addToggleSetting(containerEl, "Include extended frontmatter metadata", "Store Pocket timestamps, status, language, and summary update time.", this.plugin.settings.includeExtendedFrontmatterMetadata, async (value) =>
			this.plugin.updateSettings({ includeExtendedFrontmatterMetadata: value }),
		);
		this.addToggleSetting(containerEl, "Include source field in Pocket frontmatter", "Add a `source` property alongside the other Pocket properties.", this.plugin.settings.addSourceFrontmatterField, async (value) =>
			this.plugin.updateSettings({ addSourceFrontmatterField: value }),
		);
		this.addToggleSetting(containerEl, "Include action item due date", "Show due dates beside action items when Pocket provides them.", this.plugin.settings.includeActionItemDueDate, async (value) =>
			this.plugin.updateSettings({ includeActionItemDueDate: value }),
		);
		this.addToggleSetting(containerEl, "Include action item status", "Show action item status labels such as TODO or COMPLETED.", this.plugin.settings.includeActionItemStatus, async (value) =>
			this.plugin.updateSettings({ includeActionItemStatus: value }),
		);
		this.addToggleSetting(containerEl, "Hide completed action items", "Drop Pocket action items that are already completed.", this.plugin.settings.hideCompletedActionItems, async (value) =>
			this.plugin.updateSettings({ hideCompletedActionItems: value }),
		);

		new Setting(containerEl)
			.setName("Section order")
			.setDesc("Choose whether summaries or transcripts appear first in conversation notes.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("summary-first", "Summary first")
					.addOption("transcript-first", "Transcript first")
					.setValue(this.plugin.settings.sectionOrder)
					.onChange(async (value: PocketSyncSettings["sectionOrder"]) => {
						await this.plugin.updateSettings({ sectionOrder: value });
					}),
			);
	}

	private renderWriteBehaviorSection(containerEl: HTMLElement): void {
		this.addSectionHeading(containerEl, "Write behavior");
		new Setting(containerEl)
			.setName("Note management mode")
			.setDesc("Managed block mode preserves manual note content outside the sync block.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("managed-block", "Managed sync block only")
					.addOption("entire-note", "Entire note managed")
					.setValue(this.plugin.settings.noteManagementMode)
					.onChange(async (value: PocketSyncSettings["noteManagementMode"]) => {
						await this.plugin.updateSettings({ noteManagementMode: value });
					}),
			);

		this.addToggleSetting(containerEl, "Update existing notes on re-sync", "Modify existing Pocket notes when Pocket changes upstream content.", this.plugin.settings.updateExistingNotes, async (value) =>
			this.plugin.updateSettings({ updateExistingNotes: value }),
		);

		new Setting(containerEl)
			.setName("Deleted recording behavior")
			.setDesc("Archive notes when Pocket returns 404 for tracked recordings in the current sync window.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("archive", "Archive missing recordings")
					.addOption("leave", "Leave notes untouched")
					.setValue(this.plugin.settings.deletedRecordingBehavior)
					.onChange(async (value: PocketSyncSettings["deletedRecordingBehavior"]) => {
						await this.plugin.updateSettings({ deletedRecordingBehavior: value });
					}),
			);

	}

	private renderSupportSection(containerEl: HTMLElement): void {
		this.addSectionHeading(containerEl, "Supportability");
		new Setting(containerEl)
			.setName("Export diagnostic report")
			.setDesc("Write a diagnostic note without the access key.")
			.addButton((button) =>
				button.setButtonText("Export").onClick(() => {
					void this.plugin.exportDiagnosticReport();
				}),
			);
	}

	private addToggleSetting(
		containerEl: HTMLElement,
		name: string,
		description: string,
		value: boolean,
		onChange: (value: boolean) => Promise<void>,
	): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(description)
			.addToggle((toggle) => toggle.setValue(value).onChange(onChange));
	}

	private addNumberSetting(
		containerEl: HTMLElement,
		name: string,
		description: string,
		value: number,
		onChange: (value: number) => Promise<void>,
	): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(description)
			.addText((text) => {
				text.setValue(String(value));
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text.onChange(async (rawValue) => {
					const parsedValue = Number.parseInt(rawValue, 10);
					if (Number.isNaN(parsedValue)) {
						return;
					}

					await onChange(parsedValue);
				});
			});
	}

	private addSectionHeading(containerEl: HTMLElement, heading: string): void {
		new Setting(containerEl).setName(heading).setHeading();
	}
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number): number {
	if (typeof value !== "number" || Number.isNaN(value)) {
		return fallback;
	}

	return Math.min(max, Math.max(min, Math.round(value)));
}
