# streamdeck-display-knob

A Stream Deck plugin — and the DDC research behind it — for controlling the
**LG 32" UltraFine evo 6K (32U990A)** from a Mac: switch inputs, adjust
brightness and speaker volume, and toggle mute, all over DDC/CI.

Built and tested on Apple Silicon (M4 Pro, macOS 26) with a Stream Deck XL.

## Features

- **Switch Input** keys — Thunderbolt, HDMI, DisplayPort. The active input is
  highlighted; presses are guarded by a 5-second lock so rapid taps can't
  wedge the monitor mid-transition.
- **Brightness Up/Down** keys — one step per press, value shown on the key.
- **Volume Up/Down** keys — speaker volume over DDC (VCP 0x62).
- **Mute** toggle.
- Auto-discovers the display; no configuration needed.

## Why it works the way it does

This monitor has some hard-won DDC quirks — the standard input register lies on
read, the real input switch lives in an LG vendor register (VCP 0xF4), and
brightness is per-input. The plugin therefore **switches blindly and tracks
state by assumption** rather than trusting readback. The full investigation,
with the verified VCP codes and dead ends, is in
[RESEARCH.md](RESEARCH.md).

## Install

Download `com.sheepy.display-knob.streamDeckPlugin` and double-click it, or
build from source:

```bash
cd streamdeck-plugin
npm install
npm run build
```

Then link/copy `streamdeck-plugin/com.sheepy.display-knob.sdPlugin` into
`~/Library/Application Support/com.elgato.StreamDeck/Plugins/`.

Requires the [m1ddc](https://github.com/waydabber/m1ddc) binary — a universal
copy is bundled in the plugin; nothing else to install.

## Command-line helper

[`lg.sh`](lg.sh) exposes the same controls from a terminal:

```bash
./lg.sh tb            # switch to Thunderbolt (also: hdmi, dp)
./lg.sh bri +10       # brightness relative (or an absolute 0–100)
./lg.sh status        # current brightness
```

## Layout

- `streamdeck-plugin/` — the Stream Deck plugin (TypeScript, Elgato SDK v2)
- `lg.sh` — standalone DDC control script
- `RESEARCH.md` — DDC investigation and verified VCP codes
- `PLAN-streamdeck.md` — plugin design notes

## Credits

Bundles [m1ddc](https://github.com/waydabber/m1ddc) by waydabber (MIT) for DDC
over `IOAVService` on Apple Silicon.

## License

[MIT](LICENSE)
