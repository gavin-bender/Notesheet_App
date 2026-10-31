import { App, Component, MarkdownRenderer, Notice, TFile, setIcon, Menu } from 'obsidian';
import { NotesheetItem, NotesheetSettings, NotesheetCategory } from '../types';
import { SyncManager } from '../sync/SyncManager';

export interface CardActionCallbacks {
  onUpdate: (item: NotesheetItem) => Promise<void>;
  onDelete: (item: NotesheetItem) => Promise<void>;
  onMovePage: (item: NotesheetItem, targetPageId: string) => Promise<void>;
  onMoveOrder: (item: NotesheetItem, direction: 'up' | 'down') => Promise<void>;
  onCategoryChange: (item: NotesheetItem, categoryId?: string) => Promise<void>;
  onOpenCategoryManager?: () => void;
}

export interface CardRenderOptions {
  hideCategoryBanner?: boolean;
  hideCardTitle?: boolean;
}

export class NotesheetCard {
  private app: App;
  private component: Component;
  private syncManager: SyncManager;
  private item: NotesheetItem;
  private settings: NotesheetSettings;
  private categories: NotesheetCategory[];
  private currentPageId: string;
  private callbacks: CardActionCallbacks;
  private options: CardRenderOptions;
  private cardEl: HTMLElement;
  private isEditing = false;

  constructor(
    app: App,
    component: Component,
    syncManager: SyncManager,
    item: NotesheetItem,
    settings: NotesheetSettings,
    categories: NotesheetCategory[],
    currentPageId: string,
    callbacks: CardActionCallbacks,
    options?: CardRenderOptions
  ) {
    this.app = app;
    this.component = component;
    this.syncManager = syncManager;
    this.item = item;
    this.settings = settings;
    this.categories = categories;
    this.currentPageId = currentPageId;
    this.callbacks = callbacks;
    this.options = options || {};
  }

  public render(container: HTMLElement): HTMLElement {
    const category = this.categories.find(c => c.id === this.item.categoryId);

    this.cardEl = container.createDiv({
      cls: `notesheet-card ${this.settings.showBorders ? 'has-border' : 'no-border'} ${category ? 'has-category' : ''}`
    });
    this.cardEl.dataset.itemId = this.item.id;
    this.cardEl.setAttribute('draggable', 'true');

    if (category) {
      this.cardEl.style.setProperty('--card-cat-color', category.color);
    } else {
      this.cardEl.style.removeProperty('--card-cat-color');
    }

    if (this.isEditing) {
      this.renderEditMode();
    } else {
      this.renderViewMode();
    }

    return this.cardEl;
  }

  private renderViewMode(): void {
    this.cardEl.empty();
    const category = this.categories.find(c => c.id === this.item.categoryId);

    // Optional Category Title Header Banner (if category exists, showCategoryTitles is enabled, and not suppressed by adjacency)
    if (category && this.settings.showCategoryTitles && !this.options.hideCategoryBanner) {
      const banner = this.cardEl.createDiv({ cls: 'notesheet-category-banner' });
      banner.style.backgroundColor = `${category.color}18`; // 10% opacity tint
      banner.style.borderColor = category.color;

      const dot = banner.createSpan({ cls: 'category-color-dot' });
      dot.style.backgroundColor = category.color;

      const title = banner.createSpan({ text: category.name, cls: 'category-banner-title' });
      title.style.color = category.color;
    }

    // Top action bar
    const headerEl = this.cardEl.createDiv({ cls: 'notesheet-card-header' });

    // Left side: Title, Category pill & Sync Badge
    const headerLeft = headerEl.createDiv({ cls: 'notesheet-card-header-left' });

    // Drag handle icon
    const dragHandle = headerLeft.createSpan({ cls: 'notesheet-card-drag-handle' });
    setIcon(dragHandle, 'grip-vertical');
    dragHandle.title = 'Drag to reorder card';

    // Category Quick-Pill (Click to switch category)
    const catPill = headerLeft.createSpan({
      cls: `notesheet-card-category-pill ${category ? 'active' : ''}`
    });
    if (category) {
      const dot = catPill.createSpan({ cls: 'category-color-dot' });
      dot.style.backgroundColor = category.color;
      if (!this.settings.showCategoryTitles || this.options.hideCategoryBanner) {
        catPill.createSpan({ text: category.name });
      }
      catPill.title = `Category: ${category.name} (Click to change)`;
    } else {
      catPill.createSpan({ text: '+ Category' });
      catPill.title = 'Assign a category to color-code this card';
    }

    catPill.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openCategoryMenu(e);
    });

    const displayTitle = this.cleanFormatting(this.item.title || '');

    if (this.settings.showCardTitles && displayTitle && !this.options.hideCardTitle) {
      const titleEl = headerLeft.createSpan({ cls: 'notesheet-card-title', text: displayTitle });
      titleEl.title = displayTitle;
    }

    if (this.item.sourceFile && this.settings.showSourceLinks) {
      const sourceBadge = headerLeft.createSpan({ cls: 'notesheet-card-source-badge' });
      setIcon(sourceBadge, 'sync');
      const filename = this.item.sourceFile.split('/').pop()?.replace('.md', '') || 'note';
      sourceBadge.createSpan({ text: filename });
      sourceBadge.title = `Synced with: ${this.item.sourceFile} (Click to open note)`;

      sourceBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openSourceNote();
      });
    }

    // Right side: action buttons
    const actionsEl = headerEl.createDiv({ cls: 'notesheet-card-actions' });

    // Move to other page button (Front <-> Back)
    const targetPage = this.currentPageId === 'front' ? 'back' : 'front';
    const targetLabel = this.currentPageId === 'front' ? '→ Back' : '→ Front';
    const movePageBtn = actionsEl.createEl('button', {
      cls: 'notesheet-btn-icon',
      text: targetLabel
    });
    movePageBtn.title = `Move to ${targetPage === 'front' ? 'Page 1 (Front)' : 'Page 2 (Back)'}`;
    movePageBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onMovePage(this.item, targetPage);
    });

    // Move Up button
    const moveUpBtn = actionsEl.createEl('button', { cls: 'notesheet-btn-icon' });
    setIcon(moveUpBtn, 'chevron-up');
    moveUpBtn.title = 'Move up';
    moveUpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onMoveOrder(this.item, 'up');
    });

    // Move Down button
    const moveDownBtn = actionsEl.createEl('button', { cls: 'notesheet-btn-icon' });
    setIcon(moveDownBtn, 'chevron-down');
    moveDownBtn.title = 'Move down';
    moveDownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onMoveOrder(this.item, 'down');
    });

    // Edit button
    const editBtn = actionsEl.createEl('button', { cls: 'notesheet-btn-icon' });
    setIcon(editBtn, 'pencil');
    editBtn.title = 'Edit content (two-way syncs to note)';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.isEditing = true;
      this.renderEditMode();
    });

    // Delete button
    const deleteBtn = actionsEl.createEl('button', { cls: 'notesheet-btn-icon btn-danger' });
    setIcon(deleteBtn, 'trash-2');
    deleteBtn.title = 'Remove from notesheet';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onDelete(this.item);
    });

    // Card Body: Render Markdown (with duplicate title stripped if header already shows it)
    const bodyEl = this.cardEl.createDiv({ cls: 'notesheet-card-body' });
    const contentToRender = this.getDisplayContent(
      this.item.content,
      displayTitle,
      this.settings.showCardTitles
    );

    MarkdownRenderer.render(
      this.app,
      contentToRender,
      bodyEl,
      this.item.sourceFile || '',
      this.component
    );
  }

  /**
   * Cleans icon shortcodes, markdown markers, and trailing punctuation from titles.
   */
  private cleanFormatting(text: string): string {
    if (!text) return '';
    return text
      .replace(/:[a-zA-Z0-9_-]+:\s*/g, '')
      .replace(/^#{1,6}\s+/, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[:\s-]+$/, '')
      .trim();
  }

  /**
   * Strips duplicate leading title lines from the card body when the header displays it.
   */
  private getDisplayContent(content: string, title?: string, showTitleHeader = true): string {
    if (!content) return '';
    if (!showTitleHeader || !title) return content;

    const lines = content.trimStart().split('\n');
    if (lines.length <= 1) {
      return content;
    }

    const cleanFirstLine = this.cleanFormatting(lines[0]).toLowerCase();
    const cleanTitle = this.cleanFormatting(title).toLowerCase();

    if (cleanFirstLine && cleanTitle) {
      if (
        cleanFirstLine === cleanTitle ||
        cleanFirstLine.startsWith(cleanTitle) ||
        cleanTitle.startsWith(cleanFirstLine)
      ) {
        const rest = lines.slice(1).join('\n').trim();
        if (rest.length > 0) {
          return rest;
        }
      }
    }

    return content;
  }

  private openCategoryMenu(event: MouseEvent): void {
    const menu = new Menu();

    menu.addItem(item => {
      item
        .setTitle('None (No Category)')
        .setChecked(!this.item.categoryId)
        .onClick(async () => {
          this.item.categoryId = undefined;
          await this.callbacks.onCategoryChange(this.item, undefined);
        });
    });

    menu.addSeparator();

    for (const cat of this.categories) {
      menu.addItem(item => {
        item
          .setTitle(cat.name)
          .setChecked(this.item.categoryId === cat.id)
          .onClick(async () => {
            this.item.categoryId = cat.id;
            await this.callbacks.onCategoryChange(this.item, cat.id);
          });
      });
    }

    if (this.callbacks.onOpenCategoryManager) {
      menu.addSeparator();
      menu.addItem(item => {
        item
          .setTitle('🎨 Manage Categories...')
          .setIcon('palette')
          .onClick(() => {
            this.callbacks.onOpenCategoryManager?.();
          });
      });
    }

    menu.showAtMouseEvent(event);
  }

  private renderEditMode(): void {
    this.cardEl.empty();

    const editWrapper = this.cardEl.createDiv({ cls: 'notesheet-card-edit-wrapper' });

    // Top inputs: Title & Category Selector
    const inputsRow = editWrapper.createDiv({ cls: 'notesheet-card-inputs-row' });

    const titleInput = inputsRow.createEl('input', {
      type: 'text',
      cls: 'notesheet-card-title-input',
      value: this.item.title || ''
    });
    titleInput.placeholder = 'Card Title (optional)';

    // Category dropdown
    const catSelect = inputsRow.createEl('select', { cls: 'notesheet-select' });
    const defaultOpt = catSelect.createEl('option', { text: '-- No Category --', value: '' });
    if (!this.item.categoryId) defaultOpt.selected = true;

    for (const cat of this.categories) {
      const opt = catSelect.createEl('option', { text: `● ${cat.name}`, value: cat.id });
      if (this.item.categoryId === cat.id) opt.selected = true;
    }

    // Source note notification
    if (this.item.sourceFile && this.item.blockId) {
      const syncInfo = editWrapper.createDiv({ cls: 'notesheet-sync-notice' });
      setIcon(syncInfo, 'refresh-cw');
      syncInfo.createSpan({
        text: ` Live-linked to "${this.item.sourceFile}". Changes will update the note.`
      });
    }

    // Markdown Textarea
    const textarea = editWrapper.createEl('textarea', {
      cls: 'notesheet-card-textarea'
    });
    textarea.value = this.item.content;
    textarea.rows = Math.min(15, Math.max(3, this.item.content.split('\n').length + 1));

    // Save and Cancel button bar
    const btnRow = editWrapper.createDiv({ cls: 'notesheet-card-edit-buttons' });

    const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => {
      this.isEditing = false;
      this.renderViewMode();
    });

    const saveBtn = btnRow.createEl('button', { text: 'Save & Sync', cls: 'mod-cta' });

    const handleSave = async () => {
      const newContent = textarea.value.trim();
      const newTitle = titleInput.value.trim();
      const newCatId = catSelect.value || undefined;

      const contentChanged = newContent !== this.item.content;
      this.item.title = newTitle;
      this.item.content = newContent;
      this.item.categoryId = newCatId;
      this.item.updatedAt = Date.now();

      if (contentChanged && this.item.sourceFile && this.item.blockId) {
        saveBtn.setText('Syncing...');
        saveBtn.setAttribute('disabled', 'true');
        const ok = await this.syncManager.syncCardToSourceNote(this.item, newContent);
        if (ok) {
          new Notice(`Notesheet: Updated source note "${this.item.sourceFile}"`);
        }
      }

      await this.callbacks.onUpdate(this.item);
      this.isEditing = false;
      this.renderViewMode();
    };

    saveBtn.addEventListener('click', handleSave);

    // Keyboard shortcut: Ctrl/Cmd + Enter to save
    textarea.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSave();
      }
    });

    setTimeout(() => {
      textarea.focus();
    }, 50);
  }

  private async openSourceNote(): Promise<void> {
    if (!this.item.sourceFile) return;

    const file = this.app.vault.getAbstractFileByPath(this.item.sourceFile);
    if (file instanceof TFile) {
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);

      if (this.item.blockId) {
        new Notice(`Opened "${file.basename}" (^${this.item.blockId})`);
      }
    } else {
      new Notice(`Could not find "${this.item.sourceFile}".`);
    }
  }

  public updateContent(content: string): void {
    this.item.content = content;
    if (!this.isEditing && this.cardEl) {
      this.renderViewMode();
    }
  }
}
