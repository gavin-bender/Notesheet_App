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
