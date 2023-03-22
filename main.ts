import { spawn } from 'child_process';
import { homedir } from 'os';
import { stat } from 'fs/promises'
import { App, EditorPosition, MarkdownRenderChild, MarkdownView, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { syntaxTree, tokenClassNodeProp } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import {
	Decoration,
	DecorationSet,
	EditorView,
	PluginSpec,
	PluginValue,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import { SyntaxNodeRef } from '@lezer/common';

// Remember to rename these classes and interfaces!
interface MonolithPluginSettings {
	cliOpts: string[];
	outputPath: string;
}

const DEFAULT_SETTINGS: MonolithPluginSettings = {
	cliOpts: ['--no-js', '--isolate'],
	outputPath: homedir()
}


class MonoViewPlugin implements PluginValue {
	decorations: DecorationSet;
	constructor(view: EditorView) {
		this.decorations = this.buildDecorations(view);
	}

	update(update: ViewUpdate) {
		// window.console.log("update: ", update);
		if (update.docChanged || update.viewportChanged) {
			this.decorations = this.buildDecorations(update.view);
		}
	}

	destroy() {
	}

	buildDecorations(view: EditorView): DecorationSet {
		const builder = new RangeSetBuilder<Decoration>();

		for (let { from, to } of view.visibleRanges) {
			for (let pos = from; pos <= to;) {
				const line = view.state.doc.lineAt(pos);
				pos = line.to + 1
				// console.log("line: ", line)
			}


			// syntaxTree(view.state).iterate({
			// 	from,
			// 	to,
			// 	enter(node: SyntaxNodeRef) {


			// 		const tokenProps = node.type.prop(tokenClassNodeProp);

			// 		if (tokenProps) {
			// 			const props = new Set(tokenProps.split(" "));
			// 			// console.log("props: ", props)

			// 			const isUrl = props.has("url");

			// 			if (isUrl) {
			// 				console.log("url? ", view.state.doc.lineAt(from))
			// 			}
			// 		}


			// 	}
			// })
		}

		return builder.finish();
	}
}

class LinkWidget extends WidgetType {
	toDOM(view: EditorView): HTMLElement {
		const div = document.createElement("a");

		div.innerText = "bazinga";
		return div;
	}

	onclick(e: Event) {
		e.preventDefault();

		window.open((e.target as HTMLAnchorElement).href);
	}
}

const pluginSpec: PluginSpec<MonoViewPlugin> = {
	decorations: (value: MonoViewPlugin) => value.decorations,
}


export default class MonolithPlugin extends Plugin {
	settings: MonolithPluginSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new SettingTab(this.app, this));

		this.registerMarkdownPostProcessor((element, context) => {
			const links = element.querySelectorAll("a.archivedLink");

			for (let index = 0; index < links.length; index++) {
				const link = links.item(index);
				// @ts-ignore
				context.addChild(new ArchiveLink(link));
			}
		});

		const hm = ViewPlugin.fromClass(MonoViewPlugin, pluginSpec);
		this.registerEditorExtension([hm]);

		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'archive-link',
			name: 'Archive link',
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				const potentialUrl = view?.editor.getSelection() || "";
				const from = view?.editor.getCursor("from");

				let url;
				try {
					url = new URL(potentialUrl);
				} catch (e) {
					// ignore
				}


				if (view && url && from) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						this.archiveLink(view, url, from);
					}

					return true;
				}
			}
		});
	}

	archiveLink(view: MarkdownView, url: URL, from: EditorPosition) {
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
				const anchorString = `<a class="archivedLink" href="file://${this.settings.outputPath}/${outputFile}">(archived)</a>`;
				// add link to output file
				view.editor.setSelection(`${url.toString()} ${anchorString}`, from)
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

export class ArchiveLink extends MarkdownRenderChild {
	constructor(containerEl: HTMLElement) {
		super(containerEl);
	}

	openLink(e: Event) {
		e.preventDefault();
		// @ts-ignore
		window.open(this.containerEl.href);
	}

	onload() {
		this.containerEl.onclick = this.openLink.bind(this);
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
