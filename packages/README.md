# Előre csomagolt verziók / Pre-packaged Releases

Ebben a mappában a Scratchpad kiterjesztés készre csomagolt, közvetlenül letölthető és telepíthető változatai találhatók.  
In this folder you can find the pre-built, ready-to-install packages for Scratchpad.

---

## 1. GNOME Shell kiterjesztés (Általános ZIP / All Linux distros)

- **Fájl / File:** [`scratchpad@gavnir.shell-extension.zip`](scratchpad@gavnir.shell-extension.zip)

### Telepítés / Installation:
```sh
gnome-extensions install --force scratchpad@gavnir.shell-extension.zip
```

Ezután jelentkezz ki és vissza (Wayland) vagy indítsd újra a Shell-t (`Alt+F2` → `r`), majd engedélyezd:
```sh
gnome-extensions enable scratchpad@gavnir
```

---

## 2. Arch Linux Pacman csomag (Rendszerszintű / System-wide)

- **Fájl / File:** [`gnome-shell-extension-scratchpad-1.0.0-1-any.pkg.tar.zst`](gnome-shell-extension-scratchpad-1.0.0-1-any.pkg.tar.zst)

### Telepítés / Installation:
```sh
sudo pacman -U gnome-shell-extension-scratchpad-1.0.0-1-any.pkg.tar.zst
gnome-extensions enable scratchpad@gavnir
```
