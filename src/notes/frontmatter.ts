import { FRONTMATTER_BLOCK_KEY } from "../constants";
import type { FrontmatterValueMap } from "../types";
import { dedupeStrings, escapeRegExp } from "../utils/text";

/**
 * Frontmatter keys that Pocket Sync fully owns. These are stripped and
 * re-rendered on every sync. The standard Obsidian `tags` field is deliberately
 * NOT in this list: it is shared with the user, so it is merged rather than
 * blindly overwritten (see {@link mergeUserAuthoredTags}).
 */
export const MANAGED_FRONTMATTER_KEYS = [
	"kind",
	"artifact",
	"source",
	"recording_id",
	"recording_ids",
	"recording_title",
	"recorded_at",
	"pocket_created_at",
	"pocket_updated_at",
	"pocket_summary_updated_at",
	"duration_seconds",
	"state",
	"language",
	"pocket_tags",
	"synced_at",
] as const;

export function applyFrontmatter(content: string, frontmatter: FrontmatterValueMap, includeFrontmatter: boolean): string {
	const extracted = extractFrontmatter(content);
	const cleanedBody = extracted.body.trimStart();
	const existingBody = extracted.frontmatterBody;
	const nextFrontmatter = includeFrontmatter
		? upsertPocketFrontmatter(existingBody, frontmatter)
		: removePocketFrontmatter(existingBody);

	if (!nextFrontmatter) {
		return cleanedBody;
	}

	return `---\n${nextFrontmatter.trim()}\n---\n\n${cleanedBody}`.trim();
}

function extractFrontmatter(content: string): { frontmatterBody: string | null; body: string } {
	const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
	if (!match) {
		return {
			frontmatterBody: null,
			body: content,
		};
	}

	return {
		frontmatterBody: match[1] ?? null,
		body: content.slice(match[0].length),
	};
}

function upsertPocketFrontmatter(existingFrontmatter: string | null, frontmatter: FrontmatterValueMap): string {
	const mergedFrontmatter = mergeUserAuthoredTags(existingFrontmatter, frontmatter);
	const managesTags = Array.isArray(mergedFrontmatter.tags);
	const renderedBlock = renderFrontmatterEntries(mergedFrontmatter);
	const cleanedFrontmatter = removePocketFrontmatter(existingFrontmatter, managesTags);
	return [cleanedFrontmatter, renderedBlock].filter(Boolean).join("\n").trim();
}

/**
 * When Pocket Sync is about to write additional `tags`, union them with any
 * user-authored tags already present so a re-sync never deletes manual tags.
 * When no additional tags are being written, the frontmatter is returned
 * untouched and {@link removePocketFrontmatter} leaves the existing field alone.
 */
function mergeUserAuthoredTags(existingFrontmatter: string | null, frontmatter: FrontmatterValueMap): FrontmatterValueMap {
	if (!Array.isArray(frontmatter.tags)) {
		return frontmatter;
	}

	const existingTags = parseFrontmatterTags(existingFrontmatter);
	const additionalTags = frontmatter.tags.filter((tag): tag is string => typeof tag === "string");
	return {
		...frontmatter,
		tags: dedupeStrings([...existingTags, ...additionalTags]),
	};
}

/**
 * Best-effort parse of the existing `tags` frontmatter field. Handles the block
 * list form Pocket Sync writes plus inline array (`tags: [a, b]`) and scalar
 * (`tags: foo`) forms a user might author by hand.
 */
export function parseFrontmatterTags(existingFrontmatter: string | null): string[] {
	if (!existingFrontmatter) {
		return [];
	}

	const lines = existingFrontmatter.split("\n");
	for (let index = 0; index < lines.length; index += 1) {
		const match = lines[index]?.match(/^tags:\s*(.*)$/);
		if (!match) {
			continue;
		}

		const inline = (match[1] ?? "").trim();
		if (inline) {
			if (inline.startsWith("[")) {
				return inline
					.replace(/^\[/, "")
					.replace(/\]$/, "")
					.split(",")
					.map((part) => unquoteYamlScalar(part.trim()))
					.filter(Boolean);
			}

			const scalar = unquoteYamlScalar(inline);
			return scalar ? [scalar] : [];
		}

		const tags: string[] = [];
		for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
			const itemMatch = lines[cursor]?.match(/^\s*-\s+(.*)$/);
			if (!itemMatch) {
				break;
			}
			const value = unquoteYamlScalar((itemMatch[1] ?? "").trim());
			if (value) {
				tags.push(value);
			}
		}
		return tags;
	}

	return [];
}

function unquoteYamlScalar(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
		return trimmed.slice(1, -1).replace(/''/g, "'");
	}
	if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function removePocketFrontmatter(existingFrontmatter: string | null, stripTags = false): string {
	if (!existingFrontmatter) {
		return "";
	}

	let nextFrontmatter = existingFrontmatter
		.replace(new RegExp(`(^|\\n)${FRONTMATTER_BLOCK_KEY}:\\n(?:  .*\\n?)*`, "m"), "")
		.trim();

	const keysToStrip = stripTags ? [...MANAGED_FRONTMATTER_KEYS, "tags"] : MANAGED_FRONTMATTER_KEYS;
	for (const key of keysToStrip) {
		nextFrontmatter = nextFrontmatter
			.replace(new RegExp(`(^|\\n)${escapeRegExp(key)}:\\n(?:  - .*\\n?)*`, "m"), "")
			.replace(new RegExp(`(^|\\n)${escapeRegExp(key)}: .*\\n?`, "m"), "")
			.trim();
	}

	return nextFrontmatter;
}

function renderFrontmatterEntries(frontmatter: FrontmatterValueMap): string {
	return Object.entries(frontmatter)
		.filter(([, value]) => value !== undefined)
		.map(([key, value]) => {
			if (Array.isArray(value)) {
				return `${key}:\n${renderFrontmatterValue(value, 1)}`;
			}

			if (value && typeof value === "object") {
				return `${key}: ${quoteScalar(JSON.stringify(value))}`;
			}

			return `${key}: ${quoteScalar(value)}`;
		})
		.join("\n");
}

function renderFrontmatterValue(value: FrontmatterValueMap[] | string[] | string | number | boolean | null, depth: number): string {
	const indent = "  ".repeat(depth);

	if (Array.isArray(value)) {
		return value
			.map((item) => {
				if (typeof item === "string") {
					return `${indent}- ${quoteScalar(item)}`;
				}

				return `${indent}- ${quoteScalar(JSON.stringify(item))}`;
			})
			.join("\n");
	}

	return `${indent}${quoteScalar(value)}`;
}

function quoteScalar(value: string | number | boolean | null | undefined): string {
	if (value == null) {
		return "null";
	}

	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}

	return `'${value.replace(/'/g, "''")}'`;
}
