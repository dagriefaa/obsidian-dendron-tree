import { App, LinkCache, MarkdownPostProcessor } from "obsidian";
import { DendronWorkspace } from "../engine/workspace";
import { renderLinkTitle } from "./link-render";

export interface LinkMarkdownProcessorOptions {
  /** When true, aliased wikilinks are left to obsidian's native rendering. */
  ignoreAliases?: boolean;
}

export function createLinkMarkdownProcessor(
  app: App,
  workspace: DendronWorkspace,
  options: LinkMarkdownProcessorOptions = {}
): MarkdownPostProcessor {
  // Embed containers (obsidian transclusions and dendron refs) host nested
  // renders that are handled by their own processor invocation with their own
  // sourcePath, so anchors inside them must not be processed here.
  const EMBED_SELECTOR = ".markdown-embed, .dendron-embed";

  return (el, ctx) => {
    const outerEmbedEl = el.closest(EMBED_SELECTOR);
    const linksEl = (Array.from(el.querySelectorAll(".internal-link")) as HTMLElement[]).filter(
      (anchor) => anchor.closest(EMBED_SELECTOR) === outerEmbedEl
    );

    if (linksEl.length === 0) return;

    const cache = app.metadataCache.getCache(ctx.sourcePath);
    if (!cache?.links) return;

    const processAnchor = (anchor: HTMLElement, link: LinkCache | undefined) => {
      let title: string | undefined, href: string;

      if (link) {
        // used to check is wikilink or not
        // aria-label and data-tooltip-position only appear when link is wikilink with alias
        if (!link.original.startsWith("[[") || !link.original.endsWith("]]")) return;

        const split = link.original.substring(2, link.original.length - 2).split("|", 2);
        if (split.length == 1) href = split[0];
        else {
          href = split[0];
          title = split[1];
        }
      } else {
        // No aligned cached link (e.g. embedded content rendered without
        // section info): derive from the rendered anchor itself and only
        // rewrite unambiguous wikilinks without an alias. Obsidian renders
        // those natively with the exact href as text, while aliased links and
        // subpath links show different text.
        href = anchor.getAttribute("data-href") ?? "";
        if (!href || href.endsWith(".md")) return;
        if (anchor.textContent !== href) return;
        title = undefined;
      }

      // when ignoring aliases, leave aliased wikilinks to native rendering
      if (title && options.ignoreAliases) return;

      const titleText = renderLinkTitle(app, workspace, href, title, ctx.sourcePath);
      anchor.setText(titleText);
      anchor.setAttribute("href", href);
      anchor.setAttribute("data-href", href);
      anchor.setAttribute("aria-label", href);
      anchor.setAttribute("data-tooltip-position", "top");
    };

    const section = ctx.getSectionInfo(el);
    let links: LinkCache[];
    if (section) {
      links = cache.links.filter(
        (link) =>
          link.position.start.line >= section.lineStart && link.position.end.line <= section.lineEnd
      );
    } else {
      // Embedded/transcluded content is rendered without section info; the
      // whole render corresponds to the whole cached file.
      links = cache.links;
    }

    if (links.length === linksEl.length) {
      linksEl.forEach((anchor, index) => {
        processAnchor(anchor, links[index]);
      });
      return;
    }

    // Count alignment failed (e.g. links inside code blocks or partially
    // rendered content): process each anchor without cached link info.
    linksEl.forEach((anchor) => {
      processAnchor(anchor, undefined);
    });
  };
}
