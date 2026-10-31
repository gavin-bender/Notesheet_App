import { App, Editor, TFile } from 'obsidian';

export interface BlockExtraction {
  blockId: string;
  content: string;
  inferredTitle: string;
}

export class BlockManager {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Generates a concise, unique block id.
   */
  public generateBlockId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = 'ns-';
    for (let i = 0; i < 6; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
  }

  /**
   * Cleans markdown formatting, shortcodes, and trailing symbols from text.
   */
  public cleanFormatting(text: string): string {
    return text
      .replace(/:[a-zA-Z0-9_-]+:\s*/g, '')
      .replace(/^#{1,6}\s+/, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[:\s-]+$/, '')
      .trim();
  }

  /**
   * Infers a good title from markdown content (first heading, bold prefix, or first line).
   */
  public inferTitle(markdown: string, fallback = 'Note Block'): string {
    const trimmed = markdown.trim();
    if (!trimmed) return fallback;

    const withoutIcon = trimmed.replace(/^:[a-zA-Z0-9_-]+:\s*/, '');

    // Check for markdown heading: # Heading or ## Heading
    const headingMatch = withoutIcon.match(/^#{1,6}\s+([^\n]+)/m);
    if (headingMatch) {
      const title = this.cleanFormatting(headingMatch[1]);
      if (title) return title;
    }

    // Check for bold lead-in: **Title:** or **Title**:
    const boldMatch = withoutIcon.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      const title = this.cleanFormatting(boldMatch[1]);
      if (title) return title;
    }

    // Check for callout: > [!info] Title
    const calloutMatch = withoutIcon.match(/^>\s*\[![^\]]+\]\s*([^\n]*)/m);
    if (calloutMatch && calloutMatch[1].trim()) {
      const title = this.cleanFormatting(calloutMatch[1]);
      if (title) return title;
    }

    // First non-empty line
    const lines = withoutIcon.split('\n');
    for (const line of lines) {
      const clean = this.cleanFormatting(line.replace(/^[#\-*>\s0-9.]+\s*/, ''));
      if (clean) {
        return clean.length > 50 ? clean.substring(0, 47) + '...' : clean;
      }
    }

    return fallback;
  }

  /**
   * Extracts or ensures a block ID from the user's selected text in an active editor.
   * If the block does not have an ID, one is added to the editor.
   */
  public extractOrAttachBlockId(editor: Editor, file: TFile): BlockExtraction {
    let selection = editor.getSelection();

    // If nothing selected, select the entire current line / block
    if (!selection) {
      const cursor = editor.getCursor();
      const lineText = editor.getLine(cursor.line);
      selection = lineText;
      editor.setSelection(
        { line: cursor.line, ch: 0 },
        { line: cursor.line, ch: lineText.length }
      );
    }

    selection = selection.trim();

    // Check if selection already ends with a block identifier: ^some-id
    const blockIdMatch = selection.match(/\s+\^([a-zA-Z0-9_-]+)$/);

    if (blockIdMatch) {
      const blockId = blockIdMatch[1];
      const cleanContent = selection.substring(0, blockIdMatch.index).trim();
      return {
        blockId,
        content: cleanContent,
        inferredTitle: this.inferTitle(cleanContent, file.basename)
      };
    }

    // Create a new block ID
    const newBlockId = this.generateBlockId();
    const updatedSelection = `${selection} ^${newBlockId}`;

    // Replace the selection in the editor to persist the block ID
    editor.replaceSelection(updatedSelection);

    return {
      blockId: newBlockId,
      content: selection,
      inferredTitle: this.inferTitle(selection, file.basename)
    };
  }

  /**
   * Finds the content of a block with the given blockId inside fileContent.
   * Returns null if not found.
   */
  public findBlockContent(fileContent: string, blockId: string): string | null {
    if (!blockId || !fileContent) return null;

    // Search for line containing ^blockId
    const escapedId = blockId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lines = fileContent.split('\n');

    let targetLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (new RegExp(`\\^${escapedId}\\s*$`).test(lines[i])) {
        targetLineIdx = i;
        break;
      }
    }

    if (targetLineIdx === -1) {
      // Fallback: look for ^blockId anywhere in a line
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`^${blockId}`)) {
          targetLineIdx = i;
          break;
        }
      }
    }

    if (targetLineIdx === -1) return null;

    // Check what kind of block this is:
    // 1. Math block ending with $$ ^blockId
    if (lines[targetLineIdx].trim().startsWith('$$') || lines[targetLineIdx].includes('$$')) {
      let startIdx = targetLineIdx;
      // If the target line does not have the opening $$, walk backwards to find it
      const hasBothDelimiters = (lines[targetLineIdx].match(/\$\$/g) || []).length >= 2;
      if (!hasBothDelimiters) {
        let curr = targetLineIdx - 1;
        while (curr >= 0) {
          if (lines[curr].includes('$$')) {
            startIdx = curr;
            break;
          }
          curr--;
        }
      }
      const blockLines = lines.slice(startIdx, targetLineIdx + 1);
      const text = blockLines.join('\n').replace(new RegExp(`\\s*\\^${escapedId}\\s*$`), '');
      return text.trim();
    }

    // 2. Callout or blockquote: walks backwards through all '>'
    if (lines[targetLineIdx].trim().startsWith('>')) {
      let startIdx = targetLineIdx;
      while (startIdx > 0 && lines[startIdx - 1].trim().startsWith('>')) {
        startIdx--;
      }
      const blockLines = lines.slice(startIdx, targetLineIdx + 1);
      const text = blockLines.join('\n').replace(new RegExp(`\\s*\\^${escapedId}\\s*$`), '');
      return text.trim();
    }

    // 3. List item with nested items or standard paragraph:
    // Walk backwards until empty line or header
    let startIdx = targetLineIdx;
    while (startIdx > 0) {
      const prevLine = lines[startIdx - 1];
      if (prevLine.trim() === '' || prevLine.match(/^#{1,6}\s+/)) {
        break;
      }
      startIdx--;
    }

    const blockLines = lines.slice(startIdx, targetLineIdx + 1);
    const fullBlockText = blockLines.join('\n');
    const cleanedText = fullBlockText.replace(new RegExp(`\\s*\\^${escapedId}\\s*$`), '');
    return cleanedText.trim();
  }

  /**
   * Updates a block in the note content with new content, preserving the ^blockId.
   */
  public updateBlockInContent(fileContent: string, blockId: string, newContent: string): string {
    const escapedId = blockId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lines = fileContent.split('\n');

    let targetLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (new RegExp(`\\^${escapedId}\\s*$`).test(lines[i]) || lines[i].includes(`^${blockId}`)) {
        targetLineIdx = i;
        break;
      }
    }

    if (targetLineIdx === -1) {
      // If blockId wasn't found, append it at the end of the file
      return `${fileContent.trimEnd()}\n\n${newContent.trim()} ^${blockId}\n`;
    }

    // Find the start line of this block
    let startIdx = targetLineIdx;

    // Check for math block
    if (lines[targetLineIdx].includes('$$')) {
      const hasBoth = (lines[targetLineIdx].match(/\$\$/g) || []).length >= 2;
      if (!hasBoth) {
        let curr = targetLineIdx - 1;
        while (curr >= 0) {
          if (lines[curr].includes('$$')) {
            startIdx = curr;
            break;
          }
          curr--;
        }
      }
    } else if (lines[targetLineIdx].trim().startsWith('>')) {
      while (startIdx > 0 && lines[startIdx - 1].trim().startsWith('>')) {
        startIdx--;
      }
    } else {
      while (startIdx > 0) {
        const prev = lines[startIdx - 1];
        if (prev.trim() === '' || prev.match(/^#{1,6}\s+/)) {
          break;
        }
        startIdx--;
      }
    }

    const replacementWithId = `${newContent.trim()} ^${blockId}`;
    const before = lines.slice(0, startIdx);
    const after = lines.slice(targetLineIdx + 1);

    return [...before, replacementWithId, ...after].join('\n');
  }
}
