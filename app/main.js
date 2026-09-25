/* FAKE-08 on a Samsung TV: the launcher, input and audio start-up around
   fake08.js (built from ../src/web_host.cpp). ES5 on purpose.

   The Bluetooth gamepad is the controller. The remote is only needed for
   Return: pause menu in a game, exit on the launcher (a Samsung requirement).
   A keyboard works too, for testing on a desktop. The app ships without
   carts: they come from a PC on the LAN (/pc), USB drives (/usb) and the TV's
   Documents folder (/tv); see sources.js. */
(function () {
  'use strict';

  // PICO-8 button bits, as FAKE-08's hostVmShared.h defines them.
  var P8_LEFT = 1, P8_RIGHT = 2, P8_UP = 4, P8_DOWN = 8, P8_O = 16, P8_X = 32, P8_PAUSE = 64;

  // W3C "standard" gamepad mapping. If your pad reports other indices, the
  // stats overlay (and the launcher header) show which buttons it sends.
  var PAD = {
    up: 12, down: 13, left: 14, right: 15,
    stickX: 0, stickY: 1, stickDeadZone: 0.5
  };
  // Face buttons by the letters printed on the pad. The standard mapping sends
  // A=b0, B=b1, X=b2, Y=b3, but some pads reach the TV in Nintendo order
  // (A=b1, B=b0, X=b3, Y=b2); an AceGamer pad in Xbox mode does on a Q60D.
  // The "pad layout" setting picks one; the launcher starts a cart with A.
  // Default: Nintendo order, which is what the AceGamer pad sends (its A is b1).
  // A new key, so an older saved choice doesn't override the default.
  var LAYOUT_KEY = 'fake08.padLayout.v2';
  var padLayout = 'nintendo';
  try { padLayout = localStorage.getItem(LAYOUT_KEY) === 'standard' ? 'standard' : 'nintendo'; } catch (e) { /* no storage */ }
  function face() { return padLayout === 'nintendo' ? { a: 1, b: 0, x: 3, y: 2 } : { a: 0, b: 1, x: 2, y: 3 }; }
  // Buttons that open the pause menu in a game (hold to leave the cart) and
  // the settings on the launcher: Home (b16). The AceGamer's L1 is not b4, so
  // it isn't listed; add its number (shown in the overlay) here to use it.
  var MENU_BUTTONS = [16];
  var HOLD_TO_EXIT_MS = 1500;
  var PC_URL_KEY = 'fake08.pcUrl';
  // Which pair presses 🅾️ (O: jump in Celeste) in games. Default B/Y; the
  // settings dialog can switch it to A/X.
  var SCREEN_KEY = 'fake08.screen';
  var screenMode = 'fill';
  try { screenMode = localStorage.getItem(SCREEN_KEY) === 'pixel' ? 'pixel' : 'fill'; } catch (e) { /* no storage */ }
  var JUMP_KEY = 'fake08.oButtons';
  var oOnB = true;
  try { oOnB = localStorage.getItem(JUMP_KEY) !== 'AX'; } catch (e) { /* no storage */ }
  var STATS_KEY = 'fake08.stats';
  var SHOW_STATS = false;   // off unless switched on in the settings
  try { SHOW_STATS = localStorage.getItem(STATS_KEY) === 'on'; } catch (e) { /* no storage */ }

  var KEY_RETURN = 10009;
  var KEYS = {           // keyboard -> PICO-8 bit (the usual PICO-8 keys)
    37: P8_LEFT, 39: P8_RIGHT, 38: P8_UP, 40: P8_DOWN,
    90: P8_O, 67: P8_O, 78: P8_O,          // Z C N
    88: P8_X, 86: P8_X, 77: P8_X,          // X V M
    13: P8_PAUSE, 80: P8_PAUSE, 27: P8_PAUSE, // Enter P Escape
    10009: P8_PAUSE                         // remote Return
  };

  var launcher = document.getElementById('launcher');
  var grid = document.getElementById('grid');
  var canvas = document.getElementById('canvas');
  var status = document.getElementById('status');
  var padLabel = document.getElementById('pad');
  var sourcesLabel = document.getElementById('sources');
  var message = document.getElementById('message');
  var empty = document.getElementById('empty');
  var dialog = document.getElementById('dialog');
  var pcInput = document.getElementById('pcurl');

  var stats = document.getElementById('stats');
  var carts = [], focus = 0, playing = false, ready = false, current = '', dialogOpen = false;
  var lastLaunchA = true, lastDialogFace = [true, true, true, true];
  var keyMask = 0, lastPadMask = 0, padRepeatAt = 0, menuHeldSince = 0;
  var statsText = '', padText = '', padTextAt = 0, pendingGrid = false;

  function showStatus(text) { status.textContent = text; status.className = text ? '' : 'hidden'; }

  if (typeof WebAssembly !== 'object') {
    showStatus('This TV\'s web engine has no WebAssembly support.');
    return;
  }

  function exitApp() {
    try {
      if (window.tizen && window.tizen.application) {
        window.tizen.application.getCurrentApplication().exit();
      }
    } catch (e) { /* not on a TV */ }
  }

  // ---------------------------------------------------------------- input

  function firstPad() {
    var pads;
    try { pads = navigator.getGamepads ? navigator.getGamepads() : []; } catch (e) { pads = []; }
    for (var i = 0; i < (pads ? pads.length : 0); i++) {
      if (pads[i] && pads[i].connected !== false) { return pads[i]; }
    }
    return null;
  }

  function pressed(pad, index) {
    var b = pad.buttons[index];
    return !!b && (b.pressed || b.value > 0.5);
  }

  function anyPressed(pad, list) {
    for (var i = 0; i < list.length; i++) { if (pressed(pad, list[i])) { return true; } }
    return false;
  }

  function menuButtonPressed(pad) { return !!pad && anyPressed(pad, MENU_BUTTONS); }

  // "b0 b5 a1:-0.98": raw indices currently pressed, for mapping a new pad.
  function rawPadState(pad) {
    if (!pad) { return 'no gamepad'; }
    var parts = [];
    for (var i = 0; i < pad.buttons.length; i++) { if (pressed(pad, i)) { parts.push('b' + i); } }
    for (var a = 0; a < pad.axes.length; a++) {
      if (Math.abs(pad.axes[a]) > 0.5) { parts.push('a' + a + ':' + pad.axes[a].toFixed(2)); }
    }
    return (pad.mapping || 'no mapping') + ' | ' + (parts.join(' ') || '-');
  }

  function padMask(pad) {
    if (!pad) { return 0; }
    var f = face();
    var oButtons = oOnB ? [f.b, f.y] : [f.a, f.x];
    var xButtons = oOnB ? [f.a, f.x] : [f.b, f.y];
    var m = 0, x = pad.axes[PAD.stickX] || 0, y = pad.axes[PAD.stickY] || 0;
    if (pressed(pad, PAD.left) || x < -PAD.stickDeadZone) { m |= P8_LEFT; }
    if (pressed(pad, PAD.right) || x > PAD.stickDeadZone) { m |= P8_RIGHT; }
    if (pressed(pad, PAD.up) || y < -PAD.stickDeadZone) { m |= P8_UP; }
    if (pressed(pad, PAD.down) || y > PAD.stickDeadZone) { m |= P8_DOWN; }
    if (anyPressed(pad, oButtons)) { m |= P8_O; }
    if (anyPressed(pad, xButtons)) { m |= P8_X; }
    if (menuButtonPressed(pad)) { m |= P8_PAUSE; }
    return m;
  }

  // Called by the C host on every scanInput(): fresh Gamepad objects each time.
  function inputMask() {
    var pad = firstPad(), now = Date.now();
    if (SHOW_STATS && now - padTextAt > 100) { padTextAt = now; padText = rawPadState(pad); drawStats(); }
    if (pad && menuButtonPressed(pad)) {
      if (!menuHeldSince) { menuHeldSince = now; }
      if (now - menuHeldSince >= HOLD_TO_EXIT_MS) {
        Module.p8ExitRequest = true;   // handled by the C loop between frames
        return 0;
      }
    } else {
      menuHeldSince = 0;
    }
    return keyMask | padMask(pad);
  }

  // ---------------------------------------------------------------- stats

  function onStats(s) {
    statsText =
      'display  ' + s.loops + ' Hz\n' +
      'cart     ' + s.steps + ' / ' + s.target + ' fps' + (s.behind ? '  (late ' + s.behind + ')' : '') + '\n' +
      'lua      ' + s.step.toFixed(1) + ' ms  max ' + s.stepMax.toFixed(1) + '\n' +
      'draw     ' + s.draw.toFixed(2) + ' ms\n' +
      'audio    ' + s.audio.toFixed(2) + ' ms\n' +
      'pad read ' + s.input.toFixed(2) + ' ms\n' +
      'worst gap ' + s.gapMax.toFixed(0) + ' ms';
    drawStats();
  }

  function drawStats() {
    stats.textContent = statsText + '\n\npad  ' + padText;
  }

  document.addEventListener('keydown', function (e) {
    unlockAudio();
    var k = e.keyCode;
    if (playing) {
      if (KEYS[k]) { e.preventDefault(); keyMask |= KEYS[k]; }
      return;
    }
    if (dialogOpen) {
      var editing = document.activeElement === pcInput;
      var ok = k === 13 || k === 65376;                               // Enter / OK, IME Done
      var back = k === KEY_RETURN || k === 27 || k === 65385;         // Return, Esc, IME Cancel
      if (editing && ok) { e.preventDefault(); savePcUrl(); pcInput.blur(); }
      else if (editing && back) { e.preventDefault(); pcInput.blur(); }
      else if (!editing && ok) { e.preventDefault(); activateRow(); }
      else if (!editing && back) { e.preventDefault(); closeDialog(); }
      else if (!editing && (k === 38 || k === 40)) { e.preventDefault(); selectRow(k === 38 ? -1 : 1); }
      else if (!editing && (k === 37 || k === 39)) { e.preventDefault(); changeRow(k === 37 ? -1 : 1); }
      return;
    }
    if (k === 83) { e.preventDefault(); openDialog(); return; }                    // S on a keyboard
    if (k === KEY_RETURN || k === 27) { e.preventDefault(); exitApp(); return; }
    if (k >= 37 && k <= 40) { e.preventDefault(); moveFocus(k === 37 ? -1 : k === 39 ? 1 : 0, k === 38 ? -1 : k === 40 ? 1 : 0); }
    if (k === 13) { e.preventDefault(); launch(focus); }
  });
  document.addEventListener('keyup', function (e) {
    if (KEYS[e.keyCode]) { keyMask &= ~KEYS[e.keyCode]; }
  });
  window.addEventListener('blur', function () { keyMask = 0; });
  document.addEventListener('mousedown', unlockAudio);

  // ---------------------------------------------------------------- audio

  // Browsers start audio only after a user gesture; a key press counts, a
  // gamepad button does not. Until then the C side drops the samples.
  function unlockAudio() {
    var A = window.AudioContext || window.webkitAudioContext;
    if (!A) { return; }
    try {
      if (!Module.p8Audio) { Module.p8Audio = { ctx: new A(), next: 0 }; }
      if (Module.p8Audio.ctx.state !== 'running') { Module.p8Audio.ctx.resume(); }
    } catch (e) { /* no audio */ }
  }

  // ---------------------------------------------------------------- launcher

  var SOURCES = [{ root: '/pc', badge: 'PC' }, { root: '/usb', badge: 'USB' }, { root: '/tv', badge: 'TV' }];
  var coverUrls = {};

  // One entry per game folder: the first .p8.png in it, else the first .p8.
  function findCarts() {
    var FS = Module.FS, list = [];
    SOURCES.forEach(function (src) {
      var dirs;
      try { dirs = FS.readdir(src.root); } catch (e) { return; }
      dirs.forEach(function (dir) {
        if (dir === '.' || dir === '..') { return; }
        var path = src.root + '/' + dir, files;
        try { files = FS.readdir(path); } catch (e) { return; }
        var pick = null;
        files.forEach(function (f) { if (!pick && /\.p8\.png$/i.test(f)) { pick = f; } });
        files.forEach(function (f) { if (!pick && /\.p8$/i.test(f)) { pick = f; } });
        if (pick) { list.push({ title: dir, path: path + '/' + pick, badge: src.badge }); }
      });
    });
    list.sort(function (a, b) {
      var ta = a.title.toLowerCase(), tb = b.title.toLowerCase();
      return ta < tb ? -1 : ta > tb ? 1 : (a.badge < b.badge ? -1 : 1);
    });
    return list;
  }

  function coverUrl(path) {
    var st;
    try { st = Module.FS.stat(path); } catch (e) { return ''; }
    var key = path + '@' + st.mtime + ':' + st.size;
    if (!coverUrls[key]) {
      coverUrls[key] = URL.createObjectURL(new Blob([Module.FS.readFile(path)], { type: 'image/png' }));
    }
    return coverUrls[key];
  }

  // Rebuilds the grid, keeping the focus on the same cart when it still exists.
  function buildGrid() {
    var focusedPath = carts[focus] ? carts[focus].path : '';
    carts = findCarts();
    grid.textContent = '';
    var newFocus = 0;
    carts.forEach(function (c, i) {
      if (c.path === focusedPath) { newFocus = i; }
      var tile = document.createElement('div'), label = document.createElement('span'), img;
      tile.className = 'cart';
      if (/\.png$/i.test(c.path)) {
        img = document.createElement('img');
        img.src = coverUrl(c.path);
        img.alt = '';
      } else {
        img = document.createElement('div');       // .p8 text carts have no label image
        img.className = 'nolabel';
        img.textContent = c.title;
      }
      label.textContent = c.title;
      var badge = document.createElement('em');
      badge.textContent = c.badge;
      if (c.badge === 'TV') { badge.className = 'tv'; }
      tile.appendChild(img);
      tile.appendChild(label);
      tile.appendChild(badge);
      tile.addEventListener('click', function () { unlockAudio(); launch(i); });
      grid.appendChild(tile);
    });
    // No carts yet: explain where they come from instead of an empty grid.
    grid.className = carts.length ? '' : 'hidden';
    empty.className = carts.length ? 'hidden' : '';
    setFocus(newFocus);
  }

  function showSources() {
    // One line only, so the header (and the grid under it) never changes
    // height.
    var local = CartSources.usb.status + '  ·  ' + CartSources.tv.status;
    var text = CartSources.pc.status + '  ·  ' + local;
    if (sourcesLabel.textContent !== text) { sourcesLabel.textContent = text; }
    var el = document.getElementById('usbstate');
    if (el.textContent !== local) { el.textContent = local; }
  }

  // ---------------------------------------------------------------- PC address

  function defaultPcUrl() { return (window.FAKE08_CONFIG && window.FAKE08_CONFIG.pcUrl) || ''; }

  function savedPcUrl() {
    try { return localStorage.getItem(PC_URL_KEY) || ''; } catch (e) { return ''; }
  }

  // "b1 = A": the face buttons held now, with the letter the current layout gives them.
  function faceReadout(pad) {
    if (!pad) { return 'no gamepad'; }
    var f = face(), names = {}, parts = [];
    names[f.a] = 'A'; names[f.b] = 'B'; names[f.x] = 'X'; names[f.y] = 'Y';
    for (var b = 0; b < 4; b++) { if (pressed(pad, b)) { parts.push('b' + b + ' = ' + names[b]); } }
    return parts.join(', ') || 'press A to check';
  }

  // ---------------------------------------------------------------- settings
  //
  // A list of rows: ▲ ▼ choose, ◀ ▶ pick the left/right option, any face button
  // flips the selected row (so it works whatever the pad layout is set to).

  function store(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* no storage */ } }

  var SETTINGS = {
    layout: { values: ['nintendo', 'standard'], get: function () { return padLayout; },
              set: function (v) { padLayout = v; store(LAYOUT_KEY, v); } },
    jump:   { values: ['BY', 'AX'], get: function () { return oOnB ? 'BY' : 'AX'; },
              set: function (v) { oOnB = v === 'BY'; store(JUMP_KEY, v); } },
    screen: { values: ['fill', 'pixel'], get: function () { return screenMode; },
              set: function (v) { screenMode = v; store(SCREEN_KEY, v); } },
    stats:  { values: ['off', 'on'], get: function () { return SHOW_STATS ? 'on' : 'off'; },
              set: function (v) { SHOW_STATS = v === 'on'; store(STATS_KEY, v); } }
  };
  var ROWS = ['layout', 'jump', 'screen', 'stats', 'pc', 'close'];
  var selectedRow = 0;

  function renderSettings() {
    var rows = dialog.querySelectorAll('.row');
    for (var i = 0; i < rows.length; i++) {
      var name = rows[i].getAttribute('data-row'), setting = SETTINGS[name];
      rows[i].className = 'row' + (name === ROWS[selectedRow] ? ' sel' : '');
      if (!setting) { continue; }
      var opts = rows[i].querySelectorAll('[data-v]');
      for (var o = 0; o < opts.length; o++) {
        opts[o].className = opts[o].getAttribute('data-v') === setting.get() ? 'on' : '';
      }
      var sw = rows[i].querySelector('.switch');
      if (sw) { sw.className = 'switch' + (setting.get() === 'on' ? ' on' : ''); }
    }
  }

  function selectRow(delta) {
    selectedRow = Math.max(0, Math.min(ROWS.length - 1, selectedRow + delta));
    renderSettings();
  }

  // dir: -1 left option, +1 right option, 0 flip.
  function changeRow(dir) {
    var setting = SETTINGS[ROWS[selectedRow]];
    if (!setting) { return; }
    var cur = setting.values.indexOf(setting.get());
    setting.set(setting.values[dir < 0 ? 0 : dir > 0 ? 1 : 1 - cur]);
    renderSettings();
  }

  // A face button (or the remote's OK) on the selected row.
  function activateRow() {
    var row = ROWS[selectedRow];
    if (row === 'close') { closeDialog(); }
    else if (row === 'pc') { pcInput.focus(); }   // brings up the TV keyboard
    else { changeRow(0); }
  }

  function openDialog() {
    dialogOpen = true;
    CartSources.scanLocal();
    pcInput.value = CartSources.pc.url || savedPcUrl() || defaultPcUrl();
    document.getElementById('pcdefault').textContent = defaultPcUrl() || 'none';
    selectedRow = 0;
    renderSettings();
    lastDialogFace = [true, true, true, true];   // ignore face buttons already held
    dialog.className = '';   // the address field is only focused when chosen, not here
  }

  function closeDialog() {
    dialogOpen = false;
    lastLaunchA = true;       // a button still held must not also start a cart
    dialog.className = 'hidden';
    pcInput.blur();
  }

  function savePcUrl() {
    var url = pcInput.value.trim();
    try {
      if (url && url !== defaultPcUrl()) { localStorage.setItem(PC_URL_KEY, url); } else { localStorage.removeItem(PC_URL_KEY); }
    } catch (e) { /* no storage */ }
    CartSources.setPcUrl(url || defaultPcUrl());
    showSources();
  }

  function columns() {
    var tiles = grid.children;
    if (tiles.length < 2) { return 1; }
    var top = tiles[0].offsetTop, n = 0;
    while (n < tiles.length && tiles[n].offsetTop === top) { n++; }
    return n;
  }

  function setFocus(i) {
    if (!carts.length) { return; }
    focus = Math.max(0, Math.min(carts.length - 1, i));
    for (var j = 0; j < grid.children.length; j++) {
      grid.children[j].className = 'cart' + (j === focus ? ' focus' : '');
    }
    var t = grid.children[focus];
    if (t.offsetTop + t.offsetHeight > grid.scrollTop + grid.clientHeight) {
      grid.scrollTop = t.offsetTop + t.offsetHeight - grid.clientHeight + 28;
    } else if (t.offsetTop < grid.scrollTop + 28) {
      grid.scrollTop = Math.max(0, t.offsetTop - 28);
    }
  }

  function moveFocus(dx, dy) { setFocus(focus + dx + dy * columns()); }

  // Gamepad navigation on the launcher, with key-repeat while a direction is held.
  function launcherPoll(now) {
    if (!playing && ready) {
      var pad = firstPad();
      padLabel.textContent = pad ? 'Gamepad: ' + pad.id + ' — ' + rawPadState(pad) : 'Connect a Bluetooth gamepad';
      padLabel.className = pad ? 'connected' : '';
      showSources();
      var m = padMask(pad), fresh = m & ~lastPadMask;
      if (dialogOpen) {
        // The D-pad moves and picks; every face button does the same thing
        // (activate), so the pad layout doesn't matter here.
        document.getElementById('padnow').textContent = faceReadout(pad);
        var faces = [0, 1, 2, 3].map(function (b) { return !!pad && pressed(pad, b); });
        var faceEdge = faces.some(function (v, b) { return v && !lastDialogFace[b]; });
        lastDialogFace = faces;
        if (fresh & P8_PAUSE) { closeDialog(); }
        else if (document.activeElement === pcInput) { /* typing on the TV keyboard */ }
        else if (fresh & P8_UP) { selectRow(-1); }
        else if (fresh & P8_DOWN) { selectRow(1); }
        else if (fresh & P8_LEFT) { changeRow(-1); }
        else if (fresh & P8_RIGHT) { changeRow(1); }
        else if (faceEdge) { activateRow(); }
        lastPadMask = m;
        window.requestAnimationFrame(launcherPoll);
        return;
      }
      if (fresh & P8_PAUSE) {
        openDialog();
        lastPadMask = m;
        window.requestAnimationFrame(launcherPoll);
        return;
      }
      var dirs = m & (P8_LEFT | P8_RIGHT | P8_UP | P8_DOWN);
      if (dirs && ((dirs & fresh) || now >= padRepeatAt)) {
        moveFocus(dirs & P8_LEFT ? -1 : dirs & P8_RIGHT ? 1 : 0, dirs & P8_UP ? -1 : dirs & P8_DOWN ? 1 : 0);
        padRepeatAt = now + ((dirs & fresh) ? 400 : 120);
      }
      var aNow = !!pad && pressed(pad, face().a);
      if (aNow && !lastLaunchA) { launch(focus); }
      lastLaunchA = aNow;
      lastPadMask = m;
    }
    window.requestAnimationFrame(launcherPoll);
  }

  // WebGL draws at the final size, so the canvas is never scaled by CSS.
  // "fill": as tall as the screen (1080 px, 8.44x, sharp-bilinear);
  // "pixel": the largest whole multiple (8x = 1024 px, thin bars top and bottom).
  function resizeCanvas() {
    var fit = Math.min(window.innerWidth, window.innerHeight);
    var size = screenMode === 'pixel' ? 128 * Math.max(1, Math.floor(fit / 128)) : Math.max(128, Math.floor(fit));
    canvas.style.width = canvas.style.height = size + 'px';
    if (canvas.width !== size) { canvas.width = canvas.height = size; }
  }

  function launch(i) {
    if (!carts[i]) { return; }
    focus = i;
    message.className = 'hidden';
    keyMask = 0;
    playing = true;
    launcher.className = 'hidden';
    canvas.className = '';
    menuHeldSince = 0;
    statsText = 'measuring...';
    stats.className = SHOW_STATS ? '' : 'hidden';
    resizeCanvas();
    unlockAudio();
    current = carts[i].path;
    CartSources.setPlaying(current);
    Module.ccall('p8_run_cart', 'number', ['string'], [current]);
  }

  // Live reload: the PC changed files of the game that is running.
  function onGameChanged(gameDir) {
    if (playing && current.indexOf(gameDir + '/') === 0) {
      try { Module.FS.stat(current); } catch (e) { return; }   // cart gone; keep the old one
      Module.ccall('p8_run_cart', 'number', ['string'], [current]);
    }
  }

  // Called by the C host when a cart leaves: pause menu "exit", a held menu button,
  // or an error (the message is shown on the launcher).
  function onCartExit(error) {
    playing = false;
    current = '';
    CartSources.setPlaying('');
    keyMask = 0;
    lastPadMask = 0xff;       // ignore buttons still held from the game
    lastLaunchA = true;
    canvas.className = 'hidden';
    stats.className = 'hidden';
    launcher.className = '';
    if (error) {
      message.textContent = 'The cart stopped: ' + error;
      message.className = '';
    }
    if (pendingGrid) { pendingGrid = false; buildGrid(); } else { setFocus(focus); }
  }

  window.addEventListener('resize', resizeCanvas);

  window.Module = {
    canvas: canvas,
    p8InputMask: inputMask,
    p8OnCartExit: onCartExit,
    p8OnStats: onStats,
    print: function (text) { console.log(text); },
    printErr: function (text) { console.warn(text); },
    onRuntimeInitialized: function () {
      ready = true;
      showStatus('');
      buildGrid();
      CartSources.onChange = function () { if (!playing) { buildGrid(); } else { pendingGrid = true; } };
      CartSources.onGameChanged = onGameChanged;
      CartSources.start(savedPcUrl() || defaultPcUrl());
      window.requestAnimationFrame(launcherPoll);
    },
    onAbort: function (what) { showStatus('FAKE-08 aborted:\n' + what); }
  };
  window.addEventListener('error', function (e) {
    if (!ready) { showStatus('Failed to start:\n' + e.message); }
  });
}());
