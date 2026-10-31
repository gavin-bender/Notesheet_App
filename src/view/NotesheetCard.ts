import { App, Component, MarkdownRenderer, Notice, TFile, setIcon, Menu } from 'obsidian';
import { NotesheetItem, NotesheetSettings, NotesheetCategory } from '../types';
import { SyncManager } from '../sync/SyncManager';
import { renderTextWithIcons } from './IconRenderer';
import { openIconPickerForElement } from './IconPickerHelper';
import { normalizeCodeLanguages, highlightCodeBlocks } from './CodeHighlightHelper';

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
  startInEditMode?: boolean;
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
    if (this.options.startInEditMode) {
      this.isEditing = true;
    }
  }

  public getIsEditing(): boolean {
    return this.isEditing;
  }

  public startEditing(focus = true): void {
    if (this.isEditing) return;
    this.isEditing = true;
    if (this.cardEl) {
      this.cardEl.setAttribute('draggable', 'false');
      this.cardEl.addClass('is-editing');
      this.renderEditMode();
      if (focus) {
        setTimeout(() => {
          const titleInput = this.cardEl?.querySelector<HTMLInputElement>('.notesheet-card-title-input');
          if (titleInput) {
            titleInput.focus();
            titleInput.select();
          }
        }, 50);
      }
    }
  }

  public render(container: HTMLElement): HTMLElement {
    const category = this.categories.find(c => c.id === this.item.categoryId);

    this.cardEl = container.createDiv({
      cls: `notesheet-card ${this.settings.showBorders ? 'has-border' : 'no-border'} ${category ? 'has-category' : ''} ${this.isEditing ? 'is-editing' : ''}`
    });
    this.cardEl.dataset.itemId = this.item.id;
    this.cardEl.setAttribute('draggable', this.isEditing ? 'false' : 'true');

    if (category) {
      this.cardEl.style.setProperty('--card-cat-color', category.color);
    } else {
      this.cardEl.style.removeProperty('--card-cat-color');
    }

    if (this.isEditing) {
      this.renderEditMode();
      if (this.options.startInEditMode) {
        setTimeout(() => {
          const titleInput = this.cardEl?.querySelector<HTMLInputElement>('.notesheet-card-title-input');
          if (titleInput) {
            titleInput.focus();
            titleInput.select();
          }
        }, 50);
      }
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

      const title = banner.createSpan({ cls: 'category-banner-title' });
      title.style.color = category.color;
      renderTextWithIcons(title, category.name);
    }

    // Top action bar
    const headerEl = this.cardEl.createDiv({ cls: 'notesheet-card-header' });

    // Left side: Title, Category pill & Sync Badge
    const headerLeft = headerEl.createDiv({ cls: 'notesheet-card-header-left' });

    // Drag handle icon
    const dragHandle = headerLeft.createSpan({ cls: 'notesheet-card-drag-handle' });
    setIcon(dragHandle, 'grip-vertical');
    dragHandle.title = 'Drag to reorder card';

    // Category Quick-Dot (Click to switch category)
    const catPill = headerLeft.createSpan({
      cls: `notesheet-card-category-pill ${category ? 'active' : ''}`
    });
    const dot = catPill.createSpan({
      cls: `category-color-dot ${category ? '' : 'unassigned'}`
    });
    if (category) {
      dot.style.backgroundColor = category.color;
      catPill.title = `Category: ${category.name} (Click to change)`;
    } else {
      catPill.title = 'Assign category (Click to choose)';
    }

    catPill.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openCategoryMenu(e);
    });

    const displayTitle = this.cleanFormatting(this.item.title || '', true);
    const hasVisibleTitle = Boolean(this.settings.showCardTitles && displayTitle && !this.options.hideCardTitle);

    if (hasVisibleTitle) {
      this.cardEl.removeClass('has-no-title');
      const titleEl = headerLeft.createSpan({ cls: 'notesheet-card-title' });
      renderTextWithIcons(titleEl, displayTitle);
      titleEl.title = this.cleanFormatting(displayTitle, false);
    } else {
      this.cardEl.addClass('has-no-title');
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
      this.startEditing(true);
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
    const contentToRender = normalizeCodeLanguages(
      this.getDisplayContent(
        this.item.content,
        displayTitle,
        this.settings.showCardTitles
      )
    );

    const stripCodeActions = () => {
      bodyEl.querySelectorAll(
        'pre button, .copy-code-button, button.copy-code-button, div.copy-code-button, .code-block-action, .copy-code-button-text, .code-block-flair, pre [class*="copy" i], [aria-label*="copy" i], [title*="copy" i], div[aria-label*="copy" i]'
      ).forEach((el) => {
        if (el.tagName === 'BUTTON' || el.classList.contains('copy-code-button') || el.classList.contains('code-block-action') || el.getAttribute('aria-label')?.toLowerCase().includes('copy') || !el.classList.contains('notesheet-card-body')) {
          el.remove();
        }
      });
    };

    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => {
        stripCodeActions();
      });
      observer.observe(bodyEl, { childList: true, subtree: true });
    }

    MarkdownRenderer.render(
      this.app,
      contentToRender,
      bodyEl,
      this.item.sourceFile || '',
      this.component
    ).then(() => {
      stripCodeActions();
      requestAnimationFrame(stripCodeActions);
      setTimeout(stripCodeActions, 50);
      highlightCodeBlocks(bodyEl);
    });

    // Double click to edit card
    this.cardEl.addEventListener('dblclick', (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest('button') ||
        target.closest('.notesheet-btn-icon') ||
        target.closest('.notesheet-card-category-pill') ||
        target.closest('.notesheet-card-drag-handle') ||
        target.closest('a')
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this.startEditing(true);
    });
  }

  /**
   * Cleans icon shortcodes, markdown markers, and trailing punctuation from titles.
   */
  private cleanFormatting(text: string, preserveShortcodes = false): string {
    if (!text) return '';
    let res = text
      .replace(/^#{1,6}\s+/, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[:\s-]+$/, '')
      .trim();

    if (!preserveShortcodes) {
      res = res.replace(/:[a-zA-Z0-9_-]+:\s*/g, '').trim();
    }

    return res;
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

    const cleanFirstLine = this.cleanFormatting(lines[0], false).toLowerCase();
    const cleanTitle = this.cleanFormatting(title, false).toLowerCase();

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
    this.cardEl.setAttribute('draggable', 'false');
    this.cardEl.addClass('is-editing');

    const editWrapper = this.cardEl.createDiv({ cls: 'notesheet-card-edit-wrapper' });

    // Top inputs: Title & Category Selector
    const inputsRow = editWrapper.createDiv({ cls: 'notesheet-card-inputs-row' });

    const titleInput = inputsRow.createEl('input', {
      type: 'text',
      cls: 'notesheet-card-title-input',
      value: this.item.title || ''
    });
    titleInput.placeholder = 'Card Title (optional)';

    // Icon button for Title
    const titleIconBtn = inputsRow.createEl('button', {
      cls: 'notesheet-btn-icon notesheet-icon-picker-btn',
      attr: { 'aria-label': 'Insert icon shortcode (Cmd+I)', title: 'Insert Icon (Cmd+I)' }
    });
    setIcon(titleIconBtn, 'smile');
    titleIconBtn.createSpan({ text: ' Icon', cls: 'notesheet-btn-label' });
    titleIconBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openIconPickerForElement(this.app, titleInput);
    });

    // Category dropdown
    const catSelect = inputsRow.createEl('select', { cls: 'notesheet-select' });
    const defaultOpt = catSelect.createEl('option', { text: '-- No Category --', value: '' });
    if (!this.item.categoryId) defaultOpt.selected = true;

    for (const cat of this.categories) {
      const opt = catSelect.createEl('option', { text: `● ${cat.name}`, value: cat.id });
      if (this.item.categoryId === cat.id) opt.selected = true;
    }

    // Source note notification (Sync info shown in edit mode)
    if (this.item.sourceFile && this.item.blockId) {
      const syncInfo = editWrapper.createDiv({ cls: 'notesheet-sync-notice' });
      setIcon(syncInfo, 'refresh-cw');
      const filename = this.item.sourceFile.split('/').pop()?.replace('.md', '') || this.item.sourceFile;
      syncInfo.createSpan({
        text: ` Live-linked to "${filename}". Changes will update note.`
      });
      syncInfo.title = `Source note: ${this.item.sourceFile} (Click to open note)`;
      syncInfo.addEventListener('click', () => {
        this.openSourceNote();
      });
    }

    // Textarea toolbar with icon button and shortcut hint
    const textareaToolbar = editWrapper.createDiv({ cls: 'notesheet-card-textarea-toolbar' });

    const textareaIconBtn = textareaToolbar.createEl('button', {
      cls: 'notesheet-btn-icon notesheet-icon-picker-btn',
      attr: { 'aria-label': 'Insert icon shortcode (Cmd+I)', title: 'Insert Icon (Cmd+I)' }
    });
    setIcon(textareaIconBtn, 'sparkles');
    textareaIconBtn.createSpan({ text: ' Insert Icon', cls: 'notesheet-btn-label' });
    textareaIconBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openIconPickerForElement(this.app, textarea);
    });

    const shortcutHint = textareaToolbar.createSpan({ cls: 'notesheet-toolbar-hint' });
    shortcutHint.setText('Shift+Enter to finish • ⌘I for icons');

    // Markdown Textarea
    const textarea = editWrapper.createEl('textarea', {
      cls: 'notesheet-card-textarea'
    });
    textarea.value = this.item.content;
    textarea.rows = Math.min(15, Math.max(3, this.item.content.split('\n').length + 1));

    // Hotkey & inline :: triggers for titleInput and textarea
    const handleKeydown = (e: KeyboardEvent, el: HTMLInputElement | HTMLTextAreaElement) => {
      // Shift+Enter, Cmd+Enter, or Ctrl+Enter finishes edit and saves
      if (e.key === 'Enter' && (e.shiftKey || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        handleSave();
        return;
      }

      // Enter in Title input finishes edit and saves
      if (el === titleInput && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        handleSave();
        return;
      }

      // Cmd+I / Ctrl+I to open icon picker
      if ((e.metaKey || e.ctrlKey) && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        openIconPickerForElement(this.app, el);
      }
    };

    const handleInput = (e: Event, el: HTMLInputElement | HTMLTextAreaElement) => {
      const cursor = el.selectionStart ?? el.value.length;
      const textBefore = el.value.substring(0, cursor);
      if (textBefore.endsWith('::')) {
        openIconPickerForElement(this.app, el);
      }
    };

    titleInput.addEventListener('keydown', (e) => handleKeydown(e, titleInput));
    titleInput.addEventListener('input', (e) => handleInput(e, titleInput));
    textarea.addEventListener('keydown', (e) => handleKeydown(e, textarea));
    textarea.addEventListener('input', (e) => handleInput(e, textarea));

    // Save and Cancel button bar
    const btnRow = editWrapper.createDiv({ cls: 'notesheet-card-edit-buttons' });

    const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => {
      this.isEditing = false;
      this.cardEl.setAttribute('draggable', 'true');
      this.cardEl.removeClass('is-editing');
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
      this.cardEl.setAttribute('draggable', 'true');
      this.cardEl.removeClass('is-editing');
      this.renderViewMode();
    };

    saveBtn.addEventListener('click', handleSave);

    setTimeout(() => {
      if (this.item.title === 'New Card' || !this.item.title) {
        titleInput.focus();
        titleInput.select();
      } else {
        textarea.focus();
      }
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
