import { App, ItemView, WorkspaceLeaf, TFile, Notice, setIcon, Modal, Setting, ViewStateResult } from 'obsidian';
import { NotesheetData, NotesheetItem, createDefaultNotesheetData } from '../types';
import { NotesheetStore } from '../storage/NotesheetStore';
import { SyncManager, NotesheetSyncSubscriber } from '../sync/SyncManager';
import { BlockManager } from '../sync/BlockManager';
import { NotesheetToolbar } from './Toolbar';
import { NotesheetCard } from './NotesheetCard';
import { BlockPickerModal } from './BlockPickerModal';
import { CategoryManagerModal } from './CategoryManagerModal';
import { PrintPreviewModal } from './PrintPreviewModal';

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
  private viewZoom: number = 1.0;
  private pendingZoom: number = 1.0;
  private isZooming: boolean = false;
  private zoomContainerEl: HTMLElement | null = null;
  private pagesWrapperEl: HTMLElement | null = null;
  private toolbar: NotesheetToolbar | null = null;
  private saveZoomDebounceTimer: number | null = null;

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
    if (this.saveZoomDebounceTimer) {
      window.clearTimeout(this.saveZoomDebounceTimer);
      this.saveZoomDebounceTimer = null;
    }
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
    container.removeClass('density-compact', 'density-normal');
    container.addClass(`density-${this.data.settings.density || 'compact'}`);

    // Dynamic CSS variables for typography and density
    container.style.setProperty('--notesheet-font-size', `${this.data.settings.fontSize}pt`);
    container.style.setProperty('--notesheet-columns', `${this.data.settings.columns}`);

    const isCard = this.data.settings.pageSize === 'card3x5';
    this.viewZoom = this.data.settings.viewZoom ?? (isCard ? 1.5 : 1.0);

    // Toolbar
    this.toolbar = new NotesheetToolbar(this.app, this.data, this.activeTab, {
      onTabChange: (tab) => {
        this.activeTab = tab;
        if (this.zoomContainerEl) {
          this.updatePageTabVisibility(this.zoomContainerEl);
          const activeSheet = this.zoomContainerEl.querySelector<HTMLElement>(
            tab === 'back' ? '#notesheet-page-back' : '#notesheet-page-front'
          );
          if (activeSheet) this.updatePageFit(activeSheet);
        }
      },
      onSettingChange: async () => {
        container.removeClass('density-compact', 'density-normal');
        container.addClass(`density-${this.data.settings.density || 'compact'}`);
        container.style.setProperty('--notesheet-font-size', `${this.data.settings.fontSize}pt`);
        container.style.setProperty('--notesheet-columns', `${this.data.settings.columns}`);
        await this.saveData();
        if (this.zoomContainerEl) {
          this.renderPages(this.zoomContainerEl);
        }
      },
      onZoomChange: (newZoom) => {
        this.setViewZoom(newZoom);
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
      onPrintPreview: () => {
        new PrintPreviewModal(this.app, this.data, this).open();
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
    }, this.viewZoom);

    this.toolbar.render(container);

    // Pages scroll wrapper & display zoom container
    this.pagesWrapperEl = container.createDiv({ cls: 'notesheet-pages-wrapper' });
    this.zoomContainerEl = this.pagesWrapperEl.createDiv({ cls: 'notesheet-zoom-container' });
    this.zoomContainerEl.style.zoom = `${this.viewZoom}`;

    this.renderPages(this.zoomContainerEl);
    this.setupZoomInteractions(this.pagesWrapperEl);
  }

  private setupZoomInteractions(pagesWrapper: HTMLElement): void {
    this.pendingZoom = this.viewZoom;
    let zoomRafId: number | null = null;
    let zoomEndTimer: number | null = null;

    // Trackpad Pinch-to-zoom (Wheel event with ctrlKey on macOS/Windows)
    pagesWrapper.addEventListener('wheel', (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();

        this.isZooming = true;
        if (zoomEndTimer) window.clearTimeout(zoomEndTimer);
        zoomEndTimer = window.setTimeout(() => {
          this.isZooming = false;
        }, 150);

        // Exponential zoom scaling: smooth and uniform across the entire 0.5x - 3.0x range
        const factor = Math.exp(-e.deltaY * 0.005);
        this.pendingZoom = Math.min(3.0, Math.max(0.5, this.pendingZoom * factor));

        if (!zoomRafId) {
          zoomRafId = requestAnimationFrame(() => {
            this.setViewZoom(this.pendingZoom);
            zoomRafId = null;
          });
        }
      }
    }, { passive: false });

    // Touchscreen 2-finger pinch gesture
    let initialTouchDist = 0;
    let initialTouchZoom = 1.0;
    let touchRafId: number | null = null;

    pagesWrapper.addEventListener('touchstart', (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        this.isZooming = true;
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        initialTouchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        initialTouchZoom = this.viewZoom;
        this.pendingZoom = this.viewZoom;
      }
    }, { passive: false });

    pagesWrapper.addEventListener('touchmove', (e: TouchEvent) => {
      if (e.touches.length === 2 && initialTouchDist > 0) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const scale = currentDist / initialTouchDist;
        this.pendingZoom = Math.min(3.0, Math.max(0.5, initialTouchZoom * scale));

        if (!touchRafId) {
          touchRafId = requestAnimationFrame(() => {
            this.setViewZoom(this.pendingZoom);
            touchRafId = null;
          });
        }
      }
    }, { passive: false });

    pagesWrapper.addEventListener('touchend', (e: TouchEvent) => {
      if (e.touches.length < 2) {
        initialTouchDist = 0;
        if (zoomEndTimer) window.clearTimeout(zoomEndTimer);
        zoomEndTimer = window.setTimeout(() => {
          this.isZooming = false;
        }, 150);
      }
    });
  }

  public setViewZoom(zoom: number, save = true): void {
    const clampedZoom = Math.min(3.0, Math.max(0.5, parseFloat(zoom.toFixed(2))));
    this.viewZoom = clampedZoom;
    this.pendingZoom = clampedZoom;

    if (this.zoomContainerEl) {
      this.zoomContainerEl.style.zoom = `${clampedZoom}`;
    }

    if (this.toolbar) {
      this.toolbar.updateZoomDisplay(clampedZoom);
    }

    if (save) {
      this.data.settings.viewZoom = clampedZoom;
      if (this.saveZoomDebounceTimer) {
        window.clearTimeout(this.saveZoomDebounceTimer);
      }
      this.saveZoomDebounceTimer = window.setTimeout(async () => {
        await this.saveData();
      }, 500);
    }
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
    const pageSize = this.data.settings.pageSize;
    const orientation = this.data.settings.orientation || (pageSize === 'card3x5' ? 'landscape' : 'portrait');
    const isCard = pageSize === 'card3x5';
    const ruledSide = this.data.settings.notecardRuledSide || 'front';
    const isRuled = isCard && (ruledSide === 'both' || (ruledSide === 'front' && page.id === 'front'));
    const fontStyle = this.data.settings.notecardFontStyle || 'handwritten';

    let pageParent: HTMLElement = container;

    if (isCard) {
      const pageWrapper = container.createDiv({
        cls: `notesheet-page-wrapper is-notecard-wrapper orientation-${orientation}`,
        attr: { id: `notesheet-page-${page.id}` }
      });
      pageParent = pageWrapper;

      // Header is placed OUTSIDE the notecard so the full card space and top margin are usable
      const pageHeader = pageWrapper.createDiv({ cls: 'notesheet-page-header notecard-outside-header' });
      const headerLeft = pageHeader.createDiv({ cls: 'page-header-left' });
      const sideTitle = page.id === 'front' ? (isRuled ? 'Front (Lined Side)' : 'Front') : (!isRuled ? 'Back (Blank Side)' : 'Back');
      headerLeft.createSpan({ text: sideTitle, cls: 'page-title' });

      const count = page.items.length;
      pageHeader.createSpan({
        text: `${count} card${count !== 1 ? 's' : ''}`,
        cls: 'page-stats'
      });
    }

    const isTwoLineEq = Boolean(this.data.settings.notecardTwoLineEquations);
    const pageSheet = pageParent.createDiv({
      cls: `notesheet-page-sheet paper-${pageSize} orientation-${orientation} margin-${this.data.settings.margins} page-side-${page.id} ${isRuled ? 'is-ruled' : 'is-blank'} font-style-${fontStyle} ${isTwoLineEq ? 'has-2line-equations' : ''}`,
      ...(!isCard ? { attr: { id: `notesheet-page-${page.id}` } } : {})
    });

    if (isCard) {
      const isLandscape = orientation === 'landscape';
      const paperHeight = isLandscape ? 288 : 480;
      const defaultLines = isLandscape ? 10 : 18;
      const lineCount = this.data.settings.notecardLines || defaultLines;
      const linePitch = Math.round((paperHeight / lineCount) * 100) / 100;
      const fitFontSize = Math.round(linePitch * 0.52 * 10) / 10;

      pageSheet.style.setProperty('--notecard-line-pitch', `${linePitch}px`);
      pageSheet.style.setProperty('--notecard-font-size', `${fitFontSize}px`);
      pageSheet.style.setProperty('--notecard-lines', `${lineCount}`);

      // Fixed background ruling canvas layer on the notecard (stays exact size)
      if (isRuled) {
        pageSheet.createDiv({ cls: 'notesheet-notecard-ruling' });
      }
    } else {
      // Standard notesheet header inside page sheet (Letter, A4)
      const pageHeader = pageSheet.createDiv({ cls: 'notesheet-page-header' });
      const headerLeft = pageHeader.createDiv({ cls: 'page-header-left' });
      headerLeft.createSpan({ text: page.name, cls: 'page-title' });

      const count = page.items.length;
      pageHeader.createSpan({
        text: `${count} card${count !== 1 ? 's' : ''}`,
        cls: 'page-stats'
      });
    }

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
    if (this.data.settings.showPageNumbers && !isCard) {
      const pageFooter = pageSheet.createDiv({ cls: 'notesheet-page-footer' });
      pageFooter.createSpan({ text: this.data.title, cls: 'footer-title' });
      pageFooter.createSpan({
        text: page.id === 'front' ? 'Page 1 (Front)' : 'Page 2 (Back)',
        cls: 'footer-page-num'
      });
    }

    // Observe page resizing to keep scale and page boundaries strictly WYSIWYG
    const runFit = () => {
      this.updatePageFit(pageSheet);
    };

    if (typeof ResizeObserver !== 'undefined') {
      let rAF: number | null = null;
      let lastUnzoomedW = 0;
      let lastUnzoomedH = 0;

      const observer = new ResizeObserver((entries) => {
        // While user is actively pinching/zooming, completely skip auto-fit layout
        if (this.isZooming) return;

        const entry = entries[0];
        if (entry) {
          // Normalize by display zoom so optical zooming does NOT trigger expensive DOM refits
          const curZoom = this.viewZoom || 1.0;
          const unzoomedW = Math.round(entry.contentRect.width / curZoom);
          const unzoomedH = Math.round(entry.contentRect.height / curZoom);

          if (Math.abs(unzoomedW - lastUnzoomedW) < 2 && Math.abs(unzoomedH - lastUnzoomedH) < 2) {
            return;
          }
          lastUnzoomedW = unzoomedW;
          lastUnzoomedH = unzoomedH;
        }

        if (rAF) cancelAnimationFrame(rAF);
        rAF = requestAnimationFrame(() => {
          runFit();
        });
      });
      observer.observe(pageSheet);
      this.pageObservers.push(observer);
    }
    setTimeout(runFit, 100);
    setTimeout(runFit, 300);
    setTimeout(runFit, 600);
  }

  public updatePageFit(pageSheet: HTMLElement): void {
    const pageSheetEl = pageSheet.classList.contains('notesheet-page-sheet')
      ? pageSheet
      : pageSheet.querySelector<HTMLElement>('.notesheet-page-sheet') || pageSheet;

    const grid = pageSheetEl.querySelector<HTMLElement>('.notesheet-columns-grid');
    if (!grid) return;
    const headerEl = pageSheetEl.querySelector<HTMLElement>('.notesheet-page-header');
    const footerEl = pageSheetEl.querySelector<HTMLElement>('.notesheet-page-footer');
    const statsEl = pageSheet.querySelector<HTMLElement>('.page-stats')
      || pageSheetEl.parentElement?.querySelector<HTMLElement>('.page-stats');

    const pageSize = this.data.settings.pageSize;
    const orientation = this.data.settings.orientation || (pageSize === 'card3x5' ? 'landscape' : 'portrait');
    const isLandscape = orientation === 'landscape';
    const isCard = pageSize === 'card3x5';

    let paperWidth = 816;
    let paperHeight = 1056;

    if (pageSize === 'a4') {
      paperWidth = isLandscape ? 1123 : 794;
      paperHeight = isLandscape ? 794 : 1123;
    } else if (isCard) {
      paperWidth = isLandscape ? 480 : 288;
      paperHeight = isLandscape ? 288 : 480;
    } else {
      // letter
      paperWidth = isLandscape ? 1056 : 816;
      paperHeight = isLandscape ? 816 : 1056;
    }

    let marginPx = 24; // compact default
    if (isCard) {
      marginPx = 0; // Notecards use edge-to-edge ruled lines
    } else {
      marginPx = this.data.settings.margins === 'tight' ? 19.2 : this.data.settings.margins === 'normal' ? 48 : 24;
    }

    // Accurate header & footer measurements including their margins
    const headerH = (!isCard && headerEl) ? (headerEl.offsetHeight + 8) : 0;
    const footerH = (!isCard && footerEl) ? (footerEl.offsetHeight + 8) : 0;

    // Safety margin for print rendering tolerances (0 for notecards so full ruling height is available)
    const safetyMargin = isCard ? 0 : 24;
    const availableHeight = paperHeight - (marginPx * 2) - headerH - footerH - safetyMargin;

    const cols = Array.from(grid.querySelectorAll<HTMLElement>('.notesheet-column'));
    if (cols.length === 0) return;

    // Reset zoom temporarily to measure true unscaled natural layout height
    const prevZoom = grid.style.zoom;
    grid.style.zoom = '1';

    const zoomFactor = this.viewZoom || 1.0;

    // 3x5 Notecard: Snap lines so large equations or multiline paragraphs never break line alignment
    if (isCard) {
      const defaultLines = isLandscape ? 10 : 18;
      const lineCount = this.data.settings.notecardLines || defaultLines;
      const linePitch = paperHeight / lineCount;
      const twoLineEqs = Boolean(this.data.settings.notecardTwoLineEquations);

      const bodyElements = pageSheetEl.querySelectorAll<HTMLElement>(
        '.notesheet-card-body p, .notesheet-card-body .math-block, .notesheet-card-body li, .notesheet-card-body pre, .notesheet-card-body table'
      );
      bodyElements.forEach((el) => {
        el.style.minHeight = '';
        const isBig = (twoLineEqs && !!el.querySelector('mjx-container[display="true"], .math-block, [data-mml-node="mfrac"], [data-mml-node="msqrt"], [data-mml-node="munderover"], [data-mml-node="mtable"], mjx-frac, mjx-sqrt, mjx-over, mjx-under, mjx-table, .mfrac, .sqrt, .katex-display')) || el.classList.contains('two-lines') || el.classList.contains('math-block') || !!el.querySelector('.math-block, mjx-container[display="true"]');
        if (isBig) {
          el.classList.add('is-2line-equation');
        } else {
          el.classList.remove('is-2line-equation');
        }
        const h = el.offsetHeight || Math.round(el.getBoundingClientRect().height / zoomFactor);
        if (h > 0) {
          const minLines = isBig ? 2 : 1;
          const linesNeeded = Math.max(minLines, Math.round(h / linePitch));
          el.style.minHeight = `${linesNeeded * linePitch}px`;
        }
      });
    }

    let maxColH = 0;
    for (const col of cols) {
      const h = col.scrollHeight || Math.round(col.getBoundingClientRect().height / zoomFactor);
      if (h > maxColH) maxColH = h;
    }

    const itemCount = cols.reduce((acc, c) => acc + c.querySelectorAll('.notesheet-card').length, 0);
    const autoFit = this.data.settings.autoFitPage !== false;
    const minScale = isCard ? 0.45 : 0.65;
    const unitLabel = isCard ? 'notecard' : 'page';

    // If element is not rendered/visible in DOM (maxColH == 0), restore previous zoom and return
    if (maxColH === 0) {
      if (prevZoom) grid.style.zoom = prevZoom;
      return;
    }

    // 3x5 Notecard: Ruled lines stay at designated size; auto-fit scales content to fit card
    if (isCard) {
      const defaultLines = isLandscape ? 10 : 18;
      const lineCount = this.data.settings.notecardLines || defaultLines;
      const linePitch = paperHeight / lineCount;
      const usedLines = Math.max(1, Math.round(maxColH / linePitch));

      if (autoFit && maxColH > availableHeight) {
        const targetScale = Math.max(minScale, Math.min(1.0, availableHeight / maxColH));
        const scaleStr = targetScale.toFixed(3);
        grid.style.zoom = scaleStr;
        pageSheetEl.classList.remove('is-overflowing');
        if (statsEl) {
          statsEl.setText(`${itemCount} cards • ${usedLines}/${lineCount} lines • ${(targetScale * 100).toFixed(0)}% fit`);
          statsEl.removeClass('overflow-warn');
          statsEl.addClass('fit-active');
        }
      } else if (autoFit) {
        grid.style.zoom = '1';
        pageSheetEl.classList.remove('is-overflowing');
        if (statsEl) {
          statsEl.setText(`${itemCount} cards • ${usedLines}/${lineCount} lines`);
          statsEl.removeClass('overflow-warn', 'fit-active');
        }
      } else {
        grid.style.zoom = '1';
        if (usedLines > lineCount || maxColH > availableHeight + 2) {
          pageSheetEl.classList.add('is-overflowing');
          if (statsEl) {
            const overCount = usedLines > lineCount ? `(+${usedLines - lineCount} over)` : `(+${Math.round(maxColH - availableHeight)}px)`;
            statsEl.setText(`${itemCount} cards • ${usedLines}/${lineCount} lines ${overCount}`);
            statsEl.addClass('overflow-warn');
            statsEl.removeClass('fit-active');
          }
        } else {
          pageSheetEl.classList.remove('is-overflowing');
          if (statsEl) {
            statsEl.setText(`${itemCount} cards • ${usedLines}/${lineCount} lines`);
            statsEl.removeClass('overflow-warn', 'fit-active');
          }
        }
      }
      return;
    }

    if (autoFit && maxColH > availableHeight) {
      const targetScale = Math.max(minScale, Math.min(1.0, availableHeight / maxColH));
      const scaleStr = targetScale.toFixed(3);
      grid.style.zoom = scaleStr;
      pageSheetEl.classList.remove('is-overflowing');
      if (statsEl) {
        statsEl.setText(`${itemCount} cards • ${(targetScale * 100).toFixed(0)}% fit`);
        statsEl.removeClass('overflow-warn');
        statsEl.addClass('fit-active');
      }
    } else if (autoFit) {
      grid.style.zoom = '1';
      pageSheetEl.classList.remove('is-overflowing');
      if (statsEl) {
        statsEl.setText(`${itemCount} card${itemCount !== 1 ? 's' : ''}`);
        statsEl.removeClass('overflow-warn', 'fit-active');
      }
    } else {
      grid.style.zoom = '1';
      if (maxColH > availableHeight + 5) {
        pageSheetEl.classList.add('is-overflowing');
        if (statsEl) {
          const overflowPx = Math.round(maxColH - availableHeight);
          statsEl.setText(`${itemCount} cards • ⚠️ Overflows ${unitLabel} (+${overflowPx}px)`);
          statsEl.addClass('overflow-warn');
          statsEl.removeClass('fit-active');
        }
      } else {
        pageSheetEl.classList.remove('is-overflowing');
        if (statsEl) {
          statsEl.setText(`${itemCount} card${itemCount !== 1 ? 's' : ''}`);
          statsEl.removeClass('overflow-warn', 'fit-active');
        }
      }
    }
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

  public createPrintPageElements(): HTMLElement[] {
    const pages: HTMLElement[] = [];
    const pageEls = this.contentEl.querySelectorAll<HTMLElement>('.notesheet-page-sheet');
    pageEls.forEach((pageEl) => {
      const origGrid = pageEl.querySelector<HTMLElement>('.notesheet-columns-grid');
      const clone = pageEl.cloneNode(true) as HTMLElement;
      clone.classList.remove('tab-hidden');
      clone.classList.remove('is-overflowing');

      // Strip non-print controls (copy buttons, edit forms, drag handles, buttons)
      clone.querySelectorAll(
        'pre button, .copy-code-button, button.copy-code-button, div.copy-code-button, .code-block-action, .copy-code-button-text, .code-block-flair, [aria-label*="copy" i], [title*="copy" i], [class*="copy" i], .notesheet-card-actions, .notesheet-card-drag-handle, .notesheet-card-source-badge, .notesheet-card-category-pill, .notesheet-card-edit-wrapper, .drag-target-active'
      ).forEach((el) => {
        if (el.tagName === 'BUTTON' || el.classList.contains('copy-code-button') || el.classList.contains('code-block-action') || el.getAttribute('aria-label')?.toLowerCase().includes('copy') || !el.classList.contains('notesheet-card-body')) {
          el.remove();
        }
      });

      // If card header is now empty (no title), remove it so it takes zero space
      clone.querySelectorAll('.notesheet-card-header').forEach((header) => {
        if (!header.querySelector('.notesheet-card-title') || header.textContent?.trim() === '') {
          header.remove();
        }
      });

      const cloneGrid = clone.querySelector<HTMLElement>('.notesheet-columns-grid');
      if (origGrid && cloneGrid && origGrid.style.zoom) {
        cloneGrid.style.zoom = origGrid.style.zoom;
      }

      pages.push(clone);
    });
    return pages;
  }

  public setupPrintContainer(): HTMLElement {
    this.cleanPrintContainer();
    const pageSize = this.data.settings.pageSize;
    const orientation = this.data.settings.orientation || (pageSize === 'card3x5' ? 'landscape' : 'portrait');
    const isLandscape = orientation === 'landscape';

    let paperWidth = 816;
    if (pageSize === 'a4') {
      paperWidth = isLandscape ? 1123 : 794;
    } else if (pageSize === 'card3x5') {
      paperWidth = isLandscape ? 480 : 288;
    } else {
      paperWidth = isLandscape ? 1056 : 816;
    }

    const printContainer = document.body.createDiv({
      cls: `print notesheet-print-container density-${this.data.settings.density || 'compact'} paper-${pageSize} orientation-${orientation}`
    });
    printContainer.style.setProperty('--notesheet-font-size', `${this.data.settings.fontSize}pt`);
    printContainer.style.setProperty('--notesheet-columns', `${this.data.settings.columns}`);
    printContainer.style.width = `${paperWidth}px`;

    // Inject dynamic @page style for margins and page size
    let pageRuleSize = '';
    let marginInches = '0.25in';

    if (pageSize === 'card3x5') {
      pageRuleSize = isLandscape ? '5in 3in' : '3in 5in';
      marginInches = this.data.settings.margins === 'tight' ? '0.1in' : this.data.settings.margins === 'normal' ? '0.25in' : '0.15in';
    } else {
      pageRuleSize = `${pageSize} ${orientation}`;
      marginInches = this.data.settings.margins === 'tight' ? '0.2in' : this.data.settings.margins === 'normal' ? '0.5in' : '0.25in';
    }

    const dynamicStyle = document.createElement('style');
    dynamicStyle.id = 'notesheet-print-dynamic-style';
    dynamicStyle.textContent = `@page { size: ${pageRuleSize}; margin: ${marginInches}; }`;
    document.head.appendChild(dynamicStyle);

    const pages = this.createPrintPageElements();
    pages.forEach((pageEl) => {
      printContainer.appendChild(pageEl);
      // Run fit calculation directly on the print clone
      this.updatePageFit(pageEl);
    });

    return printContainer;
  }

  public cleanPrintContainer(): void {
    document.querySelectorAll('.notesheet-print-container').forEach((el) => el.remove());
    document.getElementById('notesheet-print-dynamic-style')?.remove();
  }

  public printNotesheet(): void {
    const isCard = this.data.settings.pageSize === 'card3x5';
    new Notice(isCard ? 'Notesheet: Preparing 3x5 notecard print & PDF export...' : 'Notesheet: Preparing 2-page print & PDF export...');
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
    }, 250);
  }
}
