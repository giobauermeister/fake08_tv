# FAKE-08 for Samsung TVs

This is a side/hobby project. I wanted a way to easily play PICO8 games on my TV. Many things are made with AI here.

A cart player for Samsung Tizen TVs: it plays `.p8` and `.p8.png` carts made
for PICO-8 with a Bluetooth gamepad. It is built on
[FAKE-08](https://github.com/jtothebell/fake-08), an independent player,
compiled to WebAssembly and packaged as a Tizen web app (`.wgt`).

FAKE-08 and this port are not affiliated with or endorsed by Lexaloffle Games.
PICO-8 is a trademark of Lexaloffle Games.

The app ships without games; see [Add games](#add-games).

## Authors and licences

| Part | Author | Licence |
|---|---|---|
| The TV app: the launcher and settings ([app/](app/)), the web platform layer for FAKE-08 ([src/web_host.cpp](src/web_host.cpp)), the cart server ([tools/](tools/)) and the build | Giovanni Bauermeister | MIT, [LICENSE](LICENSE) |
| The emulator core: [FAKE-08](https://github.com/jtothebell/fake-08) and its Lua, [z8lua](https://github.com/jtothebell/z8lua), used as a git submodule from the forks [giobauermeister/fake-08](https://github.com/giobauermeister/fake-08) and [giobauermeister/z8lua](https://github.com/giobauermeister/z8lua) (branch `tv-patches`: upstream plus 20 compatibility and speed patches, listed in `TV-PATCHES.md` there) | Jon Bell and contributors; the patches by Giovanni Bauermeister | MIT, `LICENSE.MD` in the submodule |
| Code FAKE-08 includes (Lua, LodePNG, …) and the Emscripten runtime | see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) | MIT, zlib and others |

The `.wgt` carries `LICENSE`, `LICENSE-FAKE-08.md` and
`THIRD-PARTY-NOTICES.md`.

Neither the app nor this repository contains any games. Carts belong to their
authors, and many carts on the Lexaloffle BBS are CC BY-NC-SA 4.0, so check a
cart's licence before you share it.

## Install on your TV

You need a Samsung TV from 2017 or later, a PC on the same network for the
first step, and a Bluetooth gamepad paired with the TV.

1. **Enable developer mode.** On the TV, open **Apps**, enter `12345` with the
   remote, switch **Developer mode** to **On** and enter your PC's IP address as
   **Host PC IP**. Press OK, then restart the TV: hold the power button until
   the Samsung logo appears.
2. **Install TizenBrew Installer.** Run
   [TizenBrew Installer Desktop](https://github.com/reisxd/TizenBrewInstaller/releases/latest)
   on the PC, connect to the TV and choose **Install TizenBrew Installer**.
3. **Point developer mode at the TV itself.** Open the developer mode popup
   again (Apps, `12345`), set **Host PC IP** to `127.0.0.1`, and restart the TV
   the same way. The TizenBrew Installer app on the TV can now install apps by
   itself.
4. **Sign in with a Samsung account.** Open TizenBrew Installer on the TV. On
   Tizen 7 or later (2022 and newer TVs) it asks you to sign in to a Samsung
   account, with a QR code, to create a Samsung certificate for your TV.
5. **Install FAKE-08.** Choose **Install from GitHub** and enter
   `giobauermeister/fake08_tv`. The app appears in the TV's apps as FAKE-08-TV.

The Samsung certificate that TizenBrew Installer signs the app with **lasts one
year**. Install the app again the same way before it expires, or it stops
starting. The same step installs a new version.

On 2017–2021 TVs (Tizen 3 to 6) TizenBrew Installer needs no Samsung account and
installs the release as it is. There, a new version installs only after you
**uninstall** the old one, which also resets the app's settings and the games'
saved data.

## Add games

In every case one folder is one game, and the folder name is the title shown
in the launcher:

```
PICO8/
├── Celeste/15133.p8.png                  the cart the launcher starts
└── Into Ruins/
    ├── intoruins-7.p8.png
    └── carts/intoruins_main-7.p8.png     companions loaded by the game with load(), not listed
```

- **USB drive:** put the `PICO8/` folder at the root of the drive and plug it
  into the TV. `FAKE08/` works too.
- **TV Documents:** put the same `PICO8/` folder in the TV's own Documents
  folder.
- **A PC on the same network:** run the cart server from this repository on
  the PC, then on the TV press Home on the launcher, choose **PC with carts**
  and type the address it prints:

  ```sh
  python3 tools/cart_server.py ~/my-carts      # same layout, without the PICO8/ level
  ```

The launcher starts the first `.p8.png` in a game's folder, or else the first
`.p8`, and uses the `.p8.png` image itself as the cover. Keep multi-cart games'
original file names: `load("#intoruins")` resolves through the starting cart's
file name. Until any games are found, the launcher explains these options.

## Controls

| | Bluetooth gamepad (W3C standard mapping) | Keyboard (desktop) | TV remote |
|---|---|---|---|
| Move | D-pad or left stick | arrows | – |
| 🅾️ (O: jump in Celeste) | B or Y | Z, C, N | – |
| ❎ (X: dash in Celeste) | A or X | X, V, M | – |
| Pause menu (continue / reset cart / exit to menu) | Home (b16) | Enter, P, Esc | Return |
| Leave the cart immediately | hold Home for 1.5 s | – | – |
| Launcher: choose / play | D-pad / A | arrows / Enter | – |
| Launcher: settings (pad layout, jump button, screen size, PC address, USB rescan) | Home | S | – |
| Launcher: exit the app | – | Esc | Return |

Other buttons do nothing. The remote is only needed for Return, and for
typing the PC address.

The TV's web engine only starts audio after a key press, and gamepad buttons
don't count: if a game is silent, press any key on the remote once.

To add another menu button, put its number (shown in the launcher header, or in
the stats overlay) in `MENU_BUTTONS` in
[app/main.js](app/main.js).

**Settings** (Home on the launcher) are a list: **▲ ▼** choose a row,
**◀ ▶** pick the left or right option, and **any face button** flips the
selected row, so the dialog works whatever the pad layout is set to. Changes
apply immediately and are remembered.

| Row | Options |
|---|---|
| Pad layout | **Nintendo** (A = b1, B = b0, X = b3, Y = b2), the default, which some pads send even in Xbox mode; or **Standard** (A = b0, B = b1, X = b2, Y = b3) for other pads. The line under it shows which number and letter the button you hold gives ("b1 = A"). |
| Jump button 🅾️ | **B / Y** (A / X press ❎), the default; or **A / X** |
| Screen size | **Fill height** or **Pixel-perfect 8×**, see below |
| Stats overlay | on / off switch for the FPS and timing overlay; off by default |
| PC with carts | a face button (or the remote's OK) opens the TV keyboard; OK saves, Return stops editing |
| Close | closes the dialog; so do Home and the remote's Return |

The address field is not focused when the dialog opens, so the TV keyboard
only appears when you choose that row. The launcher always starts a cart with
A, as the pad layout defines it.

**Screen size:** by default a game fills the screen height (1080 px, an 8.44×
scale). Choose Pixel-perfect 8× in the settings instead (1024 px, with
28 px bars at the top and bottom). Fill mode uses "sharp bilinear" scaling in
the WebGL shader: nearest-neighbour up to 8×, then a linear blend only across
the last fraction. Pixels stay crisp and evenly sized, where plain
nearest-neighbour at 8.44× would mix 8 and 9 px wide pixels that shimmer when
scrolling. At a whole multiple the shader is exactly nearest-neighbour.

## Stats overlay

While a cart runs, the black margin on the left shows, per second:

| Line | Meaning |
|---|---|
| `display` | how often the browser runs the loop, normally the TV's refresh rate |
| `cart` | frames the cart actually ran / its target. FAKE-08 steps at 60 even for 30 fps carts, which skip every other step. `late` counts loop runs that ended behind schedule |
| `lua` | average and worst time in the cart's Lua (`Vm::Step`), without the pad read |
| `draw` | palette conversion + WebGL upload and draw |
| `audio` | synthesis + Web Audio scheduling, per loop |
| `pad read` | `navigator.getGamepads()` |
| `worst gap` | longest time between two loop runs; above about 34 ms, frames were dropped |
| `pad` | the gamepad's mapping and the raw buttons and axes held right now |

A cart runs at full speed while `lua + draw + audio + pad read` stays under
16.7 ms. The overlay is off by default; turn it on with the Stats overlay switch
in the settings.

## Where carts come from

The launcher shows carts from three places in one grid, each marked with a
badge:

| Source | Layout | Updates |
|---|---|---|
| **PC on the LAN** (badge PC) | any folder shared by `tools/cart_server.py`, one subfolder per game | automatic, polled every 3 s; a running PC cart restarts when its files change |
| **USB drive** (badge USB) | `PICO8/<Game>/…` (or `FAKE08/`) at the root of the drive | when a drive is plugged in or removed, when the settings open, and when the app comes back to the front |
| **TV Documents** (badge TV) | `PICO8/<Game>/…` in the TV's Documents folder | when the settings open and when the app comes back to the front |

### PC on the LAN

```sh
make serve-carts CARTS_DIR=~/my-carts          # shares ~/my-carts on port 8808
python3 tools/cart_server.py ~/my-carts        # the same, without make
```

The server prints the address to use. On the TV, press Home on the launcher,
choose the PC row, press A (or the remote's OK), type the address on the TV
keyboard, and press OK. Leave it empty to go back to the build default. A
`make wgt` build defaults to the address of the PC it was built on (see
[Build from source](#build-from-source)); the published release has none. The
TV downloads the carts into memory at start-up and when they change; nothing
is written to the TV. Editing a cart on the PC while it runs on the TV
restarts it, which is handy when developing a cart.

The server only answers `GET /index.json` (the list of `.p8`/`.p8.png` files
with their modification times) and `GET /files/<path>` for those files.
Anything else, including paths outside the folder, gets a 404.

### USB drive and TV Documents

Put a `PICO8/` folder (or `FAKE08/`) at the root of a USB stick, such as the
memory card in a USB reader, or in the TV's own **Documents**
folder. The app reads both with Tizen's filesystem API, which needs the
`http://tizen.org/privilege/filesystem.read` privilege in `config.xml`:

- **USB:** `tizen.filesystem.listStorages()`, taking every storage that is
  `EXTERNAL` or labelled `removable…` (such as `removable_sda1`) and not
  `REMOVED`. Each drive is read with
  `resolve` → `listFiles` → `openStream`/`readBytes`.
- **TV Documents:** `resolve('documents')`, the same way. These carts get a
  green **TV** badge. How files get there depends on the TV: its file manager
  may or may not copy from a USB stick into Documents.

Both are rescanned at start-up, whenever the settings dialog opens, and when
the app comes back to the front; USB also when a drive is plugged in or
removed. The header and the settings show one status line each, such as
"USB: 1 games" or "TV Documents: no PICO8 folder".

## Build from source

The core is a git submodule, so clone recursively:

```sh
git clone --recursive https://github.com/giobauermeister/fake08_tv.git
# or, in an existing clone:
git submodule update --init --recursive
```

You also need [Emscripten](https://emscripten.org/) (emsdk) and, to package,
the `tz` tool from the Tizen extension for VS Code (the Makefile uses `tz` from
`PATH`, or the extension's default install location; override with `TZ=`).

```sh
source ~/emsdk/emsdk_env.sh
make -j$(nproc)      # -> app/fake08.js (~0.9 MB: the engine, wasm inlined)
make serve           # desktop test at http://localhost:8000
make wgt             # + tz build / tz pack with the active profile -> FAKE-08-TV.wgt
make release TZ_PROFILE=<profile>   # -> release/FAKE-08-TV.wgt, signed locally
make serve-carts CARTS_DIR=<folder> # share carts with the TV, see above
```

- `make` and `make wgt` bake this PC's LAN address into `app/settings.js`
  (`PC_URL=` overrides it), so a TV with that build finds
  `http://<this PC>:8808` without any typing. Install `FAKE-08-TV.wgt` from the
  Tizen extension, or with `tz install` once `sdb` sees the TV.
- `make release` builds from a staged copy of `app/` with **no** PC address
  (`make release-stage`) and signs it with the security profile `TZ_PROFILE`,
  then prints which certificates signed it. `tz` quietly signs with the
  *active* profile whatever profile it is told to use, so the target switches
  the active profile for the build and switches it back afterwards. Published
  releases come from the workflow below instead.
- `FAKE08_DIR` (default `third_party/fake-08`, the submodule) builds against
  another FAKE-08 tree, such as a local clone of the fork.

### Releasing

Releases are built by GitHub Actions
([.github/workflows/release.yml](.github/workflows/release.yml)). Set the new
version in `app/config.xml`, commit, and push a matching tag:

```sh
git tag v1.0.1 && git push origin v1.0.1
```

The workflow builds the app, signs it and attaches `FAKE-08-TV.wgt` to a GitHub
release for that tag, the one file TizenBrew Installer looks for. It signs with
an author certificate created for that run and the Tizen SDK's public
distributor certificate, so the repository holds no keys or passwords:

- On 2022+ TVs TizenBrew Installer replaces the signature with the user's own
  Samsung certificate, so the key doesn't matter.
- 2017–2021 TVs install the package as it is. Every release has a new author
  key, so updating there means uninstalling first (see
  [Install on your TV](#install-on-your-tv)).

A copy installed from a `make wgt` build, signed with your own Samsung
certificate, is not updated by a release either: uninstall it first, which also
clears its settings and `cartdata()` saves.

### The core

The submodule is the `tv-patches` branch of
[giobauermeister/fake-08](https://github.com/giobauermeister/fake-08), whose
`libs/z8lua` is the `tv-patches` branch of
[giobauermeister/z8lua](https://github.com/giobauermeister/z8lua). Each branch
is upstream at a pinned commit plus one commit per patch; `TV-PATCHES.md` in
the fake-08 fork explains every patch and how to rebase them. They are
compatibility fixes and interpreter speed-ups; the build turns the speed-ups on
(`PICO8_TLINE_FAST`, `PICO8_VM_HOT_CALLS`, `PICO8_VM_MEMORY_SUPEROPS`,
`PICO8_VM_FIELD_CACHE`, `-fwrapv`). Only FAKE-08's `source/` (minus `main.cpp`
and `hostCommonFunctions.cpp`), `libs/z8lua` and `libs/lodepng` are compiled;
its `platform/`, `test/` and `carts/` are not used.

## How it works

| Piece | Implementation ([src/web_host.cpp](src/web_host.cpp), [app/main.js](app/main.js), [app/sources.js](app/sources.js)) |
|---|---|
| Frontend | an HTML launcher; the core runs as an "external frontend", so FAKE-08's own BIOS cart never appears |
| Loop | the browser's frame callback calls `Vm::Step()` at the cart's rate (up to 4 catch-up steps per callback), then one `drawFrame()` |
| Video | palette → 128×128 RGBA → WebGL texture, drawn into a canvas already at the final size (1080 px, sharp bilinear; or 1024 px at 8×); every `poke(0x5f2c)` draw mode. Without WebGL a cart stops with an error |
| Audio | the 22050 Hz synth, 60–120 ms queued as Web Audio buffers, topped up in chunks of at least 40 ms |
| Input | Gamepad API + keyboard + remote Return, merged in JS |
| `cartdata()` | `localStorage` |
| Carts | PC, USB and TV Documents carts copied into Emscripten's in-memory file system at `/pc`, `/usb` and `/tv`; none are built in |

Every cart gets a fresh `Vm`, because FAKE-08 never resets its Lua state
between carts. "Exit to menu", holding Home, or a cart error returns to the
launcher, and an error is shown there. The hold-to-exit is only flagged from
the input callback and handled between frames, because that callback runs
inside `Vm::Step()`.
