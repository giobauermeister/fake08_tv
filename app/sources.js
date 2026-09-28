/* Where carts come from (the app ships without any): a PC on the LAN
   (tools/cart_server.py), USB drives and the TV's Documents folder. All are
   copied into FAKE-08's in-memory file system, keeping the folder layout, and
   the C side loads them from there:

     /pc/<Game>/<cart>.p8.png        /usb/<Game>/<cart>.p8.png     /tv/<Game>/<cart>.p8.png
     /pc/<Game>/carts/<companion>    /usb/<Game>/carts/<companion> /tv/<Game>/carts/<companion>

   ES5 on purpose, like main.js. */
(function () {
  'use strict';

  var CART_FILE = /\.p8(\.png)?$/i;
  var POLL_IDLE_MS = 3000;      // on the launcher
  var POLL_PLAYING_MS = 1000;   // while a PC cart runs, for live reload

  var S = window.CartSources = {
    onChange: null,             // function (changedRoots): the grid needs rebuilding
    onGameChanged: null,        // function (gameDir): files of that PC game changed
    pc: { url: '', status: 'PC: not set', files: {}, busy: false, playingGame: '' },
    // Local sources: files maps each copied cart to the size:mtime it had.
    usb: { name: 'USB', root: '/usb', status: 'USB: scanning...', scanning: false, again: false, files: {} },
    tv: { name: 'TV', root: '/tv', status: 'TV: scanning...', scanning: false, again: false, files: {} }
  };

  function FS() { return window.Module.FS; }

  function mkdirs(dir) {
    var parts = dir.split('/'), path = '';
    for (var i = 1; i < parts.length; i++) {
      path += '/' + parts[i];
      try { FS().mkdir(path); } catch (e) { /* exists */ }
    }
  }

  function writeFile(path, bytes) {
    mkdirs(path.substring(0, path.lastIndexOf('/')));
    FS().writeFile(path, bytes);
  }

  function removeTree(path) {
    var fs = FS(), st;
    try { st = fs.stat(path); } catch (e) { return; }
    if (fs.isDir(st.mode)) {
      fs.readdir(path).forEach(function (n) { if (n !== '.' && n !== '..') { removeTree(path + '/' + n); } });
      try { fs.rmdir(path); } catch (e) { /* keep going */ }
    } else {
      try { fs.unlink(path); } catch (e) { /* gone */ }
    }
  }

  function changed(roots) { if (S.onChange) { S.onChange(roots); } }

  // ------------------------------------------------------------------ PC

  function request(url, type, timeoutMs, done) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = type;
    xhr.timeout = timeoutMs;
    xhr.onload = function () { done(xhr.status === 200 ? null : 'HTTP ' + xhr.status, xhr.response); };
    xhr.onerror = function () { done('not reachable'); };
    xhr.ontimeout = function () { done('not reachable'); };
    xhr.send();
  }

  function encodePath(p) { return p.split('/').map(encodeURIComponent).join('/'); }

  function pollPc() {
    var pc = S.pc;
    if (!pc.url) { pc.status = 'PC: no address (Home on the launcher to set it)'; return; }
    if (pc.busy) { return; }
    pc.busy = true;
    request(pc.url + '/index.json', 'text', 2500, function (err, body) {
      if (err) {
        pc.busy = false;
        pc.status = 'PC ' + pc.url + ': ' + err;
        return;
      }
      var list;
      try { list = JSON.parse(body).files || []; } catch (e) { list = null; }
      if (!list) { pc.busy = false; pc.status = 'PC ' + pc.url + ': bad index.json'; return; }

      var want = {}, todo = [], games = {}, touched = {};
      list.forEach(function (f) {
        if (!CART_FILE.test(f.path) || f.path.indexOf('..') >= 0) { return; }
        want[f.path] = f.mtime + ':' + f.size;
        games[f.path.split('/')[0]] = true;
        if (pc.files[f.path] !== want[f.path]) { todo.push(f.path); }
      });
      Object.keys(pc.files).forEach(function (p) {
        if (!want[p]) { removeTree('/pc/' + p); delete pc.files[p]; touched[p.split('/')[0]] = true; }
      });

      var i = 0;
      (function next() {
        if (i >= todo.length) {
          pc.busy = false;
          pc.status = 'PC ' + pc.url + ': ' + Object.keys(games).length + ' games';
          var dirs = Object.keys(touched);
          if (dirs.length) {
            changed(['/pc']);
            if (S.onGameChanged) { dirs.forEach(function (d) { S.onGameChanged('/pc/' + d); }); }
          }
          return;
        }
        var path = todo[i++];
        request(pc.url + '/files/' + encodePath(path), 'arraybuffer', 10000, function (err2, buf) {
          if (!err2 && buf) {
            writeFile('/pc/' + path, new Uint8Array(buf));
            pc.files[path] = want[path];
            touched[path.split('/')[0]] = true;
          }
          next();
        });
      }());
    });
  }

  function pcLoop() {
    pollPc();
    setTimeout(pcLoop, S.pc.playingGame ? POLL_PLAYING_MS : POLL_IDLE_MS);
  }

  S.setPcUrl = function (url) {
    url = (url || '').replace(/\/+$/, '');
    if (url && !/^https?:\/\//i.test(url)) { url = 'http://' + url; }
    if (url && !/:\d+$/.test(url.replace(/^https?:\/\//i, ''))) { url += ':8808'; }
    if (url === S.pc.url) { return; }
    S.pc.url = url;
    Object.keys(S.pc.files).forEach(function (p) { removeTree('/pc/' + p); });
    S.pc.files = {};
    removeTree('/pc');
    changed(['/pc']);
    pollPc();
  };

  // Poll faster while this PC game runs, so edits reload it.
  S.setPlaying = function (cartPath) {
    var m = /^\/pc\/([^/]+)\//.exec(cartPath || '');
    S.pc.playingGame = m ? m[1] : '';
  };

  // ------------------------------------------------------------------ USB

  // Tizen's File API (the one Tizen 8 TVs have: resolve/listFiles/openStream).
  function listFiles(dir, done) {
    try { dir.listFiles(function (files) { done(files || []); }, function () { done([]); }); } catch (e) { done([]); }
  }

  function readFile(file, done) {
    try {
      file.openStream('r', function (stream) {
        var bytes = null;
        try { bytes = new Uint8Array(stream.readBytes(file.fileSize)); } catch (e) { /* unreadable */ }
        try { stream.close(); } catch (e) { /* ignore */ }
        done(bytes);
      }, function () { done(null); }, 'ISO-8859-1');
    } catch (e) { done(null); }
  }

  // Calls fn(item, next) for each item in turn, then done().
  function each(items, fn, done) {
    var i = 0;
    (function next() { if (i >= items.length) { done(); } else { fn(items[i++], next); } }());
  }

  // Lists the carts under dir (and its carts/ subfolder) as
  // found[<target>/<name>] = file, without reading them.
  function listCarts(dir, target, found, done) {
    listFiles(dir, function (files) {
      each(files, function (f, next) {
        if (f.isDirectory && /^carts$/i.test(f.name)) {
          listCarts(f, target + '/carts', found, next);
          return;
        }
        if (!f.isDirectory && CART_FILE.test(f.name)) { found[target + '/' + f.name] = f; }
        next();
      }, done);
    });
  }

  // <root>/PICO8/<Game>/... (or FAKE08/) -> found[<target>/<Game>/...]; done(games, note).
  function scanRoot(root, target, found, done) {
    listFiles(root, function (entries) {
      var dir = null;
      entries.forEach(function (e) { if (!dir && e.isDirectory && /^(pico-?8|fake-?08)$/i.test(e.name)) { dir = e; } });
      if (!dir) { done(0, 'no PICO8 folder'); return; }
      listFiles(dir, function (games) {
        var count = 0;
        each(games, function (g, next) {
          if (!g.isDirectory || g.name.charAt(0) === '.') { next(); return; }
          count++;
          listCarts(g, target + '/' + g.name, found, next);
        }, function () { done(count, ''); });
      });
    });
  }

  function fileKey(f) {
    var t = f.modified && f.modified.getTime ? f.modified.getTime() : '';
    return f.fileSize + ':' + t;
  }

  // Deletes a cart and the folders it leaves empty, up to the source's root.
  function removeCart(path, root) {
    try { FS().unlink(path); } catch (e) { /* gone */ }
    for (var dir = path.substring(0, path.lastIndexOf('/')); dir.length > root.length;
         dir = dir.substring(0, dir.lastIndexOf('/'))) {
      try { FS().rmdir(dir); } catch (e) { return; }   // not empty
    }
  }

  // Brings a local source's copy in line with what was found: only new or
  // changed carts are read and gone ones removed, so the grid never sees the
  // source empty mid-scan. done(anyChange).
  function syncCarts(src, found, done) {
    var any = false;
    Object.keys(src.files).forEach(function (p) {
      if (!found[p]) { removeCart(p, src.root); delete src.files[p]; any = true; }
    });
    each(Object.keys(found), function (p, next) {
      var f = found[p], key = fileKey(f);
      if (src.files[p] === key) { next(); return; }
      readFile(f, function (bytes) {
        if (bytes) { writeFile(p, bytes); src.files[p] = key; any = true; }
        next();
      });
    }, function () { done(any); });
  }

  function hasTizenFs() { return !!(window.tizen && tizen.filesystem); }

  function errorText(e) { return e && (e.name || e.message) || String(e); }

  // Runs scan(done) for a local source, one at a time; a request made
  // meanwhile (a drive plugged in mid-scan) runs once it ends. scan calls
  // done(found, status), with found null when nothing could be read, which
  // keeps the carts already copied.
  function runScan(src, scan) {
    if (!hasTizenFs()) { src.status = src.name + ': only on the TV'; return; }
    if (src.scanning) { src.again = true; return; }
    src.scanning = true;
    src.again = false;
    var finish = function (status, any) {
      src.status = status;
      if (any) { changed([src.root]); }
      src.scanning = false;
      if (src.again) { runScan(src, scan); }
    };
    try {
      scan(function (found, status) {
        if (!found) { finish(status, false); return; }
        syncCarts(src, found, function (any) { finish(status, any); });
      });
    } catch (e) { finish(src.name + ' error: ' + errorText(e), false); }
  }

  // USB drives: every storage the TV lists as external or "removable_..."
  // (a Q60D reports a stick as "removable_sda1 EXTERNAL MOUNTED").
  S.scanUsb = function () {
    runScan(S.usb, function (done) {
      tizen.filesystem.listStorages(function (storages) {
        var drives = storages.filter(function (st) {
          return (st.type === 'EXTERNAL' || /^removable/i.test(st.label)) && st.state !== 'REMOVED';
        });
        var found = {}, total = 0;
        each(drives, function (d, next) {
          tizen.filesystem.resolve(d.label, function (root) {
            scanRoot(root, '/usb', found, function (count) { total += count; next(); });
          }, function () { next(); }, 'r');
        }, function () {
          done(found, !drives.length ? 'USB: no drive' : total ? 'USB: ' + total + ' games' : 'USB: no PICO8 folder');
        });
      }, function (e) { done(null, 'USB error: ' + errorText(e)); });
    });
  };

  // The TV's own Documents folder, same PICO8/<Game>/... layout, badge "TV".
  S.scanTv = function () {
    runScan(S.tv, function (done) {
      tizen.filesystem.resolve('documents', function (root) {
        var found = {};
        scanRoot(root, '/tv', found, function (count, note) {
          done(found, count ? 'TV: ' + count + ' games' : 'TV Documents: ' + (note || 'no games'));
        });
      }, function (e) { done(null, 'TV Documents: ' + errorText(e)); }, 'r');
    });
  };

  S.scanLocal = function () { S.scanUsb(); S.scanTv(); };

  S.start = function (pcUrl) {
    S.pc.url = '';
    S.setPcUrl(pcUrl);
    setTimeout(pcLoop, POLL_IDLE_MS);
    S.scanLocal();
    try {
      tizen.filesystem.addStorageStateChangeListener(function () { S.scanUsb(); });
    } catch (e) { /* not on a TV */ }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { S.scanLocal(); } });
  };
}());
