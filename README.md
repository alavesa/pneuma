# pneuma

Audio-reactive particle field with a guided breathing mode. Pure WebGL2, no build step.

![WebGL2](https://img.shields.io/badge/WebGL2-transform%20feedback-7cf)
![License](https://img.shields.io/badge/license-MIT-lightgray)

## Modes

**Off** — passive curl-noise flow field. Move the cursor to interact (swipe to fling, click-hold to push, space to pull).

**Audio** — react to a microphone or an audio file. Bass drives point size and radial pulses, mid shapes turbulence, treble adds sparkle and color shift.

**Breathe** — guided breathing. Four patterns (Box 4·4·4·4, Calm 4·7·8, Resonant 5.5, Energize 6·2·4·2). The field converges on inhale and expands on exhale; a centered ring and cue text pace you through each cycle.

## Run it

No build system required. Serve the folder with any static server:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Or open `index.html` directly in a browser that allows `file://` WebGL2.

## Under the hood

- 10k–400k particles simulated on the GPU via **transform feedback** (WebGL2)
- Flow driven by **curl noise** of a scalar hash field (divergence-free, swirls without collapse)
- Additive trails into an RGBA16F (`EXT_color_buffer_float`) framebuffer with per-frame fade
- Audio analysis with `AnalyserNode` — bands averaged with slow-rise / fast-fall smoothing
- Breathing phase is a single signed scalar (+1 inhale → −1 exhale) eased into shader uniforms
- Proper `devicePixelRatio` handling and modulo-wrapped simulation space, so no hazy scaling or off-screen tunneling

## License

[MIT](./LICENSE)
