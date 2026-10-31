import { App, PluginSettingTab, Setting, TFile } from 'obsidian';
import type NotesheetPlugin from '../main';

export class NotesheetSettingTab extends PluginSettingTab {
  plugin: NotesheetPlugin;

  constructor(app: App, plugin: NotesheetPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Notesheet Plugin Settings' });

    new Setting(containerEl)
      .setName('Active / Default Notesheet')
      .setDesc('When adding blocks from notes via commands or context menu, add to this notesheet')
      .addDropdown(dropdown => {
        const sheets = this.plugin.store.getAllNotesheets();
        dropdown.addOption('', '-- Select active notesheet --');
        for (const sheet of sheets) {
          dropdown.addOption(sheet.path, sheet.basename.replace('.notesheet', ''));
        }
        dropdown.setValue(this.plugin.settings.activeNotesheetPath || '');
        dropdown.onChange(async (val) => {
          this.plugin.settings.activeNotesheetPath = val;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Default Columns')
      .setDesc('Number of columns for new notesheets (2 or 3 is standard for exam cheat sheets)')
      .addDropdown(dd => {
        dd.addOption('1', '1 Column');
        dd.addOption('2', '2 Columns');
        dd.addOption('3', '3 Columns');
        dd.addOption('4', '4 Columns');
        dd.setValue(this.plugin.settings.defaultColumns.toString());
        dd.onChange(async (val) => {
          this.plugin.settings.defaultColumns = parseInt(val, 10);
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Default Font Size')
      .setDesc('Base font size for notesheet cards in points (pt)')
      .addSlider(slider => {
        slider
          .setLimits(6, 12, 0.5)
          .setValue(this.plugin.settings.defaultFontSize)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.settings.defaultFontSize = val;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Default Paper Size')
      .setDesc('Standard paper dimension for print & PDF layout')
      .addDropdown(dd => {
        dd.addOption('letter', 'US Letter (8.5" x 11")');
        dd.addOption('a4', 'A4 (210 x 297 mm)');
        dd.setValue(this.plugin.settings.defaultPageSize);
        dd.onChange(async (val) => {
          this.plugin.settings.defaultPageSize = val as any;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Default Margins')
      .setDesc('Margins for notesheet pages')
      .addDropdown(dd => {
        dd.addOption('tight', 'Tight (0.2in / 5mm)');
        dd.addOption('compact', 'Compact (0.3in / 7.5mm)');
        dd.addOption('normal', 'Normal (0.5in / 12.7mm)');
        dd.setValue(this.plugin.settings.defaultMargins);
        dd.onChange(async (val) => {
          this.plugin.settings.defaultMargins = val as any;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Default Density')
      .setDesc('Compact spacing optimizes card and code block density for exam cheat sheets')
      .addDropdown(dd => {
        dd.addOption('compact', 'Compact (Cheat Sheet)');
        dd.addOption('normal', 'Normal (Spacious)');
        dd.setValue(this.plugin.settings.defaultDensity || 'compact');
        dd.onChange(async (val) => {
          this.plugin.settings.defaultDensity = val as any;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Default Auto-Fit to Page')
      .setDesc('Automatically scale cards proportionally so each sheet fits on exactly 1 printed page without spilling')
      .addToggle(toggle => {
        toggle
          .setValue(this.plugin.settings.defaultAutoFitPage !== false)
          .onChange(async (val) => {
            this.plugin.settings.defaultAutoFitPage = val;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Notesheet Folder')
      .setDesc('Folder in vault to store newly created notesheet files (leave empty for vault root)')
      .addText(text => {
        text
          .setPlaceholder('e.g. Exams or Notesheets')
          .setValue(this.plugin.settings.defaultFolder)
          .onChange(async (val) => {
            this.plugin.settings.defaultFolder = val.trim();
            await this.plugin.saveSettings();
          });
      });
  }
}
