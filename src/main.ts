import { Menu, Plugin, TAbstractFile, TFile, addIcon } from "obsidian";
import { DendronView, VIEW_TYPE_DENDRON } from "./view";
import { activeFile, dendronVaultList } from "./store";
import { LookupModal } from "./modal/lookup";
import { dendronActivityBarIcon, dendronActivityBarName } from "./icons";
import { DEFAULT_SETTINGS, DendronTreePluginSettings, DendronTreeSettingTab } from "./settings";
import { parsePath } from "./path";
import { legacyToDatetime, FRONTMATTER_DATETIME_FORMAT } from "./datetime";
import { moment } from "obsidian";
import type MomentDefault from "moment";
import { DendronWorkspace } from "./engine/workspace";
import { CustomResolver } from "./custom-resolver";
import { CustomGraph } from "./custom-graph";

/** Delay after the last edit before the updated-on-edit frontmatter write happens */
const MODIFIED_UPDATE_DELAY = 5000;
/** Window after our own frontmatter writes during which modified-time timers are retried */
const FRONTMATTER_GUARD_MS = 10000;
/** Window in which the last observed file modification is known to be our own frontmatter write */
const OWN_WRITE_WINDOW_MS = 2000;

export default class DendronTreePlugin extends Plugin {
  settings: DendronTreePluginSettings;
  workspace: DendronWorkspace = new DendronWorkspace(this.app);
  customResolver?: CustomResolver;
  customGraph?: CustomGraph;

  /** Debounce timers for the updated-on-edit write, by file path */
  private updateTimers = new Map<string, number>();
  /** Suppresses modified-time updates right after our own frontmatter writes */
  private frontmatterWriteGuard = new Map<string, number>();
  /** Paths whose in-flight file write is one of our own frontmatter writes */
  private frontmatterWriteInFlight = new Set<string>();
  /** Paths whose last observed modification was caused by our own frontmatter write */
  private ownWriteRecent = new Map<string, number>();

  async onload() {
    await this.loadSettings();
    await this.migrateSettings();

    addIcon(dendronActivityBarName, dendronActivityBarIcon);

    this.addCommand({
      id: "dendron-lookup",
      name: "Lookup Note",
      callback: () => {
        new LookupModal(this.app, this.workspace, this.app.workspace.getActiveFile()?.basename).open();
      },
    });

    this.addSettingTab(new DendronTreeSettingTab(this.app, this));

    this.registerView(VIEW_TYPE_DENDRON, (leaf) => new DendronView(leaf, this));

    this.addRibbonIcon(dendronActivityBarName, "Open Dendron Tree", () => {
      this.activateView();
    });

    this.app.workspace.onLayoutReady(() => {
      this.onRootFolderChanged();

      this.registerEvent(this.app.vault.on("create", this.onCreateFile));
      this.registerEvent(this.app.vault.on("modify", this.onModifyFile));
      this.registerEvent(this.app.vault.on("delete", this.onDeleteFile));
      this.registerEvent(this.app.vault.on("rename", this.onRenameFile));
      this.registerEvent(this.app.metadataCache.on("resolve", this.onResolveMetadata));
      this.registerEvent(this.app.workspace.on("file-open", this.onOpenFile, this));
      this.registerEvent(this.app.workspace.on("file-menu", this.onFileMenu));

      setTimeout(() => this.onOpenFile(this.app.workspace.getActiveFile() || null), 50);
    });

    this.configureCustomResolver();
    this.configureCustomGraph();
  }

  async migrateSettings() {
    function pathToVaultConfig(path: string) {
      const { name } = parsePath(path);
      if (name.length === 0)
        return {
          name: "root",
          path: "/",
        };
      let processed = path;
      if (processed.endsWith("/")) processed = processed.slice(0, -1);
      if (processed.startsWith("/") && processed.length > 1) processed = processed.slice(1);
      return {
        name,
        path: processed,
      };
    }

    if (this.settings.vaultPath) {
      this.settings.vaultList = [pathToVaultConfig(this.settings.vaultPath)];
      this.settings.vaultPath = undefined;
      await this.saveSettings();
    }
    if (this.settings.vaultList.length > 0 && typeof this.settings.vaultList[0] === "string") {
      this.settings.vaultList = (this.settings.vaultList as unknown as string[]).map((path) =>
        pathToVaultConfig(path)
      );
      await this.saveSettings();
    }
  }

  onunload() {
    this.updateTimers.forEach((timer) => window.clearTimeout(timer));
    this.updateTimers.clear();
  }

  onRootFolderChanged() {
    this.workspace.changeVault(this.settings.vaultList);
    this.updateNoteStore();
  }

  configureCustomResolver() {
    if (this.settings.customResolver && !this.customResolver) {
      this.customResolver = new CustomResolver(this, this.workspace);
      this.addChild(this.customResolver);
    } else if (!this.settings.customResolver && this.customResolver) {
      this.removeChild(this.customResolver);
      this.customResolver = undefined;
    }
  }

  configureCustomGraph() {
    if (this.settings.customGraph && !this.customGraph) {
      this.customGraph = new CustomGraph(this, this.workspace);
      this.addChild(this.customGraph);
    } else if (!this.settings.customGraph && this.customGraph) {
      this.removeChild(this.customGraph);
      this.customGraph = undefined;
    }
  }

  updateNoteStore() {
    dendronVaultList.set(this.workspace.vaultList);
  }

  onCreateFile = async (file: TAbstractFile) => {
    const vault = this.workspace.findVaultByParent(file.parent);
    if (vault && vault.onFileCreated(file)) {
      if (this.settings.autoGenerateFrontmatter && file instanceof TFile && file.stat.size === 0) {
        const note = vault.tree.getFromFileName(file.basename);
        if (note) {
          await this.writeFrontMatterGuarded(file, (frontmatter) =>
            vault.fillFrontmatter(frontmatter, note)
          );
        }
      }
      this.updateNoteStore();
    }
  };

  onModifyFile = (file: TAbstractFile) => {
    if (!(file instanceof TFile)) return;
    const vault = this.workspace.findVaultByParentPath(parsePath(file.path).dir);
    if (!vault || !vault.isNote(file.extension)) return;

    if (this.frontmatterWriteInFlight.has(file.path)) {
      // This modification is our own frontmatter write, there was no user edit
      this.ownWriteRecent.set(file.path, Date.now() + OWN_WRITE_WINDOW_MS);
      return;
    }

    const existingTimer = this.updateTimers.get(file.path);
    if (existingTimer) window.clearTimeout(existingTimer);
    this.updateTimers.set(
      file.path,
      window.setTimeout(() => this.updateModifiedTime(file), MODIFIED_UPDATE_DELAY)
    );
  };

  private async updateModifiedTime(file: TFile) {
    this.updateTimers.delete(file.path);

    const guard = this.frontmatterWriteGuard.get(file.path);
    if (guard && guard > Date.now()) {
      // Our own frontmatter write recently happened or is still in flight, retry later
      this.updateTimers.set(
        file.path,
        window.setTimeout(
          () => this.updateModifiedTime(file),
          Math.max(guard - Date.now(), 0) + 100
        )
      );
      return;
    }

    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!frontmatter || frontmatter["updated"] === undefined) return;

    const ownWrite = this.ownWriteRecent.get(file.path);
    if (ownWrite && ownWrite > Date.now()) return;

    const now = (moment as unknown as typeof MomentDefault)().format(FRONTMATTER_DATETIME_FORMAT);
    if (frontmatter["updated"] === now) return;

    await this.writeFrontMatterGuarded(file, (frontmatter) => {
      frontmatter["updated"] = now;
    });
  }

  /**
   * Convert legacy unix millisecond created/updated frontmatter values to
   * datetime strings when a note is opened.
   */
  private async migrateNoteTimestamps(file: TFile) {
    try {
      const vault = this.workspace.findVaultByParentPath(parsePath(file.path).dir);
      if (!vault || !vault.isNote(file.extension)) return;

      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter) return;
      const format = FRONTMATTER_DATETIME_FORMAT;
      if (
        legacyToDatetime(frontmatter["created"], format) === undefined &&
        legacyToDatetime(frontmatter["updated"], format) === undefined
      )
        return;

      await this.writeFrontMatterGuarded(file, (frontmatter) => {
        const created = legacyToDatetime(frontmatter["created"], format);
        if (created !== undefined) frontmatter["created"] = created;
        const updated = legacyToDatetime(frontmatter["updated"], format);
        if (updated !== undefined) frontmatter["updated"] = updated;
      });
    } catch (error) {
      console.error("DendronTree: failed to migrate note timestamps", file.path, error);
    }
  }

  /** Write frontmatter changes via processFrontMatter */
  private async writeFrontMatterIn(
    file: TFile,
    generate: (frontmatter: Record<string, unknown>) => void
  ) {
    this.frontmatterWriteInFlight.add(file.path);
    try {
      await this.app.fileManager.processFrontMatter(file, generate);
    } finally {
      this.frontmatterWriteInFlight.delete(file.path);
    }
  }

  /** Write frontmatter while suppressing the modified-time update listener */
  private async writeFrontMatterGuarded(
    file: TFile,
    generate: (frontmatter: Record<string, unknown>) => void
  ) {
    this.frontmatterWriteGuard.set(file.path, Date.now() + FRONTMATTER_GUARD_MS);
    await this.writeFrontMatterIn(file, generate);
    this.frontmatterWriteGuard.set(file.path, Date.now() + FRONTMATTER_GUARD_MS);
  }

  onDeleteFile = (file: TAbstractFile) => {
    // file.parent is null when file is deleted
    const parsed = parsePath(file.path);
    const vault = this.workspace.findVaultByParentPath(parsed.dir);
    if (vault && vault.onFileDeleted(parsed)) {
      this.updateNoteStore();
    }
  };

  onRenameFile = (file: TAbstractFile, oldPath: string) => {
    const oldParsed = parsePath(oldPath);
    const oldVault = this.workspace.findVaultByParentPath(oldParsed.dir);
    let update = false;
    if (oldVault) {
      update = oldVault.onFileDeleted(oldParsed);
    }

    const newVault = this.workspace.findVaultByParent(file.parent);
    if (newVault) {
      update = newVault.onFileCreated(file) || update;
    }
    if (update) this.updateNoteStore();
  };

  onOpenFile = (file: TFile | null) => {
    activeFile.set(file);
    if (file && this.settings.autoReveal) this.revealFile(file);
    if (file) void this.migrateNoteTimestamps(file);
  };

  onFileMenu = (menu: Menu, file: TAbstractFile) => {
    if (!(file instanceof TFile)) return;

    menu.addItem((item) => {
      item
        .setIcon(dendronActivityBarName)
        .setTitle("Reveal in Dendron Tree")
        .onClick(() => this.revealFile(file));
    });
  };

  onResolveMetadata = (file: TFile) => {
    const vault = this.workspace.findVaultByParent(file.parent);
    if (vault && vault.onMetadataChanged(file)) {
      this.updateNoteStore();
    }
  };

  revealFile(file: TFile) {
    const vault = this.workspace.findVaultByParent(file.parent);
    if (!vault) return;
    const note = vault.tree.getFromFileName(file.basename);
    if (!note) return;
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DENDRON)) {
      if (!(leaf.view instanceof DendronView)) continue;
      leaf.view.component.focusTo(vault, note);
    }
  }

  async activateView() {
    const leafs = this.app.workspace.getLeavesOfType(VIEW_TYPE_DENDRON);
    if (leafs.length == 0) {
      const leaf = this.app.workspace.getLeftLeaf(false);
      await leaf.setViewState({
        type: VIEW_TYPE_DENDRON,
        active: true,
      });
      this.app.workspace.revealLeaf(leaf);
    } else {
      leafs.forEach((leaf) => this.app.workspace.revealLeaf(leaf));
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
