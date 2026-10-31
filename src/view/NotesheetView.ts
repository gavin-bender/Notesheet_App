import { App, ItemView, WorkspaceLeaf, TFile, Notice, setIcon, Modal, Setting, ViewStateResult } from 'obsidian';
import { NotesheetData, NotesheetItem, createDefaultNotesheetData } from '../types';
import { NotesheetStore } from '../storage/NotesheetStore';
import { SyncManager, NotesheetSyncSubscriber } from '../sync/SyncManager';
import { BlockManager } from '../sync/BlockManager';
import { NotesheetToolbar } from './Toolbar';
import { NotesheetCard } from './NotesheetCard';
import { BlockPickerModal } from './BlockPickerModal';
import { CategoryManagerModal } from './CategoryManagerModal';

export const NOTESHEET_VIEW_TYPE = 'notesheet-view';

export class NotesheetView extends ItemView implements NotesheetSyncSubscriber {
  private store: NotesheetStore;
  private syncManager: SyncManager;
  private blockManager: BlockManager;
  private data: NotesheetData;
  private currentFile: TFile | null = null;
  public file: TFile | null = null;
  private activeTab: 'front' | 'back' | 'both' = 'front';
  private cardComponents: Map<string, NotesheetCard> = new Map();
  private initialEditCardId: string | null = null;
  private pageObservers: ResizeObserver[] = [];

  private isAnyCardEditing(): boolean {
    for (const card of this.cardComponents.values()) {
      if (card.getIsEditing()) return true;
    }
    return false;
  }

  constructor(
    leaf: WorkspaceLeaf,
    store: NotesheetStore,
    syncManager: SyncManager,
    blockManager: BlockManager
  ) {
    super(leaf);
    this.store = store;
    this.syncManager = syncManager;
    this.blockManager = blockManager;
    this.data = createDefaultNotesheetData();
    this.navigation = true;
  }

  getViewType(): string {
    return NOTESHEET_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.data?.title || this.currentFile?.basename.replace(/\.notesheet$/, '') || 'Exam Notesheet';
  }

  getIcon(): string {
    return 'file-spreadsheet';
  }

  public getState(): Record<string, unknown> {
    const state = super.getState();
    state.file = this.currentFile?.path;
    return state;
  }

  public async setState(state: any, result?: ViewStateResult): Promise<void> {
    if (result) {
      await super.setState(state, result);
    } else {
      await super.setState(state);
    }

    if (state?.file) {
      const file = this.app.vault.getAbstractFileByPath(state.file);
      if (file instanceof TFile) {
        await this.setFile(file);
      }
    }
  }

  async onload() {
    super.onload();
    this.syncManager.registerSubscriber(this);
    window.addEventListener('beforeprint', this.handleBeforePrint);
    window.addEventListener('afterprint', this.handleAfterPrint);

    // Add view action icon to switch to raw markdown if desired
    this.addAction('file-code', 'Open as markdown', () => {
      this.openAsMarkdown();
    });
  }

  async onunload() {
    window.removeEventListener('beforeprint', this.handleBeforePrint);
    window.removeEventListener('afterprint', this.handleAfterPrint);
    this.pageObservers.forEach(obs => obs.disconnect());
    this.pageObservers = [];
    this.cleanPrintContainer();
    this.syncManager.unregisterSubscriber(this);
    super.onunload();
  }

  public getNotesheetData(): NotesheetData | null {
    return this.data;
  }

  public getNotesheetFile(): TFile | null {
    return this.currentFile;
  }

  public async setFile(file: TFile): Promise<void> {
    this.currentFile = file;
    this.file = file;
    this.data = await this.store.loadNotesheet(file);
    await this.render();
    (this.leaf as any).updateHeader?.();
  }

  public onFileRenamed(file: TFile): void {
    this.currentFile = file;
    this.file = file;
    (this.leaf as any).updateHeader?.();
  }

  public async openAsMarkdown(): Promise<void> {
    if (!this.currentFile) return;
    const file = this.currentFile;
    const leaf = this.leaf;
    (leaf as any)._notesheetViewMode = 'markdown';
    await leaf.setViewState({
      type: 'markdown',
      state: { file: file.path },
      active: true
    });
  }

  public async saveData(): Promise<void> {
    if (this.currentFile) {
      await this.store.saveNotesheet(this.currentFile, this.data);
    }
  }

  public onItemExternalUpdate(pageId: string, item: NotesheetItem): void {
    const cardComp = this.cardComponents.get(item.id);
    if (cardComp) {
      cardComp.updateContent(item.content);
    }
  }

  public async addItem(item: NotesheetItem, targetPageId = 'front'): Promise<void> {
    let page = this.data.pages.find(p => p.id === targetPageId);
    if (!page) {
      page = this.data.pages[0];
    }
    if (page) {
      page.items.push(item);
      await this.saveData();
      await this.render();
    }
  }

  public async render(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('notesheet-view-root');

    // Dynamic CSS variables for typography and density
    container.style.setProperty('--notesheet-font-size', `${this.data.settings.fontSize}pt`);
    container.style.setProperty('--notesheet-columns', `${this.data.settings.columns}`);

    // Toolbar
    const toolbar = new NotesheetToolbar(this.app, this.data, this.activeTab, {
      onTabChange: (tab) => {
        this.activeTab = tab;
        this.updatePageTabVisibility(pagesWrapper);
      },
      onSettingChange: async () => {
        container.style.setProperty('--notesheet-font-size', `${this.data.settings.fontSize}pt`);
        container.style.setProperty('--notesheet-columns', `${this.data.settings.columns}`);
        await this.saveData();
        this.renderPages(pagesWrapper);
      },
      onAddCard: () => {
        this.promptAddCard();
      },
      onOpenPicker: () => {
        const targetPage = this.activeTab === 'back' ? 'back' : 'front';
        new BlockPickerModal(this.app, this.blockManager, targetPage, async (newItem, pId) => {
          await this.addItem(newItem, pId);
        }).open();
      },
      onPrint: () => {
        this.printNotesheet();
      },
      onSyncAll: async () => {
        const changed = await this.syncManager.refreshNotesheetFromSources(this.data);
        if (changed) {
          await this.saveData();
          new Notice('Notesheet: Refreshed all cards from source notes.');
        } else {
          new Notice('Notesheet: All cards are up to date.');
        }
        await this.render();
      },
      onTitleChange: async (newTitle) => {
        this.data.title = newTitle;
        await this.saveData();
        (this.leaf as any).updateHeader?.();
      },
      onOpenCategoryManager: () => {
        new CategoryManagerModal(this.app, this.data, async () => {
          await this.saveData();
          await this.render();
        }).open();
      }
    });

    toolbar.render(container);

    // Pages scroll wrapper
    const pagesWrapper = container.createDiv({ cls: 'notesheet-pages-wrapper' });
    this.renderPages(pagesWrapper);
  }

  private renderPages(container: HTMLElement): void {
    this.pageObservers.forEach(obs => obs.disconnect());
    this.pageObservers = [];
    container.empty();
    this.cardComponents.clear();

    for (const page of this.data.pages) {
      this.renderSinglePage(container, page);
    }

    this.updatePageTabVisibility(container);
  }

  private updatePageTabVisibility(container?: HTMLElement): void {
    const root = container || this.contentEl;
    const pageFront = root.querySelector<HTMLElement>('#notesheet-page-front');
    const pageBack = root.querySelector<HTMLElement>('#notesheet-page-back');

    if (pageFront) {
      if (this.activeTab === 'back') {
        pageFront.classList.add('tab-hidden');
      } else {
        pageFront.classList.remove('tab-hidden');
      }
    }

    if (pageBack) {
      if (this.activeTab === 'front') {
        pageBack.classList.add('tab-hidden');
      } else {
        pageBack.classList.remove('tab-hidden');
      }
    }
  }

  private renderSinglePage(container: HTMLElement, page: { id: string; name: string; items: NotesheetItem[] }): void {
    const pageSheet = container.createDiv({
      cls: `notesheet-page-sheet paper-${this.data.settings.pageSize} margin-${this.data.settings.margins}`,
      attr: { id: `notesheet-page-${page.id}` }
    });

    // Page Header (Front / Back label and card count)
    const pageHeader = pageSheet.createDiv({ cls: 'notesheet-page-header' });
    const headerLeft = pageHeader.createDiv({ cls: 'page-header-left' });
    headerLeft.createSpan({ text: page.name, cls: 'page-title' });

    const count = page.items.length;
    pageHeader.createSpan({
      text: `${count} card${count !== 1 ? 's' : ''}`,
      cls: 'page-stats'
    });

    // Page Columns Grid
    const columnsGrid = pageSheet.createDiv({
      cls: `notesheet-columns-grid cols-${this.data.settings.columns}`
    });

    if (page.items.length === 0) {
      const emptyNotice = columnsGrid.createDiv({ cls: 'notesheet-empty-state' });
      const icon = emptyNotice.createSpan();
      setIcon(icon, 'sparkles');
      emptyNotice.createEl('h3', { text: `No cards on ${page.name} yet` });
      emptyNotice.createEl('p', {
        text: 'Right-click any note selection and choose "Add to Notesheet", or click "+ Add Card" above.'
      });

      const quickImportBtn = emptyNotice.createEl('button', {
        text: 'Import from Note',
        cls: 'mod-cta'
      });
      quickImportBtn.addEventListener('click', () => {
        new BlockPickerModal(this.app, this.blockManager, page.id, async (newItem, pId) => {
          await this.addItem(newItem, pId);
        }).open();
      });
      return;
    }

    // Distribute cards into columns (balanced)
    const numCols = Math.max(1, this.data.settings.columns);
    const colContainers: HTMLElement[] = [];

    for (let c = 0; c < numCols; c++) {
      const colEl = columnsGrid.createDiv({ cls: 'notesheet-column' });
      colEl.dataset.colIndex = c.toString();

      // Drag and drop into column
      colEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        colEl.addClass('drag-target-active');
      });

      colEl.addEventListener('dragleave', () => {
        colEl.removeClass('drag-target-active');
      });

      colEl.addEventListener('drop', async (e) => {
        e.preventDefault();
        colEl.removeClass('drag-target-active');
        const draggedItemId = e.dataTransfer?.getData('text/plain');
        if (draggedItemId) {
          const itemIdx = page.items.findIndex(it => it.id === draggedItemId);
          if (itemIdx !== -1) {
            const item = page.items[itemIdx];
            item.column = c;
            await this.saveData();
            this.render();
          }
        }
      });

      colContainers.push(colEl);
    }

    // Helper to clean title for adjacency comparison
    const cleanTitle = (t?: string) => {
      if (!t) return '';
      return t
        .replace(/:[a-zA-Z0-9_-]+:\s*/g, '')
        .replace(/^#{1,6}\s+/, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/[:\s-]+$/, '')
        .trim()
        .toLowerCase();
    };

    // Group items into their respective columns
    const itemsByCol: NotesheetItem[][] = Array.from({ length: numCols }, () => []);
    page.items.forEach((item, index) => {
      const colIndex = (item.column !== undefined && item.column < numCols)
        ? item.column
        : (index % numCols);
      itemsByCol[colIndex].push(item);
    });

    // Render cards column by column with LR to TD adjacency deduplication (Highest left title wins)
    for (let c = 0; c < numCols; c++) {
      const targetCol = colContainers[c];
      const colItems = itemsByCol[c];

      for (let r = 0; r < colItems.length; r++) {
        const item = colItems[r];

        // Adjacency check for Category Title:
        // Highest left title wins:
        // 1. Top neighbor (TD): item directly above in same column
        // 2. Left neighbor (LR): item directly to left in column c - 1
        let hideCategoryBanner = false;
        if (item.categoryId) {
          if (r > 0 && colItems[r - 1].categoryId === item.categoryId) {
            hideCategoryBanner = true;
          } else if (c > 0 && r < itemsByCol[c - 1].length && itemsByCol[c - 1][r].categoryId === item.categoryId) {
            hideCategoryBanner = true;
          }
        }

        // Adjacency check for Card Title:
        let hideCardTitle = false;
        const currentTitle = cleanTitle(item.title);
        if (currentTitle) {
          if (r > 0 && cleanTitle(colItems[r - 1].title) === currentTitle) {
            hideCardTitle = true;
          } else if (c > 0 && r < itemsByCol[c - 1].length && cleanTitle(itemsByCol[c - 1][r].title) === currentTitle) {
            hideCardTitle = true;
          }
        }

        const cardComp = new NotesheetCard(
          this.app,
          this,
          this.syncManager,
          item,
          this.data.settings,
          this.data.categories,
          page.id,
          {
            onUpdate: async (updatedItem) => {
              const idx = page.items.findIndex(it => it.id === updatedItem.id);
              if (idx !== -1) {
                page.items[idx] = updatedItem;
              }
              await this.saveData();
            },
            onDelete: async (deletedItem) => {
              page.items = page.items.filter(it => it.id !== deletedItem.id);
              await this.saveData();
              await this.render();
              new Notice(`Removed "${deletedItem.title || 'Card'}" from notesheet.`);
            },
            onMovePage: async (movedItem, targetPageId) => {
              page.items = page.items.filter(it => it.id !== movedItem.id);
              let targetPage = this.data.pages.find(p => p.id === targetPageId);
              if (!targetPage) {
                targetPage = { id: targetPageId, name: targetPageId === 'front' ? 'Front (Page 1)' : 'Back (Page 2)', items: [] };
                this.data.pages.push(targetPage);
              }
              targetPage.items.push(movedItem);
              await this.saveData();
              await this.render();
              new Notice(`Moved to ${targetPage.name}`);
            },
            onMoveOrder: async (movedItem, direction) => {
              const idx = page.items.findIndex(it => it.id === movedItem.id);
              if (idx === -1) return;
              const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
              if (targetIdx >= 0 && targetIdx < page.items.length) {
                const temp = page.items[targetIdx];
                page.items[targetIdx] = page.items[idx];
                page.items[idx] = temp;
                await this.saveData();
                await this.render();
              }
            },
            onCategoryChange: async (catItem, categoryId) => {
              catItem.categoryId = categoryId;
              await this.saveData();
              await this.render();
            },
            onOpenCategoryManager: () => {
              new CategoryManagerModal(this.app, this.data, async () => {
                await this.saveData();
                await this.render();
              }).open();
            }
          },
          {
            hideCategoryBanner,
            hideCardTitle,
            startInEditMode: this.initialEditCardId === item.id
          }
        );

        if (this.initialEditCardId === item.id) {
          this.initialEditCardId = null;
        }

        const cardEl = cardComp.render(targetCol);

        // Dragstart event for card: Disabled if editing
        cardEl.addEventListener('dragstart', (e) => {
          if (cardComp.getIsEditing() || this.isAnyCardEditing()) {
            e.preventDefault();
            return false;
          }
          e.dataTransfer?.setData('text/plain', item.id);
        });

        this.cardComponents.set(item.id, cardComp);
      }
    }

    // Page Footer (for exam print verification)
    if (this.data.settings.showPageNumbers) {
      const pageFooter = pageSheet.createDiv({ cls: 'notesheet-page-footer' });
      pageFooter.createSpan({ text: this.data.title, cls: 'footer-title' });
      pageFooter.createSpan({
        text: page.id === 'front' ? 'Page 1 (Front)' : 'Page 2 (Back)',
        cls: 'footer-page-num'
      });
    }

    // Observe physical page overflow to alert user when cards exceed 1-page paper height
    const targetHeight = this.data.settings.pageSize === 'a4' ? 1123 : 1056;
    const checkOverflow = () => {
      if (pageSheet.scrollHeight > targetHeight + 10) {
        pageSheet.classList.add('is-overflowing');
      } else {
        pageSheet.classList.remove('is-overflowing');
      }
    };

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        checkOverflow();
      });
      observer.observe(pageSheet);
      this.pageObservers.push(observer);
    }
    setTimeout(checkOverflow, 200);
  }

  private async promptAddCard(): Promise<void> {
    const targetPageId = this.activeTab === 'back' ? 'back' : 'front';
    const targetPage = this.data.pages.find(p => p.id === targetPageId) || this.data.pages[0];

    const newItem: NotesheetItem = {
      id: 'item-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      sourceFile: '',
      blockId: '',
      title: 'New Card',
      content: '',
      column: 0,
      order: Date.now(),
      updatedAt: Date.now()
    };

    targetPage.items.push(newItem);
    this.initialEditCardId = newItem.id;
    await this.saveData();
    await this.render();
  }

  private handleBeforePrint = () => {
    if (this.containerEl && document.body.contains(this.containerEl) && this.containerEl.offsetWidth > 0) {
      this.setupPrintContainer();
    }
  };

  private handleAfterPrint = () => {
    this.cleanPrintContainer();
  };

  public setupPrintContainer(): HTMLElement {
    this.cleanPrintContainer();
    const printContainer = document.body.createDiv({ cls: 'print notesheet-print-container' });
    printContainer.style.setProperty('--notesheet-font-size', `${this.data.settings.fontSize}pt`);
    printContainer.style.setProperty('--notesheet-columns', `${this.data.settings.columns}`);

    // Inject dynamic @page style for margins and page size
    const marginInches = this.data.settings.margins === 'tight' ? '0.2in' : this.data.settings.margins === 'normal' ? '0.5in' : '0.25in';
    const dynamicStyle = document.createElement('style');
    dynamicStyle.id = 'notesheet-print-dynamic-style';
    dynamicStyle.textContent = `@page { size: ${this.data.settings.pageSize} portrait; margin: ${marginInches}; }`;
    document.head.appendChild(dynamicStyle);

    const pageEls = this.contentEl.querySelectorAll<HTMLElement>('.notesheet-page-sheet');
    pageEls.forEach((pageEl) => {
      const clone = pageEl.cloneNode(true) as HTMLElement;
      clone.classList.remove('tab-hidden');
      clone.classList.remove('is-overflowing');

      // Strip non-print controls (copy buttons, edit forms, drag handles, buttons)
      clone.querySelectorAll(
        '.copy-code-button, button.copy-code-button, .code-block-action, .copy-code-button-text, .code-block-flair, .notesheet-card-actions, .notesheet-card-drag-handle, .notesheet-card-source-badge, .notesheet-card-category-pill, .notesheet-card-edit-wrapper, .drag-target-active'
      ).forEach((el) => el.remove());

      // If card header is now empty (no title), remove it so it takes zero space
      clone.querySelectorAll('.notesheet-card-header').forEach((header) => {
        if (!header.querySelector('.notesheet-card-title') || header.textContent?.trim() === '') {
          header.remove();
        }
      });

      printContainer.appendChild(clone);
    });

    return printContainer;
  }

  public cleanPrintContainer(): void {
    document.querySelectorAll('.notesheet-print-container').forEach((el) => el.remove());
    document.getElementById('notesheet-print-dynamic-style')?.remove();
  }

  public printNotesheet(): void {
    new Notice('Notesheet: Preparing 2-page print & PDF export...');
    this.setupPrintContainer();

    setTimeout(() => {
      let cleaned = false;
      const doCleanup = () => {
        if (cleaned) return;
        cleaned = true;
        this.cleanPrintContainer();
        window.removeEventListener('afterprint', doCleanup);
      };

      window.addEventListener('afterprint', doCleanup, { once: true });
      window.print();
      setTimeout(doCleanup, 5000);
    }, 150);
  }
}
