#!/usr/bin/env python3
"""Build the browser version (WebAssembly) of the NESRecomp cycle-accurate core.

Needs the Emscripten SDK (emcc) on PATH. Run from anywhere:

    python web/build_web.py                 # output in web/dist/
    python web/build_web.py --nesrecomp PATH  # if nesrecomp is not at <repo>/nesrecomp

The resulting smb.wasm contains only the emulator (CPU interpreter, PPU, APU,
mappers). It has NO game data and no code generated from a ROM: the player
loads their own ROM in the page. Serve web/dist/ over HTTP (not file://).
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Same sources as runner/cyc/cyc.cmake's NESRECOMP_CYC_SOURCES, minus everything
# that needs a window, SDL, ImGui, sockets or files (cyc_host/cyc_sdl/cyc_ui/...),
# and with cyc_native_none.c standing in for the generated <prefix>_cyc.c so the
# interpreter runs the cartridge. Verified to link and run natively with gcc.
CYC_SOURCES = [
    "cpu6502.c", "cpu6502_interp.c", "hw_machine.c", "hw_mapper.c",
    "hw_fds.c", "hw_fds_audio.c", "hw_fds_hle.c", "vendor/emu2413/emu2413.c",
    "hw_ppu.c", "hw_apu.c", "hw_palette.c",
    "cyc_trace.c", "cyc_ring.c", "cyc_run.c", "cyc_ramview.c",
    "cyc_hooks.c", "cyc_mod.c", "cyc_state.c",
    "cyc_native_none.c",
]
OTHER_SOURCES = ["../src/mod_function_hooks.c", "../src/mod_savestate.c"]

EXPORTS = [
    "_smb_init", "_smb_reset", "_smb_set_input", "_smb_frame",
    "_smb_video_index", "_smb_video_rgba", "_smb_audio", "_smb_audio_rate",
    "_smb_frame_seconds", "_smb_prg_hash", "_malloc", "_free",
]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--nesrecomp", type=Path, default=HERE.parent / "nesrecomp",
                    help="nesrecomp checkout (default: <repo>/nesrecomp)")
    ap.add_argument("--out", type=Path, default=HERE / "dist")
    ap.add_argument("--dry-run", action="store_true", help="print the emcc command and exit")
    args = ap.parse_args()

    root = args.nesrecomp.resolve()
    cyc = root / "runner" / "cyc"
    if not (cyc / "cyc_core.h").exists():
        sys.exit(f"nesrecomp not found at {root} (did you run: git submodule update --init?)")

    emcc = shutil.which("emcc") or shutil.which("emcc.bat")
    if not emcc and not args.dry_run:
        sys.exit("emcc not found. Install the Emscripten SDK (https://emscripten.org/docs/getting_started/downloads.html)\n"
                 "and activate it (emsdk_env) in this shell, or use the GitHub Actions workflow.")

    sources = [HERE / "smb_web.c"] + [cyc / s for s in CYC_SOURCES] + [(cyc / s).resolve() for s in OTHER_SOURCES]
    missing = [str(s) for s in sources if not s.exists()]
    if missing:
        sys.exit("missing sources:\n  " + "\n  ".join(missing))

    args.out.mkdir(parents=True, exist_ok=True)
    cmd = [emcc or "emcc", "-O3", "-std=gnu11", "-DNDEBUG", "-w", "-fno-strict-aliasing",
           f"-I{cyc}", f"-I{root / 'runner' / 'include'}", f"-I{cyc / 'vendor' / 'emu2413'}",
           *map(str, sources),
           "-o", str(args.out / "smb.js"),
           "-sMODULARIZE=1", "-sEXPORT_NAME=createSmb", "-sENVIRONMENT=web",
           "-sEXPORTED_FUNCTIONS=" + ",".join(EXPORTS),
           "-sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAP16,HEAPU32",
           "-sINITIAL_MEMORY=33554432", "-sALLOW_MEMORY_GROWTH=1", "-sSTACK_SIZE=1048576"]
    if args.dry_run:
        print(" ".join(f'"{c}"' if " " in c else c for c in cmd))
        return
    print("[build_web] emcc ->", args.out)
    subprocess.run(cmd, check=True)

    for name in ("index.html", "app.js"):
        shutil.copy(HERE / name, args.out / name)
    # The runtime is PolyForm Noncommercial: ship its notice (and emu2413's MIT) with the binary.
    shutil.copy(root / "LICENSE", args.out / "LICENSE-nesrecomp.txt")
    shutil.copy(cyc / "vendor" / "emu2413" / "LICENSE", args.out / "LICENSE-emu2413.txt")
    print("[build_web] done. Serve it with:  python -m http.server -d", args.out, "8000")


if __name__ == "__main__":
    main()
