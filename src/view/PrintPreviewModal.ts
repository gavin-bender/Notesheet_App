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
    const paperName = this.data.settings.pageSize === 'a4' ? 'A4' : 'US Letter';
    const densityName = (this.data.settings.density || 'compact') === 'compact' ? 'Compact' : 'Normal';
    const marginsName = this.data.settings.margins === 'tight' ? 'Tight (0.2in)' : this.data.settings.margins === 'normal' ? 'Normal (0.5in)' : 'Compact (0.3in)';
    headerLeft.createSpan({
      cls: 'preview-modal-info',
      text: `${this.data.title} • 2 Pages (Front & Back) • ${paperName} • ${marginsName} • ${densityName} Density`
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
      cls: `notesheet-preview-container notesheet-print-container density-${this.data.settings.density || 'compact'}`
    });
    this.previewWrapperEl.style.setProperty('--notesheet-font-size', `${this.data.settings.fontSize}pt`);
    this.previewWrapperEl.style.setProperty('--notesheet-columns', `${this.data.settings.columns}`);

    // Generate exact print page elements
    const pages = this.view.createPrintPageElements();
    pages.forEach((pageEl, idx) => {
      const pageWrapper = this.previewWrapperEl.createDiv({ cls: 'notesheet-preview-page-wrapper' });
      pageWrapper.createDiv({
        cls: 'notesheet-preview-sheet-tag',
        text: idx === 0 ? 'Page 1 — Front' : 'Page 2 — Back'
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
    const paperWidth = this.data.settings.pageSize === 'a4' ? 794 : 816;
    if (availableWidth > 0) {
      const idealZoom = Math.min(1.0, Math.max(0.4, (availableWidth / paperWidth) * 0.95));
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

