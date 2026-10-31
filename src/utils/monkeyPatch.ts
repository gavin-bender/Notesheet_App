import { WorkspaceLeaf, TFile, OpenViewState } from 'obsidian';
import type NotesheetPlugin from '../main';
import { NOTESHEET_VIEW_TYPE, NotesheetView } from '../view/NotesheetView';

export function around<T extends Record<string, any>>(
  obj: T,
  factories: { [K in keyof T]?: (oldMethod: T[K]) => T[K] }
): () => void {
  const removers: (() => void)[] = [];
  for (const key of Object.keys(factories) as (keyof T)[]) {
    const original = obj[key];
    const factory = factories[key];
    if (typeof original === 'function' && factory) {
      const wrapped = factory(original);
      obj[key] = wrapped;
      removers.push(() => {
        if (obj[key] === wrapped) {
          obj[key] = original;
        }
      });
    }
  }
  return () => {
    for (const remove of removers) remove();
  };
}

/**
 * Monkey-patches WorkspaceLeaf.prototype.openFile so that when a notesheet file is opened
 * (e.g. clicked in the File Explorer, opened via Quick Switcher, or followed via link),
 * it directly loads NotesheetView instead of the raw MarkdownView text/data structure.
 */
export function patchWorkspaceLeafOpenFile(plugin: NotesheetPlugin): () => void {
  return around(WorkspaceLeaf.prototype, {
    openFile(oldOpenFile) {
      return async function (this: WorkspaceLeaf, file: TFile, openState?: OpenViewState): Promise<void> {
        if (file instanceof TFile && plugin.store.isNotesheetFile(file)) {
          delete (this as any)._notesheetViewMode;

          // If the leaf is already showing this notesheet, reveal and return
          if (this.view instanceof NotesheetView && this.view.getNotesheetFile()?.path === file.path) {
            plugin.app.workspace.revealLeaf(this);
            return;
          }

          await this.setViewState(
            {
              type: NOTESHEET_VIEW_TYPE,
              active: openState?.active ?? true,
              state: { file: file.path }
            },
            openState?.eState
          );

          plugin.settings.activeNotesheetPath = file.path;
          await plugin.saveSettings();
          return;
        }

        return oldOpenFile.call(this, file, openState);
      };
    }
  });
}
