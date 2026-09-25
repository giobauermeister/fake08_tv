/*
 * FAKE-08 on a Samsung Tizen TV: the web implementation of FAKE-08's Host class,
 * plus the cart runner that the HTML launcher (app/main.js) drives.
 *
 * The core runs as an "external frontend": a fresh Vm per cart, loaded from
 * bytes, and leaving the cart (pause menu "exit", or an error) hands control
 * back to the launcher instead of FAKE-08's own BIOS cart.
 *
 *   video  Vm framebuffer (128x128, 4bpp) -> palette -> RGBA -> WebGL texture
 *   audio  22050 Hz synth, pulled once per displayed frame -> Web Audio buffers
 *   input  keyboard, remote Return and the Gamepad API, merged in main.js
 *   saves  cartdata() -> localStorage
 *   loop   emscripten_set_main_loop (requestAnimationFrame), paced to the
 *          cart's 30 or 60 fps. Single thread, no pthreads.
 */

#include <emscripten.h>
#include <sys/stat.h>

#include <cstring>
#include <string>
#include <vector>

#include "host.h"
#include "hostVmShared.h"
#include "nibblehelpers.h"
#include "vm.h"

#define P8_W 128
#define P8_H 128
#define AUDIO_RATE 22050
#define AUDIO_MAX_FRAMES 4096

static Vm *s_vm;
static Host *s_host;
static int s_target_fps = 60;
static double s_deadline;
static uint32_t s_rgba[P8_W * P8_H];
static uint32_t s_audio_buf[AUDIO_MAX_FRAMES];
static bool s_no_webgl;

/* Per-second timing for the on-screen stats overlay (app/main.js). */
struct Stats {
    double window_start, last_loop;
    int loops, steps, behind, draws;
    double step_ms, step_max, draw_ms, audio_ms, input_ms, gap_max;
};
static Stats s_stats;

/* ------------------------------------------------------------ JS side */

EM_JS(int, js_input_mask, (), { return Module.p8InputMask ? Module.p8InputMask() : 0; });

/* Presents the 128x128 RGBA frame with WebGL: the frame is uploaded as a
 * texture and drawn straight into a canvas that already has the on-screen size,
 * so the browser never scales it. The shader does "sharp bilinear" scaling:
 * nearest-neighbour up to the largest whole multiple, then linear only across
 * the last fraction, so a non-integer scale such as 1080/128 = 8.44x keeps crisp,
 * even pixels; at a whole multiple (8x) it is exactly nearest-neighbour.
 * Returns 0 when the browser can't create a WebGL context. */
EM_JS(int, js_blit, (const void *rgba), {
    var c = document.getElementById('canvas');
    if (Module.p8Gl === undefined) {
        var opts = { alpha: false, antialias: false, depth: false, stencil: false,
                     preserveDrawingBuffer: false, premultipliedAlpha: false };
        var gl = c.getContext('webgl', opts) || c.getContext('experimental-webgl', opts);
        Module.p8Gl = gl || null;
        if (!gl) return 0;
        var sh = function (type, src) {
            var s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            return s;
        };
        var prog = gl.createProgram();
        gl.attachShader(prog, sh(gl.VERTEX_SHADER,
            'attribute vec2 p; varying vec2 uv;' +
            'void main() { uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }'));
        gl.attachShader(prog, sh(gl.FRAGMENT_SHADER,
            '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
            'varying vec2 uv; uniform sampler2D t; uniform float scale;' +
            'void main() {' +
            '  vec2 texel = uv * 128.0;' +
            '  vec2 d = fract(texel) - 0.5;' +
            '  float r = 0.5 - 0.5 / scale;' +
            '  vec2 f = (d - clamp(d, -r, r)) * scale + 0.5;' +
            '  gl_FragColor = texture2D(t, (floor(texel) + f) / 128.0);' +
            '}'));
        gl.linkProgram(prog);
        gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        var loc = gl.getAttribLocation(prog, 'p');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 128, 128, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        Module.p8ScaleLoc = gl.getUniformLocation(prog, 'scale');
        Module.p8ScaleSet = 0;
    }
    var g = Module.p8Gl;
    if (!g) return 0;
    g.viewport(0, 0, c.width, c.height);
    var whole = Math.max(1, Math.floor(c.width / 128));
    if (Module.p8ScaleSet !== whole) { g.uniform1f(Module.p8ScaleLoc, whole); Module.p8ScaleSet = whole; }
    g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, 128, 128, g.RGBA, g.UNSIGNED_BYTE,
                    HEAPU8.subarray(rgba, rgba + 128 * 128 * 4));
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    return 1;
});

/* How many samples to synthesise now. With a running AudioContext this keeps
 * 60-120 ms queued, topped up in chunks of at least 40 ms so the TV creates
 * about 20 audio nodes a second instead of 60. Without a running context (no
 * user gesture yet) the synth still advances in real time and the samples are
 * dropped, so music stays in step. */
EM_JS(int, js_audio_frames_needed, (int max_frames), {
    var a = Module.p8Audio;
    var now = performance.now() / 1000;
    if (!a || a.ctx.state !== 'running') {
        if (!Module.p8AudioIdle) Module.p8AudioIdle = now;
        var idle = Math.min(max_frames, Math.floor((now - Module.p8AudioIdle) * 22050));
        Module.p8AudioIdle += idle / 22050;
        return idle;
    }
    Module.p8AudioIdle = 0;
    var t = a.ctx.currentTime;
    if (a.next < t + 0.01) a.next = t + 0.03;          /* first call or underrun */
    var lead = a.next - t;
    if (lead > 0.06) return 0;
    return Math.min(max_frames, Math.floor((0.12 - lead) * 22050));
});

/* FAKE-08 writes stereo int16 pairs packed in 32 bits (L == R). */
EM_JS(void, js_audio_push, (const void *buf, int frames), {
    var a = Module.p8Audio;
    if (!a || a.ctx.state !== 'running' || frames <= 0) return;
    var b = a.ctx.createBuffer(1, frames, 22050);
    var d = b.getChannelData(0);
    var base = buf >> 1;
    for (var i = 0; i < frames; i++) d[i] = HEAP16[base + i * 2] / 32768;
    var src = a.ctx.createBufferSource();
    src.buffer = b;
    src.connect(a.ctx.destination);
    src.start(a.next);
    a.next += frames / 22050;
});

/* Select+Start is seen inside scanInput(), in the middle of Vm::Step(), so the
 * JS side only raises a flag and the loop leaves the cart between frames. */
EM_JS(int, js_take_exit_request, (), {
    var r = Module.p8ExitRequest ? 1 : 0;
    Module.p8ExitRequest = false;
    return r;
});

EM_JS(void, js_stats, (int loops, int steps, int target_fps, int behind, double step_ms, double step_max,
                      double draw_ms, double audio_ms, double input_ms, double gap_max), {
    if (Module.p8OnStats) Module.p8OnStats({
        loops: loops, steps: steps, target: target_fps, behind: behind, step: step_ms, stepMax: step_max,
        draw: draw_ms, audio: audio_ms, input: input_ms, gapMax: gap_max });
});

EM_JS(void, js_cart_exited, (const char *error), {
    if (Module.p8OnCartExit) Module.p8OnCartExit(UTF8ToString(error));
});

EM_JS(char *, js_storage_get, (const char *key), {
    var v = null;
    try { v = localStorage.getItem('p8cartdata:' + UTF8ToString(key)); } catch (e) {}
    if (v === null) return 0;
    var n = lengthBytesUTF8(v) + 1;
    var p = _malloc(n);
    stringToUTF8(v, p, n);
    return p;
});

EM_JS(void, js_storage_set, (const char *key, const char *value), {
    try { localStorage.setItem('p8cartdata:' + UTF8ToString(key), UTF8ToString(value)); } catch (e) {}
});

/* ------------------------------------------------------------ Host */

Host::Host(int windowWidth, int windowHeight)
{
    (void)windowWidth;
    (void)windowHeight;
    currKDown = 0;
    currKHeld = 0;
}

void Host::setPlatformParams(int, int, uint32_t, uint32_t, uint32_t, std::string logFilePrefix,
                             std::string customBiosLua, std::string cartDirectory)
{
    _logFilePrefix = logFilePrefix;
    _customBiosLua = customBiosLua;
    _cartDirectory = cartDirectory;
}

void Host::oneTimeSetup(Audio *audio) { (void)audio; }
void Host::oneTimeCleanup() {}

void Host::setTargetFps(int targetFps)
{
    /* Carts choose 30 or 60 by defining _update() or _update60(). */
    s_target_fps = targetFps > 0 ? targetFps : 60;
}

/* Pacing is done by the main loop below; the core never blocks here. */
void Host::waitForTargetFps() {}

double Host::deltaTMs() { return 1000.0 / s_target_fps; }

InputState_t Host::scanInput()
{
    double t0 = emscripten_get_now();
    uint8_t held = (uint8_t)js_input_mask();
    s_stats.input_ms += emscripten_get_now() - t0;
    uint8_t down = held & ~currKHeld;
    currKHeld = held;
    currKDown = down;

    InputState_t state;
    state.KDown = down;
    state.KHeld = held;
    state.mouseX = 0;
    state.mouseY = 0;
    state.mouseBtnState = 0;
    state.KBdown = false;
    state.KBkey = "";
    return state;
}

bool Host::shouldQuit() { return quit != 0; }
bool Host::shouldRunMainLoop() { return !shouldQuit(); }
void Host::changeStretch() {}
void Host::forceStretch(StretchOption newStretch) { (void)newStretch; }

/* Where a screen pixel comes from for PICO-8's draw modes (poke(0x5f2c, mode)):
 * 1/2/3 stretch the left/top half, 5/6/7 mirror it, 129-131 flip,
 * 133/134/135 rotate by 90/180/270 degrees clockwise. */
static inline void source_pixel(uint8_t mode, int x, int y, int *sx, int *sy)
{
    const int m = P8_W - 1;
    switch (mode) {
    case 1: *sx = x / 2; *sy = y; break;
    case 2: *sx = x; *sy = y / 2; break;
    case 3: *sx = x / 2; *sy = y / 2; break;
    case 5: *sx = x < 64 ? x : m - x; *sy = y; break;
    case 6: *sx = x; *sy = y < 64 ? y : m - y; break;
    case 7: *sx = x < 64 ? x : m - x; *sy = y < 64 ? y : m - y; break;
    case 129: *sx = m - x; *sy = y; break;
    case 130: *sx = x; *sy = m - y; break;
    case 131: *sx = m - x; *sy = m - y; break;
    case 133: *sx = y; *sy = m - x; break;
    case 134: *sx = m - x; *sy = m - y; break;
    case 135: *sx = m - y; *sy = x; break;
    default: *sx = x; *sy = y; break;
    }
}

void Host::drawFrame(uint8_t *picoFb, uint8_t *screenPaletteMap, uint8_t drawMode)
{
    /* The palette map sends each of the 16 draw colours to one of the 144
     * hardware colours; 0x8f folds indices like 149 onto 128..143, as PICO-8 does. */
    uint32_t pal[16];
    for (int i = 0; i < 16; i++) {
        Color c = _paletteColors[screenPaletteMap[i] & 0x8f];
        pal[i] = 0xFF000000u | ((uint32_t)c.Blue << 16) | ((uint32_t)c.Green << 8) | c.Red;
    }

    uint32_t *out = s_rgba;
    if (drawMode == 0) {
        for (int y = 0; y < P8_H; y++) {
            for (int x = 0; x < P8_W; x++) *out++ = pal[getPixelNibble(x, y, picoFb)];
        }
    } else {
        for (int y = 0; y < P8_H; y++) {
            for (int x = 0; x < P8_W; x++) {
                int sx, sy;
                source_pixel(drawMode, x, y, &sx, &sy);
                *out++ = pal[getPixelNibble(sx, sy, picoFb)];
            }
        }
    }
    s_no_webgl = !js_blit(s_rgba);
}

/* Audio is pulled by the main loop below, not by Vm::GameLoop(). */
bool Host::shouldFillAudioBuff() { return false; }
void *Host::getAudioBufferPointer() { return s_audio_buf; }
size_t Host::getAudioBufferSize() { return 0; }
void Host::playFilledAudioBuffer() {}

void Host::setUpPaletteColors()
{
    static const Color base[16] = {
        COLOR_00, COLOR_01, COLOR_02, COLOR_03, COLOR_04, COLOR_05, COLOR_06, COLOR_07,
        COLOR_08, COLOR_09, COLOR_10, COLOR_11, COLOR_12, COLOR_13, COLOR_14, COLOR_15,
    };
    static const Color alt[16] = {
        COLOR_128, COLOR_129, COLOR_130, COLOR_131, COLOR_132, COLOR_133, COLOR_134, COLOR_135,
        COLOR_136, COLOR_137, COLOR_138, COLOR_139, COLOR_140, COLOR_141, COLOR_142, COLOR_143,
    };
    memset(_paletteColors, 0, sizeof(_paletteColors));
    for (int i = 0; i < 16; i++) {
        _paletteColors[i] = base[i];
        _paletteColors[128 + i] = alt[i];
    }
}

Color *Host::GetPaletteColors() { return _paletteColors; }

/* Settings belong to FAKE-08's own BIOS/settings carts, which the launcher
 * replaces; answer from the in-memory defaults. */
int Host::getSetting(std::string sname)
{
    if (sname == "kbmode") return kbmode;
    if (sname == "resizekey") return resizekey;
    if (sname == "stretch") return stretch;
    if (sname == "menustyle") return menustyle;
    if (sname == "bgcolor") return bgcolor;
    if (sname == "p8_bgcolor") return 5;
    if (sname == "p8_textcolor") return 7;
    return 0;
}

void Host::setSetting(std::string sname, int sdata)
{
    if (sname == "kbmode") kbmode = (KeyboardOption)sdata;
    else if (sname == "resizekey") resizekey = (ResizekeyOption)sdata;
    else if (sname == "stretch") stretch = (StretchOption)sdata;
    else if (sname == "menustyle") menustyle = (MenuStyleOption)sdata;
    else if (sname == "bgcolor") bgcolor = (BgColorOption)sdata;
}

void Host::setCartDirectory(std::string cartDirectory) { _cartDirectory = cartDirectory; }
std::string Host::getCartDirectory() { return _cartDirectory; }

/* The launcher lists the carts; FAKE-08's BIOS cart never runs. */
std::vector<std::string> Host::listcarts() { return std::vector<std::string>(); }
std::vector<std::string> Host::listdirs() { return std::vector<std::string>(); }
std::string Host::customBiosLua() { return _customBiosLua; }
#if LOAD_PACK_INS
void Host::unpackCarts() {}
#endif

void Host::overrideLogFilePrefix(const char *newPrefix) { _logFilePrefix = newPrefix; }
const char *Host::logFilePrefix() { return _logFilePrefix.c_str(); }

std::string Host::getCartDataFileContents(std::string cartDataKey)
{
    char *v = js_storage_get(cartDataKey.c_str());
    if (!v) return "";
    std::string out(v);
    free(v);
    return out;
}

void Host::saveCartData(std::string cartDataKey, std::string contents)
{
    js_storage_set(cartDataKey.c_str(), contents.c_str());
}

/* Save states in files are not used by this port. */
size_t Host::getFileContents(std::string fileName, char *buffer)
{
    (void)fileName;
    (void)buffer;
    return 0;
}

void Host::writeBufferToFile(std::string fileName, char *buffer, size_t length)
{
    (void)fileName;
    (void)buffer;
    (void)length;
}

/* ------------------------------------------------------------ cart runner */

static std::vector<unsigned char> read_file(const char *path)
{
    std::vector<unsigned char> data;
    FILE *f = fopen(path, "rb");
    if (!f) return data;
    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (size > 0) {
        data.resize((size_t)size);
        if (fread(data.data(), 1, data.size(), f) != data.size()) data.clear();
    }
    fclose(f);
    return data;
}

/* notify=false when a new cart replaces the running one (e.g. the live reload
 * of a cart served from the PC), so the launcher is not shown in between. */
static void stop_cart(const std::string &error, bool notify = true)
{
    if (!s_vm) return;
    s_vm->CloseCart();
    delete s_vm;
    delete s_host;
    s_vm = nullptr;
    s_host = nullptr;
    if (notify) js_cart_exited(error.c_str());
}

/**
 * Called by the launcher with a cart path in the in-memory file system:
 * /pc/..., /usb/... or /tv/... (copied there by app/sources.js), such as
 * "/usb/Celeste/15133.p8.png". A fresh Vm per cart, because
 * FAKE-08 never resets its Lua state between carts, so reusing one would leak
 * the previous cart's globals into the next.
 */
extern "C" EMSCRIPTEN_KEEPALIVE int p8_run_cart(const char *path)
{
    stop_cart("", false);
    js_take_exit_request();

    std::vector<unsigned char> cart = read_file(path);
    if (cart.empty()) {
        js_cart_exited((std::string("Could not read ") + path).c_str());
        return 0;
    }

    s_target_fps = 60;
    s_deadline = 0;
    s_stats = Stats();

    s_host = new Host();
    std::string p(path);
    size_t slash = p.find_last_of('/');
    if (slash != std::string::npos) s_host->setCartDirectory(p.substr(0, slash));
    s_host->setUpPaletteColors();
    s_host->oneTimeSetup(nullptr);
    s_host->setTargetFps(60);

    s_vm = new Vm(s_host);
    s_vm->SetExternalFrontend(true);
    if (!s_vm->LoadCart(cart.data(), cart.size(), false)) {
        std::string err = s_vm->GetBiosError();
        stop_cart(err.empty() ? "The cart did not load" : err);
        return 0;
    }
    /* Lets a multi-cart game's load("#name") find its way back to this file,
     * and load("other") find companions in <game dir>/carts/. */
    s_vm->SetCartFilename(p);
    s_vm->vm_run();
    return 1;
}

/** Leaves the running cart, e.g. when the page is hidden. */
extern "C" EMSCRIPTEN_KEEPALIVE void p8_stop_cart(void) { stop_cart(""); }

/* One Vm::GameLoop() iteration, minus its blocking pacing and audio calls. */
static bool step_cart(void)
{
    if (s_vm->ExitRequested() || s_vm->CurrentCartFilename() == "__FAKE08-DEFAULT.p8") return false;
    double input_before = s_stats.input_ms;
    double t0 = emscripten_get_now();
    s_vm->Step();
    double t1 = emscripten_get_now();
    /* Lua time excludes the gamepad read that happens inside Step(). */
    double lua = (t1 - t0) - (s_stats.input_ms - input_before);
    s_stats.steps++;
    s_stats.step_ms += lua;
    if (lua > s_stats.step_max) s_stats.step_max = lua;
    return !s_vm->ExitRequested();
}

static void main_loop(void)
{
    if (!s_vm) return;
    if (js_take_exit_request()) {
        stop_cart("");
        return;
    }

    /* Step at the cart's own rate whatever the display does: up to four steps
     * per loop run, so the game keeps real speed even if the browser only
     * presents 20-30 frames a second, and resync after a stall. Only the last
     * step's picture is presented. */
    double now = emscripten_get_now();
    double frame_ms = 1000.0 / s_target_fps;
    if (s_deadline == 0 || now - s_deadline > 250) s_deadline = now;
    int steps = 0;
    for (; steps < 4 && now >= s_deadline; steps++) {
        s_deadline += frame_ms;
        if (!step_cart()) {
            std::string err = s_vm->GetBiosError();
            stop_cart(err);
            return;
        }
    }
    if (emscripten_get_now() >= s_deadline) s_stats.behind++;   /* still late after catching up */
    if (steps > 0) {
        double d0 = emscripten_get_now();
        s_host->drawFrame(s_vm->GetPicoInteralFb(), s_vm->GetScreenPaletteMap(),
                          s_vm->getPicoRam()->drawState.drawMode);
        s_stats.draw_ms += emscripten_get_now() - d0;
        s_stats.draws++;
        if (s_no_webgl) {
            stop_cart("this TV's browser could not start WebGL, which the app needs to show games");
            return;
        }
    }

    double t0 = emscripten_get_now();
    int frames = js_audio_frames_needed(AUDIO_MAX_FRAMES);
    if (frames > 0) {
        s_vm->FillAudioBuffer(s_audio_buf, 0, (size_t)frames);
        js_audio_push(s_audio_buf, frames);
    }
    double t1 = emscripten_get_now();
    s_stats.audio_ms += t1 - t0;

    Stats &st = s_stats;
    if (st.last_loop > 0 && now - st.last_loop > st.gap_max) st.gap_max = now - st.last_loop;
    st.last_loop = now;
    st.loops++;
    if (st.window_start == 0) st.window_start = now;
    double elapsed = t1 - st.window_start;
    if (elapsed >= 1000) {
        double per_second = 1000.0 / elapsed;
        int steps = st.steps > 0 ? st.steps : 1;
        js_stats((int)(st.loops * per_second + 0.5), (int)(st.steps * per_second + 0.5), s_target_fps,
                 st.behind, st.step_ms / steps, st.step_max, st.draw_ms / (st.draws > 0 ? st.draws : 1),
                 st.audio_ms / st.loops, st.input_ms / steps, st.gap_max);
        double keep_last = st.last_loop;
        st = Stats();
        st.window_start = t1;
        st.last_loop = keep_last;
    }
}

int main(void)
{
    emscripten_set_main_loop(main_loop, 0, false);
    return 0;
}
