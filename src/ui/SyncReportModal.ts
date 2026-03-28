import { Modal } from "obsidian";

import type { SyncReport } from "../types";
import { formatDisplayDateTime } from "../utils/date";

export class SyncReportModal extends Modal {
	constructor(app: Modal["app"], private readonly report: SyncReport) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Pocket sync report" });

		const summary = contentEl.createEl("div");
		summary.createEl("p", { text: `Started: ${formatDisplayDateTime(this.report.startedAt)}` });
		summary.createEl("p", { text: `Finished: ${formatDisplayDateTime(this.report.finishedAt)}` });
		summary.createEl("p", { text: `Scope: ${this.report.scope}` });
		summary.createEl("p", { text: `Reason: ${this.report.reason}` });
		summary.createEl("p", { text: `Dry run: ${this.report.dryRun ? "Yes" : "No"}` });
		summary.createEl("p", { text: `Created: ${this.report.created}` });
		summary.createEl("p", { text: `Updated: ${this.report.updated}` });
		summary.createEl("p", { text: `Skipped: ${this.report.skipped}` });
		summary.createEl("p", { text: `Archived: ${this.report.archived}` });

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

