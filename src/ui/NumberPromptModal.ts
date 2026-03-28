import { Modal, Setting, TextComponent } from "obsidian";

export class NumberPromptModal extends Modal {
	private value: string;
	private readonly onSubmit: (value: number) => void;
	private readonly description: string;
	private readonly titleText: string;

	constructor(
		app: Modal["app"],
		options: {
			title: string;
			description: string;
			initialValue: number;
			onSubmit: (value: number) => void;
		},
	) {
		super(app);
		this.value = String(options.initialValue);
		this.onSubmit = options.onSubmit;
		this.description = options.description;
		this.titleText = options.title;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: this.titleText });
		contentEl.createEl("p", { text: this.description });

		let inputComponent: TextComponent | null = null;
		new Setting(contentEl)
			.setName("Days")
			.setDesc("Enter a whole number of days.")
			.addText((text) => {
				inputComponent = text;
				text.setPlaceholder("7");
				text.setValue(this.value);
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text.onChange((value) => {
					this.value = value;
				});
			});

		new Setting(contentEl)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(() => {
					this.close();
				}),
			)
			.addButton((button) =>
				button
					.setButtonText("Run")
					.setCta()
					.onClick(() => {
						const parsedValue = Number.parseInt(this.value, 10);
						if (Number.isNaN(parsedValue) || parsedValue < 1) {
							inputComponent?.inputEl.focus();
							return;
						}

						this.close();
						this.onSubmit(parsedValue);
					}),
			);

		window.setTimeout(() => inputComponent?.inputEl.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

