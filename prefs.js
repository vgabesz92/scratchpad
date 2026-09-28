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

        group.add(this._spinRow(settings, 'font-size', _('Font size'), _('In points'), 10, 24, 1));
        return group;
    }

    _padsGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Pads'),
            description: _('Leave a name empty to use the default.'),
        });
        const defaults = [_('Notes'), _('Snippets'), _('Scratch')];

        const getSavedName = i => {
            const current = settings.get_strv('tab-names');
            return (current[i] ?? '').trim();
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
                tooltip_text: _('Delete'),
                sensitive: savedName.length > 0,
            });

            const updateButtons = () => {
                const text = row.text.trim();
                const currentSaved = getSavedName(i);
                saveBtn.sensitive = text !== currentSaved;
                deleteBtn.sensitive = text.length > 0 || currentSaved.length > 0;
            };

            const save = () => {
                const current = settings.get_strv('tab-names');
                while (current.length < 3)
                    current.push('');
                const newName = row.text.trim();
                current[i] = newName;
                settings.set_strv('tab-names', current.slice(0, 3));
                row.text = newName;

                saveBtn.sensitive = false;
                deleteBtn.sensitive = newName.length > 0;

                saveBtn.icon_name = 'object-select-symbolic';
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                    saveBtn.icon_name = 'document-save-symbolic';
                    return GLib.SOURCE_REMOVE;
                });
            };

            const del = () => {
                row.text = '';
                const current = settings.get_strv('tab-names');
                while (current.length < 3)
                    current.push('');
                current[i] = '';
                settings.set_strv('tab-names', current.slice(0, 3));

                saveBtn.sensitive = false;
                deleteBtn.sensitive = false;
            };

            row.connect('changed', updateButtons);
            row.connect('entry-activated', save);
            saveBtn.connect('clicked', save);
            deleteBtn.connect('clicked', del);

            row.add_suffix(saveBtn);
            row.add_suffix(deleteBtn);
            group.add(row);
            rows.push({row, updateButtons});
        }

        settings.connect('changed::tab-names', () => {
            const current = settings.get_strv('tab-names');
            for (let i = 0; i < 3; i++) {
                const saved = (current[i] ?? '').trim();
                if (rows[i].row.text.trim() !== saved) {
                    rows[i].row.text = saved;
                    rows[i].updateButtons();
                }
            }
        });

        return group;
    }

    _popupGroup(settings) {
        const group = new Adw.PreferencesGroup({title: _('Popup')});

        const position = new Adw.ComboRow({
            title: _('Panel position'),
            model: Gtk.StringList.new([_('Left'), _('Center'), _('Right')]),
        });
        position.selected = Math.max(0, POSITIONS.indexOf(settings.get_string('panel-position')));
        position.connect('notify::selected', () =>
            settings.set_string('panel-position', POSITIONS[position.selected]));
        group.add(position);

        group.add(this._spinRow(settings, 'popup-width', _('Width'), _('In pixels'), 300, 1200, 10));
        group.add(this._spinRow(settings, 'popup-height', _('Height'), _('In pixels'), 300, 1000, 10));
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
