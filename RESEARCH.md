# Research: Programmatic control of LG UltraFine 32U990A (brightness / input source)

Date: 2026-07-02
Test machine: MacBook Pro (M4 Pro), macOS Darwin 25.5.0, display connected over Thunderbolt as main display (6144×3456 @ 60 Hz).

## TL;DR — Yes, it is controllable

**DDC/CI works on the 32U990A over Thunderbolt on Apple Silicon.** Brightness read/write was verified live on this machine with `m1ddc`. The input-source VCP register is readable, so input switching via DDC should also work. Additionally, the display exposes a vendor USB HID channel ("LG Monitor Controls") that LG's own software uses.

## Empirical results (verified on this machine)

### 1. DDC/CI via `m1ddc` — WORKS ✅

```console
$ brew install m1ddc
$ m1ddc display list
[1] LG ULTRAFINE (041B0EA8-173D-41AF-B60D-A63236F45C02)
[2] EV2730Q (A6B2800F-CCF7-4DAE-A0C1-2D7206E497D0)

$ m1ddc display 1 get luminance
26
$ m1ddc display 1 set luminance 30   # verified: readback returned 30
$ m1ddc display 1 set luminance 26   # restored
$ m1ddc display 1 get input
15                                   # 0x0F = DisplayPort (Thunderbolt tunnels DP)
```

Notes:
- On Apple Silicon, DDC goes through `IOAVService`/`DCPAVServiceProxy` (two `Location=External` instances present, one per external display). `m1ddc`, BetterDisplay, and Lunar all use this path.
- The very first DDC attempt right after install failed with "Could not find a suitable external display"; a retry seconds later worked. Treat DDC as occasionally flaky — add one retry in any tooling.

### 1b. Input switching via DDC — WORKS ✅ (tested live, with caveats)

Round-trip switching was verified repeatedly with the user watching the OSD (Xbox on HDMI, Mac on Thunderbolt 5):

```console
m1ddc display <uuid> set input 16   # → HDMI (Xbox appeared; luminance probe confirmed)
m1ddc display <uuid> set input 17   # → DisplayPort input
m1ddc display <uuid> set input 15   # → back to Thunderbolt (Mac)
```

**The code map is positional, not the standard MCCS table.** Best-fit mapping from all observations: `15 = Thunderbolt`, `16 = HDMI`, `17 = DisplayPort` — i.e. codes DP1/DP2/HDMI1 select OSD inputs 1/2/3. LG-alternate codes (`set input-alt` 144/145/208–210, VCP 0xF4) and standard 18/19/20/5/6/27 did nothing observable.

Hard-won caveats (all observed live):

1. **`get input` readback lies.** It always returns 15 over the Thunderbolt link regardless of the OSD's active input. Never use it for verification.
2. **Luminance readback is a working active-input probe.** The monitor keeps per-input brightness profiles and `get luminance` returns the *active* input's value (TB profile read 26; while showing HDMI it read 90). Poll it to detect whether a switch actually happened.
3. **Signal-dependent behavior.** Switching to an input with no live signal is unreliable: with the Xbox in standby all HDMI codes were silently ignored; with the Xbox awake `set input 16` switched to it. Once the Xbox blanked its output again, `16` fell through to the DisplayPort input instead. Dead-input targets may be refused or redirected.
4. **Restores can need retries.** Returning from the dead DP input via `set input 15` worked first try; returning from the *live* HDMI input once required several attempts (write apparently dropped during signal handshake). Retry `set input 15` every ~4 s until the luminance probe shows the TB profile value.
5. **The DDC channel from the Mac stays alive no matter which input is displayed** (luminance stayed readable while the OSD showed HDMI/DP), so programmatic recovery is always possible — the "switching away severs DDC" fear did not materialize on this monitor.
6. DDC capabilities-string reads (0xF3/0xE3 chunked protocol) fail on this display (and on the EIZO via the same code path), so the value map couldn't be read out — it was derived empirically.

### 2. Apple-native brightness (DisplayServices) — NOT available ❌

Unlike the older LG UltraFine 5K (27MD5KL), which macOS drives like an Apple display, `DisplayServicesCanChangeBrightness()` returns `false` and `DisplayServicesGetBrightness()` errors (1000) for this display. So macOS brightness keys / CoreDisplay APIs are not the control path — use DDC instead.

### 3. Vendor USB HID channel — exists, protocol unknown 🟡

The display enumerates a USB HID device over the Thunderbolt link:

- **"LG Monitor Controls"** — VID `0x043E` (LG), PID `0x9A39`, usage page `0xFF00`, usage 1
- Report descriptor: no report IDs; 64-byte Input + 64-byte Output + 64-byte Feature reports — i.e. a generic bidirectional 64-byte packet pipe (a command protocol, presumably what LG Switch / OnScreen Control speaks)
- Device opens fine from user space via `IOHIDManager`; feature-report reads return zeros (the protocol is command/response over output+input reports, not static feature registers)
- This is *not* the simple 2-byte brightness feature report of the UltraFine 5K family — reverse-engineering would require sniffing LG's software

Conclusion: HID is a viable second path but needs protocol RE. DDC is the practical path.

## Recommended approach for display-knob

1. **Brightness:** `m1ddc display 1 set luminance N` (0–100), or link `libm1ddc` / talk to `IOAVService` directly for lower latency. For a knob, use `m1ddc ... chg luminance ±N` for relative steps.
2. **Input source:** `m1ddc display <uuid> set input <code>` with the positional map 15=TB / 16=HDMI / 17=DP. Verify success by polling `get luminance` (per-input profiles differ), retry the write until the expected profile value appears, and expect dead inputs to refuse or redirect the switch.
3. Identify the display by UUID (`041B0EA8-...`) rather than list index, since ordering can change: `m1ddc display 041B0EA8-173D-41AF-B60D-A63236F45C02 set luminance N`.
4. Alternatives: BetterDisplay CLI (installed copy is v2.0.11 and currently fails to launch its CLI on this OS — would need upgrade), Lunar CLI, or direct IOKit code copied from the m1ddc source (MIT).

## Web research findings (compiled 2026-07-02)

### Hardware context

Three video inputs: **Thunderbolt 5 upstream** (DP alt mode, 96W PD), **HDMI 2.1**, **DisplayPort 2.1**. Plus a TB5 *downstream* port (daisy-chain out — not an input), a USB-C 3.2 Gen 2 upstream (data/hub only), and 2× USB-C downstream.
Sources: [Newsshooter](https://www.newsshooter.com/2025/12/18/lg-ultrafine-evo-32u990a-s-monitor-32-6k-resolution-display-with-thunderbolt-5/), [PCWorld review](https://www.pcworld.com/article/3046133/lg-ultrafine-evo-32u990a-s-review.html), [MacRumors review](https://www.macrumors.com/review/lg-ultrafine-6k-32u990a-display/).

### DDC/CI — confirmed by owners too

- A 32U990A-S owner in [BetterDisplay discussion #5439](https://github.com/waydabber/BetterDisplay/discussions/5439): "It works great with BetterDisplay… Brightness/Volume buttons… adjust the monitor's brightness and volume" — BetterDisplay uses DDC over IOAVService, so this confirms VCP 0x10 (luminance) and 0x62 (volume) respond over TB5.
- [Kevin Dees's owner writeup](https://kevdees.com/switching-from-dual-lg-ultrafine-5k-displays-to-the-lg-32u990a-s-6k) recommends keeping LG Switch uninstalled and using Lunar (also DDC-based) instead.
- Known issue: black screen after wake on macOS Tahoe 26.5 with BetterDisplay 4.3.4 + this monitor — attributed to custom color-table adjustments, not DDC ([#5504](https://github.com/waydabber/BetterDisplay/discussions/5504)).

### No Apple-native brightness path (matches our DisplayServices test)

Unlike the UltraFine 5K (27MD5KL), this model does **not** implement Apple's proprietary backlight protocol. LG instead ships the **LG Switch** app: per the [MacRumors review](https://www.macrumors.com/review/lg-ultrafine-6k-32u990a-display/), keyboard brightness/volume keys "require the LG Switch app," and [LG's product page](https://www.lg.com/us/monitors/lg-32u990a-s-ultrafine-monitor) notes Mac keyboard control needs display firmware ≥ 3.05 (updated via LG Switch). This is consistent with our local finding that `DisplayServicesCanChangeBrightness` returns false — the vendor HID channel we found (PID 0x9A39) is presumably what LG Switch speaks.

### Input switching — no model-specific report, but likely works

- No published report of VCP 0x60 switching on this exact model; LG monitors broadly honor it with **standard values** (DP1=15, DP2=16, HDMI1=17, HDMI2=18, USB-C=27) and **LG-alternate values** (DP1=208, DP2=209, USB-C=210, HDMI often 0x90/0x91) — see [m1ddc README](https://github.com/waydabber/m1ddc) (`set input` vs `set input-alt`). Our read of 15 (DP1) while on the TB5 input fits the standard table.
- **Gotcha for display-knob:** switching input *away* from this Mac severs the Mac's DDC path — you can't switch back from the same machine. Options: monitor joystick, a controller running on the other input's source, or LG's **Dual Controller** app (PC-to-PC input switching + KVM, listed on [LG's support page](https://www.lg.com/us/support/product/lg-32U990A-S.AUS)).

### LG software — GUI only

LG Switch (Mac/Win), Dual Controller, LG Calibration Studio; OnScreen Control is superseded by LG Switch for this model. **No CLI, scripting hooks, or SDK.** Owner complaints: LG Switch hijacks volume routing and demands broad permissions/sign-in ([kevdees.com](https://kevdees.com/switching-from-dual-lg-ultrafine-5k-displays-to-the-lg-32u990a-s-6k), [diglloyd](https://diglloyd.com/blog/2025/20251105_122-LG-6K.html)). Consensus: use it only for firmware updates.

### Cross-platform notes

- **Linux:** `ddcutil detect && ddcutil capabilities && ddcutil setvcp 10 60 && ddcutil setvcp 60 0x0f` — no model-specific reports; likely fine over HDMI/DP, TB depends on GPU i2c path.
- **Windows:** ControlMyMonitor (`ControlMyMonitor.exe /SetValue Primary 10 60`), Monitorian, [ddcswitch](https://github.com/markdwags/ddcswitch) for input switching.
- **Other macOS tools:** Lunar CLI (`lunar set brightness 60`), MonitorControl (brightness/volume keys only, no input switching), BetterDisplay CLI (needs upgrade from the locally installed 2.0.11).

## Bottom line

| Capability | Verdict | Path |
|---|---|---|
| Brightness (read/write) | **Confirmed, tested locally** | DDC VCP 0x10 via `m1ddc` / IOAVService |
| Volume | Confirmed by owners | DDC VCP 0x62 |
| Input source (read) | Readable but **useless** — always returns 15 | Use `get luminance` per-input profile as active-input probe |
| Input source (switch) | **Confirmed, tested locally** (round-trips observed) | DDC VCP 0x60, positional codes: 15=TB, 16=HDMI, 17=DP; retry + luminance-verify; dead inputs may refuse |
| Apple-native brightness | Not supported | — (LG Switch app replaces it; vendor HID PID 0x9A39, protocol undocumented) |

