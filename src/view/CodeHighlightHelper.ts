import { loadPrism } from 'obsidian';

/**
 * Normalizes code block language tags in markdown so that common aliases
 * (such as c++, C++, py, js, ts, etc.) match Obsidian's Prism grammar keys.
 */
export function normalizeCodeLanguages(content: string): string {
  if (!content) return '';
  return content.replace(/^```([a-zA-Z0-9#+-]+)/gm, (match, lang) => {
    const lower = lang.toLowerCase();
    if (lower === 'c++') return '```cpp';
    if (lower === 'c#') return '```csharp';
    if (lower === 'py') return '```python';
    if (lower === 'js') return '```javascript';
    if (lower === 'ts') return '```typescript';
    if (lower === 'sh' || lower === 'shell' || lower === 'zsh') return '```bash';
    if (lower === 'yml') return '```yaml';
    return match;
  });
}

/**
 * Ensures Prism is loaded and registers alias grammars if needed,
 * then highlights all code elements in the rendered container.
 */
export async function highlightCodeBlocks(container: HTMLElement): Promise<void> {
  try {
    const Prism = await loadPrism();
    if (!Prism) return;

    // Register common aliases in Prism.languages
    if (Prism.languages) {
      if (Prism.languages.cpp) {
        Prism.languages['c++'] = Prism.languages.cpp;
        Prism.languages['C++'] = Prism.languages.cpp;
      }
      if (Prism.languages.csharp) {
        Prism.languages['c#'] = Prism.languages.csharp;
        Prism.languages['C#'] = Prism.languages.csharp;
      }
      if (Prism.languages.python && !Prism.languages.py) {
        Prism.languages.py = Prism.languages.python;
      }
      if (Prism.languages.javascript && !Prism.languages.js) {
        Prism.languages.js = Prism.languages.javascript;
      }
      if (Prism.languages.typescript && !Prism.languages.ts) {
        Prism.languages.ts = Prism.languages.typescript;
      }
    }

    const codeElements = container.querySelectorAll<HTMLElement>('pre > code, code[class*="language-"]');
    codeElements.forEach((codeEl) => {
      // Find language class
      const classes = Array.from(codeEl.classList);
      let langClass = classes.find(c => c.startsWith('language-'));
      
      // If code element doesn't have language class, check parent pre element
      if (!langClass && codeEl.parentElement) {
        const parentClasses = Array.from(codeEl.parentElement.classList);
        langClass = parentClasses.find(c => c.startsWith('language-'));
        if (langClass) {
          codeEl.classList.add(langClass);
        }
      }

      if (langClass) {
        let lang = langClass.replace('language-', '').toLowerCase();
        if (lang === 'c++') {
          codeEl.classList.remove('language-c++');
          codeEl.classList.add('language-cpp');
          lang = 'cpp';
        }
        if (Prism.languages && Prism.languages[lang]) {
          Prism.highlightElement(codeEl);
          codeEl.classList.add('is-loaded');
        }
      }
    });
  } catch (err) {
    console.debug('Error highlighting code blocks:', err);
  }
}
