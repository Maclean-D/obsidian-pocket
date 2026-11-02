import { Modal } from "obsidian";

import type { SyncReport } from "../types";
import { formatRecordingDateTime } from "../notes/metadata";

export class SyncReportModal extends Modal {
	constructor(app: Modal["app"], private readonly report: SyncReport, private readonly timeZone = "Europe/Madrid") {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Pocket sync report" });

		const summary = contentEl.createDiv();
		summary.createEl("p", { text: `Started: ${formatRecordingDateTime(this.report.startedAt, this.timeZone)}` });
		summary.createEl("p", { text: `Finished: ${formatRecordingDateTime(this.report.finishedAt, this.timeZone)}` });
		summary.createEl("p", { text: `Scope: ${this.report.scope}` });
		summary.createEl("p", { text: `Reason: ${this.report.reason}` });
		summary.createEl("p", { text: `Dry run: ${this.report.dryRun ? "Yes" : "No"}` });
		summary.createEl("p", { text: `Files created: ${this.report.created}` });
		summary.createEl("p", { text: `Files updated: ${this.report.updated}` });
		summary.createEl("p", { text: `Skipped: ${this.report.skipped}` });
		summary.createEl("p", { text: `Files archived: ${this.report.archived}` });

        summary.createEl("p", { text: `Recordings processed: ${new Set(this.report.processedIds).size}` });
        summary.createEl("p", { text: `Files moved: ${this.report.moved ?? 0}` });
        summary.createEl("p", { text: `Property-only updates: ${this.report.propertiesUpdated ?? 0}` });
        summary.createEl("p", { text: `Pending summaries: ${this.report.pending ?? 0}` });
        summary.createEl("p", { text: `Conflicts: ${this.report.conflicts ?? 0}` });
        if (this.report.plan?.length) {
            contentEl.createEl("h3", { text: this.report.dryRun ? "Preview plan" : "Operation plan" });
            const list = contentEl.createEl("ul");
            for (const entry of this.report.plan) list.createEl("li", { text: `${entry.action}: ${entry.sourcePath ? entry.sourcePath + " → " : ""}${entry.targetPath}${entry.reason ? " — " + entry.reason : ""}` });
        }

		if (this.report.warnings.length > 0) {
			contentEl.createEl("h3", { text: "Warnings" });
			const warningList = contentEl.createEl("ul");
			for (const warning of this.report.warnings) {
				warningList.createEl("li", { text: warning });
			}
		}

		if (this.report.errors.length > 0) {
			contentEl.createEl("h3", { text: "Errors" });
			const errorList = contentEl.createEl("ul");
			for (const error of this.report.errors) {
				errorList.createEl("li", { text: error });
			}
		}

		if (this.report.processedIds.length > 0) {
			contentEl.createEl("h3", { text: "Pocket ids" });
			const pre = contentEl.createEl("pre");
			pre.setText(this.report.processedIds.join("\n"));
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

