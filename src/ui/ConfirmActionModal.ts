import { Modal, Setting } from "obsidian";

export class ConfirmActionModal extends Modal {
	constructor(
		app: Modal["app"],
		private readonly options: {
			title: string;
			description: string;
			confirmText: string;
			onConfirm: () => void;
		},
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: this.options.title });
		contentEl.createEl("p", { text: this.options.description });

		new Setting(contentEl)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(() => {
					this.close();
				}),
			)
			.addButton((button) =>
				button
					.setButtonText(this.options.confirmText)
					.setCta()
					.onClick(() => {
						this.close();
						this.options.onConfirm();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

