# Obsidian Notesheet Plugin 📝🎓

An exam notesheet and cheat sheet organizer for [Obsidian](https://obsidian.md). Take blocks, formulas, theorems, and definitions from your vault notes and organize them onto an exam-ready notesheet formatted for printing.

---

## ✨ Features

- **2 Pages by Default (Front & Back)**: Designed specifically for exams that allow "one sheet of paper, front and back". Easily switch between Page 1 (Front), Page 2 (Back), or Dual View.
- **Select Blocks from Any Note**:
  - Right-click any selection or block in an open note: choose **"Notesheet: Add to Front (Page 1)"** or **"Notesheet: Add to Back (Page 2)"**.
  - Use the Command Palette: `Notesheet: Add selected block to Notesheet (Front / Page 1)`.
  - Use the built-in **"📥 Import Block"** browser inside the Notesheet view to preview and pull blocks from notes without leaving your sheet.
- **Seamless Two-Way Live Sync**:
  - **Edit in your note ➡️ Notesheet updates**: When you modify a block in your class notes, the notesheet card updates in real-time.
  - **Edit on the notesheet ➡️ Note updates**: Click the pencil icon on any card on the cheat sheet, edit the content, and save. It automatically updates the source note file in your vault!
  - Uses native Obsidian block anchors (`^block-id`) so your markdown files remain 100% standard, clean, and portable.
- **Exam Print & PDF Optimization (`@media print`)**:
  - Strict pagination: Page 1 (Front) and Page 2 (Back) have forced page breaks.
  - Multi-column density: 2, 3, or 4 columns to cram maximum formulas cleanly.
  - Typography controls: Adjustable font size (6.5pt to 12pt) and margins (Tight, Compact, Normal) for high-density cheat sheets.
  - Full LaTeX math rendering ($...$ and $$...$$), tables, callouts, lists, and syntax-highlighted code blocks.
  - One-click **Print / PDF** button that opens a clean print layout stripped of all UI chrome, scrollbars, and sidebars.

---

## 🚀 Getting Started

### 1. Opening or Creating a Notesheet
- Click the **Notesheet** icon on the left ribbon (or run `Notesheet: Create new exam Notesheet` from the Command Palette `Cmd/Ctrl + P`).
- Give your notesheet a title (e.g. `Physics 240 Midterm`, `EECS 280 Exam Review`).
- The interactive Notesheet view will open in a split leaf side-by-side with your notes.

### 2. Adding Blocks from Your Notes
There are two easy ways to populate your notesheet:
- **Push from Note**:
  1. Open any class note.
  2. Highlight a formula, table, or paragraph (or place your cursor on it).
  3. Right-click and choose **"Notesheet: Add to Front (Page 1)"** or **"Notesheet: Add to Back (Page 2)"**.
  4. The block is immediately linked with a unique `^block-id` and placed on your cheat sheet.
- **Pull from Sheet**:
  1. Click **"📥 Import Block"** in the Notesheet toolbar.
  2. Choose a note to browse extracted formulas and sections.
  3. Click **"+ Add to Front"** or **"+ Add to Back"**.

### 3. Two-Way Sync in Action
- **Card to Note**: Click the pencil icon on any card on the notesheet to edit formulas or shorten text. When you hit **Save & Sync** (or press `Cmd/Ctrl + Enter`), the source note in your vault is updated automatically.
- **Note to Card**: If you refine your class notes during lecture, the changes sync directly to the notesheet cards without having to re-import anything.
- **Jump to Note**: Click the source badge pill on any card header (e.g. `📄 PHYS240`) to open that note and jump to the block.

### 4. Customizing Exam Density & Layout
- **Page Tabs**: Toggle between **Page 1: Front**, **Page 2: Back**, or **Dual View**.
- **Columns**: Select **2 cols**, **3 cols**, or **4 cols** to organize your formulas.
- **Font Size**: Use the font size selector (e.g. **7.5 pt** or **8 pt**) to maximize space.
- **Borders**: Toggle card borders on or off.
- **Reordering**: Drag and drop cards between columns or use the `↑` / `↓` / `→ Back` buttons.

### 5. Printing for the Exam
1. Click the **Print / PDF** button on the toolbar.
2. The print preview dialog opens with:
   - Page 1 printing the **Front** page.
   - Page 2 printing the **Back** page.
   - Exact paper size (US Letter or A4) with tight margins.
3. Select your printer or choose "Save as PDF".

---

## 🛠️ Development & Building

To build the plugin from source:

```bash
# Install dependencies
npm install

# Run dev watch mode
npm run dev

# Build production bundle
npm run build
```

This generates:
- `main.js`: Plugin logic and bundling
- `manifest.json`: Obsidian plugin manifest
- `styles.css`: Sheet styling and `@media print` rules
