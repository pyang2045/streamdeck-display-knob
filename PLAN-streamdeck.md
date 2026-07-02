# Plan: Stream Deck plugin — LG 32U990A input switching

Goal: physical Stream Deck buttons that switch the LG UltraFine 32U990A between
Thunderbolt (Mac), HDMI (Xbox), and DisplayPort, with live active-input feedback
on the keys. Builds directly on the verified findings in `RESEARCH.md`.

## Why a native plugin (not System→Open hacks)

- Buttons need **state feedback** (highlight the active input) → requires a
  long-running plugin process that polls, not fire-and-forget scripts.
- Retry-and-verify switching logic (writes get dropped) belongs in code, not in
  a one-shot shell command.
- The Stream Deck is the ideal "switch back to Mac" device: DDC from the Mac
  usually stays alive while the monitor shows the Xbox, so a key press still
  works even when you can't see the Mac's screen.

## Architecture

```
Stream Deck app (7.4.2)
  └─ display-knob plugin (Elgato SDK v2, Node 20 runtime, TypeScript)
       ├─ actions/switch-input.ts   "Switch Input" key action (target set in PI)
       ├─ actions/cycle-input.ts    optional: cycle TB → HDMI → DP → TB
       ├─ display-controller.ts     all DDC logic (single shared instance)
       └─ m1ddc                     bundled universal binary (MIT), execFile'd
```

### display-controller.ts (the core)

Wraps `m1ddc`, encoding every hard-won rule from RESEARCH.md:

- Address the display by UUID `041B0EA8-173D-41AF-B60D-A63236F45C02`
  (configurable; auto-discover first LG ULTRAFINE as fallback).
- `setInput(target)`: write LG-alt codes — **210 = Thunderbolt, 144 = HDMI,
  208 = DisplayPort** (VCP 0xF4 via `set input-alt`; never standard `set input`).
  Then verify-with-retry: re-send every ~4 s until the luminance probe matches
  the target profile, give up after ~20 s and mark the key "failed" briefly.
- `getActiveInput()`: luminance probe — per-input brightness profiles identify
  the source (currently TB=26, DP=30, HDMI=90). Profile map lives in plugin
  settings so it can be re-learned if brightness changes. "Display not
  enumerated" ⇒ TB link down ⇒ definitely not on Thunderbolt.
- Poller singleton: probe every ~4 s (one ~50 ms DDC read), broadcast to all
  visible action instances; pause while a switch is in flight; tolerate the
  display vanishing/re-enumerating (~30 s) without crashing.

### Actions & UI

- **Switch Input** key: Property Inspector dropdown (Thunderbolt / HDMI /
  DisplayPort). Key shows input glyph; SDK `setState` highlights when its
  input is active; brief ✓/✗ overlay after a switch attempt.
- **Cycle Input** key (optional, v2).
- Stretch (only if the device is a Stream Deck + with dials): brightness dial
  action using `chg luminance ±n` — the literal "display knob".

## Implementation steps

1. **Scaffold**: `npm i -g @elgato/cli`, then `streamdeck create` →
    `com.pyang.display-knob.sdPlugin`, TypeScript template, in
    `streamdeck-plugin/` inside this repo.
2. **DisplayController**: port lg.sh logic to TS (`execFile` m1ddc); unit-test
   the retry/verify state machine with a mocked m1ddc.
3. **Switch Input action**: settings, key handler, state updates from poller.
4. **Bundle m1ddc**: copy universal binary into the .sdPlugin, spawn relative
   to plugin root (removes the Homebrew dependency); keep a settings override
   for a custom path.
5. **Icons**: three input glyphs (TB bolt / HDMI+game / DP), active + inactive
   states, plus transient success/fail overlays.
6. **On-device testing** (Xbox powered on): TB→HDMI→TB, TB→DP→TB, mashing keys
   mid-switch, link-drop recovery (leave it on DP until the TB link drops, then
   press the TB key repeatedly), Stream Deck app restart while on HDMI.
7. **Package & install**: `streamdeck pack`, double-click install; commit the
   .streamDeckPlugin artifact to a release, not the repo.

## Risks / notes

- The monitor sometimes ignores a switch to a signal-less input (Xbox asleep):
  surface as ✗ feedback rather than silent failure.
- Luminance-profile collisions: if two inputs get the same brightness the probe
  is ambiguous — offer a "re-learn profiles" helper in the PI, or later switch
  the marker to per-input volume values.
- If the plugin ever needs lower latency than spawning m1ddc (~100 ms), swap in
  a small native helper linked against libm1ddc — not needed for v1.
