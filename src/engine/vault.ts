import { App, TAbstractFile, TFile, TFolder } from "obsidian";
import { NoteMetadata, Note, NoteTree } from "./note";
import { InvalidRootModal } from "../modal/invalid-root";
import { generateUUID, getFolderFile } from "../utils";
import { ParsedPath } from "../path";
import { toDatetimeString, FRONTMATTER_DATETIME_FORMAT } from "../datetime";

export interface VaultConfig {
  path: string;
  name: string;
}

export class DendronVault {
  folder: TFolder;
  tree: NoteTree;
  isIniatialized = false;

  constructor(public app: App, public config: VaultConfig) {}

  private resolveMetadata(file: TFile): NoteMetadata | undefined {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!frontmatter) return undefined;
    return {
      title: frontmatter["title"],
      navOrder: frontmatter["nav_order"],
      navExpand: frontmatter["nav_expand"],
    };
  }

  init() {
    if (this.isIniatialized) return;

    this.tree = new NoteTree();

    const root = getFolderFile(this.app.vault, this.config.path);
    if (!(root instanceof TFolder)) {
      new InvalidRootModal(this).open();
      return;
    }

    this.folder = root;

    for (const child of root.children)
      if (child instanceof TFile && this.isNote(child.extension))
        this.tree.addFile(child).syncMetadata(this.resolveMetadata(child));

    this.tree.sort();
    this.isIniatialized = true;
  }

  async createRootFolder() {
    return await this.app.vault.createFolder(this.config.path);
  }

  async createNote(baseName: string) {
    const filePath = `${this.config.path}/${baseName}.md`;
    return await this.app.vault.create(filePath, "");
  }

  /**
   * Fill missing Dendron frontmatter properties on a note's frontmatter object.
   * created/updated are written as datetime strings in the given moment format.
   */
  fillFrontmatter(frontmatter: Record<string, unknown>, note: Note) {
    const now = Date.now();
    if (!frontmatter.id) frontmatter.id = generateUUID();
    if (!frontmatter.title) frontmatter.title = note.title;
    if (frontmatter.desc === undefined) frontmatter.desc = "";
    if (!frontmatter.created)
      frontmatter.created = toDatetimeString(now, FRONTMATTER_DATETIME_FORMAT);
    if (!frontmatter.updated)
      frontmatter.updated = toDatetimeString(now, FRONTMATTER_DATETIME_FORMAT);
    return frontmatter;
  }

  isNote(extension: string) {
    return extension === "md";
  }

  onFileCreated(file: TAbstractFile): boolean {
    if (!(file instanceof TFile) || !this.isNote(file.extension)) return false;

    this.tree.addFile(file, true).syncMetadata(this.resolveMetadata(file));
    return true;
  }

  onMetadataChanged(file: TFile): boolean {
    if (!this.isNote(file.extension)) return false;

    const note = this.tree.getFromFileName(file.basename);
    if (!note) return false;

    note.syncMetadata(this.resolveMetadata(file));
    note.parent?.sortChildren(false);
    return true;
  }

  onFileDeleted(parsed: ParsedPath): boolean {
    if (!this.isNote(parsed.extension)) return false;

    const note = this.tree.deleteByFileName(parsed.basename);
    if (note?.parent) {
      note.syncMetadata(undefined);
    }
    return true;
  }
}
