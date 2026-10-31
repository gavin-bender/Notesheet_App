import { getIcon } from 'obsidian';

/**
 * Common emoji shortcodes fallback map
 */
const EMOJI_MAP: Record<string, string> = {
  star: '⭐',
  sparkles: '✨',
  fire: '🔥',
  check: '✅',
  x: '❌',
  warning: '⚠️',
  bulb: '💡',
  book: '📖',
  pencil: '✏️',
  note: '📝',
  pin: '📌',
  rocket: '🚀',
  trophy: '🏆',
  zap: '⚡',
  memo: '📝',
  brain: '🧠',
  gear: '⚙️',
  link: '🔗',
  lock: '🔒',
  key: '🔑',
  heart: '❤️',
  thumbsup: '👍',
  '+1': '👍'
};

/**
 * Renders text containing icon shortcodes (e.g. ":luc_layers: Title") into a container element,
 * converting icon shortcodes into SVG icon elements or emojis.
 */
export function renderTextWithIcons(container: HTMLElement, text: string): void {
  container.empty();
  if (!text) return;

  const shortcodeRegex = /:([a-zA-Z0-9_-]+):/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = shortcodeRegex.exec(text)) !== null) {
    // Append any text before the shortcode
    if (match.index > lastIndex) {
      const plainText = text.substring(lastIndex, match.index);
      container.appendText(plainText);
    }

    const shortcode = match[1];
    const iconSpan = container.createSpan({ cls: 'notesheet-shortcode-icon' });
    iconSpan.dataset.shortcode = shortcode;

    let rendered = false;

    // 1. Try Lucide icons via Obsidian native getIcon
    // Support formats: luc_layers -> layers, luc_mouse_pointer -> mouse-pointer, lucide_...
    const lucideName = shortcode
      .replace(/^luc_/, '')
      .replace(/^lucide_/, '')
      .replace(/^obs_/, '')
      .replace(/_/g, '-');

    const svg = getIcon(lucideName) || getIcon(shortcode.replace(/_/g, '-')) || getIcon(shortcode);
    if (svg) {
      svg.addClass('notesheet-icon-svg');
      iconSpan.appendChild(svg);
      rendered = true;
    }

    // 2. Try window.IconSCAPIv0 (Icon Shortcodes plugin API)
    if (!rendered && typeof window !== 'undefined' && (window as any).IconSCAPIv0) {
      const api = (window as any).IconSCAPIv0;
      try {
        const idToTry = api.hasIcon && api.hasIcon(shortcode)
          ? shortcode
          : api.hasIcon && api.hasIcon(lucideName)
            ? lucideName
            : null;

        if (idToTry) {
          if (api.getIcon) {
            const syncRes = api.getIcon(idToTry);
            if (typeof syncRes === 'string') {
              iconSpan.setText(syncRes);
              rendered = true;
            } else if (syncRes instanceof Node) {
              iconSpan.empty();
              iconSpan.appendChild(syncRes);
              rendered = true;
            }
          }

          if (!rendered && api.getSVGIcon) {
            api.getSVGIcon(idToTry).then((svgEl: any) => {
              if (svgEl) {
                iconSpan.empty();
                if (typeof svgEl === 'string') {
                  iconSpan.setText(svgEl);
                } else if (svgEl instanceof Node) {
                  iconSpan.appendChild(svgEl);
                }
              }
            });
            rendered = true;
          }
        }
      } catch (e) {
        console.debug('IconSCAPIv0 render error:', e);
      }
    }

    // 3. Try Emoji fallback
    if (!rendered) {
      const emoji = EMOJI_MAP[shortcode.toLowerCase()];
      if (emoji) {
        iconSpan.setText(emoji);
        iconSpan.addClass('notesheet-emoji-icon');
        rendered = true;
      }
    }

    // 4. Fallback if no icon matched: render the shortcode text gracefully
    if (!rendered) {
      iconSpan.setText(`:${shortcode}:`);
    }

    lastIndex = shortcodeRegex.lastIndex;
  }

  // Append remaining text
  if (lastIndex < text.length) {
    container.appendText(text.substring(lastIndex));
  }
}
