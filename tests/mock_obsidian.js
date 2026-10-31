export function normalizePath(path) {
  return path.replace(/\\/g, '/');
}

export class Notice {
  constructor(message) {
    // mock notice
  }
}

export class App {}
export class TFile {}
export class Component {}
export class ItemView {}
export class Modal {}
export class FuzzySuggestModal {
  constructor(app) {
    this.app = app;
  }
  setPlaceholder() {}
  open() {}
  close() {}
}
export class Setting {}
export class Menu {
  addItem() { return this; }
  addSeparator() { return this; }
  showAtMouseEvent() {}
}
export function debounce(fn) {
  return fn;
}
export function setIcon() {}
export function getIcon(name) {
  return {
    addClass() {},
    tagName: 'svg'
  };
}
export function getIconIds() {
  return ['layers', 'mouse-pointer', 'code', 'book'];
}
export async function loadPrism() {
  return {
    languages: {
      cpp: {},
      c: {},
      javascript: {},
      python: {}
    },
    highlightElement(el) {}
  };
}
export class MarkdownRenderer {
  static async render(app, md, el, path, component) {
    if (el) el.innerHTML = md;
  }
}
