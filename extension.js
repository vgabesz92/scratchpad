// SPDX-License-Identifier: GPL-3.0-only
//
// Scratchpad — Minimalist quick notes in the GNOME top bar.

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {ScratchpadIndicator} from './indicator.js';

const POSITIONS = ['left', 'center', 'right'];

export default class ScratchpadExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        this._indicator = new ScratchpadIndicator(this, this._settings);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, this._position());

        this._applyIndicatorVisibility();

        this._settings.connectObject(
            'changed::panel-position', () => this._moveIndicator(),
            'changed::show-indicator', () => this._applyIndicatorVisibility(),
            this);

        Main.wm.addKeybinding(
            'toggle-shortcut',
            this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => this._indicator?.menu.toggle());
    }

    disable() {
        Main.wm.removeKeybinding('toggle-shortcut');
        this._settings?.disconnectObject(this);

        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }

    _position() {
        const pos = this._settings.get_string('panel-position');
        return POSITIONS.includes(pos) ? pos : 'right';
    }

    // Moving the existing actor (instead of re-creating the indicator) keeps
    // the in-memory buffers and any in-flight writes intact.
    _moveIndicator() {
        const boxes = {
            left: Main.panel._leftBox,
            center: Main.panel._centerBox,
            right: Main.panel._rightBox,
        };
        const container = this._indicator.container;
        container.get_parent()?.remove_child(container);
        boxes[this._position()].insert_child_at_index(container, 0);
    }

    _applyIndicatorVisibility() {
        if (!this._indicator)
            return;
        this._indicator.visible = this._settings.get_boolean('show-indicator');
    }
}
