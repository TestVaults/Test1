import { App, MarkdownView, Notice, TFile } from "obsidian";
import { EditorView } from "@codemirror/view";
import * as path from "path";
import { setInlineDiff } from "./inlineDiff";
import { PendingChange, PendingChangesStore } from "../state/PendingChangesStore";

export async function openFileWithInlineDiff(
  app: App,
  vaultBasePath: string,
  store: PendingChangesStore,
  change: PendingChange
): Promise<void> {
  const relPath = path.relative(vaultBasePath, change.diff.filePath);
  if (relPath.startsWith("..")) {
    new Notice("Terminus: file is outside the vault, can't open it as a note.");
    return;
  }

  const file = app.vault.getAbstractFileByPath(relPath);
  if (!(file instanceof TFile)) {
    new Notice("Terminus: couldn't find that file in the vault -- use Accept/Reject in the panel instead.");
    return;
  }

  const leaf = app.workspace.getLeaf(true);
  await leaf.openFile(file);
  const view = leaf.view;
  if (!(view instanceof MarkdownView)) return;

  const cm = (view.editor as unknown as { cm?: EditorView }).cm;
  if (!cm) {
    new Notice("Terminus: couldn't attach inline diff to this editor.");
    return;
  }

  store.registerInlineOverlay(change.id, () => {
    cm.dispatch({ effects: setInlineDiff.of(null) });
  });

  const resolve = (accepted: boolean) => {
    store.resolveItem(change.id, accepted).catch((err: Error) => {
      new Notice(`Terminus: failed to ${accepted ? "keep" : "revert"} ${path.basename(change.diff.filePath)}: ${err.message}`);
    });
  };

  cm.dispatch({
    effects: setInlineDiff.of({
      id: change.id,
      oldText: change.diff.oldText,
      newText: change.diff.newText,
      onAccept: () => resolve(true),
      onReject: () => resolve(false),
    }),
  });
}
