[← Back to README](../README.en.md) · [简体中文](performance.md) | **English**

# Resource usage

Measured on Apple Silicon (M1 Max) with the same T3 data: the official 0.1.13 and T3 Code Extensions (with the author's four extensions plus one community extension) were each measured for 40 seconds, 75 seconds after launch, idle with the window in front. CPU is per core.

| Process | Official 0.1.13 | T3 Code Extensions |
|---|---|---|
| UI (renderer) CPU | 1.1% | 2.7% |
| GPU process CPU | 1.6% | 2.7% |
| Backend CPU | 0.5% | 0.5% |
| UI memory | 184 MB | 196 MB |
| GPU process memory | 274 MB | 290 MB |
| Backend memory | 218 MB | 217 MB |

- The extra ~3% CPU and ~30 MB of memory are all in the UI and GPU processes; the backend is the same. Turning extensions off one by one shows that nearly all of it comes from the desk pets' frame animations and sprite sheets (one per pet, about 8 MB decoded). Edge glow only lights up for a moment when it alerts you, and the effort slider only animates while its panel is open, so neither costs anything measurable otherwise.
- The host doesn't poll while idle: the UI only watches `<html lang>` for changes, and the backend only watches the folder that holds the background extensions.
- When the window is in the background or covered, Chromium pauses animation and repainting, and the UI and GPU processes stay around 1%.
- UI memory grows with use: after about 75 minutes with one very long thread open, the UI was at 701 MB and the GPU process at 594 MB; after a restart with the same extensions they were back to about 200 MB and 290 MB. So the growth is mostly T3's own thread data and UI caches, and restarting the app brings it back down.
- Each case was measured once, so differences of a percentage point or two may be noise.
