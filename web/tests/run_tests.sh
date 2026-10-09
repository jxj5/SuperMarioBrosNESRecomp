#!/bin/sh
# Native smoke test of the exact core + host that goes into the wasm (needs gcc, node >= 18, python3).
# usage: ./run_tests.sh "/path/Super Mario Bros. (World).nes" [optional.zip]
set -e
ROM="$1"; ZIP="$2"; [ -n "$ROM" ] || { echo "usage: $0 ROM.nes [ROM.zip]"; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"; OUT="$HERE/out"; mkdir -p "$OUT"
NES="${NESRECOMP:-$HERE/../../nesrecomp}"
python3 - "$NES" "$OUT" <<'PY'
import importlib.util, subprocess, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location('bw', Path(sys.argv[2]).parent.parent / 'build_web.py')
bw = importlib.util.module_from_spec(spec); spec.loader.exec_module(bw)
root = Path(sys.argv[1]).resolve(); cyc = root/'runner'/'cyc'; out = Path(sys.argv[2])
srcs = [bw.HERE/'smb_web.c'] + [cyc/s for s in bw.CYC_SOURCES] + [(cyc/s).resolve() for s in bw.OTHER_SOURCES]
cmd = ['gcc','-O2','-std=gnu11','-w','-fno-strict-aliasing',f'-I{cyc}',f'-I{root/"runner"/"include"}',f'-I{cyc/"vendor"/"emu2413"}',
       *map(str,srcs), str(bw.HERE/'tests'/'native_test.c'), '-o', str(out/'native_test'), '-lm']
subprocess.run(cmd, check=True)
PY
"$OUT/native_test" "$ROM" "$OUT"
ROM="$ROM" ZIP="$ZIP" OUT="$OUT" node "$HERE/test_app.js"
echo "Frames de ejemplo en $OUT/*.ppm (título, 'WORLD 1-1' y gameplay)."
