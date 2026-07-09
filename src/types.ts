import {
	DEFAULT_BASE_FOLDER,
	DEFAULT_CONVERSATION_FOLDER,
	DEFAULT_INSIGHTS_FOLDER,
	DEFAULT_INSIGHTS_TAG,
	DEFAULT_SYNC_INTERVAL_MINUTES,
} from "./constants";

export type SyncScope = "all" | "conversations" | "insights";
export type NoteKind = "conversation" | "insight";
export type ConversationArtifactKind = "transcript" | "summary" | "action-items" | "mindmap";
export type NoteArtifactKind = ConversationArtifactKind | "insight";
export type SyncStatus = "idle" | "running" | "success" | "error";
export type SectionOrder = "summary-first" | "transcript-first";
export type NoteManagementMode = "managed-block" | "entire-note";
export type DuplicateFilenamePolicy = "append-id" | "frontmatter";
export type DeletedRecordingBehavior = "archive" | "leave";
export type InsightMode = "per-recording" | "per-day";
export type InsightDateSource = "recording-date" | "summary-date";
export type SyncReason =
	| "manual"
	| "startup"
	| "interval"
	| "backfill"
	| "rebuild"
	| "dry-run"
	| "test-connection";

export interface PocketSyncSettings {
	apiKey: string;
	verboseSyncLogging: boolean;
	syncConversations: boolean;
	syncInsights: boolean;
	includeTags: string;
	excludeTags: string;
	insightsTag: string;
	maxDaysPerSyncRun: number;
	onlyImportCompletedSummaries: boolean;
	resyncUpdatedSummaries: boolean;
	importTranscriptWhenAvailable: boolean;
	autoSyncEnabled: boolean;
	runOnStartup: boolean;
	syncIntervalMinutes: number;
	pauseAutoSyncAfterFailures: boolean;
	baseFolder: string;
	conversationFolder: string;
	insightsFolder: string;
	groupByYearMonth: boolean;
	conversationFolderTemplate: string;
	insightFilenameTemplate: string;
	duplicateFilenamePolicy: DuplicateFilenamePolicy;
	normalizeFileNames: boolean;
	includeFrontmatter: boolean;
	includeMetadataSection: boolean;
	includeSummaryMarkdown: boolean;
	includeBulletHighlights: boolean;
	includeActionItems: boolean;
	includeMindMap: boolean;
	renderActionItemsAsChecklist: boolean;
	includeTranscript: boolean;
	includeTranscriptTimestamps: boolean;
	includeTagsInFrontmatter: boolean;
	includeInlineObsidianTags: boolean;
	includeExtendedFrontmatterMetadata: boolean;
	sectionOrder: SectionOrder;
	noteManagementMode: NoteManagementMode;
	updateExistingNotes: boolean;
	deletedRecordingBehavior: DeletedRecordingBehavior;
	insightMode: InsightMode;
	insightDateSource: InsightDateSource;
	includeActionItemDueDate: boolean;
	includeActionItemStatus: boolean;
	hideCompletedActionItems: boolean;
	addSourceFrontmatterField: boolean;
	additionalTags: string;
	additionalConversationTags: string;
	additionalInsightTags: string;
	additionalTagsInFrontmatter: boolean;
	additionalTagsInline: boolean;
}

export interface PocketTag {
	id: string;
	name: string;
	color: string | null;
	usageCount?: number;
	createdAt?: string | null;
	updatedAt?: string | null;
}

export interface PocketRecordingListItem {
	id: string;
	title: string;
	durationSeconds: number | null;
	state: string | null;
	language: string | null;
	recordingAt: string;
	createdAt: string;
	updatedAt: string;
	tags: PocketTag[];
}

export interface PocketTranscriptSegment {
	start: number;
	end: number;
	speaker: string | null;
	text: string;
	originalText: string | null;
}

export interface PocketTranscript {
	text: string;
	segments: PocketTranscriptSegment[];
	metadata: Record<string, unknown>;
}

export interface PocketActionItemSubtask {
	id: string;
	title: string;
	assignee: string | null;
	status: string | null;
	priority: string | null;
	dueDate: string | null;
	category: string | null;
	completed: boolean;
}

export interface PocketActionItem {
	id: string;
	title: string;
	description: string | null;
	assignee: string | null;
	status: string | null;
	priority: string | null;
	dueDate: string | null;
	category: string | null;
	completed: boolean;
	type: string | null;
	subtasks: PocketActionItemSubtask[];
}

export interface PocketSummary {
	id: string;
	summarizationId: string;
	processingStatus: string | null;
	title: string;
	emoji: string | null;
	markdown: string;
	bulletPoints: string[];
	actionItems: PocketActionItem[];
	mindMap: unknown;
	autoInitiated: boolean;
	createdAt: string | null;
	updatedAt: string | null;
	settings: Record<string, unknown>;
	raw: unknown;
}

export interface NormalizedPocketRecording {
	id: string;
	title: string;
	kind: NoteKind;
	state: string | null;
	durationSeconds: number | null;
	language: string | null;
	recordingAt: string;
	createdAt: string;
	updatedAt: string;
	tags: PocketTag[];
	transcript: PocketTranscript | null;
	summary: PocketSummary | null;
}

export interface PocketTrackedRecord {
	id: string;
	kind: NoteKind;
	notePath: string;
	artifactPaths: string[];
	groupKey: string;
	recordingAt: string;
	lastSeenAt: string;
	lastSourceUpdatedAt: string;
	archivedAt: string | null;
}

export interface SyncReport {
	startedAt: string;
	finishedAt: string;
	scope: SyncScope;
	reason: SyncReason;
	dryRun: boolean;
	created: number;
	updated: number;
	skipped: number;
	archived: number;
	errors: string[];
	warnings: string[];
	processedIds: string[];
	windowStart: string;
	windowEnd: string;
}

export interface PocketSyncState {
	lastAttemptedSyncAt: string | null;
	lastSuccessfulSyncAt: string | null;
	lastSyncStatus: SyncStatus;
	lastSyncMessage: string;
	lastConnectionSucceededAt: string | null;
	consecutiveFailures: number;
	lastSyncReport: SyncReport | null;
	dryRunNextSync: boolean;
	records: Record<string, PocketTrackedRecord>;
}

export interface PluginData {
	settings?: Partial<PocketSyncSettings>;
	state?: Partial<PocketSyncState>;
}

export interface SyncOptions {
	scope: SyncScope;
	reason: SyncReason;
	dryRun?: boolean;
	backfillDays?: number;
	forceFullScan?: boolean;
}

export interface PocketApiTagResponse {
	id: string;
	name: string;
	color: string | null;
	usage_count?: number;
	created_at?: string;
	updated_at?: string;
}

export interface FrontmatterValueMap {
	[key: string]:
		| string
		| number
		| boolean
		| null
		| string[]
		| FrontmatterValueMap
		| FrontmatterValueMap[];
}

export interface RenderedPocketNote {
	title: string;
	body: string;
	frontmatter: FrontmatterValueMap;
}

export interface SyncNoteSpec {
	kind: NoteKind;
	artifactKind: NoteArtifactKind;
	targetPath: string;
	previousPath: string | null;
	groupKey: string;
	trackingIds: string[];
	recordings: NormalizedPocketRecording[];
}

export const DEFAULT_SETTINGS: PocketSyncSettings = {
	apiKey: "",
	verboseSyncLogging: false,
	syncConversations: true,
	syncInsights: true,
	includeTags: "",
	excludeTags: "",
	insightsTag: DEFAULT_INSIGHTS_TAG,
	maxDaysPerSyncRun: 30,
	onlyImportCompletedSummaries: true,
	resyncUpdatedSummaries: true,
	importTranscriptWhenAvailable: true,
	autoSyncEnabled: true,
	runOnStartup: true,
	syncIntervalMinutes: DEFAULT_SYNC_INTERVAL_MINUTES,
	pauseAutoSyncAfterFailures: true,
	baseFolder: DEFAULT_BASE_FOLDER,
	conversationFolder: DEFAULT_CONVERSATION_FOLDER,
	insightsFolder: DEFAULT_INSIGHTS_FOLDER,
	groupByYearMonth: false,
	conversationFolderTemplate: "{{title}}",
	insightFilenameTemplate: "{{date}} {{title}}",
	duplicateFilenamePolicy: "append-id",
	normalizeFileNames: true,
	includeFrontmatter: false,
	includeMetadataSection: false,
	includeSummaryMarkdown: true,
	includeBulletHighlights: true,
	includeActionItems: true,
	includeMindMap: true,
	renderActionItemsAsChecklist: true,
	includeTranscript: true,
	includeTranscriptTimestamps: true,
	includeTagsInFrontmatter: true,
	includeInlineObsidianTags: false,
	includeExtendedFrontmatterMetadata: true,
	sectionOrder: "summary-first",
	noteManagementMode: "entire-note",
	updateExistingNotes: true,
	deletedRecordingBehavior: "archive",
	insightMode: "per-recording",
	insightDateSource: "recording-date",
	includeActionItemDueDate: true,
	includeActionItemStatus: true,
	hideCompletedActionItems: false,
	addSourceFrontmatterField: true,
	additionalTags: "",
	additionalConversationTags: "",
	additionalInsightTags: "",
	additionalTagsInFrontmatter: true,
	additionalTagsInline: false,
};

export const DEFAULT_SYNC_STATE: PocketSyncState = {
	lastAttemptedSyncAt: null,
	lastSuccessfulSyncAt: null,
	lastSyncStatus: "idle",
	lastSyncMessage: "Pocket Sync is ready.",
	lastConnectionSucceededAt: null,
	consecutiveFailures: 0,
	lastSyncReport: null,
	dryRunNextSync: false,
	records: {},
};

