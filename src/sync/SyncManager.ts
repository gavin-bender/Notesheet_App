import { App, TFile, Notice, debounce, Debouncer } from 'obsidian';
import { BlockManager } from './BlockManager';
import { NotesheetData, NotesheetItem } from '../types';
import { NotesheetStore } from '../storage/NotesheetStore';

export interface NotesheetSyncSubscriber {
  getNotesheetData(): NotesheetData | null;
  getNotesheetFile(): TFile | null;
  onItemExternalUpdate(pageId: string, item: NotesheetItem): void;
  saveData(): Promise<void>;
}

export class SyncManager {
  private app: App;
  private blockManager: BlockManager;
  private store: NotesheetStore;
  private subscribers: Set<NotesheetSyncSubscriber> = new Set();
  private ignoreMap: Map<string, number> = new Map();
  private debouncedSync: Debouncer<[TFile], Promise<void>>;

  constructor(app: App, blockManager: BlockManager, store: NotesheetStore) {
    this.app = app;
    this.blockManager = blockManager;
    this.store = store;

    // Debounce note file change events by 350ms
    this.debouncedSync = debounce(this.handleFileModify.bind(this), 350, true);
  }

  public registerSubscriber(subscriber: NotesheetSyncSubscriber): void {
    this.subscribers.add(subscriber);
  }

  public unregisterSubscriber(subscriber: NotesheetSyncSubscriber): void {
    this.subscribers.delete(subscriber);
  }

  /**
   * Called whenever any file in vault is modified.
   */
  public onFileModified(file: TFile): void {
    // If this file is ignored due to internal modification within 2 seconds, ignore it
    const lastIgnored = this.ignoreMap.get(file.path);
    if (lastIgnored && Date.now() - lastIgnored < 2000) {
      return;
    }

    this.debouncedSync(file);
  }

  private async handleFileModify(file: TFile): Promise<void> {
    // If it's a notesheet file itself, we don't sync notes to it
    if (this.store.isNotesheetFile(file)) {
      return;
    }

    let fileContent: string | null = null;

    // Check all active subscribers (open Notesheet views)
    for (const subscriber of this.subscribers) {
      const data = subscriber.getNotesheetData();
      if (!data) continue;

      let sheetModified = false;

      for (const page of data.pages) {
        for (const item of page.items) {
          if (item.sourceFile === file.path && item.blockId) {
            // Lazy load content once per file
            if (fileContent === null) {
              fileContent = await this.app.vault.read(file);
            }

            const currentBlockText = this.blockManager.findBlockContent(fileContent, item.blockId);
            if (currentBlockText !== null && currentBlockText !== item.content) {
              item.content = currentBlockText;
              item.updatedAt = Date.now();
              sheetModified = true;
              subscriber.onItemExternalUpdate(page.id, item);
            }
          }
        }
      }

      if (sheetModified) {
        await subscriber.saveData();
      }
    }
  }

  /**
   * Syncs card content edited directly inside the Notesheet back to the source note.
   */
  public async syncCardToSourceNote(item: NotesheetItem, newContent: string): Promise<boolean> {
    if (!item.sourceFile || !item.blockId) {
      // Standalone card, nothing to sync to note
      return true;
    }

    const file = this.app.vault.getAbstractFileByPath(item.sourceFile);
    if (!(file instanceof TFile)) {
      new Notice(`Notesheet: Could not find source note "${item.sourceFile}".`);
      return false;
    }

    try {
      // Ignore modify events triggered by this write
      this.ignoreMap.set(file.path, Date.now());

      const content = await this.app.vault.read(file);
      const updatedContent = this.blockManager.updateBlockInContent(content, item.blockId, newContent);

      if (updatedContent !== content) {
        await this.app.vault.modify(file, updatedContent);
        return true;
      }
    } catch (err) {
      console.error('Notesheet sync error:', err);
      new Notice(`Notesheet: Failed to sync changes to "${file.basename}".`);
      return false;
    }

    return true;
  }

  /**
   * Refreshes all cards in a notesheet from their current source files.
   */
  public async refreshNotesheetFromSources(data: NotesheetData): Promise<boolean> {
    let changed = false;

    for (const page of data.pages) {
      for (const item of page.items) {
        if (!item.sourceFile || !item.blockId) continue;

        const file = this.app.vault.getAbstractFileByPath(item.sourceFile);
        if (file instanceof TFile) {
          try {
            const content = await this.app.vault.read(file);
            const blockText = this.blockManager.findBlockContent(content, item.blockId);
            if (blockText !== null && blockText !== item.content) {
              item.content = blockText;
              item.updatedAt = Date.now();
              changed = true;
            }
          } catch (e) {
            console.error(`Error reading ${item.sourceFile}:`, e);
          }
        }
      }
    }

    return changed;
  }
}
