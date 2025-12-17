import { App, SuggestModal, getIcon } from "obsidian";
import { Note } from "../engine/note";
import { openFile } from "../utils";
import { DendronVault } from "../engine/vault";
import { SelectVaultModal } from "./select-vault";
import { DendronWorkspace } from "../engine/workspace";
import { CreateNoteWarning } from "./create-note-warning";

interface LookupItem {
  note: Note;
  vault: DendronVault;
}

export class LookupModal extends SuggestModal<LookupItem | null> {
  constructor(app: App, private workspace: DendronWorkspace, private initialQuery: string = "") {
    super(app);
    this.scope.register([], "Tab", (evt) => {
      const selectedElement = this.resultContainerEl.querySelector(".is-selected") as HTMLElement | null;
      if (selectedElement) {
        const path = selectedElement.dataset["path"];
        if (path) {
          this.inputEl.value = path;
          this.inputEl.dispatchEvent(new Event("input"));
        }
      }
    })
  }

  onOpen(): void {
    super.onOpen();
    if (this.initialQuery.length > 0) {
      this.inputEl.value = this.initialQuery;
      this.inputEl.dispatchEvent(new Event("input"));
    }
  }

  getSuggestions(query: string): (LookupItem | null)[] {
    const queryLowercase = query.toLowerCase().trim();
    let result: (LookupItem)[]
      = this.workspace.vaultList.flatMap(
        vault => vault.tree.flatten().map(note => ({ note, vault }))
      );

    // if prefixed by ?, search by title
    if (queryLowercase.startsWith("?")) {
      const titleQuery = queryLowercase.substring(1);
      result = result.filter(item => item.note.title.toLowerCase().includes(titleQuery))
        .sort((a, b) => this.sortByDistance(a, b, titleQuery));
      return result;
    }
          
    // if empty string, show all 1st level results
    if (queryLowercase.length === 0) {
      return result.filter(item => !item.note.getPath().includes('.'))
    }

    // otherwise show first all that start with query sorted, then those that contain it sorted
    const startsWithResults = result.filter(item => 
      item.note.getPath().toLowerCase().startsWith(queryLowercase))
      .sort((a, b) => this.sortByDistance(a, b, queryLowercase));
    const containsResults = result.filter(item => 
      !item.note.getPath().toLowerCase().startsWith(queryLowercase)
        && item.note.getPath().toLowerCase().includes(queryLowercase))
      .sort((a, b) => this.sortByDistance(a, b, queryLowercase));
    result = [...startsWithResults, ...containsResults];

    // add 'create new' if no exact match
    const firstResult = result.find(() => true)?.note.getPath().toLowerCase();
    if (queryLowercase.length > 0 
      && !queryLowercase?.endsWith('.')
      && firstResult !== queryLowercase) {
        return [null, ...result]
    }

    return result;
  }

  renderSuggestion(item: LookupItem | null, el: HTMLElement) {
    el.classList.add("mod-complex");
    const path = item?.note.getPath();
    if (path) {
      el.dataset["path"] = path;
    }
    el.createEl("div", { cls: "suggestion-content" }, (el) => {
      el.createEl("div", { text: item?.note.title ?? "Create New", cls: "suggestion-title" });
      el.createEl("small", { cls: "suggestion-content suggestion-content-row", }, el => {
        if (!item) {
          el.setText("Note does not exist");
          return
        }
        const query = this.inputEl.value;
        const path = item.note.getPath();
        
        // if path contains query, bold that part
        const index = path.toLowerCase().indexOf(query.toLowerCase());
        if (!query.startsWith('?') && index >= 0) {
          const boldPart = path.substring(index, index + query.length);
          const restPart1 = path.substring(0, index);
          const restPart2 = path.substring(index + query.length);
          el.appendText(restPart1);
          el.createEl("span", { text: boldPart, cls: "suggestion-highlight" });
          el.appendText(restPart2);
        } else {
          el.setText(path);
        }
      });
    });
    if (!item || !item.note.file)
      el.createEl("div", { cls: "suggestion-aux" }, (el) => {
        el.append(getIcon("plus")!);
      });
  }
  async onChooseSuggestion(item: LookupItem | null, evt: MouseEvent | KeyboardEvent) {
    if (item && item.note.file) {
      openFile(this.app, item.note.file);
      return;
    }

    const path = item ? item.note.getPath() : this.inputEl.value;

    const doCreateInternal = async (vault: DendronVault, path: string) => {
      const file = await vault.createNote(path);
      return openFile(vault.app, file);
    };

    const doCreate = async (vault: DendronVault) => {
      if (path.startsWith("root.")) {
        const modal = new CreateNoteWarning(this.app, path, async (omitRoot) => {
          const newPath = omitRoot ? path.substring(path.indexOf(".") + 1) : path;
          doCreateInternal(vault, newPath);
        });
        modal.open();
        return Promise.resolve();
      }
      return doCreateInternal(vault, path);
    };
    if (item?.vault) {
      await doCreate(item.vault);
    } else if (this.workspace.vaultList.length == 1) {
      await doCreate(this.workspace.vaultList[0]);
    } else {
      new SelectVaultModal(this.app, this.workspace, doCreate).open();
    }
  }

  /**
   * Computes the Damerau-Levenshtein distance between two strings.
   * If the distance exceeds `threshold`, returns Number.MAX_SAFE_INTEGER.
   *
   * Note: Uses Array.from to iterate by code point (better Unicode handling).
   *
   * @param source first string
   * @param target second string
   * @param threshold maximum allowable distance
   * @returns distance or Number.MAX_SAFE_INTEGER if threshold exceeded
   */
  damerauLevenshteinDistance(source: string, target: string, threshold: number): number {
    let sa = Array.from(source);
    let ta = Array.from(target);

    let length1 = sa.length;
    let length2 = ta.length;

    if (Math.abs(length1 - length2) > threshold) {
      return Number.MAX_SAFE_INTEGER;
    }

    // Ensure sa is the shorter sequence
    if (length1 > length2) {
      [sa, ta] = [ta, sa];
      [length1, length2] = [length2, length1];
    }

    const maxi = length1;
    const maxj = length2;

    let dCurrent: number[] = new Array(maxi + 1).fill(0);
    let dMinus1: number[] = new Array(maxi + 1).fill(0);
    let dMinus2: number[] = new Array(maxi + 1).fill(0);
    let dSwap: number[];

    for (let i = 0; i <= maxi; i++) {
      dCurrent[i] = i;
    }

    let jm1 = 0;
    let im1 = 0;
    let im2 = -1;

    for (let j = 1; j <= maxj; j++) {
      // Rotate buffers
      dSwap = dMinus2;
      dMinus2 = dMinus1;
      dMinus1 = dCurrent;
      dCurrent = dSwap;

      let minDistance = Number.MAX_SAFE_INTEGER;
      dCurrent[0] = j;
      im1 = 0;
      im2 = -1;

      for (let i = 1; i <= maxi; i++) {
        const cost = sa[im1] === ta[jm1] ? 0 : 1;

        const del = dCurrent[im1] + 1;
        const ins = dMinus1[i] + 1;
        const sub = dMinus1[im1] + cost;

        // Min of three integers (fast)
        let min = del > ins ? (ins > sub ? sub : ins) : (del > sub ? sub : del);

        if (
          i > 1 &&
          j > 1 &&
          sa[im2] === ta[jm1] &&
          sa[im1] === ta[j - 2]
        ) {
          min = Math.min(min, dMinus2[im2] + cost);
        }

        dCurrent[i] = min;
        if (min < minDistance) {
          minDistance = min;
        }
        im1++;
        im2++;
      }

      jm1++;
      if (minDistance > threshold) {
        return Number.MAX_SAFE_INTEGER;
      }
    }

    const result = dCurrent[maxi];
    return result > threshold ? Number.MAX_SAFE_INTEGER : result;
  }

  sortByDistance(a: LookupItem, b: LookupItem, queryLowercase: string): number {
		// order by distance from query
        const pathA = a.note.getPath();
        const pathB = b.note.getPath();
		let prefixALength = 0;
		let prefixBLength = 0;
		while (prefixALength < queryLowercase.length && prefixALength < pathA.length && queryLowercase[prefixALength] === pathA[prefixALength]) {
			prefixALength++;
		}
		while (prefixBLength < queryLowercase.length && prefixBLength < pathB.length && queryLowercase[prefixBLength] === pathB[prefixBLength]) {
			prefixBLength++;
		}
      if (prefixALength !== prefixBLength) {
        return prefixBLength - prefixALength;
      }
      return this.damerauLevenshteinDistance(queryLowercase, pathA, 10)
        - this.damerauLevenshteinDistance(queryLowercase, pathB, 10);
    }
  
}
