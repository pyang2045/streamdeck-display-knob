import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import streamDeck from "@elgato/streamdeck";

export type InputSource = "tb" | "hdmi" | "dp";

/**
 * LG 32" UltraFine evo 6K (32U990A) input codes.
 * Only the LG-alt register (m1ddc `set input-alt`, VCP 0xF4) switches reliably;
 * standard VCP 0x60 writes are silently ignored by this monitor.
 */
const INPUT_ALT_CODE: Record<InputSource, number> = {
  tb: 210, // Thunderbolt 5 (LG "USB-C" slot)
  hdmi: 144, // HDMI 1
  dp: 208, // DisplayPort 1
};

export const INPUT_LABEL: Record<InputSource, string> = {
  tb: "Thunderbolt",
  hdmi: "HDMI",
  dp: "DisplayPort",
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
  private listeners = new Set<(active: InputSource) => void>();
  /** The input we last commanded — shown as "active" on the keys. */
  private assumedInput: InputSource = "tb";
  private lockedUntil = 0;

  async init(): Promise<void> {
    const settings = await streamDeck.settings.getGlobalSettings<{ uuid?: string }>();
    if (settings.uuid) this.displayUuid = settings.uuid;
    await this.discoverDisplay();
    streamDeck.logger.info(`display uuid: ${this.displayUuid}`);
  }

  private m1ddcPath(): string {
    const bundled = path.join(path.dirname(fileURLToPath(import.meta.url)), "m1ddc");
    if (existsSync(bundled)) return bundled;
    return "/opt/homebrew/bin/m1ddc"; // dev fallback
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
    streamDeck.logger.info(`setInput ${target} (input-alt ${INPUT_ALT_CODE[target]})`);
    await this.m1ddc("set", "input-alt", String(INPUT_ALT_CODE[target]));
  }

  /** Last commanded input — the plugin's (unverified) view of the world. */
  get active(): InputSource {
    return this.assumedInput;
  }

  // ---- brightness ----

  /** Change brightness by delta; returns the new value, or null on failure. */
  async changeBrightness(delta: number): Promise<number | null> {
    try {
      const out = await this.m1ddc("chg", "luminance", String(delta));
      const v = parseInt(out, 10);
      return Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
    } catch {
      return null;
    }
  }

  // ---- volume (VCP 0x62 / mute 0x8D — standard codes, honest readback) ----

  /** Change speaker volume by delta; returns the new value, or null on failure. */
  async changeVolume(delta: number): Promise<number | null> {
    try {
      const out = await this.m1ddc("chg", "volume", String(delta));
      const v = parseInt(out, 10);
      return Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
    } catch {
      return null;
    }
  }

  /** Mute or unmute the speakers. Returns false on failure. */
  async setMute(on: boolean): Promise<boolean> {
    try {
      await this.m1ddc("set", "mute", on ? "on" : "off");
      return true;
    } catch {
      return false;
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
