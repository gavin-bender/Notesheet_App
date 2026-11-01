export type PageSize = 'letter' | 'a4' | 'card3x5';
export type PageOrientation = 'portrait' | 'landscape';

export interface NotesheetCategory {
  id: string;
  name: string;
  color: string; // Hex color e.g. '#2563eb'
}

export interface NotesheetItem {
  id: string;
  sourceFile: string;      // Vault relative path (e.g. "Physics/Formulas.md"), empty if standalone
  blockId: string;         // Obsidian block id (e.g. "eq-euler" from ^eq-euler), empty if standalone
  title?: string;          // Optional title for the card
  content: string;         // Markdown content of the block
  column: number;          // Target column (0, 1, 2...)
  order: number;           // Sort order within column
  updatedAt: number;       // Timestamp of last update
  color?: string;          // Optional card accent color
  categoryId?: string;     // Assigned category id
}

export interface NotesheetPage {
  id: string;              // "front" | "back" | custom
  name: string;            // "Front (Page 1)" | "Back (Page 2)"
  items: NotesheetItem[];
}

export interface NotesheetSettings {
  pageSize: PageSize;
  orientation: PageOrientation;
  columns: number;         // 1, 2, 3, or 4 columns per page
  fontSize: number;        // pt size: 5.0 - 12.0
  lineHeight: number;      // 1.0 - 1.5
  margins: 'tight' | 'compact' | 'normal'; // tight: 0.2in (0.1in card), compact: 0.3in (0.15in card), normal: 0.5in (0.25in card)
  density?: 'compact' | 'normal';          // Content density: compact (exam cheat sheet) vs normal
  autoFitPage?: boolean;                   // Automatically scale content to fit cleanly on 1 page per sheet
  showBorders: boolean;    // show card border boxes
  showCardBackground?: boolean; // show subtle grey background on cards
  showCardTitles: boolean; // show title header on cards
  showSourceLinks: boolean;// show link back to source note
  showPageNumbers: boolean;// show Page 1: Front / Page 2: Back in print footer
  showCategoryTitles: boolean; // show or hide category title banners/badges
}

export interface NotesheetData {
  version: 1;
  id: string;
  title: string;
  settings: NotesheetSettings;
  categories: NotesheetCategory[];
  pages: NotesheetPage[];  // Front and Back pages by default
}

export interface PluginSettings {
  defaultColumns: number;
  defaultFontSize: number;
  defaultPageSize: PageSize;
  defaultOrientation: PageOrientation;
  defaultMargins: 'tight' | 'compact' | 'normal';
  defaultDensity: 'compact' | 'normal';
  defaultAutoFitPage: boolean;
  defaultCardBackground: boolean;
  defaultFolder: string;
  activeNotesheetPath: string;
  confirmCardDelete: boolean;
}

export const DEFAULT_CATEGORIES: NotesheetCategory[] = [
  { id: 'cat-formulas', name: 'Formulas', color: '#2563eb' },       // Blue
  { id: 'cat-definitions', name: 'Definitions', color: '#16a34a' },  // Green
  { id: 'cat-theorems', name: 'Theorems', color: '#9333ea' },        // Purple
  { id: 'cat-examples', name: 'Examples', color: '#d97706' },        // Amber
  { id: 'cat-constants', name: 'Constants', color: '#dc2626' }       // Red
];

export const DEFAULT_NOTESHEET_SETTINGS: NotesheetSettings = {
  pageSize: 'letter',
  orientation: 'portrait',
  columns: 2,
  fontSize: 8.5,
  lineHeight: 1.25,
  margins: 'compact',
  density: 'compact',
  autoFitPage: true,
  showBorders: true,
  showCardBackground: false,
  showCardTitles: true,
  showSourceLinks: true,
  showPageNumbers: true,
  showCategoryTitles: true,
};

export const DEFAULT_NOTECARD_SETTINGS: NotesheetSettings = {
  pageSize: 'card3x5',
  orientation: 'landscape',
  columns: 1,
  fontSize: 7.0,
  lineHeight: 1.2,
  margins: 'compact',
  density: 'compact',
  autoFitPage: true,
  showBorders: true,
  showCardBackground: false,
  showCardTitles: true,
  showSourceLinks: true,
  showPageNumbers: true,
  showCategoryTitles: true,
};

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
  defaultColumns: 2,
  defaultFontSize: 8.5,
  defaultPageSize: 'letter',
  defaultOrientation: 'portrait',
  defaultMargins: 'compact',
  defaultDensity: 'compact',
  defaultAutoFitPage: true,
  defaultCardBackground: false,
  defaultFolder: '',
  activeNotesheetPath: '',
  confirmCardDelete: false,
};

export function createDefaultNotesheetData(
  title = 'Exam Notesheet',
  customSettings?: Partial<NotesheetSettings>
): NotesheetData {
  const isCard = customSettings?.pageSize === 'card3x5';
  const baseSettings = isCard ? DEFAULT_NOTECARD_SETTINGS : DEFAULT_NOTESHEET_SETTINGS;
  return {
    version: 1,
    id: 'sheet-' + Date.now().toString(36),
    title,
    settings: { ...baseSettings, ...customSettings },
    categories: [...DEFAULT_CATEGORIES],
    pages: [
      {
        id: 'front',
        name: isCard ? 'Front (Card 1)' : 'Front (Page 1)',
        items: []
      },
      {
        id: 'back',
        name: isCard ? 'Back (Card 2)' : 'Back (Page 2)',
        items: []
      }
    ]
  };
}
