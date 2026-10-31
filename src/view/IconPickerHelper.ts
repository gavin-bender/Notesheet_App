import { App, FuzzySuggestModal, getIcon, getIconIds } from 'obsidian';

/**
 * Common Lucide & academic/exam icons available in Obsidian
 */
const COMMON_LUCIDE_ICONS = [
  'layers',
  'mouse-pointer',
  'code',
  'terminal',
  'cpu',
  'database',
  'binary',
  'hash',
  'calculator',
  'sigma',
  'function-square',
  'book',
  'book-open',
  'bookmark',
  'file-code',
  'file-text',
  'sparkles',
  'lightbulb',
  'zap',
  'flame',
  'check',
  'check-circle',
  'x-circle',
  'alert-triangle',
  'alert-circle',
  'info',
  'clock',
  'timer',
  'atom',
  'compass',
  'git-branch',
  'git-commit',
  'workflow',
  'share-2',
  'shield',
  'key',
  'lock',
  'star',
  'heart',
  'flag',
  'tag',
  'table',
  'list',
  'list-ordered',
  'bar-chart',
  'activity',
  'eye',
  'search',
  'wrench'
];

/**
 * Inserts text into an input or textarea at the current cursor position,
 * cleanly replacing any preceding partial shortcode or colons (e.g. ":luc" or "::").
 */
export function insertAtCursor(target: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? target.value.length;
  const val = target.value;

  // Check if there is an unclosed ':' or '::' immediately preceding cursor (e.g. ":luc" or "::" or ":")
  const textBefore = val.substring(0, start);
  const colonMatch = textBefore.match(/(:{1,2}[a-zA-Z0-9_-]*)$/);

  let replaceStart = start;
  if (colonMatch && colonMatch.index !== undefined) {
    replaceStart = colonMatch.index;
  }

  target.value = val.substring(0, replaceStart) + text + val.substring(end);
  const newPos = replaceStart + text.length;
  target.setSelectionRange(newPos, newPos);
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.focus();
}

export class FallbackIconPickerModal extends FuzzySuggestModal<string> {
  private onChoose: (shortcode: string) => void;

  constructor(app: App, onChoose: (shortcode: string) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder('Search icon (e.g. layers, mouse-pointer, code, book)...');
  }

  getItems(): string[] {
    try {
      if (typeof getIconIds === 'function') {
        const all = getIconIds();
        if (all && all.length > 0) {
          return all;
        }
      }
    } catch {
      // ignore
    }
    return COMMON_LUCIDE_ICONS;
  }

  getItemText(item: string): string {
    return `:luc_${item}: ${item}`;
  }

  renderSuggestion(item: any, el: HTMLElement): void {
    el.empty();
    el.addClass('notesheet-icon-suggest-item');

    const iconSpan = el.createSpan({ cls: 'notesheet-icon-preview' });
    const svg = getIcon(item.item);
    if (svg) {
      svg.addClass('notesheet-icon-svg');
      iconSpan.appendChild(svg);
    }

    const nameSpan = el.createSpan({ text: `:luc_${item.item}:` });
    nameSpan.style.marginLeft = '8px';
  }

  onChooseItem(item: string, evt: MouseEvent | KeyboardEvent): void {
    const code = item.startsWith('luc_') ? item : `luc_${item}`;
    this.onChoose(`:${code}: `);
  }
}

/**
 * Opens the user's icon plugin picker (or fallback Lucide modal) and inserts into target element.
 */
export async function openIconPickerForElement(
  app: App,
  target: HTMLInputElement | HTMLTextAreaElement
): Promise<void> {
  // 1. Check if user's "Icon Shortcodes" plugin is active and provides getIconFromUser
  if (typeof window !== 'undefined' && (window as any).IconSCAPIv0?.getIconFromUser) {
    try {
      const api = (window as any).IconSCAPIv0;
      const result = await api.getIconFromUser();
      if (result) {
        const rawId = typeof result === 'string' ? result : (result.id || result.name);
        if (rawId) {
          const formatted = rawId.startsWith(':') && rawId.endsWith(':') ? `${rawId} ` : `:${rawId}: `;
          insertAtCursor(target, formatted);
          return;
        }
      } else {
        // User cancelled the picker modal
        target.focus();
        return;
      }
    } catch (err) {
      console.debug('Error using IconSCAPIv0 picker:', err);
    }
  }

  // 2. Fallback: Open built-in icon picker modal with all Obsidian & Lucide icons
  new FallbackIconPickerModal(app, (shortcode) => {
    insertAtCursor(target, shortcode);
  }).open();
}
