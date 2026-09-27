<script lang="ts">
  import NoteComponent from "./NoteComponent.svelte";
  import { dendronVaultList } from "../store";
  import { DendronVault } from "../engine/vault";
  import { Note } from "../engine/note";

  const roots: Record<string, NoteComponent> = {};
  const children: Record<string, NoteComponent> = {};

  let pendingOpenNote: Note | null = null;

  export function focusTo(vault: DendronVault, note: Note) {
    if (pendingOpenNote === note) {
      pendingOpenNote = null;
      return;
    }
    const pathNotes = note.getPathNotes();
    pathNotes.shift();

    if (pathNotes.length === 0) {
      roots[vault.config.name]?.focusNotes([]);
      return;
    }

    const topLevelNote = pathNotes.shift()!;
    children[`${vault.config.name}\0${topLevelNote.name}`]?.focusNotes(pathNotes);
  }

  function onOpenNote(e: CustomEvent<Note>) {
    pendingOpenNote = e.detail;
  }
</script>

<div>
  {#each $dendronVaultList as vault (vault.config.name)}
    <NoteComponent
      note={vault.tree.root}
      isRoot
      renderChildren={false}
      {vault}
      bind:this={roots[vault.config.name]}
      on:openNote={onOpenNote}
    />
    <hr class="root-separator" />
    {#each vault.tree.root.children as child (child.name)}
      <NoteComponent
        note={child}
        {vault}
        bind:this={children[`${vault.config.name}\0${child.name}`]}
        on:openNote={onOpenNote}
      />
    {/each}
  {/each}
</div>

<style>
  .root-separator {
    margin: var(--size-2-3) 0;
  }
</style>
