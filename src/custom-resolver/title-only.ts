import { Component, MarkdownPreviewRenderer, Plugin } from "obsidian";
import { ViewPlugin } from "@codemirror/view";
import { DendronWorkspace } from "../engine/workspace";
import { createLinkMarkdownProcessor } from "./link-markdown-processor";
import { LinkLivePlugin } from "./link-live";

/**
 * A lightweight variant of the custom resolver that only renders wikilinks
 * without an alias as the target note's frontmatter title.
 *
 * Wikilinks with an alias are left completely to obsidian's native rendering
 * (they already show their alias), and none of the other custom resolver
 * features (dendron ref/embed resolution, hover preview patching, openLinkText
 * handling) are activated.
 */
export class TitleOnlyResolver extends Component {
	linkPostProcessor = createLinkMarkdownProcessor(this.plugin.app, this.workspace, {
		ignoreAliases: true,
	});
	linkEditorExtension = ViewPlugin.define(
		(view) => {
			return new LinkLivePlugin(this.plugin.app, this.workspace, view, true);
		},
		{
			decorations: (value) => value.decorations,
		}
	);

	constructor(public plugin: Plugin, public workspace: DendronWorkspace) {
		super();
	}

	onload(): void {
		MarkdownPreviewRenderer.registerPostProcessor(this.linkPostProcessor);
		this.plugin.app.workspace.registerEditorExtension(this.linkEditorExtension);
	}

	onunload(): void {
		this.plugin.app.workspace.unregisterEditorExtension(this.linkEditorExtension);
		MarkdownPreviewRenderer.unregisterPostProcessor(this.linkPostProcessor);
	}
}
