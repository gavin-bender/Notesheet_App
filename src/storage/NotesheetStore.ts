import { App, TFile, normalizePath, Notice } from 'obsidian';
import { NotesheetData, NotesheetSettings, createDefaultNotesheetData, DEFAULT_CATEGORIES } from '../types';

export class NotesheetStore {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Serialize notesheet data to markdown format with frontmatter and codeblock.
   */
  public serialize(data: NotesheetData): string {
    const jsonStr = JSON.stringify(data, null, 2);
    const orientation = data.settings.orientation || (data.settings.pageSize === 'card3x5' ? 'landscape' : 'portrait');
    return `---
notesheet: true
title: ${JSON.stringify(data.title)}
pageSize: ${data.settings.pageSize}
orientation: ${orientation}
columns: ${data.settings.columns}
fontSize: ${data.settings.fontSize}
updatedAt: ${new Date().toISOString()}
---

\`\`\`notesheet-data
${jsonStr}
\`\`\`
`;
  }

  /**
   * Parse notesheet data from file content.
   */
  public deserialize(content: string, fallbackTitle = 'Notesheet'): NotesheetData {
    const normalizeSettings = (parsed: NotesheetData) => {
      if (!parsed.categories || !Array.isArray(parsed.categories)) {
        parsed.categories = [...DEFAULT_CATEGORIES];
      }
      if (parsed.settings) {
        // Normalize legacy or alternate 3x5 paper size names
        if ((parsed.settings as any).pageSize === '3x5' || (parsed.settings as any).pageSize === 'notecard' || (parsed.settings as any).pageSize === 'index-card') {
          parsed.settings.pageSize = 'card3x5';
        }
        if (!parsed.settings.pageSize) {
          parsed.settings.pageSize = 'letter';
        }
        if (!parsed.settings.orientation) {
          parsed.settings.orientation = parsed.settings.pageSize === 'card3x5' ? 'landscape' : 'portrait';
        }
        if (parsed.settings.showCategoryTitles === undefined) {
          parsed.settings.showCategoryTitles = true;
        }
        if (parsed.settings.density === undefined) {
          parsed.settings.density = 'compact';
        }
        if (parsed.settings.autoFitPage === undefined) {
          parsed.settings.autoFitPage = true;
        }
        if (parsed.settings.showCardBackground === undefined) {
          parsed.settings.showCardBackground = false;
        }
        if (!parsed.settings.notecardFontStyle) {
          parsed.settings.notecardFontStyle = 'handwritten';
        }
        if (!parsed.settings.notecardRuledSide) {
          parsed.settings.notecardRuledSide = 'front';
        }
        if (!parsed.settings.notecardLines) {
          parsed.settings.notecardLines = parsed.settings.orientation === 'portrait' ? 18 : 10;
        }
      }
    };

    // Try to find ```notesheet-data ... ``` or ```notesheet ... ```
    const match = content.match(/```notesheet(?:-data)?\s*\n([\s\S]*?)\n```/);
    if (match && match[1]) {
      try {
        const parsed = JSON.parse(match[1]) as NotesheetData;
        if (parsed && parsed.pages) {
          normalizeSettings(parsed);

          // Clean up titles of any legacy formatting or icon shortcodes
          const cleanTitleStr = (t?: string) => {
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
              .trim();
          };

          for (const p of parsed.pages) {
            for (const item of p.items) {
              if (item.title) {
                item.title = cleanTitleStr(item.title);
              }
            }
          }

          // Normalize and ensure 2 pages minimum (Front and Back)
          if (!parsed.pages.some(p => p.id === 'front')) {
            parsed.pages.unshift({ id: 'front', name: 'Front (Page 1)', items: [] });
          }
          if (!parsed.pages.some(p => p.id === 'back')) {
            if (parsed.pages.length === 1) {
              parsed.pages.push({ id: 'back', name: 'Back (Page 2)', items: [] });
            }
          }
          return parsed;
        }
      } catch (err) {
        console.error('Error parsing notesheet JSON:', err);
      }
    }

    // Fallback: check if entire file is raw JSON
    try {
      const parsed = JSON.parse(content) as NotesheetData;
      if (parsed && parsed.pages) {
        normalizeSettings(parsed);
        return parsed;
      }
    } catch {
      // not raw JSON
    }

    // If file is empty or corrupted, create fresh template with fallback title
    return createDefaultNotesheetData(fallbackTitle);
  }

  /**
   * Create a new notesheet file in the vault.
   */
  public async createNotesheet(
    folderPath = '',
    title = 'Exam Notesheet',
    settings?: Partial<NotesheetSettings>
  ): Promise<TFile> {
    const isCard = settings?.pageSize === 'card3x5';
    const safeTitle = title.replace(/[\\/:"*?<>|]/g, '').trim() || (isCard ? 'Exam Notecard' : 'Exam Notesheet');
    let baseFileName = `${safeTitle}.notesheet.md`;
    let fullPath = folderPath ? normalizePath(`${folderPath}/${baseFileName}`) : baseFileName;

    // Ensure unique file name if already exists
    let counter = 1;
    while (this.app.vault.getAbstractFileByPath(fullPath)) {
      baseFileName = `${safeTitle} ${counter}.notesheet.md`;
      fullPath = folderPath ? normalizePath(`${folderPath}/${baseFileName}`) : baseFileName;
      counter++;
    }

    const data = createDefaultNotesheetData(title, settings);
    const content = this.serialize(data);
    const file = await this.app.vault.create(fullPath, content);
    return file;
  }

  /**
   * Helper to create a 3x5 notecard in the vault.
   */
  public async createNotecard(folderPath = '', title = 'Exam Notecard (3x5)'): Promise<TFile> {
    return this.createNotesheet(folderPath, title, {
      pageSize: 'card3x5',
      orientation: 'landscape',
      columns: 1,
      fontSize: 7.5,
      notecardLines: 10,
      notecardFontStyle: 'handwritten',
      notecardRuledSide: 'front',
      showCategoryTitles: false,
      viewZoom: 1.5
    });
  }

  /**
   * Load notesheet data from a TFile.
   */
  public async loadNotesheet(file: TFile): Promise<NotesheetData> {
    const content = await this.app.vault.read(file);
    return this.deserialize(content, file.basename.replace('.notesheet', ''));
  }

  /**
   * Save notesheet data to a TFile.
   */
  public async saveNotesheet(file: TFile, data: NotesheetData): Promise<void> {
    const content = this.serialize(data);
    await this.app.vault.modify(file, content);
  }

  /**
   * Find all notesheets in the vault.
   */
  public getAllNotesheets(): TFile[] {
    const files = this.app.vault.getFiles();
    return files.filter(f => this.isNotesheetFile(f));
  }

  /**
   * Determine if a file is a notesheet.
   */
  public isNotesheetFile(file: TFile | null): boolean {
    if (!file) return false;
    if (
      file.name.endsWith('.notesheet.md') ||
      file.name.endsWith('.notesheet.markdown') ||
      file.extension === 'notesheet'
    ) {
      return true;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    if (cache?.frontmatter) {
      const val = cache.frontmatter.notesheet;
      if (val === true || val === 'true' || val === 'yes') {
        return true;
      }
    }
    return false;
  }
}
