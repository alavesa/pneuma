# pneuma

A single canvas for music visualization, focus sessions, and ambient screensavers. Audio-reactive particle field with a guided breathing mode — pure WebGL2, no build step.

The name is Greek — *pneuma*: breath, spirit, the force that sustains consciousness. Fitting, given one of the modes is a breathing coach.

**[→ Try it live](https://alavesa.github.io/pneuma/)**

![WebGL2](https://img.shields.io/badge/WebGL2-transform%20feedback-7cf)
![License](https://img.shields.io/badge/license-MIT-lightgray)

<!-- TODO: add ./docs/preview.gif (a short loop of Breathe mode or an audio reaction) -->

## Controls

Swipe to fling particles · click-hold to push · hold space to pull. Works in every mode.

## Modes

**Off** — passive curl-noise flow field.

**Audio** — react to a microphone or an audio file. Bass drives point size and radial pulses, mid shapes turbulence, treble adds sparkle and color shift.

**Breathe** — guided breathing. Five patterns (Box 4·4·4·4, Calm 4·7·8, Lengthen 4·4·8, Resonant 5·5, Energize 6·2·4·2). The field converges on inhale and expands on exhale; a centered ring and cue text pace you through each cycle.

### Why breathe

Slow, deep breathing stimulates the vagus nerve, which signals the brain that the fight-or-flight response isn't needed and shifts the body into a parasympathetic "rest and digest" state — lowering heart rate, blood pressure, and perceived anxiety. The *Lengthen* (4·4·8) pattern is the one respiratory researcher Nicholas Tiller specifically recommends; a 2023 review he co-authored in the *European Journal of Applied Physiology* separates the evidence-backed effects of slow deep breathing from the marketing-driven noise around other "breathing interventions."

Further reading: *[The science is clear: Deep breathing can be a game changer for anyone](https://www.nytimes.com/athletic/6321893/2025/05/01/the-science-is-clear-deep-breathing-can-be-a-game-changer-for-anyone-elite-athletes-agree/)* — The Athletic, 2025.

## Run it locally

Serve the folder with any static server — modern browsers block WebGL2 on `file://` for security, so don't just double-click the HTML.

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Under the hood

- 10k–400k particles simulated on the GPU via **transform feedback** (WebGL2)
- Flow driven by **curl noise** of a scalar hash field (divergence-free, swirls without collapse)
- Additive trails into an RGBA16F (`EXT_color_buffer_float`) framebuffer with per-frame fade
- Audio analysis with `AnalyserNode` — bands averaged with slow-rise / fast-fall smoothing
- Breathing phase is a single signed scalar (+1 inhale → −1 exhale) eased into shader uniforms
- Proper `devicePixelRatio` handling and modulo-wrapped simulation space, so no hazy scaling or off-screen tunneling

## See also

- [rpbk/tempolux](https://github.com/rpbk/tempolux)

## License

[MIT](./LICENSE)
