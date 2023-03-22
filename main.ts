import { spawn } from 'child_process';
import { homedir } from 'os';
import { stat } from 'fs/promises'
import { App, EditorPosition, MarkdownView, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

// Remember to rename these classes and interfaces!
interface MonolithPluginSettings {
	cliOpts: string[];
	outputPath: string;
}

interface Range {
	from: EditorPosition
	to: EditorPosition
}

const DEFAULT_SETTINGS: MonolithPluginSettings = {
	cliOpts: ['--no-js', '--isolate'],
	outputPath: homedir()
}

export default class MonolithPlugin extends Plugin {
	settings: MonolithPluginSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new SettingTab(this.app, this));

		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'archive-link',
			name: 'Archive link',
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) return true;

				const potentialUrl = view.editor.getSelection() || "";
				const range = { from: view.editor.getCursor("from"), to: view.editor.getCursor("to") };

				let url;
				try {
					url = new URL(potentialUrl);
				} catch (e) {
					// ignore
				}


				if (url) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						this.archiveLink(view, url, range);
					}

					return true;
				}
			}
		});
	}

	archiveLink(view: MarkdownView, url: URL, range: Range) {
		const path = url.pathname.split('/');
		// trailing slash is falsy
		const outputFile = `${path.pop() || path.pop()}.html`;
		const baseArgs = [`-o${outputFile}`, url.toString()];
		const args = (this.settings.cliOpts[0] !== '') ? [...this.settings.cliOpts, ...baseArgs] : baseArgs;
		const spawnOpts = { cwd: this.settings.outputPath };

		const monolith = spawn('monolith', args, spawnOpts);

		monolith.stdout.on('data', (data) => {
			console.log(data.toString());
		});
		monolith.stderr.on('data', (data) => {
			console.log(data.toString());
		});
		monolith.on('close', (code) => {
			if (code === 0) {
				const linkString = `[(archived)](file://${this.settings.outputPath}/${outputFile})`
				// add link to output file
				view.editor.setSelection(range.to, range.from);
				view.editor.replaceSelection(`${url.toString()} ${linkString}`)
				new Notice('Link archived!');
			} else {
				new Notice('Archiving failed, check console.')
			}
		});
	}

	onunload() {
		// maybe clean up links
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SettingTab extends PluginSettingTab {
	plugin: MonolithPlugin;

	constructor(app: App, plugin: MonolithPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Monolith plugin settings' });

		new Setting(containerEl)
			.setName('Flags')
			.setDesc('Used when invoking Monolith.')
			.addText(text => text
				.setPlaceholder('monolith --help')
				.setValue(this.plugin.settings.cliOpts.join(' '))
				.onChange(async (value) => {
					this.plugin.settings.cliOpts = value.split(' ');
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Output folder')
			.setDesc('Where archived pages will be saved.')
			.addText(text => text
				.setPlaceholder('$HOME')
				.setValue(this.plugin.settings.outputPath)
				.onChange(async (value) => {
					let stats;
					try {
						stats = await stat(value);
					} catch (e) {
						if (!containerEl.querySelector('.outErr')) {
							containerEl.createEl('h2', { text: `Invalid path will not be saved.`, cls: 'outErr' })
						}
					}

					if (stats && stats.isDirectory()) {
						this.plugin.settings.outputPath = value;
						await this.plugin.saveSettings();

						const err = containerEl.querySelector('.outErr');
						if (err) {
							containerEl.removeChild(err);
						}
					}
				}));
	}
}
