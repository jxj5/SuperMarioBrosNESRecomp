/* native headless test: run N frames, dump PPM + audio stats */
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
int  smb_init(const uint8_t*, int);
void smb_set_input(int, int);
int  smb_frame(void);
const uint16_t *smb_video_index(void); const uint32_t *smb_video_rgba(void); void smb_reset(void); 
const int16_t *smb_audio(void);
uint32_t smb_prg_hash(void);
static const char *OUT = ".";
static char *P(const char *n){ static char b[4][512]; static int k; k=(k+1)&3; snprintf(b[k],512,"%s/%s",OUT,n); return b[k]; }
static void dump(const char *p) {
    FILE *f = fopen(p, "wb"); fprintf(f, "P6\n256 240\n255\n");
    const uint32_t *v = smb_video_rgba();
    for (int i = 0; i < 256*240; i++) { uint8_t c[3] = {v[i], v[i]>>8, v[i]>>16}; fwrite(c,1,3,f); }
    fclose(f);
}
int main(int argc, char **argv) {
    if (argc > 2) OUT = argv[2];
    FILE *f = fopen(argv[1], "rb"); fseek(f,0,SEEK_END); long n = ftell(f); fseek(f,0,SEEK_SET);
    uint8_t *rom = malloc(n); fread(rom,1,n,f); fclose(f);
    if (!smb_init(rom, (int)n)) { puts("init failed"); return 1; }
    printf("prg hash rt=%08x\n", smb_prg_hash());
    long total = 0; int peak = 0;
    for (int fr = 0; fr < 1500; fr++) {
        /* scripted input: press Start around frame 200, then run right + jump */
        int b = 0;
        if (fr >= 200 && fr < 210) b = 0x10;              /* Start */
        if (fr >= 400) b = 0x01 | ((fr/20)%2 ? 0x80 : 0); /* Right + A pulses */
        if (fr == 700) { smb_reset(); }
        if (fr >= 700) { b = 0; }
        smb_set_input(0, b);
        int s = smb_frame(); total += s;
        const int16_t *a = smb_audio();
        for (int i = 0; i < s; i++) { int v = abs(a[i]); if (v > peak) peak = v; }
        char name[64];
        if (fr == 600) { FILE *g=fopen(P("idx600.bin"),"wb"); fwrite(smb_video_index(),2,256*240,g); fclose(g); g=fopen(P("rgba600.bin"),"wb"); fwrite(smb_video_rgba(),4,256*240,g); fclose(g);} if (fr == 100 || fr == 300 || fr == 600 || fr == 800 || fr == 1200) { sprintf(name, "f%04d.ppm", fr); dump(P(name)); }
    }
    printf("audio samples=%ld peak=%d\n", total, peak);
    return 0;
}
