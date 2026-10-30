import { App, Modal, Setting, Notice } from 'obsidian';
import { NotesheetCategory, NotesheetData } from '../types';

const COLOR_PRESETS = [
  { name: 'Blue', color: '#2563eb' },
  { name: 'Green', color: '#16a34a' },
  { name: 'Purple', color: '#9333ea' },
  { name: 'Amber', color: '#d97706' },
  { name: 'Red', color: '#dc2626' },
  { name: 'Teal', color: '#0d9488' },
  { name: 'Pink', color: '#db2777' },
  { name: 'Indigo', color: '#4f46e5' },
  { name: 'Orange', color: '#ea580c' },
  { name: 'Gray', color: '#4b5563' }
];

export class CategoryManagerModal extends Modal {
  private data: NotesheetData;
  private onSave: () => Promise<void>;

  constructor(app: App, data: NotesheetData, onSave: () => Promise<void>) {
    super(app);
    this.data = data;
    this.onSave = onSave;
  }

  onOpen() {
    this.render();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('notesheet-category-modal');

    contentEl.createEl('h2', { text: 'Manage Categories' });
    contentEl.createEl('p', {
      text: 'Assign categories to color-code cards and organize your exam notesheet.',
      cls: 'setting-item-description'
    });

    const listContainer = contentEl.createDiv({ cls: 'category-manager-list' });

    for (const cat of this.data.categories) {
      const row = listContainer.createDiv({ cls: 'category-manager-row' });

      // Color preview / picker dot
      const colorInput = row.createEl('input', {
        type: 'color',
        cls: 'category-color-picker',
        value: cat.color
      });
      colorInput.title = 'Choose custom color';
      colorInput.addEventListener('change', async () => {
        cat.color = colorInput.value;
        await this.onSave();
      });

      // Name input
      const nameInput = row.createEl('input', {
        type: 'text',
        cls: 'category-name-input',
        value: cat.name
      });
      nameInput.addEventListener('change', async () => {
        cat.name = nameInput.value.trim() || 'Untitled Category';
        await this.onSave();
      });

      // Color presets palette
      const palette = row.createDiv({ cls: 'category-color-presets' });
      for (const preset of COLOR_PRESETS.slice(0, 5)) {
        const swatch = palette.createSpan({ cls: 'color-swatch' });
        swatch.style.backgroundColor = preset.color;
        swatch.title = preset.name;
        swatch.addEventListener('click', async () => {
          cat.color = preset.color;
          colorInput.value = preset.color;
          await this.onSave();
        });
      }

      // Delete button
      const delBtn = row.createEl('button', {
        text: '✕',
        cls: 'notesheet-btn-icon btn-danger delete-cat-btn'
      });
      delBtn.title = 'Delete category';
      delBtn.addEventListener('click', async () => {
        this.data.categories = this.data.categories.filter(c => c.id !== cat.id);
        // Clear category from cards that had this category
        for (const page of this.data.pages) {
          for (const item of page.items) {
            if (item.categoryId === cat.id) {
              item.categoryId = undefined;
            }
          }
        }
        await this.onSave();
        this.render();
      });
    }

    // Add New Category Section
    const addSection = contentEl.createDiv({ cls: 'category-add-section' });

    const newNameInput = addSection.createEl('input', {
      type: 'text',
      cls: 'category-name-input new-category-input',
      placeholder: 'New category name (e.g. Key Theorems)'
    });

    let selectedColor = COLOR_PRESETS[this.data.categories.length % COLOR_PRESETS.length].color;

    const newColorInput = addSection.createEl('input', {
      type: 'color',
      cls: 'category-color-picker',
      value: selectedColor
    });
    newColorInput.addEventListener('change', () => {
      selectedColor = newColorInput.value;
    });

    const addBtn = addSection.createEl('button', {
      text: '+ Add Category',
      cls: 'mod-cta'
    });

    const handleAdd = async () => {
      const name = newNameInput.value.trim();
      if (!name) {
        new Notice('Please enter a category name.');
        return;
      }
      const newCat: NotesheetCategory = {
        id: 'cat-' + Date.now().toString(36),
        name,
        color: newColorInput.value || selectedColor
      };
      this.data.categories.push(newCat);
      await this.onSave();
      this.render();
    };

    addBtn.addEventListener('click', handleAdd);
    newNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAdd();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
