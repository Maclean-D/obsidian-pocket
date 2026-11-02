import { sanitizeArtifactLanguage } from "./notes/artifactLanguage";
import { App, ButtonComponent, PluginSettingTab, Setting } from "obsidian";

import { POCKET_API_KEYS_URL, SUPPORTED_FILENAME_TOKENS } from "./constants";
import type PocketSyncPlugin from "./main";
import type { InsightMode, PocketSyncSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { formatRecordingDateTime, validTimeZone } from "./notes/metadata";
import { normalizeFolderPath } from "./utils/text";

export function sanitizeSettings(settings: Partial<PocketSyncSettings>): PocketSyncSettings {
	return {
		...DEFAULT_SETTINGS,
		...settings,
		groupByDay: settings.groupByDay === true,
		noteManagementMode: settings.noteManagementMode === "mirror" || settings.noteManagementMode === "managed-block" || settings.noteManagementMode === "entire-note"
			? settings.noteManagementMode : DEFAULT_SETTINGS.noteManagementMode,
        artifactLanguage: sanitizeArtifactLanguage(settings.artifactLanguage),
        organizationMode: settings.organizationMode === "pocket" ? "pocket" : "date",
        timeZone: validTimeZone(settings.timeZone),
        localMovePolicy: settings.localMovePolicy === "follow-pocket" ? "follow-pocket" : "keep-local",
        contentRefreshDays: clampNumber(settings.contentRefreshDays, 1, 365, DEFAULT_SETTINGS.contentRefreshDays),
        includeFolderIds: settings.includeFolderIds?.trim() ?? "",
        excludeFolderIds: settings.excludeFolderIds?.trim() ?? "",
        includeSpaceIds: settings.includeSpaceIds?.trim() ?? "",
        excludeSpaceIds: settings.excludeSpaceIds?.trim() ?? "",
		apiKey: settings.apiKey?.trim() ?? DEFAULT_SETTINGS.apiKey,
		includeTags: settings.includeTags?.trim() ?? DEFAULT_SETTINGS.includeTags,
		excludeTags: settings.excludeTags?.trim() ?? DEFAULT_SETTINGS.excludeTags,
		insightsTag: settings.insightsTag?.trim() || DEFAULT_SETTINGS.insightsTag,
		maxDaysPerSyncRun: clampNumber(settings.maxDaysPerSyncRun, 1, 365, DEFAULT_SETTINGS.maxDaysPerSyncRun),
		syncIntervalMinutes: clampNumber(settings.syncIntervalMinutes, 5, 1440, DEFAULT_SETTINGS.syncIntervalMinutes),
		baseFolder: normalizeFolderPath(settings.baseFolder ?? DEFAULT_SETTINGS.baseFolder) || DEFAULT_SETTINGS.baseFolder,
		conversationFolder:
			normalizeFolderPath(settings.conversationFolder ?? DEFAULT_SETTINGS.conversationFolder) ||
			DEFAULT_SETTINGS.conversationFolder,
		insightsFolder:
			normalizeFolderPath(settings.insightsFolder ?? DEFAULT_SETTINGS.insightsFolder) ||
			DEFAULT_SETTINGS.insightsFolder,
		conversationFolderTemplate:
			settings.conversationFolderTemplate?.trim() || DEFAULT_SETTINGS.conversationFolderTemplate,
		insightFilenameTemplate:
			settings.insightFilenameTemplate?.trim() || DEFAULT_SETTINGS.insightFilenameTemplate,
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
		overviewParagraph.appendText("Sync your conversations, summaries, action items, mind maps, and insights into markdown notes. ");
		overviewParagraph.appendText("Imported notes contain copies of your Pocket data, and the API key is stored in Obsidian's local plugin data without encryption.");

		this.renderStatusSection(containerEl);
		this.renderSetupActions(containerEl);
		this.renderAuthenticationSection(containerEl);
		this.renderSyncScopeSection(containerEl);
		this.renderSchedulingSection(containerEl);
		this.renderOrganizationSection(containerEl);
        this.renderPocketOrganizationSection(containerEl);
		this.renderContentSection(containerEl);
		this.renderWriteBehaviorSection(containerEl);
		this.renderSupportSection(containerEl);
	}

	private renderStatusSection(containerEl: HTMLElement): void {
		this.addSectionHeading(containerEl, "Status");
		const statusList = containerEl.createEl("ul");
		statusList.createEl("li", { text: `Last sync status: ${this.plugin.syncState.lastSyncStatus}` });
		statusList.createEl("li", { text: `Last sync message: ${this.plugin.syncState.lastSyncMessage}` });
		statusList.createEl("li", { text: `Last attempted sync: ${formatRecordingDateTime(this.plugin.syncState.lastAttemptedSyncAt, this.plugin.settings.timeZone)}` });
		statusList.createEl("li", { text: `Last successful sync: ${formatRecordingDateTime(this.plugin.syncState.lastSuccessfulSyncAt, this.plugin.settings.timeZone)}` });
		statusList.createEl("li", { text: `Last successful connection test: ${formatRecordingDateTime(this.plugin.syncState.lastConnectionSucceededAt, this.plugin.settings.timeZone)}` });
		statusList.createEl("li", { text: `Consecutive failures: ${this.plugin.syncState.consecutiveFailures}` });
	}

	private renderSetupActions(containerEl: HTMLElement): void {
		this.addSectionHeading(containerEl, "Quick actions");
		const isRunning = this.plugin.syncState.lastSyncStatus === "running";
		const actionsEl = containerEl.createDiv({ cls: "pocket-sync-quick-actions" });
		new ButtonComponent(actionsEl)
			.setButtonText("Get API key")
			.onClick(() => {
				window.open(POCKET_API_KEYS_URL, "_blank");
			});
		new ButtonComponent(actionsEl)
			.setButtonText("Test connection")
			.onClick(() => {
				void this.plugin.testPocketConnection();
			});
		new ButtonComponent(actionsEl)
			.setButtonText(isRunning ? "Sync running..." : "Sync now")
			.setCta()
			.setDisabled(isRunning)
			.onClick(() => {
				void this.plugin.runSync({
					scope: "all",
					reason: "manual",
				});
			});
	}

	private renderAuthenticationSection(containerEl: HTMLElement): void {
		this.addSectionHeading(containerEl, "Authentication and privacy");
		new Setting(containerEl)
			.setName("API key")
			.setDesc("Use your API key for direct sync.")
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
			.setDesc("Import standard Pocket recordings into drive-style folders with transcript, summary, action item, and mind map files.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncConversations).onChange(async (value) => {
					await this.plugin.updateSettings({ syncConversations: value });
				}),
			);

		new Setting(containerEl)
			.setName("Sync insights")
			.setDesc("Import Pocket insights into single notes under the insights folder.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncInsights).onChange(async (value) => {
					await this.plugin.updateSettings({ syncInsights: value });
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
			.setName("Insights tag")
			.setDesc("Pocket tag name that identifies insight recordings.")
			.addText((text) => {
				text.setValue(this.plugin.settings.insightsTag);
				text.onChange(async (value) => {
					await this.plugin.updateSettings({ insightsTag: value });
				});
			});

		this.addNumberSetting(
			containerEl,
			"Max days per sync run",
			"Limits incremental sync and manual backfill windows after the first sync. The first sync imports all Pocket history since October 5, 2025.",
			this.plugin.settings.maxDaysPerSyncRun,
			async (value) => this.plugin.updateSettings({ maxDaysPerSyncRun: value }),
		);

		new Setting(containerEl)
			.setName("Only import completed summaries")
			.setDesc("Wait for completed summaries before creating content notes. Pending recordings remain visible in the catalog.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.onlyImportCompletedSummaries).onChange(async (value) => {
					await this.plugin.updateSettings({ onlyImportCompletedSummaries: value });
				}),
			);

		new Setting(containerEl)
			.setName("Re-sync updated summaries")
			.setDesc("Update generated files when Pocket content changes upstream.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.resyncUpdatedSummaries).onChange(async (value) => {
					await this.plugin.updateSettings({ resyncUpdatedSummaries: value });
				}),
			);

		new Setting(containerEl)
			.setName("Import transcript when available")
			.setDesc("Request transcript data so conversations can write transcript files.")
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
			.setName("Insights folder")
			.setDesc("Folder under the base Pocket folder for insight notes.")
			.addText((text) => {
				text.setPlaceholder("Insights");
				text.setValue(this.plugin.settings.insightsFolder);
				text.onChange(async (value) => {
					await this.plugin.updateSettings({ insightsFolder: value });
				});
			});

		new Setting(containerEl)
			.setName("Group by year and month")
			.setDesc("Add `YYYY/MM` beneath each Pocket conversation folder, or beneath the conversation root in date mode. Insights group beneath the insights root in both modes. Existing notes move on the next sync; manually pinned folders stay in place.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.groupByYearMonth).onChange(async (value) => {
					await this.plugin.updateSettings({ groupByYearMonth: value });
					this.display();
				}),
			);

		new Setting(containerEl)
			.setName("Group by day")
			.setDesc("Add `DD` beneath `YYYY/MM` using the configured timezone. Requires year and month grouping. Existing notes move on the next sync; manually pinned folders stay in place.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.groupByDay)
					.setDisabled(!this.plugin.settings.groupByYearMonth)
					.onChange(async (value) => {
						await this.plugin.updateSettings({ groupByDay: value });
					}),
			);

		new Setting(containerEl)
            .setName("Artifact language")
            .setDesc("Language for conversation filenames and navigation labels. Existing files are renamed on the next sync; Pocket content is not translated. English preserves the original filenames.")
            .addDropdown(dropdown => dropdown
                .addOption("en", "English").addOption("es", "Español").addOption("fr", "Français")
                .addOption("de", "Deutsch").addOption("it", "Italiano").addOption("pt", "Português").addOption("zh", "中文")
                .setValue(this.plugin.settings.artifactLanguage)
                .onChange(async value => { await this.plugin.updateSettings({ artifactLanguage: sanitizeArtifactLanguage(value) }); }));

		new Setting(containerEl)
			.setName("Conversation folder template")
			.setDesc(`Names the folder containing the localized transcript, summary, action items, and mind map files. Supported tokens: ${SUPPORTED_FILENAME_TOKENS.join(", ")}`)
			.addText((text) => {
				text.setPlaceholder("{{title}}");
				text.setValue(this.plugin.settings.conversationFolderTemplate);
				text.onChange(async (value) => {
					await this.plugin.updateSettings({ conversationFolderTemplate: value });
				});
			});

		new Setting(containerEl)
			.setName("Insight filename template")
			.setDesc(`Names the single insight note under the Insights folder. Supported tokens: ${SUPPORTED_FILENAME_TOKENS.join(", ")}`)
			.addText((text) => {
				text.setPlaceholder("{{date}} {{title}}");
				text.setValue(this.plugin.settings.insightFilenameTemplate);
				text.onChange(async (value) => {
					await this.plugin.updateSettings({ insightFilenameTemplate: value });
				});
			});

		new Setting(containerEl)
			.setName("Duplicate filename policy")
			.setDesc("Choose how to avoid collisions when two recordings produce the same folder or note name.")
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
			.setName("Insights mode")
			.setDesc("Create one note per insight recording, or roll multiple insights into one note per day.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("per-recording", "One note per recording")
					.addOption("per-day", "Roll up to one note per day")
					.setValue(this.plugin.settings.insightMode)
					.onChange(async (value: InsightMode) => {
						await this.plugin.updateSettings({ insightMode: value });
					}),
			);

		new Setting(containerEl)
			.setName("Insight date source")
			.setDesc("Use the recording date or the summary update date when naming insights.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("recording-date", "Recording date")
					.addOption("summary-date", "Summary date")
					.setValue(this.plugin.settings.insightDateSource)
					.onChange(async (value: PocketSyncSettings["insightDateSource"]) => {
						await this.plugin.updateSettings({ insightDateSource: value });
					}),
			);
	}

 private renderPocketOrganizationSection(containerEl: HTMLElement): void {
  this.addSectionHeading(containerEl, "Pocket folders and metadata");
  new Setting(containerEl).setName("Organization mode").setDesc("Follow Pocket spaces and folders, or keep date and template organization. Preview before migrating existing notes.")
   .addDropdown(dropdown => dropdown.addOption("date", "Date and template").addOption("pocket", "Follow Pocket folders")
    .setValue(this.plugin.settings.organizationMode).onChange(async value => { await this.plugin.updateSettings({ organizationMode: value === "pocket" ? "pocket" : "date" }); }));
  new Setting(containerEl).setName("Time zone").setDesc("Time zone used for dates and grouping (an IANA name, for example `America/New_York`).")
   .addText(text => {
    text.setValue(this.plugin.settings.timeZone);
    text.inputEl.addEventListener("change", () => {
     const value = text.getValue().trim();
     try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); text.inputEl.setCustomValidity(""); void this.plugin.updateSettings({ timeZone: value }); }
     catch { text.inputEl.setCustomValidity("Enter a valid IANA time zone."); text.inputEl.reportValidity(); }
    });
   });
  for (const [key, name] of [
   ["includeFolderIds", "Include folder ids"], ["excludeFolderIds", "Exclude folder ids"],
   ["includeSpaceIds", "Include space ids"], ["excludeSpaceIds", "Exclude space ids"],
  ] as const) {
   new Setting(containerEl).setName(name).setDesc("Comma-separated exact Pocket ids. Folder filters match that folder; space filters include its descendants. Exclusion takes priority. Empty means no filter.")
    .addText(text => text.setValue(this.plugin.settings[key]).onChange(async value => { await this.plugin.updateSettings({ [key]: value }); }));
  }
  new Setting(containerEl).setName("Folder database view").setDesc("Create an optional table of summaries, filterable by space, folder, tags and date. Requires frontmatter and the built-in database feature.")
   .addButton(button => button.setButtonText("Create view").onClick(() => { void this.plugin.createBasesView(); }));
  this.addToggleSetting(containerEl, "Generate folder index", "Write a folder index note after successful syncs, with links to existing summaries and pending items.", this.plugin.settings.generateFolderIndex,
   async value => this.plugin.updateSettings({ generateFolderIndex: value }));
  this.addNumberSetting(containerEl, "Content refresh days", "Refresh content periodically even when Pocket's update timestamp has not changed.", this.plugin.settings.contentRefreshDays,
   async value => this.plugin.updateSettings({ contentRefreshDays: value }));
  new Setting(containerEl).setName("Manual moves").setDesc("Keep notes in a manually chosen location, or move them back to match Pocket during reconciliation.")
   .addDropdown(dropdown => dropdown.addOption("keep-local", "Keep local location").addOption("follow-pocket", "Follow remote folders")
    .setValue(this.plugin.settings.localMovePolicy).onChange(async value => { await this.plugin.updateSettings({ localMovePolicy: value === "follow-pocket" ? "follow-pocket" : "keep-local" }); }));
  for (const [name, options] of [
   ["Preview organization", { organizationOnly: true, dryRun: true }],
   ["Update organization", { organizationOnly: true }],
   ["Update content", { forceContentRefresh: true }],
  ] as const) {
   new Setting(containerEl).setName(name).addButton(button => button.setButtonText(name).onClick(() => {
    void this.plugin.runSync({ scope: "all", reason: "manual", forceFullScan: true, ...options });
   }));
  }
 }

	private renderContentSection(containerEl: HTMLElement): void {
		this.addSectionHeading(containerEl, "Note content");
		this.addToggleSetting(containerEl, "Include frontmatter", "Store Pocket metadata as Obsidian properties. Turn off for the closest raw Drive-style file bodies.", this.plugin.settings.includeFrontmatter, async (value) =>
			this.plugin.updateSettings({ includeFrontmatter: value }),
		);
		this.addToggleSetting(containerEl, "Include Pocket metadata section", "Add a Markdown metadata section to insight notes.", this.plugin.settings.includeMetadataSection, async (value) =>
			this.plugin.updateSettings({ includeMetadataSection: value }),
		);
		this.addToggleSetting(containerEl, "Write summary", "Write Pocket's summary markdown into each conversation folder and insight note.", this.plugin.settings.includeSummaryMarkdown, async (value) =>
			this.plugin.updateSettings({ includeSummaryMarkdown: value }),
		);
		this.addToggleSetting(containerEl, "Include bullet highlights", "Append Pocket summary bullet points to summary output when available.", this.plugin.settings.includeBulletHighlights, async (value) =>
			this.plugin.updateSettings({ includeBulletHighlights: value }),
		);
		this.addToggleSetting(containerEl, "Write action items", "Write Pocket action items into each conversation folder.", this.plugin.settings.includeActionItems, async (value) =>
			this.plugin.updateSettings({ includeActionItems: value }),
		);
		this.addToggleSetting(containerEl, "Write mind map", "Write Pocket mind map markdown into each conversation folder when available.", this.plugin.settings.includeMindMap, async (value) =>
			this.plugin.updateSettings({ includeMindMap: value }),
		);
		this.addToggleSetting(containerEl, "Render action items as checklist", "Use Markdown checkboxes instead of plain bullets.", this.plugin.settings.renderActionItemsAsChecklist, async (value) =>
			this.plugin.updateSettings({ renderActionItemsAsChecklist: value }),
		);
		this.addToggleSetting(containerEl, "Write transcript", "Write transcript content into each conversation folder when Pocket provides it.", this.plugin.settings.includeTranscript, async (value) =>
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

	}

	private renderWriteBehaviorSection(containerEl: HTMLElement): void {
		this.addSectionHeading(containerEl, "Write behavior");
		new Setting(containerEl)
			.setName("Note management mode")
			.setDesc("Mirror replaces local content and task states on full refresh. Metadata-only sync keeps the body; refresh content to migrate existing notes.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("managed-block", "Managed sync block only")
					.addOption("entire-note", "Entire note managed")
					.addOption("mirror", "Mirror Pocket (replace local content)")
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
