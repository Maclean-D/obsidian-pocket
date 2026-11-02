import { requestUrl } from "obsidian";

import { DEFAULT_REQUEST_TIMEOUT_MS, DEFAULT_RETRY_COUNT, DEFAULT_RETRY_DELAY_MS, MAX_PAGE_SIZE, POCKET_API_BASE_URL } from "../constants";
import { normalizeFolders } from "./folders";
import type { PocketFolder, PocketSyncSettings } from "../types";

interface PocketApiEnvelope<T> {
	success: boolean;
	data: T;
	error?: string;
	pagination?: {
		page: number;
		limit: number;
		total: number;
		total_pages: number;
		has_more: boolean;
	};
}

interface ListRecordingsParams {
	startDate?: string;
	endDate?: string;
	tagIds?: string[];
	page?: number;
	limit?: number;
}

interface RateLimitState {
	limit: number | null;
	remaining: number | null;
	resetAt: number | null;
}

type RateLimitWaitHandler = (waitMs: number, details: RateLimitState) => Promise<void> | void;

export class PocketApiError extends Error {
	status: number | null;

	constructor(message: string, status: number | null = null) {
		super(message);
		this.name = "PocketApiError";
		this.status = status;
	}
}

export class PocketApi {
	private readonly apiKey: string;
	private readonly retryCount: number;
	private readonly retryDelayMs: number;
	private readonly timeoutMs: number;
	private readonly verbose: boolean;
	private readonly onRateLimitWait?: RateLimitWaitHandler;
	private rateLimitState: RateLimitState = {
		limit: null,
		remaining: null,
		resetAt: null,
	};

	constructor(settings: PocketSyncSettings, onRateLimitWait?: RateLimitWaitHandler) {
		this.apiKey = settings.apiKey.trim();
		this.retryCount = DEFAULT_RETRY_COUNT;
		this.retryDelayMs = DEFAULT_RETRY_DELAY_MS;
		this.timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS;
		this.verbose = settings.verboseSyncLogging;
		this.onRateLimitWait = onRateLimitWait;
	}

	async testConnection(): Promise<{ tagCount: number }> {
		const tags = await this.listTags();
		return { tagCount: tags.length };
	}

	async listTags(): Promise<unknown[]> {
		const response = await this.request<unknown[]>("/public/tags");
		return response.data ?? [];
	}

 async listFolders(): Promise<PocketFolder[]> {
  const response = await this.request<unknown[]>("/public/folders");
  if (!Array.isArray(response.data)) throw new PocketApiError("Pocket returned an invalid folder catalog.");
  return normalizeFolders(response.data);
 }

	async listAllRecordings(params: ListRecordingsParams = {}): Promise<unknown[]> {
		const allItems: unknown[] = [];
		let page = params.page ?? 1;
		const limit = Math.min(params.limit ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);

		while (true) {
			const response = await this.request<unknown[]>("/public/recordings", {
				query: {
					start_date: params.startDate,
					end_date: params.endDate,
					tag_ids: params.tagIds?.join(","),
					page: String(page),
					limit: String(limit),
				},
			});

			allItems.push(...(response.data ?? []));

			if (!response.pagination?.has_more) {
				break;
			}

			page += 1;
		}

		return allItems;
	}

	async getRecordingDetails(
		recordingId: string,
		options: { includeTranscript: boolean; includeSummarizations: boolean },
	): Promise<unknown> {
		const response = await this.request<unknown>(`/public/recordings/${encodeURIComponent(recordingId)}`, {
			query: {
				include_transcript: String(options.includeTranscript),
				include_summarizations: String(options.includeSummarizations),
			},
		});

		return response.data;
	}

	private async request<T>(
		path: string,
		options: {
			method?: string;
			query?: Record<string, string | undefined>;
			body?: string;
		} = {},
	): Promise<PocketApiEnvelope<T>> {
		if (!this.apiKey) {
			throw new PocketApiError("Pocket API key is required before syncing.");
		}

		const url = new URL(`${POCKET_API_BASE_URL}${path}`);
		for (const [key, value] of Object.entries(options.query ?? {})) {
			if (value) {
				url.searchParams.set(key, value);
			}
		}

		let attempt = 0;

		while (true) {
			try {
				await this.waitForRateLimitResetIfNeeded(path);
				this.log("Pocket API request started", { path, attempt: attempt + 1 });
				const response = await withTimeout(
					requestUrl({
						url: url.toString(),
						method: options.method ?? "GET",
						headers: {
							Authorization: `Bearer ${this.apiKey}`,
							Accept: "application/json",
						},
						contentType: "application/json",
						body: options.body,
						throw: false,
					}),
					this.timeoutMs,
					`Pocket request timed out after ${Math.round(this.timeoutMs / 1000)} seconds: ${path}`,
				);

				const payload = response.json as PocketApiEnvelope<T>;
				this.updateRateLimitState(response.headers);

				if (response.status >= 200 && response.status < 300) {
                    if (payload.success === false) throw new PocketApiError("Pocket reported an unsuccessful response.", response.status);
					this.log("Pocket API request succeeded", {
						path,
						status: response.status,
						rateLimit: this.rateLimitState,
					});
					return payload;
				}

				if (response.status === 401) {
					throw new PocketApiError("Pocket rejected the API key. Open settings and test the connection again.", 401);
				}

				if (response.status === 429) {
					await this.waitForRateLimitReset(path, payload);
					continue;
				}

				if (response.status >= 500 && attempt < this.retryCount) {
					this.log("Pocket API request retrying", {
						path,
						status: response.status,
						attempt: attempt + 1,
					});
					attempt += 1;
					await sleep(this.retryDelayMs * attempt);
					continue;
				}

				throw new PocketApiError(payload.error || `Pocket request failed with status ${response.status}.`, response.status);
			} catch (error) {
				if (error instanceof PocketApiError) {
					throw error;
				}

				if (attempt < this.retryCount) {
					this.log("Pocket API request failed; retrying", {
						path,
						attempt: attempt + 1,
						error: error instanceof Error ? error.message : "Unknown error",
					});
					attempt += 1;
					await sleep(this.retryDelayMs * attempt);
					continue;
				}

				const message = error instanceof Error ? error.message : "Unknown Pocket API error.";
				throw new PocketApiError(message, null);
			}
		}
	}

	private log(message: string, details?: Record<string, unknown>): void {
		if (!this.verbose) {
			return;
		}

		console.debug(`[Pocket Sync] ${message}`, details ?? {});
	}

	private updateRateLimitState(headers: Record<string, string>): void {
		const limit = parseIntegerHeader(headers, "X-RateLimit-Limit");
		const remaining = parseIntegerHeader(headers, "X-RateLimit-Remaining");
		const resetAtSeconds = parseIntegerHeader(headers, "X-RateLimit-Reset");

		if (limit != null) {
			this.rateLimitState.limit = limit;
		}

		if (remaining != null) {
			this.rateLimitState.remaining = remaining;
		}

		if (resetAtSeconds != null) {
			this.rateLimitState.resetAt = resetAtSeconds * 1000;
		}
	}

	private async waitForRateLimitResetIfNeeded(path: string): Promise<void> {
		if (this.rateLimitState.remaining == null || this.rateLimitState.remaining > 0 || this.rateLimitState.resetAt == null) {
			return;
		}

		const waitMs = this.rateLimitState.resetAt - Date.now() + 1000;
		if (waitMs <= 0) {
			return;
		}

		this.log("Pocket API rate limit exhausted; waiting for reset", {
			path,
			waitMs,
			rateLimit: this.rateLimitState,
		});
		await this.notifyRateLimitWait(waitMs);
		await sleep(waitMs);
	}

	private async waitForRateLimitReset(path: string, payload: PocketApiEnvelope<unknown>): Promise<void> {
		const retryAfterMs = parseRetryAfterMs(payload);
		const resetWaitMs = this.rateLimitState.resetAt == null ? null : this.rateLimitState.resetAt - Date.now() + 1000;
		const waitMs = Math.max(retryAfterMs ?? 0, resetWaitMs ?? 0, 1000);
		this.log("Pocket API returned 429; waiting before retry", {
			path,
			waitMs,
			rateLimit: this.rateLimitState,
		});
		await this.notifyRateLimitWait(waitMs);
		await sleep(waitMs);
	}

	private async notifyRateLimitWait(waitMs: number): Promise<void> {
		await this.onRateLimitWait?.(waitMs, { ...this.rateLimitState });
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timeoutId = window.setTimeout(() => {
			reject(new PocketApiError(message, null));
		}, timeoutMs);

		promise
			.then((value) => {
				window.clearTimeout(timeoutId);
				resolve(value);
			})
			.catch((error: unknown) => {
				window.clearTimeout(timeoutId);
				reject(error instanceof Error ? error : new PocketApiError("Unknown Pocket request error.", null));
			});
	});
}

function parseIntegerHeader(headers: Record<string, string>, name: string): number | null {
	const rawValue = headers[name] ?? headers[name.toLowerCase()];
	if (!rawValue) {
		return null;
	}

	const parsed = Number.parseInt(rawValue, 10);
	return Number.isNaN(parsed) ? null : parsed;
}

function parseRetryAfterMs(payload: PocketApiEnvelope<unknown>): number | null {
	const value = asRecord(payload).retryAfter;
	if (typeof value !== "number") {
		return null;
	}

	return Math.max(0, value * 1000);
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

