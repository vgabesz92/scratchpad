// SPDX-License-Identifier: GPL-3.0-only

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {defaultDataDir, expandPath} from './storage.js';

const POSITIONS = ['left', 'center', 'right'];
const PROJECT_URL = 'https://github.com/vgabesz92/scratchpad';

function fmt(str, ...args) {
    let i = 0;
    return str.replace(/%[ds]/g, () => String(args[i++]));
}

// '<Super><Alt>n'  ->  'Super+Alt+N'
function accelToHuman(accel) {
    if (!accel)
        return '';
    const [ok, key, mods] = Gtk.accelerator_parse(accel);
    if (!ok || key === 0)
        return accel;
    return Gtk.accelerator_get_label(key, mods);
}

// 'Super+Alt+N' or '<Super><Alt>n'  ->  normalized GTK accelerator, or null
function humanToAccel(text) {
    let accel = text.trim();
    if (!accel)
        return '';
    if (!accel.includes('<') && accel.includes('+')) {
        const parts = accel.split('+').map(p => p.trim()).filter(Boolean);
        const key = parts.pop();
        accel = parts.map(m => `<${m}>`).join('') + key.toLowerCase();
    }
    const [ok, key, mods] = Gtk.accelerator_parse(accel);
    if (!ok || key === 0)
        return null;
    return Gtk.accelerator_name(key, mods);
}

export default class ScratchpadPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;
        window.set_default_size(640, 760);

        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'document-edit-symbolic',
        });
        window.add(page);

        page.add(this._editorGroup(settings));
        page.add(this._padsGroup(settings));
        page.add(this._popupGroup(settings));
        page.add(this._keyboardGroup(settings));
        page.add(this._storageGroup(settings, window));
        page.add(this._aboutGroup(window));
    }

    _editorGroup(settings) {
        const group = new Adw.PreferencesGroup({title: _('Editor')});

        const wrap = new Adw.SwitchRow({
            title: _('Word wrap'),
            subtitle: _('Wrap long lines instead of scrolling horizontally'),
        });
        settings.bind('wrap-lines', wrap, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(wrap);

        const syntax = new Adw.SwitchRow({
            title: _('Syntax highlighting'),
            subtitle: _('Highlight code blocks and programming languages'),
        });
        settings.bind('syntax-highlighting', syntax, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(syntax);

        const markdown = new Adw.SwitchRow({
            title: _('Markdown styling'),
            subtitle: _('Highlight markdown headings, bold, italic, quotes and lists'),
        });
        settings.bind('markdown-styling', markdown, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(markdown);

        group.add(this._spinRow(settings, 'font-size', _('Font size'), _('In points'), 6, 24, 1));
        return group;
    }

    _padsGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Pads'),
            description: _('Leave a name empty to use the default. Changes are finalized by pressing Enter.'),
        });
        const defaults = [_('Notes'), _('Snippets'), _('Scratch')];

        const getSavedName = i => {
            const current = settings.get_strv('tab-names');
            return (current[i] ?? '').trim();
        };

        const getEnabledPads = () => {
            try {
                if (settings.settings_schema?.has_key('enabled-pads')) {
                    const val = settings.get_value('enabled-pads');
                    const arr = val?.deep_unpack();
                    if (Array.isArray(arr) && arr.length >= 3) {
                        if (arr.some(Boolean))
                            return arr.slice(0, 3);
                    }
                }
            } catch (_) {}
            return [true, true, true];
        };

        const setEnabledPads = pads => {
            settings.set_value('enabled-pads', new GLib.Variant('ab', pads));
        };

        const rows = [];

        for (let i = 0; i < 3; i++) {
            const savedName = getSavedName(i);
            const row = new Adw.EntryRow({
                title: fmt(_('Pad %d (default: %s)'), i + 1, defaults[i]),
                text: savedName,
            });

            const saveBtn = new Gtk.Button({
                icon_name: 'document-save-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
                tooltip_text: _('Save'),
                sensitive: false,
            });

            const deleteBtn = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
                tooltip_text: _('Delete pad'),
            });

            const restoreBtn = new Gtk.Button({
                icon_name: 'edit-undo-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
                tooltip_text: _('Restore pad'),
                visible: false,
            });

            const save = () => {
                const current = settings.get_strv('tab-names');
                while (current.length < 3)
                    current.push('');
                const newName = row.text.trim();
                current[i] = newName;
                settings.set_strv('tab-names', current.slice(0, 3));
                row.text = newName;

                saveBtn.sensitive = false;
                saveBtn.icon_name = 'object-select-symbolic';
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                    saveBtn.icon_name = 'document-save-symbolic';
                    return GLib.SOURCE_REMOVE;
                });
            };

            deleteBtn.connect('clicked', () => {
                const enabled = getEnabledPads();
                if (enabled.filter(Boolean).length <= 1)
                    return;
                row.text = getSavedName(i);
                enabled[i] = false;
                setEnabledPads(enabled);
                updateAllRows();
            });

            restoreBtn.connect('clicked', () => {
                const enabled = getEnabledPads();
                enabled[i] = true;
                setEnabledPads(enabled);
                updateAllRows();
            });

            row.connect('changed', () => {
                const text = row.text.trim();
                const currentSaved = getSavedName(i);
                saveBtn.sensitive = text !== currentSaved;
            });
            row.connect('entry-activated', save);
            saveBtn.connect('clicked', save);

            row.add_suffix(saveBtn);
            row.add_suffix(deleteBtn);
            row.add_suffix(restoreBtn);
            group.add(row);
            rows.push({row, saveBtn, deleteBtn, restoreBtn});
        }

        const resetRow = new Adw.ActionRow({
            title: _('Restore default pads'),
            subtitle: _('Re-enable all three pads'),
        });
        const resetBtn = new Gtk.Button({
            label: _('Restore all'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        resetBtn.connect('clicked', () => {
            setEnabledPads([true, true, true]);
            updateAllRows();
        });
        resetRow.add_suffix(resetBtn);
        resetRow.activatable_widget = resetBtn;
        group.add(resetRow);

        const updateAllRows = () => {
            const enabled = getEnabledPads();
            const enabledCount = enabled.filter(Boolean).length;

            for (let i = 0; i < 3; i++) {
                const isEnabled = enabled[i];
                const {row, saveBtn, deleteBtn, restoreBtn} = rows[i];
                const currentSaved = getSavedName(i);
                const text = row.text.trim();

                if (isEnabled) {
                    row.title = fmt(_('Pad %d (default: %s)'), i + 1, defaults[i]);
                    row.set_editable(true);
                    saveBtn.visible = true;
                    deleteBtn.visible = true;
                    restoreBtn.visible = false;

                    saveBtn.sensitive = text !== currentSaved;
                    deleteBtn.sensitive = enabledCount > 1;
                    deleteBtn.tooltip_text = enabledCount > 1
                        ? _('Delete pad')
                        : _('At least one pad must remain active');
                } else {
                    row.title = fmt(_('Pad %d (default: %s) — Deleted'), i + 1, defaults[i]);
                    row.set_editable(false);
                    saveBtn.visible = false;
                    deleteBtn.visible = false;
                    restoreBtn.visible = true;
                    restoreBtn.sensitive = true;
                }
            }

            resetRow.visible = enabledCount < 3;
        };

        settings.connect('changed::tab-names', () => {
            const current = settings.get_strv('tab-names');
            for (let i = 0; i < 3; i++) {
                const saved = (current[i] ?? '').trim();
                if (rows[i].row.text.trim() !== saved) {
                    rows[i].row.text = saved;
                }
            }
            updateAllRows();
        });

        settings.connect('changed::enabled-pads', updateAllRows);

        updateAllRows();

        return group;
    }

    _popupGroup(settings) {
        const group = new Adw.PreferencesGroup({title: _('Popup')});

        const indicator = new Adw.SwitchRow({
            title: _('Show panel icon'),
            subtitle: _('Show the Scratchpad icon in the top bar. You can still open it with the keyboard shortcut.'),
        });
        settings.bind('show-indicator', indicator, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(indicator);

        const position = new Adw.ComboRow({
            title: _('Panel position'),
            model: Gtk.StringList.new([_('Left'), _('Center'), _('Right')]),
        });
        position.selected = Math.max(0, POSITIONS.indexOf(settings.get_string('panel-position')));
        position.connect('notify::selected', () =>
            settings.set_string('panel-position', POSITIONS[position.selected]));
        group.add(position);

        const DISPLAY_MODES = ['popup', 'sidebar-left', 'sidebar-right'];
        const displayModeRow = new Adw.ComboRow({
            title: _('Display mode'),
            subtitle: _('Show as a top bar dropdown popup or a full-height sidebar'),
            model: Gtk.StringList.new([_('Popup menu'), _('Left sidebar'), _('Right sidebar')]),
        });
        displayModeRow.selected = Math.max(0, DISPLAY_MODES.indexOf(settings.get_string('display-mode')));
        displayModeRow.connect('notify::selected', () =>
            settings.set_string('display-mode', DISPLAY_MODES[displayModeRow.selected]));
        group.add(displayModeRow);

        // --- Size presets ---
        const SIZE_PRESETS = [
            {label: _('Small'),  w: 340, h: 400},
            {label: _('Medium'), w: 480, h: 540},
            {label: _('Large'),  w: 680, h: 700},
        ];
        const CUSTOM_INDEX = SIZE_PRESETS.length; // last entry

        const presetLabels = SIZE_PRESETS.map(p => p.label);
        presetLabels.push(_('Custom'));

        const presetRow = new Adw.ComboRow({
            title: _('Size'),
            subtitle: _('Preset popup dimensions or set a custom size below'),
            model: Gtk.StringList.new(presetLabels),
        });

        const widthRow = this._spinRow(settings, 'popup-width', _('Width'), _('In pixels'), 250, 1400, 10);
        const heightRow = this._spinRow(settings, 'popup-height', _('Height'), _('In pixels'), 200, 1200, 10);

        // Sync sensitivity of height and preset rows with display mode
        const syncDisplayMode = () => {
            const mode = settings.get_string('display-mode');
            const isPopup = mode === 'popup';
            heightRow.sensitive = isPopup;
            heightRow.subtitle = isPopup ? _('In pixels') : _('Automatic (full display height)');
            presetRow.sensitive = isPopup;
        };
        settings.connect('changed::display-mode', syncDisplayMode);
        displayModeRow.connect('notify::selected', syncDisplayMode);
        syncDisplayMode();

        // Determine initial preset selection
        const matchPreset = () => {
            const w = settings.get_int('popup-width');
            const h = settings.get_int('popup-height');
            const idx = SIZE_PRESETS.findIndex(p => p.w === w && p.h === h);
            return idx >= 0 ? idx : CUSTOM_INDEX;
        };

        let suppressPresetSync = false;

        presetRow.selected = matchPreset();
        presetRow.connect('notify::selected', () => {
            if (suppressPresetSync)
                return;
            const idx = presetRow.selected;
            if (idx < SIZE_PRESETS.length) {
                const {w, h} = SIZE_PRESETS[idx];
                settings.set_int('popup-width', w);
                settings.set_int('popup-height', h);
            }
        });

        // When spin rows change, switch preset to Custom if it no longer matches
        const onSizeChanged = () => {
            if (suppressPresetSync)
                return;
            suppressPresetSync = true;
            presetRow.selected = matchPreset();
            suppressPresetSync = false;
        };
        settings.connect('changed::popup-width', onSizeChanged);
        settings.connect('changed::popup-height', onSizeChanged);

        group.add(presetRow);
        group.add(widthRow);
        group.add(heightRow);

        // --- Reset to default ---
        const DEFAULT_W = 380;
        const DEFAULT_H = 440;
        const resetRow = new Adw.ActionRow({
            title: _('Reset size'),
            subtitle: fmt(_('Default: %d × %d px'), DEFAULT_W, DEFAULT_H),
        });
        const resetBtn = new Gtk.Button({
            icon_name: 'edit-undo-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: _('Reset to default size'),
        });
        resetBtn.connect('clicked', () => {
            settings.set_int('popup-width', DEFAULT_W);
            settings.set_int('popup-height', DEFAULT_H);
        });
        resetRow.add_suffix(resetBtn);
        resetRow.activatable_widget = resetBtn;
        group.add(resetRow);

        return group;
    }

    _keyboardGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Keyboard'),
            description: _('Type a combination like Super+Alt+N and press apply. Leave empty to disable.'),
        });
        const row = new Adw.EntryRow({
            title: _('Toggle shortcut'),
            show_apply_button: true,
            text: accelToHuman(settings.get_strv('toggle-shortcut')[0] ?? ''),
        });
        row.connect('apply', () => {
            const accel = humanToAccel(row.text);
            if (accel === null) {
                row.add_css_class('error');
                return;
            }
            row.remove_css_class('error');
            settings.set_strv('toggle-shortcut', accel ? [accel] : []);
            row.text = accelToHuman(accel);
        });
        group.add(row);
        return group;
    }

    _storageGroup(settings, window) {
        const group = new Adw.PreferencesGroup({
            title: _('Storage'),
            description: fmt(_('Leave empty to use the default: %s'), defaultDataDir()),
        });

        const dirRow = new Adw.EntryRow({
            title: _('Notes folder'),
            show_apply_button: true,
            text: settings.get_string('data-directory'),
        });
        dirRow.connect('apply', () => settings.set_string('data-directory', dirRow.text.trim()));
        settings.connect('changed::data-directory', () => {
            const value = settings.get_string('data-directory');
            if (dirRow.text !== value)
                dirRow.text = value;
        });
        group.add(dirRow);

        const openRow = new Adw.ActionRow({title: _('Open notes folder')});
        const openButton = new Gtk.Button({label: _('Open'), valign: Gtk.Align.CENTER});
        openButton.connect('clicked', () => {
            const path = expandPath(settings.get_string('data-directory'));
            GLib.mkdir_with_parents(path, 0o700);
            new Gtk.FileLauncher({file: Gio.File.new_for_path(path)}).launch(window, null, null);
        });
        openRow.add_suffix(openButton);
        openRow.activatable_widget = openButton;
        group.add(openRow);

        return group;
    }

    _aboutGroup(window) {
        const group = new Adw.PreferencesGroup({title: _('About')});
        const row = new Adw.ActionRow({
            title: _('Scratchpad'),
            subtitle: PROJECT_URL,
            activatable: true,
        });
        row.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
        row.connect('activated', () =>
            new Gtk.UriLauncher({uri: PROJECT_URL}).launch(window, null, null));
        group.add(row);
        return group;
    }

    _spinRow(settings, key, title, subtitle, lower, upper, step) {
        const row = new Adw.SpinRow({
            title,
            subtitle,
            adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 5}),
        });
        row.value = settings.get_int(key);
        row.connect('notify::value', () => {
            const v = Math.round(row.value);
            if (settings.get_int(key) !== v)
                settings.set_int(key, v);
        });
        settings.connect(`changed::${key}`, () => {
            const v = settings.get_int(key);
            if (Math.round(row.value) !== v)
                row.value = v;
        });
        return row;
    }
}
