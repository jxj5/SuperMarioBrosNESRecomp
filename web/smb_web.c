/*
 * smb_web.c - minimal browser host for the NESRecomp cycle-accurate core.
 *
 * Exposes a tiny C API (no SDL, no threads, no blocking loop) so JavaScript
 * owns the canvas, WebAudio, keyboard and the requestAnimationFrame loop.
 * The same file builds natively (gcc) for headless testing.
 */
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdbool.h>

#include "cyc_core.h"
#include "cyc_run.h"

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define SMB_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define SMB_EXPORT
#endif

#define AUDIO_RATE 48000
#define AUDIO_BUF_SAMPLES 4096

static int16_t s_audio[AUDIO_BUF_SAMPLES];
static size_t  s_audio_n = 0;
static bool    s_ready = false;
static uint8_t s_pad[2];
/* The core's 256x240 ARGB8888 picture, converted to canvas byte order (R,G,B,A). */
static uint32_t s_rgba[256 * 240];

/* Returns 1 on success. rom = full iNES image (header included). */
SMB_EXPORT int smb_init(const uint8_t *rom, int size)
{
    if (!rom || size < 16) return 0;
    cyc_set_region(CYC_REGION_NTSC);
    if (!cyc_load_ines(rom, (size_t)size)) return 0;
    cyc_set_console(CYC_CONSOLE_NES);
    if (!cyc_audio_enable(AUDIO_RATE)) return 0;
    cyc_power_on(0);
    cyc_run_power_on();
    s_ready = true;
    return 1;
}

/* NES button byte: A B Select Start Up Down Left Right, MSB first
 * (bit7=A bit6=B bit5=Select bit4=Start bit3=Up bit2=Down bit1=Left bit0=Right). */
SMB_EXPORT void smb_set_input(int port, int buttons)
{
    if (port < 0 || port > 1) return;
    s_pad[port] = (uint8_t)buttons;
}

/* Run exactly one NES frame. Returns the number of audio samples produced. */
SMB_EXPORT int smb_frame(void)
{
    if (!s_ready) return 0;
    cyc_set_controller(0, s_pad[0]);
    cyc_set_controller(1, s_pad[1]);
    cyc_run_frame();
    s_audio_n = cyc_audio_read(s_audio, AUDIO_BUF_SAMPLES);
    return (int)s_audio_n;
}

/* Soft reset to power-on state (same cartridge). */
SMB_EXPORT void smb_reset(void)
{
    if (!s_ready) return;
    cyc_power_on(0);
    cyc_run_power_on();
    s_audio_n = 0;
}

/* 256x240 uint16 PPU color indices (6-bit color | emphasis << 6) for JS-side palettes. */
SMB_EXPORT const uint16_t *smb_video_index(void) { return cyc_frame_index(); }

/* 256x240 pixels as bytes R,G,B,A (ready for canvas ImageData). */
SMB_EXPORT const uint32_t *smb_video_rgba(void)
{
    const uint32_t *src = cyc_frame_argb();
    for (int i = 0; i < 256 * 240; i++) {
        uint32_t p = src[i];
        s_rgba[i] = 0xFF000000u | ((p & 0xFFu) << 16) | (p & 0xFF00u) | ((p >> 16) & 0xFFu);
    }
    return s_rgba;
}
SMB_EXPORT const int16_t  *smb_audio(void) { return s_audio; }
SMB_EXPORT int smb_audio_rate(void)        { return AUDIO_RATE; }
SMB_EXPORT double smb_frame_seconds(void)  { return cyc_frame_seconds(); }
SMB_EXPORT uint32_t smb_prg_hash(void)     { return cyc_prg_hash(); }
