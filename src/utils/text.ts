const INVALID_FILENAME_CHARS = /[\\/:*?"<>|#[\]^]/g;
const MULTI_SPACE = /\s+/g;

export function parseCommaSeparatedList(input: string): string[] {
	return input
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
}

export function sanitizeFileComponent(input: string, fallback = "Untitled"): string {
	const sanitized = input
		.replace(INVALID_FILENAME_CHARS, " ")
		.replace(MULTI_SPACE, " ")
		.trim()
		.replace(/\.$/, "");

	return sanitized || fallback;
}

export function normalizeFolderPath(input: string): string {
	return input
		.split("/")
		.map((segment) => segment.trim())
		.filter(Boolean)
		.join("/");
}

export function truncate(input: string, maxLength: number): string {
	if (input.length <= maxLength) {
		return input;
	}

	return `${input.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

/**
 * Canonical Obsidian tag normalization shared by inline and frontmatter output.
 * Lowercases, replaces unsupported characters with dashes, collapses repeats,
 * and trims leading/trailing dashes. Returns the bare tag without a `#` prefix.
 * May return an empty string when the input has no usable characters (e.g. `!!!`).
 */
export function sanitizeTag(tag: string): string {
	return tag
		.toLowerCase()
		.replace(/[^a-z0-9/_-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^[-/]+|[-/]+$/g, "");
}

export function toObsidianTag(tag: string): string {
	return `#pocket/${sanitizeTag(tag)}`;
}

export function toCustomObsidianTag(tag: string): string {
	return `#${sanitizeTag(tag)}`;
}

export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function quoteYamlString(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

export function dedupeStrings(values: string[]): string[] {
	return Array.from(new Set(values));
}

