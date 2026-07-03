import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import streamDeck from "@elgato/streamdeck";

export type InputSource = "tb" | "hdmi" | "dp";

/**
 * LG 32" UltraFine evo 6K (32U990A) inputs: the LG-alt switch code (m1ddc
 * `set input-alt`, VCP 0xF4 — standard VCP 0x60 writes are silently ignored)
 * and the short label rendered on the key.
 */
export interface InputInfo {
  code: number;
  label: string;
}
export const INPUTS: Record<InputSource, InputInfo> = {
  tb: { code: 210, label: "TB" }, // Thunderbolt 5 (LG "USB-C" slot)
  hdmi: { code: 144, label: "HDMI" }, // HDMI 1
  dp: { code: 208, label: "DP" }, // DisplayPort 1
};

const DEFAULT_UUID = "041B0EA8-173D-41AF-B60D-A63236F45C02";

/**
 * Design: switch BLINDLY, guarded by a time lock.
 *
 * The monitor offers no trustworthy input readback (VCP 0x60 lies, 0xF4 is
 * write-only), and inferring the input from per-input brightness profiles
 * broke whenever brightness was changed via the monitor's own joystick. So
 * we don't verify: send the switch command once, remember what we commanded,
 * and refuse further switches for SWITCH_LOCK_MS (re-sending mid-transition
 * restarts the link handshake and flashes the screen; rapid-fire writes have
 * been seen to wedge the monitor's input mechanism entirely).
 */
const SWITCH_LOCK_MS = 5000;

export type SwitchResult = "ok" | "failed" | "locked";

class DisplayController {
  private displayUuid = DEFAULT_UUID;
  private m1ddcBin?: string;
  private listeners = new Set<(active: InputSource) => void>();
  /** The input we last commanded — shown as "active" on the keys. */
  private assumedInput: InputSource = "tb";
  /** Speaker mute state — unreadable over DDC, so tracked by assumption. */
  private assumedMuted = false;
  private lockedUntil = 0;

  async init(): Promise<void> {
    const settings = await streamDeck.settings.getGlobalSettings<{ uuid?: string }>();
    if (settings.uuid) this.displayUuid = settings.uuid;
    await this.discoverDisplay();
    streamDeck.logger.info(`display uuid: ${this.displayUuid}`);
  }

  private m1ddcPath(): string {
    if (this.m1ddcBin) return this.m1ddcBin;
    const bundled = path.join(path.dirname(fileURLToPath(import.meta.url)), "m1ddc");
    this.m1ddcBin = existsSync(bundled) ? bundled : "/opt/homebrew/bin/m1ddc"; // dev fallback
    return this.m1ddcBin;
  }

  private m1ddcRaw(...args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(this.m1ddcPath(), args, { timeout: 5000 }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });
  }

  private m1ddc(...args: string[]): Promise<string> {
    return this.m1ddcRaw("display", this.displayUuid, ...args);
  }

  /** Find the LG UltraFine automatically so no configuration is needed. */
  async discoverDisplay(): Promise<boolean> {
    try {
      const out = await this.m1ddcRaw("display", "list");
      const displays: { name: string; uuid: string }[] = [];
      for (const line of out.split("\n")) {
        const m = line.match(/^\[\d+\]\s+(.+?)\s+\(([0-9A-Fa-f-]{36})\)/);
        if (m) displays.push({ name: m[1], uuid: m[2] });
      }
      const lg = displays.find((d) => /ULTRAFINE/i.test(d.name)) ?? displays.find((d) => /^LG\b/i.test(d.name));
      if (!lg) return false;
      if (lg.uuid !== this.displayUuid) {
        streamDeck.logger.info(`discovered display "${lg.name}" (${lg.uuid})`);
        this.displayUuid = lg.uuid;
        await streamDeck.settings.setGlobalSettings({ uuid: this.displayUuid });
      }
      return true;
    } catch {
      return false;
    }
  }

  // ---- input switching (blind, time-locked) ----

  async setInput(target: InputSource): Promise<SwitchResult> {
    if (Date.now() < this.lockedUntil) return "locked";
    this.lockedUntil = Date.now() + SWITCH_LOCK_MS;
    try {
      await this.sendSwitch(target);
    } catch (e) {
      // Stale UUID (display re-enumerated)? Rediscover and try once more.
      streamDeck.logger.warn(`switch write failed, rediscovering: ${e}`);
      if (!(await this.discoverDisplay())) return "failed";
      try {
        await this.sendSwitch(target);
      } catch (e2) {
        streamDeck.logger.error(`switch write failed after rediscovery: ${e2}`);
        return "failed";
      }
    }
    this.assumedInput = target;
    this.notify();
    return "ok";
  }

  private async sendSwitch(target: InputSource): Promise<void> {
    streamDeck.logger.info(`setInput ${target} (input-alt ${INPUTS[target].code})`);
    await this.m1ddc("set", "input-alt", String(INPUTS[target].code));
  }

  /** Last commanded input — the plugin's (unverified) view of the world. */
  get active(): InputSource {
    return this.assumedInput;
  }

  // ---- brightness / volume (VCP 0x10 / 0x62 — honest readback) ----

  /** Change brightness by delta; returns the new value, or null on failure. */
  changeBrightness(delta: number): Promise<number | null> {
    return this.changeVcp("luminance", delta);
  }

  /** Change speaker volume by delta; returns the new value, or null on failure. */
  changeVolume(delta: number): Promise<number | null> {
    return this.changeVcp("volume", delta);
  }

  private async changeVcp(vcp: string, delta: number): Promise<number | null> {
    try {
      const out = await this.m1ddc("chg", vcp, String(delta));
      const v = parseInt(out, 10);
      return Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
    } catch {
      return null;
    }
  }

  // ---- mute (VCP 0x8D — blind toggle, state tracked by assumption) ----

  get muted(): boolean {
    return this.assumedMuted;
  }

  /** Toggle mute; returns the new state, or null on failure. */
  async toggleMute(): Promise<boolean | null> {
    const next = !this.assumedMuted;
    try {
      await this.m1ddc("set", "mute", next ? "on" : "off");
      this.assumedMuted = next;
      return next;
    } catch {
      return null;
    }
  }

  // ---- key refresh notifications ----

  onActiveChanged(listener: (active: InputSource) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) {
      try {
        l(this.assumedInput);
      } catch (e) {
        streamDeck.logger.error(`listener error: ${e}`);
      }
    }
  }
}

export const displayController = new DisplayController();
