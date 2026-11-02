import { App, TFile } from "obsidian";
import type { PocketTrackedRecord } from "../types";
import { safePath } from "../core/paths";
import { SyncStateStore } from "./stateStore";

export interface JournalOperation {
	id: string;
	recordingIds: string[];
	sourcePath: string | null;
	targetPath: string;
	kind: "write" | "archive";
	nextRecords?: PocketTrackedRecord[];
	expectedContent?: string;
	previousContent?: string;
}

/** The intent is durable before IO; paths become authoritative only after successful IO. */
export async function beginOperation(store: SyncStateStore, operation: JournalOperation): Promise<void> {
	store.state.pendingOperations = [...(store.state.pendingOperations ?? []), operation];
	await store.persist();
}

export async function finishOperation(store: SyncStateStore, operation: JournalOperation): Promise<void> {
	store.upsertRecords(operation.nextRecords ?? []);
	store.state.pendingOperations = (store.state.pendingOperations ?? []).filter((entry) => entry.id !== operation.id);
	await store.persist();
}

/** Recovery only reconciles completed moves/creates; unfinished content is fetched again. */
export async function recoverOperations(app: App, store: SyncStateStore): Promise<void> {
	for (const operation of [...(store.state.pendingOperations ?? [])] as JournalOperation[]) {
		safePath(operation.targetPath);
		if (operation.sourcePath) safePath(operation.sourcePath);
		const target = app.vault.getAbstractFileByPath(operation.targetPath);
		const source = operation.sourcePath ? app.vault.getAbstractFileByPath(operation.sourcePath) : null;
		if (target && source && operation.targetPath !== operation.sourcePath) {
			throw new Error(`Recovery conflict: both source and destination exist for ${operation.id}`);
		}
		if (target instanceof TFile) {
			const content = await app.vault.read(target);
			if (content !== operation.expectedContent && !(operation.sourcePath && content === operation.previousContent)) {
				throw new Error(`Recovery conflict: target content does not match the recorded operation: ${operation.targetPath}`);
			}
			for (const record of operation.nextRecords ?? []) {
				// A process may have stopped between rename and content update.
				record.lastSourceUpdatedAt = "";
				record.lastContentSyncedAt = undefined;
			}
			await finishOperation(store, operation);
		} else if (target) {
			throw new Error(`Recovery conflict: target is not a note: ${operation.targetPath}`);
		} else {
			// No IO happened (or source remains); discard intent and rebuild the plan.
			store.state.pendingOperations = (store.state.pendingOperations ?? []).filter((entry) => entry.id !== operation.id);
			await store.persist();
		}
	}
}
