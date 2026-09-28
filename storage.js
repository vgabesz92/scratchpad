// SPDX-License-Identifier: GPL-3.0-only
//
// Plain-Markdown pad storage:
//   <dir>/pad_1.md, pad_2.md, pad_3.md   (+ pad_N.md.bak before a clear)
//
// Writes go through Gio.File.replace_contents: GLib writes a temporary file
// next to the target, fsyncs it and atomically renames it over the original,
// keeping the original's permissions. Symlinks are resolved first so a
// symlinked pad (e.g. into a Syncthing/Git folder) stays a symlink.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');
Gio._promisify(Gio.File.prototype, 'query_info_async');

export const TOTAL_PADS = 3;
const MONITOR_DEBOUNCE_MS = 300;
const PAD_NAME_RE = /^pad_[1-3]\.md$/;

const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

export function defaultDataDir() {
    return GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-scratchpad']);
}

export function expandPath(path) {
    const trimmed = (path ?? '').trim();
    if (!trimmed)
        return defaultDataDir();
    if (trimmed === '~')
        return GLib.get_home_dir();
    if (trimmed.startsWith('~/'))
        return GLib.build_filenamev([GLib.get_home_dir(), trimmed.slice(2)]);
    return trimmed;
}

function isNotFound(e) {
    return e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND);
}

async function resolveSymlinks(file) {
    let current = file;
    for (let hop = 0; hop < 16; hop++) {
        let info;
        try {
            info = await current.query_info_async(
                'standard::is-symlink,standard::symlink-target',
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                GLib.PRIORITY_DEFAULT, null);
        } catch (e) {
            if (isNotFound(e))
                return current;
            throw e;
        }
        if (!info.get_is_symlink())
            return current;
        const target = info.get_symlink_target();
        current = GLib.path_is_absolute(target)
            ? Gio.File.new_for_path(target)
            : current.get_parent().resolve_relative_path(target);
    }
    return current;
}

export class PadStore {
    constructor(dirPath) {
        this._dir = Gio.File.new_for_path(expandPath(dirPath));
        this._mtimes = new Array(TOTAL_PADS).fill(null);
        this._queues = Array.from({length: TOTAL_PADS}, () => Promise.resolve());
        this._monitor = null;
        this._monitorTimeoutId = 0;
    }

    get path() {
        return this._dir.get_path();
    }

    padFile(index) {
        return this._dir.get_child(`pad_${index + 1}.md`);
    }

    backupFile(index) {
        return this._dir.get_child(`pad_${index + 1}.md.bak`);
    }

    _ensureDir() {
        // Notes may be private: create the directory as 0700.
        if (GLib.mkdir_with_parents(this.path, 0o700) !== 0)
            throw new Error(`Cannot create notes directory ${this.path}`);
    }

    async _mtime(file) {
        try {
            const info = await file.query_info_async(
                'time::modified,time::modified-usec',
                Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null);
            const dt = info.get_modification_date_time();
            return dt ? dt.to_unix_usec() : null;
        } catch (e) {
            if (isNotFound(e))
                return null;
            throw e;
        }
    }

    async _write(file, text) {
        this._ensureDir();
        const target = await resolveSymlinks(file);
        const bytes = new GLib.Bytes(encoder.encode(text));
        await target.replace_contents_bytes_async(
            bytes, null, false, Gio.FileCreateFlags.NONE, null);
    }

    async load(index) {
        const file = this.padFile(index);
        try {
            const [contents] = await file.load_contents_async(null);
            this._mtimes[index] = await this._mtime(file);
            return decoder.decode(contents);
        } catch (e) {
            if (isNotFound(e)) {
                this._mtimes[index] = null;
                return '';
            }
            throw e;
        }
    }

    async loadAll() {
        this._ensureDir();
        const texts = [];
        for (let i = 0; i < TOTAL_PADS; i++)
            texts.push(await this.load(i));
        return texts;
    }

    /**
     * Returns the pad content if the file changed on disk since we last read
     * or wrote it, otherwise null.
     */
    async loadIfModified(index) {
        await this._queues[index].catch(() => {});
        const mtime = await this._mtime(this.padFile(index));
        if (mtime === null)
            return null;
        const last = this._mtimes[index];
        if (last !== null && mtime <= last)
            return null;
        return this.load(index);
    }

    /** Serialised per pad, so a slow write never lands after a newer one. */
    save(index, text) {
        const job = this._queues[index]
            .catch(() => {})
            .then(async () => {
                const file = this.padFile(index);
                await this._write(file, text);
                this._mtimes[index] = await this._mtime(file);
            });
        this._queues[index] = job;
        return job;
    }

    async backup(index, text) {
        if (text)
            await this._write(this.backupFile(index), text);
    }

    startMonitor(onChange) {
        this.stopMonitor();
        try {
            this._monitor = this._dir.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
        } catch (e) {
            console.warn(`[Scratchpad] Cannot monitor ${this.path}: ${e.message}`);
            return;
        }
        this._monitor.connect('changed', (_m, file, otherFile) => {
            const names = [file?.get_basename(), otherFile?.get_basename()];
            if (!names.some(n => n && (PAD_NAME_RE.test(n) || n.endsWith('.md') || n.endsWith('.txt'))))
                return;
            if (this._monitorTimeoutId)
                GLib.source_remove(this._monitorTimeoutId);
            this._monitorTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, MONITOR_DEBOUNCE_MS, () => {
                this._monitorTimeoutId = 0;
                onChange();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    stopMonitor() {
        if (this._monitorTimeoutId) {
            GLib.source_remove(this._monitorTimeoutId);
            this._monitorTimeoutId = 0;
        }
        if (this._monitor) {
            this._monitor.cancel();
            this._monitor = null;
        }
    }

    /** Stops monitoring. Queued writes still complete in the background. */
    destroy() {
        this.stopMonitor();
    }
}
