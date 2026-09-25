# Third-party notices

The FAKE-08 TV app (`FAKE-08.wgt`) contains the software below, besides this
project's own code (MIT, see `LICENSE`). Everything listed is compiled into
`fake08.js`; the package contains no other third-party code, fonts or assets,
and no games.

| Component | Where it comes from | Licence |
|---|---|---|
| FAKE-08 | https://github.com/jtothebell/fake-08, Jon Bell and contributors, with the TV patches in https://github.com/giobauermeister/fake-08 (branch `tv-patches`) | MIT. Its `LICENSE.MD` ships as `LICENSE-FAKE-08.md` and also lists the projects FAKE-08 took code from (zepto8, tac08, PicoLove, …) |
| z8lua | https://github.com/samhocevar/z8lua via https://github.com/jtothebell/z8lua, patched in https://github.com/giobauermeister/z8lua | MIT, as Lua (below) |
| Lua 5.2 | https://www.lua.org/, the base of z8lua | MIT, notice below |
| LodePNG | https://lodev.org/lodepng/, Lode Vandevenne | zlib, see `LICENSE-FAKE-08.md` |
| Font data | FAKE-08's `source/fontdata.cpp`, "taken from tac08" (https://github.com/0xcafed00d/tac08) | MIT |
| Code snippets from Stack Overflow | FAKE-08's `source/graphics.cpp` (oval drawing, https://stackoverflow.com/a/8448181), `source/filehelpers.cpp` and `source/vm.cpp` link their sources | CC BY-SA (3.0 or 4.0, depending on the post's date) |
| Emscripten runtime and system libraries | https://emscripten.org/: the JavaScript runtime, musl libc, libc++/libc++abi, compiler-rt and the allocator linked into the WebAssembly | Emscripten: MIT or University of Illinois/NCSA; musl: MIT; libc++, libc++abi, compiler-rt: Apache-2.0 WITH LLVM-exception; dlmalloc: public domain |

FAKE-08 is an independent player and is not affiliated with or endorsed by
Lexaloffle Games. PICO-8 is a trademark of Lexaloffle Games.

## Lua

```
Copyright (C) 1994-2015 Lua.org, PUC-Rio.

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Emscripten

```
Copyright (c) 2010-2014 Emscripten authors, see AUTHORS file.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## musl libc

```
Copyright © 2005-2020 Rich Felker, et al.

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

libc++, libc++abi and compiler-rt are under the Apache License 2.0 with LLVM
Exceptions (https://llvm.org/LICENSE.txt); the exception waives the attribution
requirement for code compiled into a program like this one.
