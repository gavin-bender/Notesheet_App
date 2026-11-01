import { Plugin, MarkdownView, Editor, TFile, Notice, WorkspaceLeaf, Modal, Setting } from 'obsidian';
import {
  PluginSettings,
  DEFAULT_PLUGIN_SETTINGS,
  NotesheetItem,
  NotesheetData,
  PageSize
} from './types';
import { NotesheetStore } from './storage/NotesheetStore';
import { BlockManager } from './sync/BlockManager';
import { SyncManager } from './sync/SyncManager';
import { NotesheetView, NOTESHEET_VIEW_TYPE } from './view/NotesheetView';
import { NotesheetSettingTab } from './settings/SettingsTab';
import { patchWorkspaceLeafOpenFile } from './utils/monkeyPatch';
import { FileExplorerDecorator } from './view/FileExplorerDecorator';

export default class NotesheetPlugin extends Plugin {
  public settings: PluginSettings;
  public store: NotesheetStore;
  public blockManager: BlockManager;
  public syncManager: SyncManager;
  public fileExplorerDecorator: FileExplorerDecorator;

  async onload() {
    console.log('Loading Notesheet plugin...');
    await this.loadSettings();

    this.store = new NotesheetStore(this.app);
    this.blockManager = new BlockManager(this.app);
    this.syncManager = new SyncManager(this.app, this.blockManager, this.store);

    // Register Notesheet View
    this.registerView(
      NOTESHEET_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new NotesheetView(leaf, this.store, this.syncManager, this.blockManager)
    );

    // Register .notesheet file extension
    try {
      this.registerExtensions(['notesheet'], NOTESHEET_VIEW_TYPE);
    } catch (e) {
      // Ignore if already registered
    }

    // Intercept opening files so clicking a notesheet in File Explorer loads NotesheetView
    this.register(patchWorkspaceLeafOpenFile(this));

    // Register Vault Modification listener for Two-Way Sync
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile) {
          this.syncManager.onFileModified(file);
        }
      })
    );

    // Decorate File Explorer and Quick Switcher with NOTESHEET filetype tags
    this.fileExplorerDecorator = new FileExplorerDecorator(this.app, this.store);
    this.fileExplorerDecorator.init();

    this.registerEvent(
      this.app.workspace.on('layout-change', () => this.fileExplorerDecorator.onLayoutChange())
    );

    // Watch for file rename and delete to update active paths, views, and file explorer tags
    this.registerEvent(
      this.app.vault.on('rename', async (file, oldPath) => {
        if (file instanceof TFile) {
          if (this.settings.activeNotesheetPath === oldPath) {
            this.settings.activeNotesheetPath = file.path;
            await this.saveSettings();
          }

          const leaves = this.app.workspace.getLeavesOfType(NOTESHEET_VIEW_TYPE);
          for (const leaf of leaves) {
            const v = leaf.view as NotesheetView;
            if (v.getNotesheetFile()?.path === oldPath) {
              v.onFileRenamed(file);
            }
          }

          this.fileExplorerDecorator.update();
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('delete', async (file) => {
        if (file instanceof TFile) {
          if (this.settings.activeNotesheetPath === file.path) {
            this.settings.activeNotesheetPath = '';
            await this.saveSettings();
          }
          this.fileExplorerDecorator.update();
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('create', () => {
        this.fileExplorerDecorator.update();
      })
    );

    // Safety net: when a notesheet file is opened in active leaf, ensure it renders in Notesheet view
    this.registerEvent(
      this.app.workspace.on('file-open', async (file) => {
        if (!file || !(file instanceof TFile)) return;
        if (this.store.isNotesheetFile(file)) {
          this.settings.activeNotesheetPath = file.path;
          await this.saveSettings();

          const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
          if (activeLeaf && (activeLeaf as any)._notesheetViewMode !== 'markdown') {
            await activeLeaf.setViewState({
              type: NOTESHEET_VIEW_TYPE,
              state: { file: file.path },
              active: true
            });
          }
        }
      })
    );

    // When Obsidian finishes loading layout, convert any already-open markdown tabs with notesheets
    this.app.workspace.onLayoutReady(() => {
      this.app.workspace.iterateAllLeaves((leaf) => {
        if (
          leaf.view instanceof MarkdownView &&
          leaf.view.file &&
          this.store.isNotesheetFile(leaf.view.file) &&
          (leaf as any)._notesheetViewMode !== 'markdown'
        ) {
          const file = leaf.view.file;
          leaf.setViewState({
            type: NOTESHEET_VIEW_TYPE,
            state: { file: file.path },
            active: leaf === this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf
          });
        }
      });
    });

    // Ribbon icon: Open or create Notesheet
    this.addRibbonIcon('file-spreadsheet', 'Open Exam Notesheet', async () => {
      await this.openOrCreateNotesheet();
    });

    // Editor context menu items
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, view) => {
        if (!view.file) return;

        if (this.store.isNotesheetFile(view.file)) {
          menu.addItem((item) => {
            item
              .setTitle('Open in Notesheet View')
              .setIcon('file-spreadsheet')
              .onClick(async () => {
                delete (view.leaf as any)._notesheetViewMode;
                await view.leaf.setViewState({
                  type: NOTESHEET_VIEW_TYPE,
                  state: { file: view.file!.path },
                  active: true
                });
              });
          });
          return;
        }

        menu.addItem((item) => {
          item
            .setTitle('Notesheet: Add to Front (Page 1)')
            .setIcon('file-text')
            .onClick(async () => {
              await this.handleAddToNotesheet(editor, view as MarkdownView, 'front');
            });
        });

        menu.addItem((item) => {
          item
            .setTitle('Notesheet: Add to Back (Page 2)')
            .setIcon('file-text')
            .onClick(async () => {
              await this.handleAddToNotesheet(editor, view as MarkdownView, 'back');
            });
        });
      })
    );

    // File context menu (File Explorer right-click)
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file, source, leaf) => {
        if (file instanceof TFile && this.store.isNotesheetFile(file)) {
          menu.addItem((item) => {
            item
              .setTitle('Open in Notesheet View')
              .setIcon('file-spreadsheet')
              .onClick(async () => {
                await this.openNotesheetFile(file);
              });
          });

          menu.addItem((item) => {
            item
              .setTitle('Open as Markdown')
              .setIcon('file-code')
              .onClick(async () => {
                const targetLeaf = leaf || this.app.workspace.getLeaf(false);
                (targetLeaf as any)._notesheetViewMode = 'markdown';
                await targetLeaf.setViewState({
                  type: 'markdown',
                  state: { file: file.path },
                  active: true
                });
              });
          });
        }
      })
    );

    // Register Commands
    this.addCommand({
      id: 'open-notesheet-view',
      name: 'Open Notesheet',
      callback: async () => {
        await this.openOrCreateNotesheet();
      }
    });

    this.addCommand({
      id: 'create-notesheet',
      name: 'Create new exam Notesheet',
      callback: async () => {
        await this.promptCreateNewNotesheet();
      }
    });

    this.addCommand({
      id: 'create-notecard',
      name: 'Create new 3x5 Notecard',
      callback: async () => {
        await this.promptCreateNewNotecard();
      }
    });

    this.addCommand({
      id: 'toggle-notesheet-view',
      name: 'Toggle between Notesheet and Markdown view',
      checkCallback: (checking: boolean) => {
        const activeLeaf =
          this.app.workspace.getActiveViewOfType(NotesheetView)?.leaf ||
          this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
        if (!activeLeaf) return false;

        const currentFile =
          (activeLeaf.view as any)?.file ||
          (activeLeaf.view as any)?.getNotesheetFile?.();
        if (!currentFile || !this.store.isNotesheetFile(currentFile)) return false;

        if (!checking) {
          if (activeLeaf.view.getViewType() === NOTESHEET_VIEW_TYPE) {
            (activeLeaf as any)._notesheetViewMode = 'markdown';
            activeLeaf.setViewState({
              type: 'markdown',
              state: { file: currentFile.path },
              active: true
            });
          } else {
            delete (activeLeaf as any)._notesheetViewMode;
            activeLeaf.setViewState({
              type: NOTESHEET_VIEW_TYPE,
              state: { file: currentFile.path },
              active: true
            });
          }
        }
        return true;
      }
    });

    this.addCommand({
      id: 'add-selection-to-front',
      name: 'Add selected block to Notesheet (Front / Page 1)',
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        await this.handleAddToNotesheet(editor, view, 'front');
      }
    });

    this.addCommand({
      id: 'add-selection-to-back',
      name: 'Add selected block to Notesheet (Back / Page 2)',
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        await this.handleAddToNotesheet(editor, view, 'back');
      }
    });

    this.addCommand({
      id: 'print-notesheet',
      name: 'Print / Export to PDF (2 Pages)',
      checkCallback: (checking: boolean) => {
        const leaf = this.app.workspace.getActiveViewOfType(NotesheetView);
        if (leaf) {
          if (!checking) {
            leaf.printNotesheet();
          }
          return true;
        }
        return false;
      }
    });

    // Settings tab
    this.addSettingTab(new NotesheetSettingTab(this.app, this));
  }

  async onunload() {
    console.log('Unloading Notesheet plugin...');
    this.fileExplorerDecorator?.unload();
    this.app.workspace.detachLeavesOfType(NOTESHEET_VIEW_TYPE);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_PLUGIN_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /**
   * Adds the user's selected block in the editor to the target page of a notesheet.
   */
  public async handleAddToNotesheet(
    editor: Editor,
    view: MarkdownView,
    targetPageId: 'front' | 'back'
  ): Promise<void> {
    const file = view.file;
    if (!file) {
      new Notice('No active note to add from.');
      return;
    }

    // Extract or attach block ID to note
    const extraction = this.blockManager.extractOrAttachBlockId(editor, file);

    // Find target notesheet
    const sheetFile = await this.resolveTargetNotesheetFile();
    if (!sheetFile) return;

    // Load data
    const data = await this.store.loadNotesheet(sheetFile);

    // Create item
    const newItem: NotesheetItem = {
      id: 'item-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      sourceFile: file.path,
      blockId: extraction.blockId,
      title: extraction.inferredTitle,
      content: extraction.content,
      column: 0,
      order: Date.now(),
      updatedAt: Date.now()
    };

    let page = data.pages.find(p => p.id === targetPageId);
    if (!page) {
      page = {
        id: targetPageId,
        name: targetPageId === 'front' ? 'Front (Page 1)' : 'Back (Page 2)',
        items: []
      };
      data.pages.push(page);
    }
    page.items.push(newItem);

    // Save
    await this.store.saveNotesheet(sheetFile, data);

    // If a NotesheetView is currently showing this file, refresh it
    const leaves = this.app.workspace.getLeavesOfType(NOTESHEET_VIEW_TYPE);
    for (const leaf of leaves) {
      const v = leaf.view as NotesheetView;
      if (v.getNotesheetFile()?.path === sheetFile.path) {
        await v.setFile(sheetFile);
      }
    }

    new Notice(
      `Notesheet: Added "${newItem.title}" to ${targetPageId === 'front' ? 'Page 1 (Front)' : 'Page 2 (Back)'} of "${sheetFile.basename}".`
    );
  }

  /**
   * Opens an existing notesheet or prompts to create a new one.
   */
  public async openOrCreateNotesheet(): Promise<void> {
    const sheetFile = await this.resolveTargetNotesheetFile();
    if (sheetFile) {
      await this.openNotesheetFile(sheetFile);
    }
  }

  public async openNotesheetFile(file: TFile): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(NOTESHEET_VIEW_TYPE)[0];
    if (!leaf) {
      // Open in a split leaf to the right so user can view notes and notesheet simultaneously!
      leaf = this.app.workspace.getLeaf('split', 'vertical');
      await leaf.setViewState({ type: NOTESHEET_VIEW_TYPE, active: true, state: { file: file.path } });
    } else {
      this.app.workspace.revealLeaf(leaf);
      const view = leaf.view as NotesheetView;
      await view.setFile(file);
    }

    this.settings.activeNotesheetPath = file.path;
    await this.saveSettings();
  }

  /**
   * Resolves which notesheet to use:
   * 1. If activeNotesheetPath exists and is valid, use it.
   * 2. If exactly one notesheet exists in vault, use it and set as active.
   * 3. If multiple notesheets exist, prompt user with modal.
   * 4. If none exist, prompt to create one.
   */
  private async resolveTargetNotesheetFile(): Promise<TFile | null> {
    if (this.settings.activeNotesheetPath) {
      const activeFile = this.app.vault.getAbstractFileByPath(this.settings.activeNotesheetPath);
      if (activeFile instanceof TFile) {
        return activeFile;
      }
    }

    const allSheets = this.store.getAllNotesheets();
    if (allSheets.length === 1) {
      this.settings.activeNotesheetPath = allSheets[0].path;
      await this.saveSettings();
      return allSheets[0];
    } else if (allSheets.length > 1) {
      return new Promise((resolve) => {
        new SelectNotesheetModal(this.app, allSheets, async (selectedFile) => {
          if (selectedFile) {
            this.settings.activeNotesheetPath = selectedFile.path;
            await this.saveSettings();
          }
          resolve(selectedFile);
        }).open();
      });
    }

    // None exist yet: create default
    return await this.promptCreateNewNotesheet();
  }

  public async promptCreateNewNotesheet(): Promise<TFile | null> {
    return new Promise((resolve) => {
      new CreateNotesheetModal(this.app, this.settings.defaultFolder, async (title, folder, pageSize) => {
        const file = await this.store.createNotesheet(folder, title, { pageSize });
        this.settings.activeNotesheetPath = file.path;
        await this.saveSettings();
        await this.openNotesheetFile(file);
        const unitName = pageSize === 'card3x5' ? '3x5 notecard' : 'exam notesheet';
        new Notice(`Created ${unitName}: "${file.basename}"`);
        resolve(file);
      }, this.settings.defaultPageSize || 'letter').open();
    });
  }

  public async promptCreateNewNotecard(): Promise<TFile | null> {
    return new Promise((resolve) => {
      new CreateNotesheetModal(this.app, this.settings.defaultFolder, async (title, folder, pageSize) => {
        const file = await this.store.createNotesheet(folder, title, { pageSize });
        this.settings.activeNotesheetPath = file.path;
        await this.saveSettings();
        await this.openNotesheetFile(file);
        new Notice(`Created 3x5 notecard: "${file.basename}"`);
        resolve(file);
      }, 'card3x5').open();
    });
  }
}

class SelectNotesheetModal extends Modal {
  private files: TFile[];
  private onSelect: (file: TFile | null) => void;
  private selected = false;

  constructor(app: App, files: TFile[], onSelect: (file: TFile | null) => void) {
    super(app);
    this.files = files;
    this.onSelect = onSelect;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: 'Select Target Exam Notesheet' });

    for (const f of this.files) {
      const itemEl = contentEl.createDiv({ cls: 'notesheet-picker-card' });
      itemEl.style.cursor = 'pointer';
      itemEl.createEl('strong', { text: f.basename.replace('.notesheet', '') });
      itemEl.createEl('div', { text: f.path, cls: 'notesheet-badge' });

      itemEl.addEventListener('click', () => {
        this.selected = true;
        this.onSelect(f);
        this.close();
      });
    }
  }

  onClose() {
    if (!this.selected) {
      this.onSelect(null);
    }
  }
}

class CreateNotesheetModal extends Modal {
  private folder: string;
  private selectedPageSize: PageSize;
  private onSubmit: (title: string, folder: string, pageSize: PageSize) => void;

  constructor(
    app: App,
    defaultFolder: string,
    onSubmit: (title: string, folder: string, pageSize: PageSize) => void,
    initialPageSize: PageSize = 'letter'
  ) {
    super(app);
    this.folder = defaultFolder;
    this.onSubmit = onSubmit;
    this.selectedPageSize = initialPageSize;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const isCard = this.selectedPageSize === 'card3x5';
    const headerTitle = contentEl.createEl('h3', {
      text: isCard ? 'Create 3x5 Exam Notecard' : 'Create Exam Notesheet'
    });

    let title = isCard ? 'Exam Notecard (3x5)' : 'Final Exam Cheat Sheet';
    let textInputEl: HTMLInputElement | null = null;

    new Setting(contentEl)
      .setName('Format / Paper Size')
      .setDesc('Select standard sheet or 3" x 5" index notecard')
      .addDropdown(dd => {
        dd.addOption('letter', 'US Letter (8.5" x 11")');
        dd.addOption('card3x5', '3" x 5" Notecard (Index Card)');
        dd.addOption('a4', 'A4 (210 x 297 mm)');
        dd.setValue(this.selectedPageSize);
        dd.onChange(val => {
          const oldWasCard = this.selectedPageSize === 'card3x5';
          this.selectedPageSize = val as PageSize;
          const newIsCard = this.selectedPageSize === 'card3x5';

          headerTitle.setText(newIsCard ? 'Create 3x5 Exam Notecard' : 'Create Exam Notesheet');
          if (submitBtn) {
            submitBtn.setButtonText(newIsCard ? 'Create Notecard' : 'Create Notesheet');
          }

          if (textInputEl) {
            if (newIsCard && !oldWasCard && (title === 'Final Exam Cheat Sheet' || !title)) {
              title = 'Exam Notecard (3x5)';
              textInputEl.value = title;
            } else if (!newIsCard && oldWasCard && (title === 'Exam Notecard (3x5)' || !title)) {
              title = 'Final Exam Cheat Sheet';
              textInputEl.value = title;
            }
          }
        });
      });

    new Setting(contentEl)
      .setName('Title')
      .setDesc('e.g. Physics 240 Midterm, Calculus II Exam')
      .addText(text => {
        textInputEl = text.inputEl;
        text.setValue(title);
        text.onChange(val => {
          title = val.trim();
        });
      });

    new Setting(contentEl)
      .setName('Save Folder')
      .setDesc('Folder in vault to store this notesheet')
      .addText(text => {
        text.setValue(this.folder);
        text.onChange(val => {
          this.folder = val.trim();
        });
      });

    let submitBtn: any = null;
    new Setting(contentEl)
      .addButton(btn => {
        submitBtn = btn;
        btn
          .setButtonText(isCard ? 'Create Notecard' : 'Create Notesheet')
          .setCta()
          .onClick(() => {
            if (!title) {
              title = this.selectedPageSize === 'card3x5' ? 'Exam Notecard' : 'Exam Notesheet';
            }
            this.onSubmit(title, this.folder, this.selectedPageSize);
            this.close();
          });
      });
  }

  onClose() {
    this.contentEl.empty();
  }
}
