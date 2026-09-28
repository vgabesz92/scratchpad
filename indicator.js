// SPDX-License-Identifier: GPL-3.0-only

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Pango from 'gi://Pango';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';

import {PadStore, TOTAL_PADS, expandPath} from './storage.js';
import {createSyntaxAttributes, setRefreshCallback} from './syntax.js';

Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');
Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');
Gio._promisify(Gio.File.prototype, 'trash_async');
Gio._promisify(Gio.File.prototype, 'delete_async');

const DEBOUNCE_MS = 400;
const COPY_FEEDBACK_MS = 1500;
const UNDO_BANNER_MS = 5000;
const FONT_MIN = 10;
const FONT_MAX = 24;
const WIDTH_MIN = 300;
const WIDTH_MAX = 1200;
const HEIGHT_MIN = 300;
const HEIGHT_MAX = 1000;

const VERTICAL = Clutter.Orientation.VERTICAL;
const CENTER = Clutter.ActorAlign.CENTER;
const Color = Clutter.Color ?? Cogl.Color;

function fmt(str, ...args) {
    let i = 0;
    return str.replace(/%[ds]/g, () => String(args[i++]));
}

function formatFileDate(mtimeUsec) {
    if (!mtimeUsec)
        return '';
    const date = new Date(mtimeUsec / 1000);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    const pad = n => String(n).padStart(2, '0');
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());

    if (isToday)
        return fmt(_('Today, %s:%s'), hours, minutes);

    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());

    if (year === now.getFullYear())
        return `${month}-${day} ${hours}:${minutes}`;

    return `${year}-${month}-${day}`;
}

function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
}

function charCount(text) {
    let n = 0;
    for (const _c of text)
        n++;
    return n;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

function defaultFilenameForNote(text, tabName) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const firstLine = lines.length > 0 ? lines[0] : '';

    // Strip common markdown prefixes (headings, list items, checklists, blockquotes)
    let clean = firstLine
        .replace(/^([#*\-+=~>]|\d+\.)+\s*/, '')
        .replace(/^\[[ xX]\]\s*/, '')
        .trim();

    clean = clean.replace(/#+$/, '').trim();

    if (!clean)
        clean = firstLine;

    // Remove invalid filename characters (/ \ ? % * : | " < > ` ~ and control characters)
    let sanitized = clean
        .replace(/[/\\?%*:|"<>`~\x00-\x1f\x7f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (sanitized.toLowerCase().endsWith('.md'))
        sanitized = sanitized.slice(0, -3).trim();

    sanitized = sanitized.replace(/[.\s]+$/, '').slice(0, 50).trim();

    // Prevent collision with internal pad files (pad_1.md, pad_2.md, pad_3.md)
    if (/^pad_[1-3]$/i.test(sanitized))
        sanitized = `${sanitized}_note`;

    if (sanitized)
        return `${sanitized}.md`;

    let baseName = (tabName || '').trim()
        .replace(/[/\\?%*:|"<>`~\x00-\x1f\x7f]/g, '')
        .trim();
    if (!baseName || /^pad_[1-3]$/i.test(baseName))
        baseName = 'note';

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return `${baseName.toLowerCase()}-${dateStr}.md`;
}

export const ScratchpadIndicator = GObject.registerClass(
class ScratchpadIndicator extends PanelMenu.Button {
    _init(extension, settings) {
        super._init(0.5, _('Scratchpad'), false);

        this._extension = extension;
        this._settings = settings;
        this._destroyed = false;
        this._loaded = false;
        this._suppressChange = false;
        this._saveFailed = false;
        this._undo = null;
        this._hasCodeSnippetAttrs = false;
        this._formatting = false;
        this._sources = new Map();
        this._store = null;

        setRefreshCallback(() => {
            if (!this._destroyed && this._entry?.clutter_text)
                this._updateFormatting();
        });

        this._texts = new Array(TOTAL_PADS).fill('');
        this._dirty = new Array(TOTAL_PADS).fill(false);
        this._cursors = new Array(TOTAL_PADS).fill(-1);
        this._currentFile = new Array(TOTAL_PADS).fill(null);
        this._cachedFiles = new Array(TOTAL_PADS).fill(null);
        this._activeTab = clamp(settings.get_int('active-tab'), 0, TOTAL_PADS - 1);

        this.add_child(new St.Icon({
            gicon: Gio.icon_new_for_string(
                GLib.build_filenamev([extension.path, 'icons', 'scratchpad-symbolic.svg'])),
            style_class: 'system-status-icon',
        }));

        this._buildUi();
        this.menu.box.add_style_class_name('scratchpad-menu');

        this._leftHandle = this._createResizeHandle('left');
        this._rightHandle = this._createResizeHandle('right');
        this._bottomHandle = this._createResizeHandle('bottom');
        this._seCornerHandle = this._createResizeHandle('corner-se');
        this._swCornerHandle = this._createResizeHandle('corner-sw');

        const middleBox = new St.BoxLayout({
            style_class: 'scratchpad-middle-box',
            x_expand: true,
            y_expand: true,
        });
        middleBox.add_child(this._leftHandle);
        middleBox.add_child(this._root);
        middleBox.add_child(this._rightHandle);

        const bottomBox = new St.BoxLayout({
            style_class: 'scratchpad-bottom-box',
            x_expand: true,
        });
        bottomBox.add_child(this._swCornerHandle);
        bottomBox.add_child(this._bottomHandle);
        bottomBox.add_child(this._seCornerHandle);

        this._container = new St.BoxLayout({
            style_class: 'scratchpad-container',
            orientation: VERTICAL,
            x_expand: true,
            y_expand: true,
        });
        this._container.add_child(middleBox);
        this._container.add_child(bottomBox);
        this.menu.box.add_child(this._container);

        // PanelMenu.Button.setMenu() already connects
        // this._onOpenStateChanged(menu, open) — we inherit that connection by
        // overriding the method, so no extra connect here (a second one would
        // run the open branch twice and get the arguments out of sync).

        this._bindSettings();
        this._applyTabNames();
        this._applyEditorSettings();
        this._applyPopupSize();
        this._applyReducedMotion();
        this._updateTabButtons();
        this._setStatus('saved');

        this._openStore();
    }

    // ---------------------------------------------------------------- UI --

    _buildUi() {
        this._root = new St.BoxLayout({
            style_class: 'scratchpad-root',
            orientation: VERTICAL,
            x_expand: true,
            y_expand: true,
        });

        // Header: tabs + settings toggle
        const header = new St.BoxLayout({style_class: 'scratchpad-header', x_expand: true});
        const tabBox = new St.BoxLayout({style_class: 'scratchpad-tabs', x_expand: true});
        this._tabButtons = [];
        for (let i = 0; i < TOTAL_PADS; i++) {
            const btn = new St.Button({
                style_class: 'scratchpad-tab button flat',
                can_focus: true,
                x_expand: true,
                label: '',
            });
            btn.connect('clicked', () => this._selectTab(i));
            tabBox.add_child(btn);
            this._tabButtons.push(btn);
        }
        this._settingsButton = new St.Button({
            style_class: 'scratchpad-icon-button button flat',
            toggle_mode: true,
            can_focus: true,
            y_align: CENTER,
            accessible_name: _('Settings'),
            child: new St.Icon({icon_name: 'emblem-system-symbolic', icon_size: 16}),
        });
        this._settingsButton.connect('notify::checked', () => {
            if (this._settingsButton.checked)
                this._closeHistoryMenu();
            this._drawer.visible = this._settingsButton.checked;
        });
        header.add_child(tabBox);
        header.add_child(this._settingsButton);

        // Settings drawer
        this._drawer = new St.BoxLayout({
            style_class: 'scratchpad-drawer',
            orientation: VERTICAL,
            x_expand: true,
            visible: false,
        });
        this._wrapSwitch = this._addSwitchRow(_('Word wrap'), 'wrap-lines');
        this._syntaxSwitch = this._addSwitchRow(_('Syntax highlighting'), 'syntax-highlighting');

        const fontRow = new St.BoxLayout({style_class: 'scratchpad-drawer-row', x_expand: true, y_align: CENTER});
        this._fontLabel = new St.Label({x_expand: true, y_align: CENTER});
        fontRow.add_child(this._fontLabel);

        const fontBtnGroup = new St.BoxLayout({style_class: 'scratchpad-button-group', y_align: CENTER});
        const decFontBtn = new St.Button({
            style_class: 'scratchpad-group-button button flat',
            can_focus: true,
            accessible_name: _('Decrease font size'),
            child: new St.Icon({icon_name: 'list-remove-symbolic', icon_size: 14, y_align: CENTER}),
            y_align: CENTER,
        });
        decFontBtn.connect('clicked', () => this._adjustFont(-1));
        const incFontBtn = new St.Button({
            style_class: 'scratchpad-group-button button flat',
            can_focus: true,
            accessible_name: _('Increase font size'),
            child: new St.Icon({icon_name: 'list-add-symbolic', icon_size: 14, y_align: CENTER}),
            y_align: CENTER,
        });
        incFontBtn.connect('clicked', () => this._adjustFont(1));
        fontBtnGroup.add_child(decFontBtn);
        fontBtnGroup.add_child(incFontBtn);
        fontRow.add_child(fontBtnGroup);
        this._drawer.add_child(fontRow);

        const prefsButton = new St.Button({
            style_class: 'scratchpad-drawer-row scratchpad-drawer-button button flat',
            can_focus: true,
            x_expand: true,
        });
        const prefsBox = new St.BoxLayout({x_expand: true, y_align: CENTER});
        prefsBox.add_child(new St.Label({
            text: _('More settings…'),
            x_expand: true,
            y_align: CENTER,
        }));
        prefsBox.add_child(new St.Icon({
            icon_name: 'go-next-symbolic',
            icon_size: 14,
            y_align: CENTER,
            style_class: 'scratchpad-row-arrow',
        }));
        prefsButton.set_child(prefsBox);
        prefsButton.connect('clicked', () => {
            this.menu.close();
            this._extension.openPreferences();
        });
        this._drawer.add_child(prefsButton);

        // Undo banner
        this._banner = new St.BoxLayout({style_class: 'scratchpad-banner', x_expand: true, visible: false});
        this._banner.add_child(new St.Label({text: _('Note cleared.'), x_expand: true, y_align: CENTER}));
        const undoButton = new St.Button({
            style_class: 'scratchpad-pill button default',
            label: _('Undo'),
            can_focus: true,
        });
        undoButton.connect('clicked', () => this._undoClear());
        this._banner.add_child(undoButton);

        // Editor
        this._entry = new St.Entry({
            style_class: 'scratchpad-editor',
            hint_text: _('Jot down a quick thought, command, or snippet…'),
            can_focus: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.START,
        });
        this._entry.connectObject(
            // StEntry rewrites the ClutterText attribute list from the CSS theme
            // whenever its style is recomputed (popup mapping, focus/hover
            // pseudo-classes, font-size/family changes), which throws away the
            // syntax attributes. Using GObject.ConnectFlags.AFTER ensures our
            // handler runs after St's default class closure (_st_set_text_from_style),
            // safely restoring the syntax highlighting attributes.
            'style-changed', () => {
                if (this._destroyed || !this._loaded)
                    return;
                this._updateFormatting();
            },
            GObject.ConnectFlags.AFTER,
            'notify::mapped', () => {
                if (!this._destroyed && this._loaded && this._entry.is_mapped())
                    this._updateFormatting();
            },
            this);
        const ct = this._entry.clutter_text;
        ct.set({
            single_line_mode: false,
            activatable: false,
            editable: false, // enabled once the pads are loaded
            line_wrap: true,
            line_wrap_mode: Pango.WrapMode.WORD_CHAR,
            ellipsize: Pango.EllipsizeMode.NONE,
            color: new Color({red: 255, green: 255, blue: 255, alpha: 255}),
        });
        ct.connect('text-changed', () => this._onTextChanged());
        ct.connect('cursor-changed', () => this._addIdle('scroll', () => this._ensureCursorVisible()));
        // GNOME 51: event signals are deprecated in favour of Clutter controllers.
        // ClutterText's own controller propagates Ctrl+… and control characters
        // (Tab), so these reach ours regardless of action order.
        this._keyController = new Clutter.KeyController();
        this._keyController.connect('key-press', () => this._onEditorKeyPress());
        ct.add_action(this._keyController);
        ct.connect('key-focus-in', () => {
            this._scroll.add_style_pseudo_class('focus');
            this._closeHistoryMenu();
            this._updateFormatting();
        });
        ct.connect('key-focus-out', () => this._scroll.remove_style_pseudo_class('focus'));

        this._viewport = new St.BoxLayout({
            orientation: VERTICAL,
            x_expand: true,
            y_expand: true,
            reactive: true,
        });
        this._viewport.add_child(this._entry);
        // Clicking the empty area below the text focuses the editor at the end.
        // The gesture only claims presses that land on the viewport itself,
        // so it never competes with ClutterText's own click gesture.
        const clickGesture = new Clutter.ClickGesture();
        clickGesture.set_recognize_on_press(true);
        clickGesture.connect('may-recognize', () => {
            const event = clickGesture.get_point_event(0);
            return global.stage.get_event_actor(event) === this._viewport;
        });
        clickGesture.connect('recognize', () => {
            this._closeHistoryMenu();
            ct.grab_key_focus();
            ct.set_cursor_position(-1);
            ct.set_selection_bound(-1);
        });
        this._viewport.add_action(clickGesture);

        this._scroll = new St.ScrollView({
            style_class: 'scratchpad-scroll',
            x_expand: true,
            y_expand: true,
            overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            child: this._viewport,
        });

        // Footer: counter, status, actions
        const footer = new St.BoxLayout({style_class: 'scratchpad-footer', x_expand: true, y_align: CENTER});

        const infoBox = new St.BoxLayout({style_class: 'scratchpad-footer-info', x_expand: true, y_align: CENTER});
        this._counterLabel = new St.Label({style_class: 'scratchpad-counter', y_align: CENTER});
        this._counterLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._statusLabel = new St.Label({style_class: 'scratchpad-status', y_align: CENTER});
        this._statusLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        infoBox.add_child(this._counterLabel);
        infoBox.add_child(new St.Label({text: ' · ', style_class: 'scratchpad-counter-sep', y_align: CENTER}));
        infoBox.add_child(this._statusLabel);

        // Keep label references for compatibility with methods modifying text
        this._saveLabel = new St.Label({text: _('Save to file'), visible: false});
        this._historyLabel = new St.Label({text: _('History'), visible: false});
        this._exportLabel = new St.Label({text: _('Export…'), visible: false});
        this._copyLabel = new St.Label({text: _('Copy all'), visible: false});

        // Group 1: File operations (Save, History, Export)
        const fileGroup = new St.BoxLayout({style_class: 'scratchpad-button-group', y_align: CENTER});

        this._saveIcon = new St.Icon({icon_name: 'document-save-symbolic', icon_size: 14, y_align: CENTER});
        this._saveButton = new St.Button({
            style_class: 'scratchpad-group-button button flat',
            can_focus: true,
            accessible_name: _('Save to file'),
            child: this._saveIcon,
            y_align: CENTER,
        });
        this._saveButton.connect('clicked', () => {
            this._closeHistoryMenu();
            this._saveToFile();
        });

        this._historyIcon = new St.Icon({icon_name: 'document-open-recent-symbolic', icon_size: 14, y_align: CENTER});
        this._historyArrow = new St.Icon({icon_name: 'pan-down-symbolic', icon_size: 9, y_align: CENTER, style_class: 'scratchpad-pill-arrow'});
        const historyBox = new St.BoxLayout({style_class: 'scratchpad-btn-content', y_align: CENTER});
        historyBox.add_child(this._historyIcon);
        historyBox.add_child(this._historyArrow);
        this._historyButton = new St.Button({
            style_class: 'scratchpad-group-button button flat',
            can_focus: true,
            accessible_name: _('History'),
            child: historyBox,
            y_align: CENTER,
        });
        this._historyButton.connect('clicked', () => this._toggleHistoryMenu());

        this._exportIcon = new St.Icon({icon_name: 'document-save-as-symbolic', icon_size: 14, y_align: CENTER});
        this._exportButton = new St.Button({
            style_class: 'scratchpad-group-button button flat',
            can_focus: true,
            accessible_name: _('Export…'),
            child: this._exportIcon,
            y_align: CENTER,
        });
        this._exportButton.connect('clicked', () => {
            this._closeHistoryMenu();
            this._exportToFile();
        });

        fileGroup.add_child(this._saveButton);
        fileGroup.add_child(this._historyButton);
        fileGroup.add_child(this._exportButton);

        // Group 2: Edit operations (Copy all, Clear)
        const editGroup = new St.BoxLayout({style_class: 'scratchpad-button-group', y_align: CENTER});

        this._copyIcon = new St.Icon({icon_name: 'edit-copy-symbolic', icon_size: 14, y_align: CENTER});
        this._copyButton = new St.Button({
            style_class: 'scratchpad-group-button button flat',
            can_focus: true,
            accessible_name: _('Copy all'),
            child: this._copyIcon,
            y_align: CENTER,
        });
        this._copyButton.connect('clicked', () => {
            this._closeHistoryMenu();
            this._copyAll();
        });

        const clearButton = new St.Button({
            style_class: 'scratchpad-group-button scratchpad-destructive button flat',
            can_focus: true,
            accessible_name: _('Clear'),
            child: new St.Icon({icon_name: 'edit-clear-all-symbolic', icon_size: 14, y_align: CENTER}),
            y_align: CENTER,
        });
        clearButton.connect('clicked', () => {
            this._closeHistoryMenu();
            this._clear();
        });

        editGroup.add_child(this._copyButton);
        editGroup.add_child(clearButton);

        // Hover hints on the status bar
        const bindHint = (btn, text) => {
            btn.connect('notify::hover', () => {
                if (btn.hover) {
                    this._statusLabel.text = text;
                    this._statusLabel.add_style_class_name('scratchpad-hint');
                } else {
                    this._statusLabel.remove_style_class_name('scratchpad-hint');
                    this._refreshStatus();
                }
            });
        };
        bindHint(this._saveButton, _('Save to file') + ' (Ctrl+Shift+S)');
        bindHint(this._historyButton, _('History') + ' (Ctrl+Shift+H)');
        bindHint(this._exportButton, _('Export…') + ' (Ctrl+Shift+E)');
        bindHint(this._copyButton, _('Copy all') + ' (Ctrl+Shift+C)');
        bindHint(clearButton, _('Clear'));
        bindHint(this._settingsButton, _('Settings'));

        const actionsBox = new St.BoxLayout({style_class: 'scratchpad-footer-actions', y_align: CENTER});
        actionsBox.add_child(fileGroup);
        actionsBox.add_child(editGroup);

        footer.add_child(infoBox);
        footer.add_child(actionsBox);

        // History dropdown menu container (positioned above footer)
        this._historyDropdownWrapper = new St.BoxLayout({
            style_class: 'scratchpad-history-dropdown-wrapper',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            visible: false,
        });

        this._historyDropdown = new St.BoxLayout({
            style_class: 'scratchpad-history-dropdown',
            orientation: VERTICAL,
        });
        this._historyDropdownWrapper.add_child(this._historyDropdown);

        this._root.add_child(header);
        this._root.add_child(this._drawer);
        this._root.add_child(this._banner);
        this._root.add_child(this._scroll);
        this._root.add_child(this._historyDropdownWrapper);
        this._root.add_child(footer);
    }

    _iconButton(iconName, accessibleName, callback) {
        const btn = new St.Button({
            style_class: 'scratchpad-icon-button button flat',
            can_focus: true,
            y_align: CENTER,
            accessible_name: accessibleName,
            child: new St.Icon({icon_name: iconName, icon_size: 16}),
        });
        btn.connect('clicked', callback);
        return btn;
    }

    _addSwitchRow(text, key) {
        const sw = new PopupMenu.Switch(this._settings.get_boolean(key));
        const box = new St.BoxLayout({x_expand: true});
        box.add_child(new St.Label({text, x_expand: true, y_align: CENTER}));
        box.add_child(sw);
        const row = new St.Button({
            style_class: 'scratchpad-drawer-row scratchpad-drawer-button',
            can_focus: true,
            x_expand: true,
            child: box,
        });
        row.connect('clicked', () => this._settings.set_boolean(key, !this._settings.get_boolean(key)));
        this._drawer.add_child(row);
        return sw;
    }

    // ---------------------------------------------------------- settings --

    _bindSettings() {
        this._settings.connectObject(
            'changed::wrap-lines', () => this._applyEditorSettings(),
            'changed::syntax-highlighting', () => this._applyEditorSettings(),
            'changed::font-size', () => this._applyEditorSettings(),
            'changed::tab-names', () => this._applyTabNames(),
            'changed::popup-width', () => this._applyPopupSize(),
            'changed::popup-height', () => this._applyPopupSize(),
            'changed::data-directory', () => this._onDataDirChanged(),
            'changed::active-tab', () => {
                const tab = clamp(this._settings.get_int('active-tab'), 0, TOTAL_PADS - 1);
                if (tab !== this._activeTab)
                    this._selectTab(tab);
            },
            this);

        // GNOME 51: honour the system-wide reduced-motion preference.
        St.Settings.get().connectObject(
            'notify::reduced-motion', () => this._applyReducedMotion(),
            this);
    }

    _applyReducedMotion() {
        const {reducedMotion} = St.Settings.get();
        if (St.ReducedMotion && reducedMotion === St.ReducedMotion.REDUCE) {
            this._root.add_style_class_name('scratchpad-reduced-motion');
            this._container?.add_style_class_name('scratchpad-reduced-motion');
        } else {
            this._root.remove_style_class_name('scratchpad-reduced-motion');
            this._container?.remove_style_class_name('scratchpad-reduced-motion');
        }
    }

    _applyTabNames() {
        const defaults = [_('Notes'), _('Snippets'), _('Scratch')];
        const custom = this._settings.get_strv('tab-names');
        this._tabButtons.forEach((btn, i) => {
            btn.label = (custom[i] ?? '').trim() || defaults[i];
            if (btn.label_actor?.clutter_text)
                btn.label_actor.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        });
        this._updateEntryStyle();
        this._updateFormatting();
        this._refreshRecentFiles();
    }

    _applyEditorSettings() {
        const wrap = this._settings.get_boolean('wrap-lines');
        const size = clamp(this._settings.get_int('font-size'), FONT_MIN, FONT_MAX);
        const syntax = this._settings.get_boolean('syntax-highlighting');

        this._entry.clutter_text.line_wrap = wrap;
        this._scroll.hscrollbar_policy = wrap ? St.PolicyType.NEVER : St.PolicyType.AUTOMATIC;
        this._wrapSwitch.state = wrap;
        if (this._syntaxSwitch)
            this._syntaxSwitch.state = syntax;
        this._fontLabel.text = fmt(_('Font size: %d pt'), size);

        this._updateEntryStyle();
        this._updateFormatting();
    }

    _isSnippetsPad(index = this._activeTab) {
        if (index === 1)
            return true;
        const custom = this._settings.get_strv('tab-names');
        const name = (custom[index] ?? '').trim().toLowerCase();
        return name === 'snippets' || name === 'kódok' || name === 'kódrészletek' ||
               name === 'kodok' || name === 'kodreszletek' || name === 'code' || name === 'codes';
    }

    _updateEntryStyle(index = this._activeTab) {
        if (!this._entry)
            return;
        const size = clamp(this._settings.get_int('font-size'), FONT_MIN, FONT_MAX);
        const isSnippets = this._isSnippetsPad(index);
        const newStyle = isSnippets
            ? `font-size: ${size}pt; font-family: monospace; color: #ffffff;`
            : `font-size: ${size}pt; color: #ffffff;`;
        if (this._entry.style !== newStyle)
            this._entry.style = newStyle;
        if (this._entry.clutter_text)
            this._entry.clutter_text.color = new Color({red: 255, green: 255, blue: 255, alpha: 255});
    }

    _updateFormatting(index = this._activeTab) {
        if (this._formatting || !this._entry?.clutter_text)
            return;
        this._formatting = true;
        try {
            const ct = this._entry.clutter_text;
            const isSnippets = this._isSnippetsPad(index);
            const enableSyntax = this._settings.get_boolean('syntax-highlighting');

            const text = ct.get_text() || this._texts[index] || '';
            const attrList = createSyntaxAttributes(text, isSnippets, enableSyntax);

            if (attrList) {
                ct.set_attributes(attrList);
                this._hasCodeSnippetAttrs = true;
            } else {
                ct.set_attributes(null);
                this._hasCodeSnippetAttrs = false;
            }
            ct.color = new Color({red: 255, green: 255, blue: 255, alpha: 255});
            ct.queue_redraw();
        } finally {
            this._formatting = false;
        }
    }

    _createResizeHandle(side) {
        const isVertical = side === 'left' || side === 'right';
        const isBottom = side === 'bottom';
        const isCornerSE = side === 'corner-se';
        const isCornerSW = side === 'corner-sw';

        const handle = new St.BoxLayout({
            style_class: `scratchpad-resize-handle scratchpad-resize-handle-${side}`,
            reactive: true,
            can_focus: false,
            x_expand: isBottom,
            y_expand: isVertical,
            x_align: isVertical ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.FILL,
            y_align: isVertical ? Clutter.ActorAlign.FILL : Clutter.ActorAlign.CENTER,
        });

        let cursorType;
        if (isVertical)
            cursorType = Clutter.CursorType.COL_RESIZE;
        else if (isBottom)
            cursorType = Clutter.CursorType.ROW_RESIZE;
        else if (isCornerSE)
            cursorType = Clutter.CursorType.NWSE_RESIZE;
        else if (isCornerSW)
            cursorType = Clutter.CursorType.NESW_RESIZE;

        handle.set_cursor_type(cursorType);

        let gripClass = null;
        let xAlign = Clutter.ActorAlign.CENTER;
        let yAlign = Clutter.ActorAlign.CENTER;

        if (isBottom) {
            gripClass = 'scratchpad-resize-grip-h';
        } else if (isCornerSE) {
            gripClass = 'scratchpad-resize-grip-corner-se';
            xAlign = Clutter.ActorAlign.END;
            yAlign = Clutter.ActorAlign.END;
        } else if (isCornerSW) {
            gripClass = 'scratchpad-resize-grip-corner-sw';
            xAlign = Clutter.ActorAlign.START;
            yAlign = Clutter.ActorAlign.END;
        }

        if (gripClass) {
            const grip = new St.Widget({
                style_class: gripClass,
                x_align: xAlign,
                y_align: yAlign,
            });
            handle.add_child(grip);
        }

        const pan = new Clutter.PanGesture();
        if (isVertical)
            pan.set_pan_axis(Clutter.PanAxis.X);
        else if (isBottom)
            pan.set_pan_axis(Clutter.PanAxis.Y);
        else
            pan.set_pan_axis(Clutter.PanAxis.BOTH);

        pan.set_begin_threshold(1);
        pan.set_max_n_points(1);

        pan.connect('recognize', () => {
            this._dragStartWidth = clamp(this._settings.get_int('popup-width'), WIDTH_MIN, WIDTH_MAX);
            this._dragStartHeight = clamp(this._settings.get_int('popup-height'), HEIGHT_MIN, HEIGHT_MAX);
            this._currentDragWidth = this._dragStartWidth;
            this._currentDragHeight = this._dragStartHeight;
            handle.add_style_pseudo_class('active');
            global.stage.set_cursor_type(cursorType);
        });

        pan.connect('pan-update', () => {
            const delta = pan.get_accumulated_delta();
            const dx = typeof delta.get_x === 'function' ? delta.get_x() : (delta.x ?? 0);
            const dy = typeof delta.get_y === 'function' ? delta.get_y() : (delta.y ?? 0);
            const maxAllowedWidth = Math.min(WIDTH_MAX, global.stage.width - 40);
            const maxAllowedHeight = Math.min(HEIGHT_MAX, global.stage.height - 100);

            let targetWidth = this._dragStartWidth;
            let targetHeight = this._dragStartHeight;

            if (side === 'left') {
                targetWidth = clamp(this._dragStartWidth - Math.round(dx), WIDTH_MIN, maxAllowedWidth);
            } else if (side === 'right') {
                targetWidth = clamp(this._dragStartWidth + Math.round(dx), WIDTH_MIN, maxAllowedWidth);
            } else if (side === 'bottom') {
                targetHeight = clamp(this._dragStartHeight + Math.round(dy), HEIGHT_MIN, maxAllowedHeight);
            } else if (side === 'corner-se') {
                targetWidth = clamp(this._dragStartWidth + Math.round(dx), WIDTH_MIN, maxAllowedWidth);
                targetHeight = clamp(this._dragStartHeight + Math.round(dy), HEIGHT_MIN, maxAllowedHeight);
            } else if (side === 'corner-sw') {
                targetWidth = clamp(this._dragStartWidth - Math.round(dx), WIDTH_MIN, maxAllowedWidth);
                targetHeight = clamp(this._dragStartHeight + Math.round(dy), HEIGHT_MIN, maxAllowedHeight);
            }

            if (targetWidth !== this._currentDragWidth || targetHeight !== this._currentDragHeight) {
                this._currentDragWidth = targetWidth;
                this._currentDragHeight = targetHeight;
                this._root.style = `width: ${targetWidth}px; height: ${targetHeight}px;`;
            }
        });

        const finishDrag = save => {
            handle.remove_style_pseudo_class('active');
            global.stage.set_cursor_type(Clutter.CursorType.DEFAULT);
            if (save) {
                if (this._currentDragWidth !== undefined && this._currentDragWidth !== this._dragStartWidth)
                    this._settings.set_int('popup-width', this._currentDragWidth);
                if (this._currentDragHeight !== undefined && this._currentDragHeight !== this._dragStartHeight)
                    this._settings.set_int('popup-height', this._currentDragHeight);
            } else {
                const w = this._dragStartWidth ?? clamp(this._settings.get_int('popup-width'), WIDTH_MIN, WIDTH_MAX);
                const h = this._dragStartHeight ?? clamp(this._settings.get_int('popup-height'), HEIGHT_MIN, HEIGHT_MAX);
                this._root.style = `width: ${w}px; height: ${h}px;`;
            }
            this._dragStartWidth = undefined;
            this._dragStartHeight = undefined;
            this._currentDragWidth = undefined;
            this._currentDragHeight = undefined;
        };

        pan.connect('end', () => finishDrag(true));
        pan.connect('cancel', () => finishDrag(false));

        handle.add_action(pan);
        return handle;
    }

    _applyPopupSize() {
        const w = clamp(this._settings.get_int('popup-width'), WIDTH_MIN, WIDTH_MAX);
        const h = clamp(this._settings.get_int('popup-height'), HEIGHT_MIN, HEIGHT_MAX);
        this._root.style = `width: ${w}px; height: ${h}px;`;
    }

    _adjustFont(delta) {
        const size = clamp(this._settings.get_int('font-size') + delta, FONT_MIN, FONT_MAX);
        this._settings.set_int('font-size', size);
    }

    // ----------------------------------------------------------- storage --

    async _openStore() {
        const ct = this._entry.clutter_text;
        this._loaded = false;
        ct.editable = false;

        const store = new PadStore(this._settings.get_string('data-directory'));
        this._store = store;
        try {
            const texts = await store.loadAll();
            if (this._destroyed || store !== this._store)
                return;
            this._texts = texts;
            this._dirty.fill(false);
            this._cursors.fill(-1);
            this._loaded = true;
            this._saveFailed = false;
            ct.editable = true;
            this._showPad(this._activeTab);
            this._migrateLegacyFiles(store.path);
            await this._refreshRecentFiles();
            store.startMonitor(() => this._onExternalChange());


        } catch (e) {
            console.error(`[Scratchpad] Failed to load pads from ${store.path}: ${e.message}`);
            if (!this._destroyed)
                this._setStatus('error');
        }
    }

    async _onDataDirChanged() {
        await this._flush();
        if (this._destroyed)
            return;
        this._store?.destroy();
        this._hideBanner();
        this._closeHistoryMenu();
        await this._openStore();
    }

    _scheduleSave() {
        this._addTimeout('save', DEBOUNCE_MS, () => this._flush());
    }

    /** Writes every dirty pad now. Safe to call during destroy. */
    _flush() {
        this._removeSource('save');
        const store = this._store;
        if (!store || !this._loaded)
            return Promise.resolve();

        const jobs = [];
        for (let i = 0; i < TOTAL_PADS; i++) {
            if (!this._dirty[i])
                continue;
            this._dirty[i] = false;
            jobs.push(store.save(i, this._texts[i]).then(() => {
                this._saveFailed = false;
            }).catch(e => {
                this._dirty[i] = true;
                this._saveFailed = true;
                console.error(`[Scratchpad] Failed to save pad ${i + 1}: ${e.message}`);
            }));
        }
        return Promise.all(jobs).then(() => {
            if (!this._destroyed)
                this._refreshStatus();
        });
    }

    async _syncFromDisk(index) {
        const store = this._store;
        if (!store || !this._loaded)
            return;
        let text;
        try {
            text = await store.loadIfModified(index);
        } catch (e) {
            console.error(`[Scratchpad] Failed to reload pad ${index + 1}: ${e.message}`);
            return;
        }
        if (this._destroyed || store !== this._store || text === null)
            return;
        // Unsaved local edits win; they will be written on the next save.
        if (this._dirty[index] || text === this._texts[index])
            return;
        this._texts[index] = text;
        if (index === this._activeTab)
            this._showPad(index, this._entry.clutter_text.get_cursor_position());
    }

    _onExternalChange() {
        for (let i = 0; i < TOTAL_PADS; i++)
            this._syncFromDisk(i);
        this._refreshRecentFiles();
    }

    // ------------------------------------------------------------ editor --

    _showPad(index, cursor = this._cursors[index]) {
        const ct = this._entry.clutter_text;
        const text = this._texts[index];

        this._updateEntryStyle(index);

        this._suppressChange = true;
        ct.set_text(text);
        this._suppressChange = false;

        this._updateFormatting(index);

        const len = charCount(text);
        const pos = cursor < 0 || cursor > len ? -1 : cursor;
        ct.set_cursor_position(pos);
        ct.set_selection_bound(pos);

        this._updateTabButtons();
        this._updateCounter();
        this._refreshStatus();
        this._addIdle('scroll', () => this._ensureCursorVisible());
    }

    _selectTab(index) {
        if (index === this._activeTab || index < 0 || index >= TOTAL_PADS)
            return;
        this._cursors[this._activeTab] = this._entry.clutter_text.get_cursor_position();
        this._flush();
        this._activeTab = index;
        if (this._settings.get_int('active-tab') !== index)
            this._settings.set_int('active-tab', index);
        this._closeHistoryMenu();
        this._showPad(index);
        this._syncFromDisk(index);
        this._refreshRecentFiles();
    }

    _updateTabButtons() {
        this._tabButtons.forEach((btn, i) => {
            btn.checked = i === this._activeTab;
        });
    }

    _onTextChanged() {
        if (this._suppressChange || !this._loaded)
            return;
        const i = this._activeTab;
        this._texts[i] = this._entry.clutter_text.get_text();
        this._dirty[i] = true;
        this._setStatus('editing');
        this._updateCounter();
        this._updateFormatting();
        this._scheduleSave();
    }

    _onEditorKeyPress() {
        const [hasKey, sym] = this._keyController.get_key();
        const [hasState, state] = this._keyController.get_state();
        if (!hasKey || !hasState)
            return Clutter.EVENT_PROPAGATE;
        const ctrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const shift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;
        const alt = (state & Clutter.ModifierType.MOD1_MASK) !== 0;
        const ct = this._entry.clutter_text;

        if (sym === Clutter.KEY_Escape && this._historyDropdownWrapper?.visible) {
            this._closeHistoryMenu();
            return Clutter.EVENT_STOP;
        }
        if (ctrl && shift && (sym === Clutter.KEY_C || sym === Clutter.KEY_c)) {
            this._copyAll();
            return Clutter.EVENT_STOP;
        }
        if (ctrl && shift && (sym === Clutter.KEY_S || sym === Clutter.KEY_s)) {
            this._saveToFile();
            return Clutter.EVENT_STOP;
        }
        if (ctrl && shift && (sym === Clutter.KEY_H || sym === Clutter.KEY_h)) {
            this._toggleHistoryMenu();
            return Clutter.EVENT_STOP;
        }
        if (ctrl && shift && (sym === Clutter.KEY_E || sym === Clutter.KEY_e)) {
            this._exportToFile();
            return Clutter.EVENT_STOP;
        }
        if (ctrl && !shift && (sym === Clutter.KEY_s || sym === Clutter.KEY_S)) {
            this._flush();
            return Clutter.EVENT_STOP;
        }
        if (ctrl && sym === Clutter.KEY_Page_Down) {
            this._selectTab((this._activeTab + 1) % TOTAL_PADS);
            return Clutter.EVENT_STOP;
        }
        if (ctrl && sym === Clutter.KEY_Page_Up) {
            this._selectTab((this._activeTab + TOTAL_PADS - 1) % TOTAL_PADS);
            return Clutter.EVENT_STOP;
        }
        if (ctrl && !shift) {
            const idx = [Clutter.KEY_1, Clutter.KEY_2, Clutter.KEY_3].indexOf(sym);
            if (idx >= 0) {
                this._selectTab(idx);
                return Clutter.EVENT_STOP;
            }
        }
        // Tab inserts a real tab character (useful for snippets).
        if (sym === Clutter.KEY_Tab && !ctrl && !shift && ct.editable) {
            ct.delete_selection();
            ct.insert_text('\t', ct.get_cursor_position());
            return Clutter.EVENT_STOP;
        }
        // Return / Enter inserts a newline character.
        const isEnter = sym === Clutter.KEY_Return ||
            sym === Clutter.KEY_KP_Enter ||
            sym === Clutter.KEY_ISO_Enter ||
            sym === Clutter.KEY_Linefeed;
        if (isEnter && !alt && ct.editable) {
            ct.delete_selection();
            ct.insert_text('\n', ct.get_cursor_position());
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _ensureCursorVisible() {
        const ct = this._entry.clutter_text;
        if (!ct.has_allocation() || !this._entry.has_allocation())
            return;
        const [ok, x, y, lineHeight] = ct.position_to_coords(ct.get_cursor_position());
        if (!ok)
            return;
        const entryBox = this._entry.get_allocation_box();
        const textBox = ct.get_allocation_box();

        const vadj = this._scroll.vadjustment;
        const top = entryBox.y1 + textBox.y1 + y;
        const bottom = top + lineHeight;
        if (top < vadj.value)
            vadj.value = top;
        else if (bottom > vadj.value + vadj.page_size)
            vadj.value = bottom - vadj.page_size;

        if (!ct.line_wrap) {
            const hadj = this._scroll.hadjustment;
            const left = entryBox.x1 + textBox.x1 + x;
            const margin = 24;
            if (left - margin < hadj.value)
                hadj.value = Math.max(0, left - margin);
            else if (left + margin > hadj.value + hadj.page_size)
                hadj.value = left + margin - hadj.page_size;
        }
    }

    _updateCounter() {
        const text = this._texts[this._activeTab];
        const trimmed = text.trim();
        const words = trimmed ? trimmed.split(/\s+/u).length : 0;
        const chars = charCount(text);
        this._counterLabel.text = `${fmt(ngettext('%d word', '%d words', words), words)} · ${
            fmt(ngettext('%d character', '%d characters', chars), chars)}`;
    }

    _refreshStatus() {
        if (this._saveFailed)
            this._setStatus('error');
        else
            this._setStatus(this._dirty[this._activeTab] ? 'editing' : 'saved');
    }

    _setStatus(kind) {
        const labels = {
            saved: _('Saved'),
            editing: _('Editing…'),
            error: _('Save failed'),
        };
        this._statusLabel.text = labels[kind];
        if (kind === 'error')
            this._statusLabel.add_style_class_name('scratchpad-error');
        else
            this._statusLabel.remove_style_class_name('scratchpad-error');
    }

    // ----------------------------------------------------------- actions --

    _copyAll() {
        const text = this._texts[this._activeTab];
        if (!text)
            return;
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);

        this._copyLabel.text = _('Copied!');
        this._copyIcon.icon_name = 'object-select-symbolic';
        this._copyButton.add_style_class_name('scratchpad-success');
        this._statusLabel.text = _('Copied!');
        this._addTimeout('copy', COPY_FEEDBACK_MS, () => {
            this._copyLabel.text = _('Copy all');
            this._copyIcon.icon_name = 'edit-copy-symbolic';
            this._copyButton.remove_style_class_name('scratchpad-success');
            this._refreshStatus();
        });
    }

    _getCategoryName(tabIndex = this._activeTab) {
        const defaults = [_('Notes'), _('Snippets'), _('Scratch')];
        const custom = this._settings.get_strv('tab-names');
        return (custom[tabIndex] ?? '').trim() || defaults[tabIndex];
    }

    _getCategoryDir(tabIndex = this._activeTab) {
        const baseDir = this._store?.path ?? expandPath(this._settings.get_string('data-directory'));
        const catName = this._getCategoryName(tabIndex);
        const sanitized = catName.replace(/[/\\?%*:|"<>`~\x00-\x1f\x7f]/g, '').trim() || `category_${tabIndex + 1}`;

        const defaultsEn = ['Notes', 'Snippets', 'Scratch'];
        const defaultsLoc = [_('Notes'), _('Snippets'), _('Scratch')];
        const candidates = [
            sanitized,
            defaultsLoc[tabIndex],
            defaultsEn[tabIndex],
            defaultsEn[tabIndex]?.toLowerCase(),
            `category_${tabIndex + 1}`,
            `pad_${tabIndex + 1}`,
        ].filter(Boolean);

        for (const name of candidates) {
            const path = GLib.build_filenamev([baseDir, name]);
            if (GLib.file_test(path, GLib.FileTest.IS_DIR))
                return path;
        }

        return GLib.build_filenamev([baseDir, sanitized]);
    }

    _migrateLegacyFiles(baseDir) {
        try {
            const dir = Gio.File.new_for_path(baseDir);
            const enumerator = dir.enumerate_children(
                'standard::name,standard::type',
                Gio.FileQueryInfoFlags.NONE,
                null
            );
            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                if (info.get_file_type() !== Gio.FileType.REGULAR)
                    continue;
                const name = info.get_name();
                if (/^pad_[1-3]\.md(\.bak)?$/.test(name))
                    continue;
                if (!name.endsWith('.md') && !name.endsWith('.txt'))
                    continue;

                const file = dir.get_child(name);
                let targetTab = 0;
                try {
                    const [ok, contents] = file.load_contents(null);
                    if (ok) {
                        const fileText = decoder.decode(contents).trim();
                        for (let t = 0; t < TOTAL_PADS; t++) {
                            if (this._texts[t]?.trim() === fileText && fileText.length > 0) {
                                targetTab = t;
                                break;
                            }
                        }
                    }
                } catch {
                    // Ignore read error
                }

                const targetDir = this._getCategoryDir(targetTab);
                GLib.mkdir_with_parents(targetDir, 0o700);
                const destFile = Gio.File.new_for_path(GLib.build_filenamev([targetDir, name]));
                file.move(destFile, Gio.FileCopyFlags.OVERWRITE, null, null);
                if (targetTab === this._activeTab)
                    this._currentFile[targetTab] = name;
            }
            enumerator.close(null);
        } catch {
            // Ignore if directory does not exist yet
        }
    }

    async _loadCategoryFiles(tabIndex = this._activeTab) {
        const catDir = this._getCategoryDir(tabIndex);
        const dir = Gio.File.new_for_path(catDir);
        try {
            const enumerator = await dir.enumerate_children_async(
                'standard::name,standard::display-name,standard::type,time::modified,time::modified-usec',
                Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_DEFAULT,
                null
            );
            const files = [];
            while (true) {
                const batch = await enumerator.next_files_async(100, GLib.PRIORITY_DEFAULT, null);
                if (!batch || batch.length === 0)
                    break;
                for (const info of batch) {
                    if (info.get_file_type() !== Gio.FileType.REGULAR)
                        continue;
                    const name = info.get_name();
                    if (name.startsWith('.') || name.endsWith('.bak'))
                        continue;
                    if (!name.endsWith('.md') && !name.endsWith('.txt'))
                        continue;

                    const dt = info.get_modification_date_time();
                    const mtime = dt ? dt.to_unix_usec() : 0;
                    files.push({
                        name,
                        displayName: name.replace(/\.(md|txt)$/i, ''),
                        mtime,
                        file: dir.get_child(name),
                    });
                }
            }
            enumerator.close(null);
            files.sort((a, b) => b.mtime - a.mtime);
            return files;
        } catch {
            return [];
        }
    }

    async _refreshRecentFiles() {
        if (this._destroyed || !this._loaded)
            return;

        const currentTab = this._activeTab;
        const allFiles = await this._loadCategoryFiles(currentTab);
        if (this._destroyed || currentTab !== this._activeTab)
            return;

        this._cachedFiles[currentTab] = allFiles;

        if (this._historyButton) {
            this._historyButton.accessible_name = allFiles.length > 0
                ? fmt(_('History (%d)'), allFiles.length)
                : _('History');
        }

        if (this._historyDropdownWrapper?.visible)
            this._renderHistoryDropdown(allFiles);
    }

    _toggleHistoryMenu() {
        if (this._historyDropdownWrapper.visible) {
            this._closeHistoryMenu();
        } else {
            this._openHistoryMenu();
        }
    }

    _openHistoryMenu() {
        if (this._settingsButton?.checked)
            this._settingsButton.checked = false;

        const files = this._cachedFiles[this._activeTab] ?? [];
        this._renderHistoryDropdown(files);
        this._historyDropdownWrapper.visible = true;
        this._historyButton.add_style_class_name('scratchpad-pill-active');
        this._historyArrow.icon_name = 'pan-up-symbolic';
    }

    _closeHistoryMenu() {
        if (!this._historyDropdownWrapper?.visible)
            return;

        this._historyDropdownWrapper.visible = false;
        this._historyButton.remove_style_class_name('scratchpad-pill-active');
        this._historyArrow.icon_name = 'pan-down-symbolic';
    }

    _renderHistoryDropdown(allFiles) {
        this._historyDropdown.destroy_all_children();

        const headerRow = new St.BoxLayout({
            style_class: 'scratchpad-history-header',
            x_expand: true,
            y_align: CENTER,
        });

        const headerIcon = new St.Icon({
            icon_name: 'document-open-recent-symbolic',
            icon_size: 14,
            style_class: 'scratchpad-history-header-icon',
            y_align: CENTER,
        });
        headerRow.add_child(headerIcon);

        const titleLabel = new St.Label({
            text: allFiles.length > 0
                ? fmt(_('History (%d)'), allFiles.length)
                : _('History'),
            style_class: 'scratchpad-history-title',
            x_expand: true,
            y_align: CENTER,
        });
        headerRow.add_child(titleLabel);

        const closeBtn = new St.Button({
            style_class: 'scratchpad-icon-button button flat',
            can_focus: true,
            accessible_name: _('Close'),
            child: new St.Icon({icon_name: 'window-close-symbolic', icon_size: 13}),
            y_align: CENTER,
        });
        closeBtn.connect('clicked', () => this._closeHistoryMenu());
        headerRow.add_child(closeBtn);

        this._historyDropdown.add_child(headerRow);

        if (allFiles.length > 0) {
            const scroll = new St.ScrollView({
                style_class: 'scratchpad-history-scroll',
                x_expand: true,
                overlay_scrollbars: true,
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
            });
            const listBox = new St.BoxLayout({
                style_class: 'scratchpad-history-list',
                orientation: VERTICAL,
                x_expand: true,
            });

            allFiles.forEach(f => {
                const isCurrent = this._currentFile[this._activeTab] === f.name;
                const row = new St.BoxLayout({
                    style_class: `scratchpad-history-row${isCurrent ? ' scratchpad-recent-active' : ''}`,
                    x_expand: true,
                    y_align: CENTER,
                });

                const fileBtn = new St.Button({
                    style_class: 'scratchpad-history-row-button button flat',
                    can_focus: true,
                    x_expand: true,
                    accessible_name: `${f.name} (${formatFileDate(f.mtime)})`,
                });
                const contentBox = new St.BoxLayout({
                    style_class: 'scratchpad-history-row-content',
                    x_expand: true,
                    y_align: CENTER,
                });
                contentBox.add_child(new St.Icon({icon_name: 'text-x-generic-symbolic', icon_size: 13, y_align: CENTER}));

                const nameLabel = new St.Label({
                    text: f.displayName,
                    style_class: 'scratchpad-history-row-name',
                    x_expand: true,
                    y_align: CENTER,
                });
                nameLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                contentBox.add_child(nameLabel);

                const dateLabel = new St.Label({
                    text: formatFileDate(f.mtime),
                    style_class: 'scratchpad-history-row-date',
                    y_align: CENTER,
                });
                contentBox.add_child(dateLabel);

                fileBtn.set_child(contentBox);
                fileBtn.connect('clicked', () => {
                    this._loadFile(f.file);
                    this._closeHistoryMenu();
                });
                row.add_child(fileBtn);

                const delBtn = new St.Button({
                    style_class: 'scratchpad-history-delete-button scratchpad-destructive button flat',
                    can_focus: true,
                    accessible_name: _('Delete file'),
                    child: new St.Icon({icon_name: 'user-trash-symbolic', icon_size: 13}),
                    y_align: CENTER,
                });
                delBtn.connect('clicked', () => this._deleteSavedFile(f.file));
                row.add_child(delBtn);

                listBox.add_child(row);
            });

            scroll.set_child(listBox);
            this._historyDropdown.add_child(scroll);
        } else {
            const emptyLabel = new St.Label({
                text: _('No saved files yet'),
                style_class: 'scratchpad-history-empty',
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: CENTER,
            });
            this._historyDropdown.add_child(emptyLabel);
        }

        const sep = new St.Widget({style_class: 'scratchpad-history-separator'});
        this._historyDropdown.add_child(sep);

        const browseBtn = new St.Button({
            style_class: 'scratchpad-history-browse-button button flat',
            can_focus: true,
            x_expand: true,
        });
        const browseBox = new St.BoxLayout({
            style_class: 'scratchpad-history-browse-content',
            x_expand: true,
            y_align: CENTER,
        });
        browseBox.add_child(new St.Icon({icon_name: 'document-open-symbolic', icon_size: 13, y_align: CENTER}));
        browseBox.add_child(new St.Label({
            text: _('Browse other files…'),
            style_class: 'scratchpad-history-browse-label',
            y_align: CENTER,
        }));
        browseBtn.set_child(browseBox);
        browseBtn.connect('clicked', () => {
            this._closeHistoryMenu();
            this._openFileDialog();
        });
        this._historyDropdown.add_child(browseBtn);
    }

    async _loadFile(file) {
        if (!file)
            return;
        try {
            await this._flush();
            const [contents] = await file.load_contents_async(null);
            const text = decoder.decode(contents);

            this._suppressChange = true;
            this._entry.clutter_text.set_text(text);
            this._suppressChange = false;

            this._texts[this._activeTab] = text;
            this._currentFile[this._activeTab] = file.get_basename();
            this._dirty[this._activeTab] = true;

            this._updateFormatting();
            this._updateCounter();
            this._scheduleSave();

            Main.notify(_('Scratchpad'), fmt(_('Loaded “%s”'), file.get_basename()));
            await this._refreshRecentFiles();
            this._entry.clutter_text.grab_key_focus();
        } catch (e) {
            console.error(`[Scratchpad] Failed to load note from file: ${e.message}`);
            Main.notifyError(_('Scratchpad'), fmt(_('Failed to load file: %s'), e.message));
        }
    }

    async _deleteSavedFile(file) {
        const basename = file.get_basename();
        try {
            try {
                await file.trash_async(GLib.PRIORITY_DEFAULT, null);
            } catch {
                await file.delete_async(GLib.PRIORITY_DEFAULT, null);
            }
            if (this._currentFile[this._activeTab] === basename)
                this._currentFile[this._activeTab] = null;

            Main.notify(_('Scratchpad'), fmt(_('“%s” deleted'), basename));
            await this._refreshRecentFiles();
        } catch (e) {
            console.error(`[Scratchpad] Failed to delete file: ${e.message}`);
            Main.notifyError(_('Scratchpad'), fmt(_('Failed to delete file: %s'), e.message));
        }
    }

    async _openFileDialog() {
        const catDir = this._getCategoryDir(this._activeTab);
        this.menu.close();

        const chosenPath = await this._openFilePortal(catDir);
        if (!chosenPath)
            return;

        const file = Gio.File.new_for_path(chosenPath);
        await this._loadFile(file);
    }

    _openFilePortal(catDir) {
        return new Promise(resolve => {
            try {
                const bus = Gio.DBus.session;
                const filters = [
                    [_('Markdown files (*.md)'), [[0, '*.md']]],
                    [_('Text files (*.txt)'), [[0, '*.txt']]],
                    [_('All files'), [[0, '*']]],
                ];
                const options = {
                    handle_token: new GLib.Variant('s', `scratchpad_open_${Date.now()}`),
                    multiple: new GLib.Variant('b', false),
                    filters: new GLib.Variant('a(sa(us))', filters),
                };
                if (catDir)
                    options.current_folder = new GLib.Variant('ay', [...encoder.encode(catDir), 0]);

                bus.call(
                    'org.freedesktop.portal.Desktop',
                    '/org/freedesktop/portal/desktop',
                    'org.freedesktop.portal.FileChooser',
                    'OpenFile',
                    new GLib.Variant('(ssa{sv})', ['', _('Load Note from File'), options]),
                    new GLib.VariantType('(o)'),
                    Gio.DBusCallFlags.NONE,
                    -1,
                    null,
                    (b, res) => {
                        try {
                            const reply = b.call_finish(res);
                            const [handlePath] = reply.recursiveUnpack();
                            const signalId = bus.signal_subscribe(
                                'org.freedesktop.portal.Desktop',
                                'org.freedesktop.portal.Request',
                                'Response',
                                handlePath,
                                null,
                                Gio.DBusSignalFlags.NO_MATCH_RULE,
                                (_conn, _sender, _path, _iface, _signal, parameters) => {
                                    bus.signal_unsubscribe(signalId);
                                    const [response, results] = parameters.recursiveUnpack();
                                    if (response === 0 && results?.uris?.length > 0) {
                                        const uri = results.uris[0];
                                        const file = Gio.File.new_for_uri(uri);
                                        resolve(file.get_path());
                                    } else {
                                        resolve(null);
                                    }
                                }
                            );
                        } catch {
                            resolve(null);
                        }
                    }
                );
            } catch {
                resolve(null);
            }
        });
    }

    async _saveToFile() {
        const text = this._texts[this._activeTab];
        if (!text || !text.trim())
            return;

        const tabName = this._getCategoryName(this._activeTab);
        const catDir = this._getCategoryDir(this._activeTab);

        try {
            if (GLib.mkdir_with_parents(catDir, 0o700) !== 0)
                throw new Error(`Cannot create directory ${catDir}`);

            const current = this._currentFile[this._activeTab];
            const filename = current || defaultFilenameForNote(text, tabName);
            const fullPath = GLib.build_filenamev([catDir, filename]);
            const file = Gio.File.new_for_path(fullPath);
            const bytes = new GLib.Bytes(encoder.encode(text));
            await file.replace_contents_bytes_async(
                bytes,
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );

            this._currentFile[this._activeTab] = filename;

            this._saveLabel.text = _('Saved!');
            this._saveIcon.icon_name = 'object-select-symbolic';
            this._saveButton.add_style_class_name('scratchpad-success');
            this._statusLabel.text = _('Saved!');
            this._addTimeout('saveFile', COPY_FEEDBACK_MS, () => {
                this._saveLabel.text = _('Save to file');
                this._saveIcon.icon_name = 'document-save-symbolic';
                this._saveButton.remove_style_class_name('scratchpad-success');
                this._refreshStatus();
            });

            Main.notify(_('Scratchpad'), fmt(_('Saved to “%s”'), file.get_basename()));
            await this._refreshRecentFiles();
        } catch (e) {
            console.error(`[Scratchpad] Failed to save note to file: ${e.message}`);
            Main.notifyError(_('Scratchpad'), fmt(_('Failed to save file: %s'), e.message));
        }
    }

    async _exportToFile() {
        const text = this._texts[this._activeTab];
        if (!text || !text.trim())
            return;

        const defaults = [_('Notes'), _('Snippets'), _('Scratch')];
        const custom = this._settings.get_strv('tab-names');
        const tabName = (custom[this._activeTab] ?? '').trim() || defaults[this._activeTab];

        const defaultFilename = defaultFilenameForNote(text, tabName);
        const configuredDir = this._settings.get_string('data-directory').trim();
        let startDir;
        if (configuredDir) {
            startDir = expandPath(configuredDir);
        } else {
            startDir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOCUMENTS) || GLib.get_home_dir();
        }
        const defaultPath = GLib.build_filenamev([startDir, defaultFilename]);

        this.menu.close();

        let chosenPath = await this._pickFilePortal(defaultFilename, startDir);
        if (!chosenPath)
            return;

        if (!chosenPath.includes('.') && !chosenPath.endsWith('.md'))
            chosenPath += '.md';

        try {
            const file = Gio.File.new_for_path(chosenPath);
            const bytes = new GLib.Bytes(encoder.encode(text));
            await file.replace_contents_bytes_async(
                bytes,
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );

            this._exportLabel.text = _('Exported!');
            this._exportIcon.icon_name = 'object-select-symbolic';
            this._exportButton.add_style_class_name('scratchpad-success');
            this._statusLabel.text = _('Exported!');
            this._addTimeout('exportFile', COPY_FEEDBACK_MS, () => {
                this._exportLabel.text = _('Export…');
                this._exportIcon.icon_name = 'document-save-as-symbolic';
                this._exportButton.remove_style_class_name('scratchpad-success');
                this._refreshStatus();
            });

            Main.notify(_('Scratchpad'), fmt(_('Exported to “%s”'), file.get_basename()));
        } catch (e) {
            console.error(`[Scratchpad] Failed to export note to file: ${e.message}`);
            Main.notifyError(_('Scratchpad'), fmt(_('Failed to export file: %s'), e.message));
        }
    }

    _pickFilePortal(defaultFilename, startDir) {
        return new Promise(resolve => {
            try {
                const bus = Gio.DBus.session;
                const filters = [
                    [_('Markdown files (*.md)'), [[0, '*.md']]],
                    [_('Text files (*.txt)'), [[0, '*.txt']]],
                    [_('All files'), [[0, '*']]],
                ];
                const options = {
                    handle_token: new GLib.Variant('s', `scratchpad_save_${Date.now()}`),
                    current_name: new GLib.Variant('s', defaultFilename),
                    filters: new GLib.Variant('a(sa(us))', filters),
                };
                if (startDir)
                    options.current_folder = new GLib.Variant('ay', [...encoder.encode(startDir), 0]);

                bus.call(
                    'org.freedesktop.portal.Desktop',
                    '/org/freedesktop/portal/desktop',
                    'org.freedesktop.portal.FileChooser',
                    'SaveFile',
                    new GLib.Variant('(ssa{sv})', ['', _('Export Note to File'), options]),
                    new GLib.VariantType('(o)'),
                    Gio.DBusCallFlags.NONE,
                    -1,
                    null,
                    (b, res) => {
                        try {
                            const reply = b.call_finish(res);
                            const [handlePath] = reply.recursiveUnpack();
                            const signalId = bus.signal_subscribe(
                                'org.freedesktop.portal.Desktop',
                                'org.freedesktop.portal.Request',
                                'Response',
                                handlePath,
                                null,
                                Gio.DBusSignalFlags.NO_MATCH_RULE,
                                (_conn, _sender, _path, _iface, _signal, parameters) => {
                                    bus.signal_unsubscribe(signalId);
                                    const [response, results] = parameters.recursiveUnpack();
                                    if (response === 0 && results?.uris?.length > 0) {
                                        const uri = results.uris[0];
                                        const file = Gio.File.new_for_uri(uri);
                                        resolve(file.get_path());
                                    } else {
                                        resolve(null);
                                    }
                                }
                            );
                        } catch (e) {
                            console.error(`[Scratchpad] Portal SaveFile finish error: ${e.message}`);
                            resolve(null);
                        }
                    }
                );
            } catch (e) {
                console.error(`[Scratchpad] Portal SaveFile error: ${e.message}`);
                resolve(null);
            }
        });
    }

    _clear() {
        const index = this._activeTab;
        const previous = this._texts[index];
        if (!previous || !this._loaded)
            return;

        this._store.backup(index, previous).catch(e =>
            console.error(`[Scratchpad] Failed to back up pad ${index + 1}: ${e.message}`));

        this._undo = {index, text: previous, file: this._currentFile[index]};
        this._currentFile[index] = null;
        this._entry.clutter_text.set_text(''); // marks the pad dirty
        this._flush();

        this._banner.show();
        this._addTimeout('undo', UNDO_BANNER_MS, () => this._hideBanner());
        this._refreshRecentFiles();
        this._entry.clutter_text.grab_key_focus();
    }

    _undoClear() {
        if (!this._undo)
            return;
        const {index, text, file} = this._undo;
        this._hideBanner();

        this._texts[index] = text;
        this._dirty[index] = true;
        this._currentFile[index] = file ?? null;
        if (index === this._activeTab)
            this._showPad(index, -1);
        this._flush();
        this._refreshRecentFiles();
        this._entry.clutter_text.grab_key_focus();
    }

    _hideBanner() {
        this._removeSource('undo');
        this._undo = null;
        this._banner.hide();
    }

    _onOpenStateChanged(_menu, open) {
        const ct = this._entry.clutter_text;
        if (open) {
            this._updateEntryStyle(this._activeTab);
            if (this._loaded)
                this._showPad(this._activeTab);
            this._syncFromDisk(this._activeTab);
            this._refreshRecentFiles();
            this._addIdle('focus', () => {
                ct.grab_key_focus();
                this._ensureCursorVisible();
                this._updateFormatting(this._activeTab);
            });
            this._addIdle('format', () => {
                if (!this._destroyed && this._loaded)
                    this._updateFormatting(this._activeTab);
            });
        } else {
            this._removeSource('focus');
            this._removeSource('format');
            global.stage.set_cursor_type(Clutter.CursorType.DEFAULT);
            this._cursors[this._activeTab] = ct.get_cursor_position();
            this._settingsButton.checked = false;
            this._closeHistoryMenu();
            this._flush();
        }
    }

    // ----------------------------------------------------- main-loop glue --

    _addTimeout(name, ms, callback) {
        this._removeSource(name);
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._sources.delete(name);
            callback();
            return GLib.SOURCE_REMOVE;
        });
        this._sources.set(name, id);
    }

    _addIdle(name, callback) {
        this._removeSource(name);
        const id = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._sources.delete(name);
            callback();
            return GLib.SOURCE_REMOVE;
        });
        this._sources.set(name, id);
    }

    _removeSource(name) {
        const id = this._sources.get(name);
        if (id) {
            GLib.source_remove(id);
            this._sources.delete(name);
        }
    }

    _onDestroy() {
        global.stage.set_cursor_type(Clutter.CursorType.DEFAULT);
        this._destroyed = true;
        for (const id of this._sources.values())
            GLib.source_remove(id);
        this._sources.clear();

        this._entry?.clutter_text?.disconnectObject(this);
        this._entry?.disconnectObject(this);
        this._settings?.disconnectObject(this);
        this.menu?.box?.disconnectObject(this);

        // Persist pending edits; the writes finish in the background.
        this._flush();
        this._store?.destroy();
        setRefreshCallback(null);

        super._onDestroy();
    }
});
