import { App, Component, MarkdownRenderer, Notice, TFile, setIcon } from 'obsidian';
import { NotesheetItem, NotesheetSettings } from '../types';
import { SyncManager } from '../sync/SyncManager';

export interface CardActionCallbacks {
  onUpdate: (item: NotesheetItem) => Promise<void>;
  onDelete: (item: NotesheetItem) => Promise<void>;
  onMovePage: (item: NotesheetItem, targetPageId: string) => Promise<void>;
  onMoveOrder: (item: NotesheetItem, direction: 'up' | 'down') => Promise<void>;
}

export class NotesheetCard {
  private app: App;
  private component: Component;
  private syncManager: SyncManager;
  private item: NotesheetItem;
  private settings: NotesheetSettings;
  private currentPageId: string;
  private callbacks: CardActionCallbacks;
  private cardEl: HTMLElement;
  private isEditing = false;

  constructor(
    app: App,
    component: Component,
    syncManager: SyncManager,
    item: NotesheetItem,
    settings: NotesheetSettings,
    currentPageId: string,
    callbacks: CardActionCallbacks
  ) {
    this.app = app;
    this.component = component;
    this.syncManager = syncManager;
    this.item = item;
    this.settings = settings;
    this.currentPageId = currentPageId;
    this.callbacks = callbacks;
  }

  public render(container: HTMLElement): HTMLElement {
    this.cardEl = container.createDiv({
      cls: `notesheet-card ${this.settings.showBorders ? 'has-border' : 'no-border'}`
    });
    this.cardEl.dataset.itemId = this.item.id;
    this.cardEl.setAttribute('draggable', 'true');

    if (this.isEditing) {
      this.renderEditMode();
    } else {
      this.renderViewMode();
    }

    return this.cardEl;
  }

  private renderViewMode(): void {
    this.cardEl.empty();

    // Top action bar
    const headerEl = this.cardEl.createDiv({ cls: 'notesheet-card-header' });

    // Left side: Title & Sync Badge
    const headerLeft = headerEl.createDiv({ cls: 'notesheet-card-header-left' });

    // Drag handle icon
    const dragHandle = headerLeft.createSpan({ cls: 'notesheet-card-drag-handle' });
    setIcon(dragHandle, 'grip-vertical');
    dragHandle.title = 'Drag to reorder card';

    if (this.settings.showCardTitles && this.item.title) {
      const titleEl = headerLeft.createSpan({ cls: 'notesheet-card-title', text: this.item.title });
      titleEl.title = this.item.title;
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

    // Card Body: Render Markdown
    const bodyEl = this.cardEl.createDiv({ cls: 'notesheet-card-body' });
    MarkdownRenderer.render(
      this.app,
      this.item.content,
      bodyEl,
      this.item.sourceFile || '',
      this.component
    );
  }

  private renderEditMode(): void {
    this.cardEl.empty();

    const editWrapper = this.cardEl.createDiv({ cls: 'notesheet-card-edit-wrapper' });

    // Title input
    const titleInput = editWrapper.createEl('input', {
      type: 'text',
      cls: 'notesheet-card-title-input',
      value: this.item.title || ''
    });
    titleInput.placeholder = 'Card Title (optional)';

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

      const contentChanged = newContent !== this.item.content;
      this.item.title = newTitle;
      this.item.content = newContent;
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

      // If we have a blockId, try to scroll to it
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
