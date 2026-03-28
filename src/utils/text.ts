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

export function toObsidianTag(tag: string): string {
	return `#pocket/${tag
		.toLowerCase()
		.replace(/[^a-z0-9/-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")}`;
}

export function quoteYamlString(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

export function dedupeStrings(values: string[]): string[] {
	return Array.from(new Set(values));
}

