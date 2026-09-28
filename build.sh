#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
#
#   ./build.sh pack       build dist/<uuid>.shell-extension.zip
#   ./build.sh install    pack + install for the current user
#   ./build.sh pacman     build Arch Linux pacman package (.pkg.tar.zst)
#   ./build.sh uninstall  remove the user install (notes are kept)
#   ./build.sh pot        regenerate the translation template
#   ./build.sh nested     start a devkit GNOME Shell for testing
set -euo pipefail
cd "$(dirname "$0")"

UUID="scratchpad@gavnir"
ZIP="dist/${UUID}.shell-extension.zip"

pack() {
    mkdir -p dist packages
    gnome-extensions pack --force \
        --podir=po \
        --schema=schemas/org.gnome.shell.extensions.scratchpad.gschema.xml \
        --extra-source=indicator.js \
        --extra-source=storage.js \
        --extra-source=syntax.js \
        --extra-source=languages \
        --extra-source=icons \
        --extra-source=LICENSE \
        --out-dir=dist .
    cp -f "${ZIP}" packages/
    echo "Built ${ZIP} (and copied to packages/)"
}

case "${1:-pack}" in
    pack)
        pack ;;
    install)
        pack
        gnome-extensions install --force "${ZIP}"
        echo
        echo "Installed. On Wayland, log out and back in, then run:"
        echo "  gnome-extensions enable ${UUID}"
        ;;
    uninstall)
        gnome-extensions uninstall "${UUID}" || true
        echo "Removed. Notes in ~/.local/share/gnome-scratchpad were kept." ;;
    pot)
        xgettext --from-code=UTF-8 --language=JavaScript \
            --keyword=_ --keyword=ngettext:1,2 \
            --package-name=scratchpad \
            --output="po/${UUID}.pot" \
            extension.js indicator.js prefs.js storage.js syntax.js
        for po in po/*.po; do msgmerge --update --backup=none "$po" "po/${UUID}.pot"; done ;;
    pacman)
        mkdir -p dist packages
        (cd packaging/arch && makepkg -f)
        cp -f packaging/arch/*.pkg.tar.zst dist/
        cp -f packaging/arch/*.pkg.tar.zst packages/
        echo "Built package in dist/ and packages/"
        ;;
    nested)
        # GNOME 49+ replaced --nested with the devkit viewer.
        dbus-run-session gnome-shell --devkit --wayland ;;
    *)
        echo "usage: $0 {pack|install|pacman|uninstall|pot|nested}" >&2
        exit 1 ;;
esac
