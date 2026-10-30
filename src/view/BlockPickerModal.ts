import { App, Modal, TFile, Setting, Notice } from 'obsidian';
import { BlockManager } from '../sync/BlockManager';
import { NotesheetItem } from '../types';

export class BlockPickerModal extends Modal {
  private blockManager: BlockManager;
  private onSelectBlock: (item: NotesheetItem, targetPageId: string) => void;
  private targetPageId: string;
  private files: TFile[] = [];
  private selectedFile: TFile | null = null;
  private blocks: Array<{ content: string; blockId: string; title: string }> = [];

  constructor(
    app: App,
    blockManager: BlockManager,
    defaultTargetPageId: string,
    onSelectBlock: (item: NotesheetItem, targetPageId: string) => void
  ) {
    super(app);
    this.blockManager = blockManager;
    this.targetPageId = defaultTargetPageId;
    this.onSelectBlock = onSelectBlock;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('notesheet-picker-modal');

    contentEl.createEl('h2', { text: 'Import Block from Vault Note' });

    // Target page selection
    new Setting(contentEl)
      .setName('Target Page')
      .setDesc('Select which page of the notesheet to place this block')
      .addDropdown(dd => {
        dd.addOption('front', 'Page 1 (Front)');
        dd.addOption('back', 'Page 2 (Back)');
        dd.setValue(this.targetPageId);
        dd.onChange(val => {
          this.targetPageId = val;
        });
      });

    // File selection
    this.files = this.app.vault.getMarkdownFiles().filter(f => !f.name.endsWith('.notesheet.md'));

    const fileSetting = new Setting(contentEl)
      .setName('Select Source Note')
      .setDesc('Pick a note to extract formulas, definitions, or blocks from');

    const selectEl = fileSetting.controlEl.createEl('select', { cls: 'dropdown' });
    selectEl.createEl('option', { text: '-- Choose a note --', value: '' });

    for (const file of this.files) {
      selectEl.createEl('option', { text: file.path, value: file.path });
    }

    const blocksContainer = contentEl.createDiv({ cls: 'notesheet-picker-blocks' });

    selectEl.addEventListener('change', async () => {
      const selectedPath = selectEl.value;
      if (!selectedPath) {
        blocksContainer.empty();
        return;
      }

      const file = this.app.vault.getAbstractFileByPath(selectedPath);
      if (file instanceof TFile) {
        this.selectedFile = file;
        await this.loadBlocksForFile(file, blocksContainer);
      }
    });
  }

  private async loadBlocksForFile(file: TFile, container: HTMLElement): Promise<void> {
    container.empty();
    container.createEl('h3', { text: `Blocks & Sections in "${file.basename}"` });

    const content = await this.app.vault.read(file);
    const lines = content.split('\n');

    // Split into paragraphs / code blocks / math blocks / headings
    const extracted: Array<{ content: string; blockId: string; title: string }> = [];

    let currentChunk: string[] = [];
    let inCodeOrMath = false;

    const flushChunk = () => {
      if (currentChunk.length > 0) {
        const text = currentChunk.join('\n').trim();
        if (text && text.length > 3) {
          // Check for existing block ID
          const match = text.match(/\s+\^([a-zA-Z0-9_-]+)$/);
          const blockId = match ? match[1] : '';
          const cleanText = match ? text.substring(0, match.index).trim() : text;
          const title = this.blockManager.inferTitle(cleanText, file.basename);

          extracted.push({
            content: cleanText,
            blockId,
            title
          });
        }
        currentChunk = [];
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.trim().startsWith('```') || line.trim().startsWith('$$')) {
        inCodeOrMath = !inCodeOrMath;
        currentChunk.push(line);
        if (!inCodeOrMath) {
          flushChunk();
        }
        continue;
      }

      if (inCodeOrMath) {
        currentChunk.push(line);
        continue;
      }

      // If line is empty or is a heading, flush
      if (line.trim() === '' || line.match(/^#{1,6}\s+/)) {
        flushChunk();
        if (line.match(/^#{1,6}\s+/)) {
          currentChunk.push(line);
          flushChunk();
        }
      } else {
        currentChunk.push(line);
      }
    }
    flushChunk();

    if (extracted.length === 0) {
      container.createEl('p', { text: 'No content blocks found in this note.' });
      return;
    }

    const listEl = container.createDiv({ cls: 'notesheet-picker-list' });

    for (const blk of extracted) {
      const cardEl = listEl.createDiv({ cls: 'notesheet-picker-card' });
      const topBar = cardEl.createDiv({ cls: 'notesheet-picker-card-top' });
      topBar.createEl('strong', { text: blk.title });

      if (blk.blockId) {
        topBar.createEl('span', { text: `^${blk.blockId}`, cls: 'notesheet-badge' });
      }

      const snippetEl = cardEl.createEl('pre', { cls: 'notesheet-picker-snippet' });
      snippetEl.setText(blk.content.length > 200 ? blk.content.substring(0, 197) + '...' : blk.content);

      const addBtn = cardEl.createEl('button', {
        text: `+ Add to ${this.targetPageId === 'front' ? 'Front' : 'Back'}`,
        cls: 'mod-cta'
      });

      addBtn.addEventListener('click', async () => {
        let blockId = blk.blockId;

        // If block didn't have an ID in the file, generate one and update the file
        if (!blockId && this.selectedFile) {
          blockId = this.blockManager.generateBlockId();
          const fileText = await this.app.vault.read(this.selectedFile);
          const updated = this.blockManager.updateBlockInContent(fileText, blockId, blk.content);
          await this.app.vault.modify(this.selectedFile, updated);
          new Notice(`Added anchor ^${blockId} to "${this.selectedFile.basename}"`);
        }

        const newItem: NotesheetItem = {
          id: 'item-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          sourceFile: this.selectedFile ? this.selectedFile.path : '',
          blockId,
          title: blk.title,
          content: blk.content,
          column: 0,
          order: Date.now(),
          updatedAt: Date.now()
        };

        this.onSelectBlock(newItem, this.targetPageId);
        new Notice(`Added "${blk.title}" to ${this.targetPageId === 'front' ? 'Page 1 (Front)' : 'Page 2 (Back)'}`);
        this.close();
      });
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
