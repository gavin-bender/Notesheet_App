import { App, Modal, setIcon } from 'obsidian';
import { NotesheetData } from '../types';
import type { NotesheetView } from './NotesheetView';

export class PrintPreviewModal extends Modal {
  private data: NotesheetData;
  private view: NotesheetView;
  private currentZoom: number = 0.85;
  private previewWrapperEl: HTMLElement;

  constructor(app: App, data: NotesheetData, view: NotesheetView) {
    super(app);
    this.data = data;
    this.view = view;
  }

  onOpen() {
    this.modalEl.addClass('notesheet-preview-modal');
    this.render();
  }

  onClose() {
    this.contentEl.empty();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('notesheet-preview-modal-body');

    // Header Toolbar
    const header = contentEl.createDiv({ cls: 'notesheet-preview-modal-header' });

    // Left side: Title & Document Metadata
    const headerLeft = header.createDiv({ cls: 'preview-header-left' });
    headerLeft.createSpan({ cls: 'preview-modal-title', text: 'Print Preview' });
    const pageSize = this.data.settings.pageSize;
    const orientation = this.data.settings.orientation || (pageSize === 'card3x5' ? 'landscape' : 'portrait');
    const isCard = pageSize === 'card3x5';
    const orientLabel = orientation === 'landscape' ? 'Landscape' : 'Portrait';

    let paperName = 'US Letter';
    if (isCard) {
      paperName = `3" x 5" Notecard (${orientLabel})`;
    } else if (pageSize === 'a4') {
      paperName = `A4 (${orientLabel})`;
    } else {
      paperName = `US Letter (${orientLabel})`;
    }

    const densityName = (this.data.settings.density || 'compact') === 'compact' ? 'Compact' : 'Normal';
    let marginsName = 'Compact (0.3in)';
    if (isCard) {
      marginsName = this.data.settings.margins === 'tight' ? 'Tight (0.1in)' : this.data.settings.margins === 'normal' ? 'Normal (0.25in)' : 'Compact (0.15in)';
    } else {
      marginsName = this.data.settings.margins === 'tight' ? 'Tight (0.2in)' : this.data.settings.margins === 'normal' ? 'Normal (0.5in)' : 'Compact (0.3in)';
    }

    const unitDesc = isCard ? '2 Sides (Front & Back)' : '2 Pages (Front & Back)';
    const ruledSide = this.data.settings.notecardRuledSide || 'front';
    const ruledDesc = ruledSide === 'front' ? 'Front Lined / Back Blank' : ruledSide === 'both' ? 'Both Lined' : 'Plain';
    const fontDesc = (this.data.settings.notecardFontStyle || 'handwritten') === 'handwritten' ? 'Handwritten' : 'Standard';
    const notecardExtra = isCard ? ` • ${ruledDesc} • ${fontDesc}` : '';
    headerLeft.createSpan({
      cls: 'preview-modal-info',
      text: `${this.data.title} • ${unitDesc} • ${paperName}${notecardExtra} • ${marginsName} • ${densityName} Density`
    });

    // Right side: Zoom, Print & Close Controls
    const headerRight = header.createDiv({ cls: 'preview-header-right' });

    // Zoom Controls
    const zoomGroup = headerRight.createDiv({ cls: 'preview-zoom-group' });

    const zoomOutBtn = zoomGroup.createEl('button', { cls: 'preview-btn-icon' });
    setIcon(zoomOutBtn, 'minus');
    zoomOutBtn.title = 'Zoom out';
    zoomOutBtn.addEventListener('click', () => {
      this.currentZoom = Math.max(0.35, parseFloat((this.currentZoom - 0.1).toFixed(2)));
      this.updateZoom(zoomLabel);
    });

    const zoomLabel = zoomGroup.createSpan({ cls: 'preview-zoom-label', text: `${Math.round(this.currentZoom * 100)}%` });

    const zoomInBtn = zoomGroup.createEl('button', { cls: 'preview-btn-icon' });
    setIcon(zoomInBtn, 'plus');
    zoomInBtn.title = 'Zoom in';
    zoomInBtn.addEventListener('click', () => {
      this.currentZoom = Math.min(1.5, parseFloat((this.currentZoom + 0.1).toFixed(2)));
      this.updateZoom(zoomLabel);
    });

    const fitBtn = zoomGroup.createEl('button', { cls: 'notesheet-btn-toolbar', text: 'Fit Width' });
    fitBtn.title = 'Fit sheets to window width';
    fitBtn.addEventListener('click', () => {
      this.autoFitZoom(zoomLabel);
    });

    // Direct Print Button
    const printBtn = headerRight.createEl('button', {
      cls: 'notesheet-btn-toolbar print-btn mod-cta'
    });
    const printIcon = printBtn.createSpan();
    setIcon(printIcon, 'printer');
    printBtn.createSpan({ text: ' Print / PDF' });
    printBtn.title = 'Print or export front & back pages for exam';
    printBtn.addEventListener('click', () => {
      this.close();
      setTimeout(() => {
        this.view.printNotesheet();
      }, 100);
    });

    // Close Button
    const closeBtn = headerRight.createEl('button', { cls: 'preview-btn-icon' });
    setIcon(closeBtn, 'x');
    closeBtn.title = 'Close preview (Esc)';
    closeBtn.addEventListener('click', () => {
      this.close();
    });

    // Scrollable Preview Backdrop (PDF viewer background)
    const viewerBackdrop = contentEl.createDiv({ cls: 'notesheet-preview-backdrop' });

    // Inner container holding both pages
    this.previewWrapperEl = viewerBackdrop.createDiv({
      cls: `notesheet-preview-container notesheet-print-container density-${this.data.settings.density || 'compact'} paper-${pageSize} orientation-${orientation}`
    });
    this.previewWrapperEl.style.setProperty('--notesheet-font-size', `${this.data.settings.fontSize}pt`);
    this.previewWrapperEl.style.setProperty('--notesheet-columns', `${this.data.settings.columns}`);

    // Generate exact print page elements
    const pages = this.view.createPrintPageElements();
    pages.forEach((pageEl, idx) => {
      const pageWrapper = this.previewWrapperEl.createDiv({ cls: 'notesheet-preview-page-wrapper' });
      pageWrapper.createDiv({
        cls: 'notesheet-preview-sheet-tag',
        text: isCard
          ? (idx === 0 ? 'Card 1 — Front' : 'Card 2 — Back')
          : (idx === 0 ? 'Page 1 — Front' : 'Page 2 — Back')
      });
      pageWrapper.appendChild(pageEl);
      this.view.updatePageFit(pageEl);
    });

    this.updateZoom(zoomLabel);

    // Auto-fit zoom after DOM layout
    setTimeout(() => {
      this.autoFitZoom(zoomLabel);
    }, 50);
  }

  private autoFitZoom(labelEl?: HTMLElement) {
    if (!this.previewWrapperEl || !this.contentEl) return;
    const availableWidth = this.contentEl.clientWidth - 80;
    const pageSize = this.data.settings.pageSize;
    const orientation = this.data.settings.orientation || (pageSize === 'card3x5' ? 'landscape' : 'portrait');
    const isLandscape = orientation === 'landscape';

    let paperWidth = 816;
    if (pageSize === 'a4') {
      paperWidth = isLandscape ? 1123 : 794;
    } else if (pageSize === 'card3x5') {
      paperWidth = isLandscape ? 480 : 288;
    } else {
      paperWidth = isLandscape ? 1056 : 816;
    }

    if (availableWidth > 0) {
      const maxZoom = pageSize === 'card3x5' ? 1.4 : 1.0;
      const idealZoom = Math.min(maxZoom, Math.max(0.4, (availableWidth / paperWidth) * 0.95));
      this.currentZoom = parseFloat(idealZoom.toFixed(2));
      this.updateZoom(labelEl);
    }
  }

  private updateZoom(labelEl?: HTMLElement) {
    if (this.previewWrapperEl) {
      this.previewWrapperEl.style.transform = `scale(${this.currentZoom})`;
      this.previewWrapperEl.style.transformOrigin = 'top center';
    }
    const label = labelEl || this.contentEl.querySelector<HTMLElement>('.preview-zoom-label');
    if (label) {
      label.setText(`${Math.round(this.currentZoom * 100)}%`);
    }
  }
}

