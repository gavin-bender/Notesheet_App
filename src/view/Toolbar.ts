import { App, setIcon } from 'obsidian';
import { NotesheetData } from '../types';

export interface ToolbarCallbacks {
  onTabChange: (activeTab: 'front' | 'back' | 'both') => void;
  onSettingChange: () => Promise<void>;
  onAddCard: () => void;
  onOpenPicker: () => void;
  onPrint: () => void;
  onSyncAll: () => Promise<void>;
  onTitleChange: (newTitle: string) => Promise<void>;
  onOpenCategoryManager: () => void;
}

export class NotesheetToolbar {
  private app: App;
  private data: NotesheetData;
  private activeTab: 'front' | 'back' | 'both';
  private callbacks: ToolbarCallbacks;
  private containerEl: HTMLElement;

  constructor(
    app: App,
    data: NotesheetData,
    activeTab: 'front' | 'back' | 'both',
    callbacks: ToolbarCallbacks
  ) {
    this.app = app;
    this.data = data;
    this.activeTab = activeTab;
    this.callbacks = callbacks;
  }

  public render(container: HTMLElement): HTMLElement {
    this.containerEl = container.createDiv({ cls: 'notesheet-toolbar' });

    // Row 1: Title + Page Tabs + Primary Actions
    const row1 = this.containerEl.createDiv({ cls: 'notesheet-toolbar-row primary-row' });

    // Title input
    const titleContainer = row1.createDiv({ cls: 'notesheet-title-container' });
    const titleInput = titleContainer.createEl('input', {
      type: 'text',
      cls: 'notesheet-title-input',
      value: this.data.title || 'Exam Notesheet'
    });
    titleInput.addEventListener('change', async () => {
      this.data.title = titleInput.value.trim() || 'Exam Notesheet';
      await this.callbacks.onTitleChange(this.data.title);
    });

    // Page Navigation Tabs (Front, Back, Dual)
    const tabsContainer = row1.createDiv({ cls: 'notesheet-nav-tabs' });

    const createTabBtn = (tabKey: 'front' | 'back' | 'both', label: string, iconName: string) => {
      const btn = tabsContainer.createEl('button', {
        cls: `notesheet-tab-btn ${this.activeTab === tabKey ? 'active' : ''}`
      });
      const iconSpan = btn.createSpan({ cls: 'tab-icon' });
      setIcon(iconSpan, iconName);
      btn.createSpan({ text: label });

      btn.addEventListener('click', () => {
        if (this.activeTab !== tabKey) {
          this.activeTab = tabKey;
          tabsContainer.findAll('.notesheet-tab-btn').forEach(el => el.removeClass('active'));
          btn.addClass('active');
          this.callbacks.onTabChange(tabKey);
        }
      });
    };

    createTabBtn('front', 'Page 1: Front', 'file-text');
    createTabBtn('back', 'Page 2: Back', 'file-text');
    createTabBtn('both', 'Dual View', 'columns');

    // Right action buttons
    const actionsContainer = row1.createDiv({ cls: 'notesheet-toolbar-actions' });

    // Manage Categories button
    const catBtn = actionsContainer.createEl('button', {
      cls: 'notesheet-btn-toolbar',
      text: '🎨 Categories'
    });
    catBtn.title = 'Add, edit, or color-code categories';
    catBtn.addEventListener('click', () => this.callbacks.onOpenCategoryManager());

    // Add Card button
    const addCardBtn = actionsContainer.createEl('button', {
      cls: 'notesheet-btn-toolbar',
      text: '+ Add Card'
    });
    addCardBtn.addEventListener('click', () => this.callbacks.onAddCard());

    // Import from Note button
    const importBtn = actionsContainer.createEl('button', {
      cls: 'notesheet-btn-toolbar',
      text: '📥 Import Block'
    });
    importBtn.addEventListener('click', () => this.callbacks.onOpenPicker());

    // Sync All button
    const syncBtn = actionsContainer.createEl('button', { cls: 'notesheet-btn-toolbar' });
    const syncIcon = syncBtn.createSpan();
    setIcon(syncIcon, 'refresh-cw');
    syncBtn.createSpan({ text: ' Sync' });
    syncBtn.title = 'Refresh all blocks from source notes';
    syncBtn.addEventListener('click', async () => {
      syncIcon.addClass('rotating');
      await this.callbacks.onSyncAll();
      setTimeout(() => syncIcon.removeClass('rotating'), 600);
    });

    // Print Exam Notesheet Button
    const printBtn = actionsContainer.createEl('button', {
      cls: 'notesheet-btn-toolbar print-btn mod-cta'
    });
    const printIcon = printBtn.createSpan();
    setIcon(printIcon, 'printer');
    printBtn.createSpan({ text: ' Print / PDF' });
    printBtn.title = 'Print or export front & back pages for exam';
    printBtn.addEventListener('click', () => this.callbacks.onPrint());

    // Row 2: Typography, Columns, Margins, Categories & Exam Print Density Controls
    const row2 = this.containerEl.createDiv({ cls: 'notesheet-toolbar-row formatting-row' });

    // Columns selector
    const colGroup = row2.createDiv({ cls: 'toolbar-group' });
    colGroup.createSpan({ text: 'Columns:', cls: 'group-label' });
    const colSelect = colGroup.createEl('select', { cls: 'notesheet-select' });
    [1, 2, 3, 4].forEach(colCount => {
      const opt = colSelect.createEl('option', {
        text: `${colCount} col${colCount > 1 ? 's' : ''}`,
        value: colCount.toString()
      });
      if (this.data.settings.columns === colCount) opt.selected = true;
    });
    colSelect.addEventListener('change', async () => {
      this.data.settings.columns = parseInt(colSelect.value, 10);
      await this.callbacks.onSettingChange();
    });

    // Font Size Stepper
    const fontGroup = row2.createDiv({ cls: 'toolbar-group' });
    fontGroup.createSpan({ text: 'Font Size:', cls: 'group-label' });
    const fontSelect = fontGroup.createEl('select', { cls: 'notesheet-select' });
    const sizes = [6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 11, 12];
    sizes.forEach(sz => {
      const opt = fontSelect.createEl('option', {
        text: `${sz} pt`,
        value: sz.toString()
      });
      if (this.data.settings.fontSize === sz) opt.selected = true;
    });
    fontSelect.addEventListener('change', async () => {
      this.data.settings.fontSize = parseFloat(fontSelect.value);
      await this.callbacks.onSettingChange();
    });

    // Margins
    const marginGroup = row2.createDiv({ cls: 'toolbar-group' });
    marginGroup.createSpan({ text: 'Margins:', cls: 'group-label' });
    const marginSelect = marginGroup.createEl('select', { cls: 'notesheet-select' });
    [
      { id: 'tight', name: 'Tight (0.2in)' },
      { id: 'compact', name: 'Compact (0.3in)' },
      { id: 'normal', name: 'Normal (0.5in)' }
    ].forEach(m => {
      const opt = marginSelect.createEl('option', { text: m.name, value: m.id });
      if (this.data.settings.margins === m.id) opt.selected = true;
    });
    marginSelect.addEventListener('change', async () => {
      this.data.settings.margins = marginSelect.value as any;
      await this.callbacks.onSettingChange();
    });

    // Paper Size
    const paperGroup = row2.createDiv({ cls: 'toolbar-group' });
    paperGroup.createSpan({ text: 'Paper:', cls: 'group-label' });
    const paperSelect = paperGroup.createEl('select', { cls: 'notesheet-select' });
    [
      { id: 'letter', name: 'US Letter' },
      { id: 'a4', name: 'A4' }
    ].forEach(p => {
      const opt = paperSelect.createEl('option', { text: p.name, value: p.id });
      if (this.data.settings.pageSize === p.id) opt.selected = true;
    });
    paperSelect.addEventListener('change', async () => {
      this.data.settings.pageSize = paperSelect.value as any;
      await this.callbacks.onSettingChange();
    });

    // Toggle Card Borders
    const borderGroup = row2.createDiv({ cls: 'toolbar-group' });
    const borderCheck = borderGroup.createEl('input', { type: 'checkbox', cls: 'notesheet-checkbox' });
    borderCheck.checked = this.data.settings.showBorders;
    const borderLabel = borderGroup.createSpan({ text: 'Borders', cls: 'checkbox-label' });
    borderCheck.addEventListener('change', async () => {
      this.data.settings.showBorders = borderCheck.checked;
      await this.callbacks.onSettingChange();
    });
    borderLabel.addEventListener('click', () => {
      borderCheck.checked = !borderCheck.checked;
      borderCheck.dispatchEvent(new Event('change'));
    });

    // Toggle Category Titles (Show/Hide)
    const catTitlesGroup = row2.createDiv({ cls: 'toolbar-group' });
    const catCheck = catTitlesGroup.createEl('input', { type: 'checkbox', cls: 'notesheet-checkbox' });
    catCheck.checked = this.data.settings.showCategoryTitles;
    const catLabel = catTitlesGroup.createSpan({ text: 'Category Titles', cls: 'checkbox-label' });
    catCheck.addEventListener('change', async () => {
      this.data.settings.showCategoryTitles = catCheck.checked;
      await this.callbacks.onSettingChange();
    });
    catLabel.addEventListener('click', () => {
      catCheck.checked = !catCheck.checked;
      catCheck.dispatchEvent(new Event('change'));
    });

    return this.containerEl;
  }
}
