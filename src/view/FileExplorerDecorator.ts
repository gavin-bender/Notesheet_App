import { App, TFile, debounce } from 'obsidian';
import { NotesheetStore } from '../storage/NotesheetStore';

export class FileExplorerDecorator {
  private app: App;
  private store: NotesheetStore;
  private observer: MutationObserver | null = null;
  private debouncedUpdate: () => void;
  private isUnloaded = false;

  constructor(app: App, store: NotesheetStore) {
    this.app = app;
    this.store = store;
    this.debouncedUpdate = debounce(this.update.bind(this), 50, true);
  }

  public init(): void {
    this.update();
    this.setupObserver();
  }

  public unload(): void {
    this.isUnloaded = true;
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.revertAll();
  }

  public update(): void {
    if (this.isUnloaded) return;

    this.decorateFileExplorer();
    this.decorateSuggestions();
  }

  /**
   * Decorates items in the File Explorer sidebar (.nav-file-title)
   */
  public decorateFileExplorer(): void {
    const fileExplorerLeaves = this.app.workspace.getLeavesOfType('file-explorer');
    for (const leaf of fileExplorerLeaves) {
      const container = (leaf.view as any)?.containerEl as HTMLElement;
      if (!container) continue;

      const titleEls = container.querySelectorAll<HTMLElement>('.nav-file-title');
      titleEls.forEach((selfEl) => {
        const path = selfEl.dataset.path || selfEl.getAttribute('data-path');
        if (!path) return;

        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile && this.store.isNotesheetFile(file)) {
          this.decorateFileExplorerItem(selfEl, file);
        }
      });
    }
  }

  private decorateFileExplorerItem(selfEl: HTMLElement, file: TFile): void {
    const titleEl = selfEl.querySelector<HTMLElement>('.nav-file-title-content');
    if (!titleEl) return;

    // Do not interfere if user is currently renaming the file in the file explorer
    if (titleEl.querySelector('input')) return;

    // 1. Strip the redundant .notesheet suffix from the visible title text
    this.stripNotesheetSuffix(titleEl);

    // 2. Add or ensure the native filetype tag (.nav-file-tag) is present on the right
    let tagEl = selfEl.querySelector<HTMLElement>('.notesheet-file-tag');
    if (!tagEl) {
      tagEl = selfEl.createSpan({
        cls: 'nav-file-tag notesheet-file-tag',
        text: 'notesheet'
      });
    } else if (tagEl.textContent !== 'notesheet') {
      tagEl.textContent = 'notesheet';
    }
  }

  /**
   * Decorates items in Quick Switcher and suggestion popups (.suggestion-item)
   */
  public decorateSuggestions(): void {
    const suggestionEls = document.querySelectorAll<HTMLElement>('.suggestion-item');
    if (suggestionEls.length === 0) return;

    suggestionEls.forEach((itemEl) => {
      const titleEl = itemEl.querySelector<HTMLElement>('.suggestion-title');
      if (!titleEl || !titleEl.textContent) return;

      const rawTitle = titleEl.textContent;
      if (rawTitle.endsWith('.notesheet') || rawTitle.includes('.notesheet.')) {
        this.stripNotesheetSuffix(titleEl);

        let flairEl = itemEl.querySelector<HTMLElement>('.notesheet-flair');
        if (!flairEl) {
          flairEl = itemEl.createSpan({
            cls: 'suggestion-flair notesheet-flair',
            text: 'NOTESHEET'
          });
        } else if (flairEl.textContent !== 'NOTESHEET') {
          flairEl.textContent = 'NOTESHEET';
        }
      }
    });
  }

  private stripNotesheetSuffix(el: HTMLElement): void {
    // Preserve any inner highlight spans by modifying the trailing text node if possible
    if (el.lastChild && el.lastChild.nodeType === Node.TEXT_NODE && el.lastChild.textContent) {
      if (el.lastChild.textContent.endsWith('.notesheet')) {
        if (!el.dataset.originalText) {
          el.dataset.originalText = el.textContent || '';
        }
        el.lastChild.textContent = el.lastChild.textContent.replace(/\.notesheet$/, '');
      }
    } else if (el.textContent && el.textContent.endsWith('.notesheet')) {
      if (!el.dataset.originalText) {
        el.dataset.originalText = el.textContent;
      }
      el.textContent = el.textContent.replace(/\.notesheet$/, '');
    }
  }

  private setupObserver(): void {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new MutationObserver(() => {
      this.debouncedUpdate();
    });

    // Observe document body for both sidebar explorer updates and quick switcher popups
    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  public onLayoutChange(): void {
    this.debouncedUpdate();
  }

  private revertAll(): void {
    // Clean up File Explorer tags and restore titles
    document.querySelectorAll('.notesheet-file-tag, .notesheet-flair').forEach((el) => el.remove());

    document.querySelectorAll<HTMLElement>('.nav-file-title-content, .suggestion-title').forEach((el) => {
      if (el.dataset.originalText) {
        el.textContent = el.dataset.originalText;
        delete el.dataset.originalText;
      }
    });
  }
}

