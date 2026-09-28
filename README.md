# Scratchpad for GNOME Shell

* [Magyar leírás](#magyar)
* [English description](#english)

---

<a name="magyar"></a>
# Scratchpad GNOME Shell kiterjesztés

Minimalista gyorsjegyzet-kezelő a GNOME felső paneljén.

Támogatott GNOME Shell verzió: **50**, **51**.

## Funkciók

- **Három független jegyzetlap (Pad)** — Jegyzetek (*Notes*), Töredékek (*Snippets*), Piszkozat (*Scratch*) – egyedileg átnevezhető lapok.
- **Tiszta Markdown fájlformátum** — `pad_1.md`, `pad_2.md`, `pad_3.md` a `~/.local/share/gnome-scratchpad/` könyvtárban (testreszabható tárolási mappa). Bármilyen szövegszerkesztővel szerkeszthető, könnyen szinkronizálható Syncthing, Git vagy Nextcloud segítségével.
- **Összeomlásbiztos, atomi mentések** — Átmeneti fájl → fsync → atomi átnevezés a `Gio.File.replace_contents` segítségével; a fájljogosultságok és szimbolikus linkek megmaradnak. A mentések laponként sorba vannak állítva, így egy régebbi mentés sosem írhat felül egy újabbat.
- **Automatikus mentés késleltetéssel (Debounced auto-save)** — 400 ms a gépelés befejezése után, azonnal lapváltáskor, a felugró ablak bezárásakor, `Ctrl+S` lenyomásakor, a kiterjesztés letiltásakor vagy a képernyő zárolásakor.
- **Valós idejű külső szinkronizáció** — `Gio.FileMonitor` figyeli a jegyzetek mappáját, a módosítási idő (mtime) pedig ellenőrzésre kerül a fül megnyitásakor vagy lapváltáskor. A mentetlen helyi szerkesztések mindig elsőbbséget élveznek.
- **Szintaxiskiemelés** — 21 programozási és jelölőnyelv automatikus felismerése és színezése (Markdown, Python, Bash, JavaScript, TypeScript, C, C++, C#, Java, Go, Rust, PHP, SQL, HTML, CSS, JSON, YAML, TOML, Dockerfile, Diff).
- **Fájlba mentés és kategória mappák** — Jegyzetek exportálása és mentése kategória almappákba (`Notes/`, `Snippets/`, `Scratch/` vagy egyedi nevek).
- **Legutóbbi fájlok és gyors betöltés** — A kategóriák utolsó 5 mentett fájlja megjelenik egy gyorsgomb-sávban az 1-kattintásos betöltéshez. Több mint 5 fájl esetén a „Betöltés…” gomb egy fiókot nyit meg az összes fájl listájával, dátumokkal és törlési lehetőséggel, valamint natív fájlválasztó portállal.
- **Biztonságos törlés visszavonással** — Törlés előtt automatikusan biztonsági mentést készít (`pad_N.md.bak`), majd 5 másodpercig megjelenít egy visszavonási sávot.
- **Szó- és karakterszámláló**, valamint valós idejű mentési állapotjelző.
- **Beállítások fiók** — Sortörés (word wrap), betűméret-állítás (10–24 pt), szintaxiskiemelés ki/bekapcsolása; monospaced betűtípus a kódrészletekhez.
- **GNOME integráció** — Globális gyorsbillentyű (alapértelmezett: `Super+Alt+N`), panelpozíció (bal / közép / jobb), egérrel átméretezhető szélesség (300–1200 px), Libadwaita beállítóablak, a rendszer kiemelőszínéhez (accent color) igazodó felület.
- **Csökkentett mozgás támogatása** — Követi a GNOME 51 rendszerbeállításait.
- **Többnyelvűség** — Magyar, Angol, Török fordítás.

## Gyorsbillentyűk

| Gyorsbillentyű            | Művelet                                         |
| ------------------------- | ----------------------------------------------- |
| `Super+Alt+N` (globális)  | Felugró ablak megnyitása / bezárása            |
| `Escape`                  | Ablak bezárása és mentetlen szerkesztések mentése |
| `Ctrl+Shift+C`            | Aktív jegyzet teljes szövegének másolása       |
| `Ctrl+Shift+S`            | Aktív jegyzet mentése fájlba…                  |
| `Ctrl+S`                  | Azonnali mentés                                 |
| `Ctrl+1` / `Ctrl+2` / `Ctrl+3` | Váltás az 1. / 2. / 3. jegyzetlapra        |
| `Ctrl+PgUp` / `Ctrl+PgDn` | Előző / következő jegyzetlap                   |
| `Tab`                     | Tabulátor karakter beszúrása                   |

## Telepítés

### Felhasználói telepítés

```sh
./build.sh install
# Wayland esetén jelentkezz ki, majd be, ezt követően:
gnome-extensions enable scratchpad@vgabesz92.github.io
```

### Arch Linux (rendszerszintű csomag / Pacman)

```sh
# Pacman csomag építése:
./build.sh pacman

# Telepítés pacman segítségével:
sudo pacman -U dist/gnome-shell-extension-scratchpad-1.0.0-1-any.pkg.tar.zst

# Vagy közvetlenül a makepkg-vel:
cd packaging/arch
makepkg -si
```

## Fejlesztés

```sh
./build.sh nested                            # devkit GNOME Shell indítása (Wayland)
journalctl -f -o cat /usr/bin/gnome-shell    # naplóbejegyzések megtekintése
./build.sh pot                               # fordítási sablon frissítése és .po fájlok összefésülése
```

## GNOME 50 és 51 megjegyzések

- A beviteli események kezelése Clutter vezérlőkkel (`Clutter.KeyController`, `Clutter.ClickGesture`) történik az elavult `key-press-event` / `button-press-event` helyett.
- Az elrendezések az `orientation` tulajdonságot használják (a `vertical` megszűnt a GNOME 51-ben).
- A `disable()` szinkron lefutású; a folyamatban lévő lemezműveletek a háttérben fejeződnek be.

## Fájlstruktúra

```
extension.js   életciklus, gyorsbillentyű-kezelés, panel elhelyezés
indicator.js   panel gomb + felugró felület, szerkesztő logika
storage.js     atomi fájltárolás, mtime követés, könyvtárfigyelő
prefs.js       libadwaita beállítóablak
syntax.js      szintaxiskiemelő motor
languages/     nyelvi definíciók (21 nyelv)
stylesheet.css stíluslap
schemas/       GSettings sémafájlok
po/            fordítások (.po és .pot)
packaging/     arch pacman PKGBUILD és telepítő
```

---

<a name="english"></a>
# Scratchpad for GNOME Shell

Minimalist quick notes in the GNOME top bar.

Supports GNOME Shell **50** and **51**.

## Features

- **Three pads** — Notes, Snippets, Scratch (names customizable).
- **Plain Markdown storage** — `pad_1.md`, `pad_2.md`, `pad_3.md` in
  `~/.local/share/gnome-scratchpad/` (configurable). Editable with any tool,
  syncable with Syncthing / Git / Nextcloud.
- **Crash-resilient atomic writes** — temp file → fsync → atomic rename via
  `Gio.File.replace_contents`; file permissions and symlinks are preserved.
  Writes are serialized per pad, so an older save can never land after a newer one.
- **Debounced auto-save** — 400 ms after typing stops, immediately on tab switch,
  popup close, `Ctrl+S`, extension disable or screen lock.
- **Live external sync** — a `Gio.FileMonitor` watches the notes directory, and
  the mtime is re-checked on popup open / tab switch. Unsaved local edits always win.
- **Syntax highlighting** — automatic detection and highlighting for 21 programming and markup languages (Markdown, Python, Bash, JavaScript, TypeScript, C, C++, C#, Java, Go, Rust, PHP, SQL, HTML, CSS, JSON, YAML, TOML, Dockerfile, Diff).
- **Save to file & category folders** — saves notes into category subfolders (`Notes/`, `Snippets/`, `Scratch/` or custom names).
- **Recent saved files & quick loading** — when a category has saved files, the last 5 are listed in a pill bar for instant 1-click loading. If more than 5 exist, a "Load…" option opens a drawer listing all files with dates and deletion options, plus a native file chooser.
- **Non-destructive clear** — writes `pad_N.md.bak` first, then shows a 5-second
  undo banner.
- **Word & character counter**, save status indicator.
- **Settings drawer** — word wrap, font size stepper (10–24 pt), syntax highlighting toggle; automatic monospace font for code snippets and the snippets pad.
- **GNOME integration** — global toggle shortcut (default `Super+Alt+N`),
  panel position (left / center / right), mouse-draggable resizable width (300–1200 px),
  adjustable popup size, accent-color aware styling, libadwaita preferences window,
  and native GTK4/GNOME look and feel.
- **Reduced motion** — follows the GNOME 51 system setting.
- **Translations** — English, Hungarian, Turkish.

## Keyboard shortcuts

| Shortcut                  | Action                                          |
| ------------------------- | ----------------------------------------------- |
| `Super+Alt+N` (global)    | Open / close the popup                          |
| `Escape`                  | Close the popup and flush unsaved edits         |
| `Ctrl+Shift+C`            | Copy the whole active pad                       |
| `Ctrl+Shift+S`            | Save active pad to file…                        |
| `Ctrl+S`                  | Save now                                        |
| `Ctrl+1` / `Ctrl+2` / `Ctrl+3` | Switch to pad 1 / 2 / 3                    |
| `Ctrl+PgUp` / `Ctrl+PgDn` | Previous / next pad                             |
| `Tab`                     | Insert a tab character                          |

## Installation

### User install

```sh
./build.sh install
# Wayland: log out and back in, then
gnome-extensions enable scratchpad@vgabesz92.github.io
```

### Arch Linux (system-wide / Pacman)

```sh
# Build pacman package:
./build.sh pacman

# Install using pacman:
sudo pacman -U dist/gnome-shell-extension-scratchpad-1.0.0-1-any.pkg.tar.zst

# Or directly with makepkg:
cd packaging/arch
makepkg -si
```

## Development

```sh
./build.sh nested                            # devkit GNOME Shell (Wayland)
journalctl -f -o cat /usr/bin/gnome-shell    # logs
./build.sh pot                               # refresh translation template and merge .po files
```

## GNOME 50 & 51 notes

- Input handling uses Clutter controllers (`Clutter.KeyController`,
  `Clutter.ClickGesture`) instead of the deprecated `key-press-event` /
  `button-press-event` signals.
- Layouts use `orientation` (the `vertical` property was removed in 51).
- `disable()` is synchronous; pending writes finish in the background.

## Layout

```
extension.js   lifecycle, keybinding, panel placement
indicator.js   panel button + popup UI, editor logic
storage.js     atomic pad storage, mtime tracking, directory monitor
prefs.js       libadwaita preferences
syntax.js      syntax highlighting engine
languages/     language tokenizers (21 languages)
stylesheet.css styling
schemas/       GSettings schema
po/            translations (.po and .pot)
packaging/     arch pacman PKGBUILD and install script
```

## License

GPL-3.0-only.
