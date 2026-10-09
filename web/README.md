# Super Mario Bros. en el navegador (WebAssembly)

Port web del runtime *cycle-accurate* de [nesrecomp](https://github.com/mstan/nesrecomp) /
[SuperMarioBrosNESRecomp](https://github.com/mstan/SuperMarioBrosNESRecomp).

El `.wasm` contiene **solo el emulador** (CPU, PPU, APU, mappers). No lleva la ROM ni código generado a
partir de la ROM: cada jugador carga su propio `.nes` (o un `.zip` que lo contenga) en la página, y se
procesa localmente en el navegador.

## Cómo se usa

Copiá `web/` y `.github/` en la raíz de tu checkout de `SuperMarioBrosNESRecomp` (el que tiene `nesrecomp/` al lado).

**Opción A – GitHub Pages (no instalás nada):** subí el repo a tu GitHub, activá *Settings → Pages → Source: GitHub Actions*
y el workflow `web.yml` compila y publica el sitio.

**Opción B – local:** instalá [emsdk](https://emscripten.org/docs/getting_started/downloads.html), activalo en la terminal y:

    python web/build_web.py
    python -m http.server -d web/dist 8000      # abrir http://localhost:8000

(Hay que servirlo por HTTP; `file://` no puede cargar el `.wasm`.)

## Qué hay

| Archivo | Para qué |
|---|---|
| `smb_web.c` | Host mínimo en C: `smb_init / smb_frame / smb_set_input / smb_video_index / smb_audio / smb_reset`. Sin SDL, sin hilos, sin bucle bloqueante: el navegador manda el ritmo. |
| `app.js`, `index.html` | Canvas, WebAudio (AudioWorklet), teclado, gamepad, controles táctiles, ROM `.nes`/`.zip` + drag&drop, paletas, pausa, pantalla completa. |
| `build_web.py` | Compila con `emcc`. La lista de fuentes es la del backend *cycle*, sin SDL/ImGui/red/archivos. |
| `tests/run_tests.sh` | Prueba nativa (gcc + node) del mismo core y host que entra al wasm. |

## Qué está verificado y qué no

Verificado en Linux x86-64 con gcc, usando tu ROM:
- El core + `smb_web.c` enlazan sin código generado y corren: título, “WORLD 1-1” y gameplay (puntaje, enemigos, tuberías), 1500 frames de input scripteado, audio ≈ 800 muestras/frame.
- Salida **idéntica frame a frame** entre el intérprete y el código recompilado (mismo md5 en 4 capturas).
- El reset vuelve al estado de encendido exacto. La paleta de `app.js` coincide píxel a píxel con la del core; el lector de ZIP/CRC32 funciona con tu zip.
- Rendimiento nativo del intérprete: ~130 fps (≈ 2x tiempo real).

**No verificado** (no tuve `emcc` ni navegador en mi entorno): la compilación con Emscripten y la ejecución en un navegador real
(canvas, AudioWorklet, gamepad, táctil). Si `emcc` o la página fallan, pegame el error y lo ajusto.
En WebAssembly el emulador rinde menos que nativo; si en un equipo lento no llega a 60 fps, el bucle descarta frames sin romper el audio.

## Notas

- **Paleta:** la decodificación NTSC del core pone el cielo violeta. “Paleta clásica” aplica una rotación de tono de 28° (cielo azul). La “original del proyecto” es idéntica al core.
- **Licencia:** el runtime es **PolyForm Noncommercial 1.0.0** (uso no comercial); `build_web.py` copia su aviso y el de emu2413 (MIT) a `dist/`. No subas ROMs de Nintendo a ningún sitio público.
- Este port usa el intérprete 6502 del core, no el código recompilado; por eso no hace falta compilar nada generado desde la ROM. Los mods del repo (widescreen, voxel, etc.), netplay y el launcher de escritorio no se incluyen.
