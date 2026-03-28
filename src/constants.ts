export const PLUGIN_ID = "pocket-sync";
export const PLUGIN_NAME = "Pocket Sync";
export const POCKET_API_BASE_URL = "https://public.heypocketai.com/api/v1";
export const POCKET_API_KEYS_URL = "https://app.heypocket.com/app/settings/api-keys";

export const DEFAULT_BASE_FOLDER = "Pocket";
export const DEFAULT_CONVERSATION_FOLDER = "Conversations";
export const DEFAULT_DAILY_HIGHLIGHTS_FOLDER = "Daily highlights";
export const DEFAULT_ARCHIVE_FOLDER = "Archive";
export const DEFAULT_DIAGNOSTICS_FOLDER = "Diagnostics";
export const DEFAULT_FIRST_SYNC_DATE = "2025-10-05";

export const MANAGED_BLOCK_START = "<!-- pocket-sync:managed:start -->";
export const MANAGED_BLOCK_END = "<!-- pocket-sync:managed:end -->";
export const FRONTMATTER_BLOCK_KEY = "pocketSync";

export const SUPPORTED_FILENAME_TOKENS = [
	"{{date}}",
	"{{title}}",
	"{{id}}",
	"{{yyyy}}",
	"{{MM}}",
	"{{dd}}",
] as const;

export const AUTO_SYNC_FAILURE_THRESHOLD = 3;
export const SYNC_SAFETY_LOOKBACK_DAYS = 2;
export const DEFAULT_REBUILD_DAYS = 7;
export const DEFAULT_BACKFILL_DAYS = 7;
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 50;
export const DEFAULT_SYNC_INTERVAL_MINUTES = 60;
export const DEFAULT_RETRY_COUNT = 3;
export const DEFAULT_RETRY_DELAY_MS = 1500;
export const DEFAULT_DAILY_HIGHLIGHTS_TAG = "highlights";

