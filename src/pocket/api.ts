import { requestUrl } from "obsidian";

import { DEFAULT_RETRY_COUNT, DEFAULT_RETRY_DELAY_MS, MAX_PAGE_SIZE, POCKET_API_BASE_URL } from "../constants";
import type { PocketSyncSettings } from "../types";

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
	private readonly verbose: boolean;

	constructor(settings: PocketSyncSettings) {
		this.apiKey = settings.apiKey.trim();
		this.retryCount = DEFAULT_RETRY_COUNT;
		this.retryDelayMs = DEFAULT_RETRY_DELAY_MS;
		this.verbose = settings.verboseSyncLogging;
	}

	async testConnection(): Promise<{ tagCount: number }> {
		const tags = await this.listTags();
		return { tagCount: tags.length };
	}

	async listTags(): Promise<unknown[]> {
		const response = await this.request<unknown[]>("/public/tags");
		return response.data ?? [];
	}

	async listAllRecordings(params: ListRecordingsParams): Promise<unknown[]> {
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
				const response = await requestUrl({
					url: url.toString(),
					method: options.method ?? "GET",
					headers: {
						Authorization: `Bearer ${this.apiKey}`,
						Accept: "application/json",
					},
					contentType: "application/json",
					body: options.body,
					throw: false,
				});

				const payload = response.json as PocketApiEnvelope<T>;

				if (response.status >= 200 && response.status < 300) {
					this.log("Pocket API request succeeded", {
						path,
						status: response.status,
					});
					return payload;
				}

				if (response.status === 401) {
					throw new PocketApiError("Pocket rejected the API key. Open settings and test the connection again.", 401);
				}

				if ((response.status === 429 || response.status >= 500) && attempt < this.retryCount) {
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
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

