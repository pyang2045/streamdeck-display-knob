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
 * The monitor has no trustworthy input readback (VCP 0x60 always answers 15,
 * 0xF4 is write-only), but it keeps a separate brightness per input and
 * `get luminance` reports the active input's value — so distinct per-input
 * brightness values identify the source. The map is persisted in global
 * settings and re-learned whenever we change brightness ourselves.
 */
export interface ProfileMap {
  [key: string]: number;
  tb: number;
  hdmi: number;
  dp: number;
}
const DEFAULT_PROFILES: ProfileMap = { tb: 26, hdmi: 90, dp: 30 };

const POLL_INTERVAL_MS = 4000;
const SWITCH_RETRY_MS = 4000;
const SWITCH_MAX_TRIES = 5;
const SWITCH_LOCK_MS = 5000;

export type SwitchResult = "ok" | "failed" | "locked";

export type ActiveInput = InputSource | "unknown" | "offline";

class DisplayController {
  private profiles: ProfileMap = { ...DEFAULT_PROFILES };
  private displayUuid = DEFAULT_UUID;
  private listeners = new Set<(active: ActiveInput) => void>();
  private lastActive: ActiveInput = "unknown";
  /** Input we most recently switched to / detected; brightness changes are attributed to it. */
  private assumedInput: InputSource = "tb";
  private pollTimer?: NodeJS.Timeout;
  private switching = false;
  private lockedUntil = 0;

  async init(): Promise<void> {
    const settings = await streamDeck.settings.getGlobalSettings<{ profiles?: ProfileMap; uuid?: string }>();
    if (settings.profiles) this.profiles = settings.profiles;
    if (settings.uuid) this.displayUuid = settings.uuid;
    await this.discoverDisplay();
    this.startPolling();
  }

  // ---- display discovery ----

  private m1ddcRaw(...args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(this.m1ddcPath(), args, { timeout: 5000 }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });
  }

  /**
   * Find the LG UltraFine automatically so the plugin works without
   * configuration and survives UUID changes (other Macs, re-enumeration).
   */
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
        await this.persistProfiles();
      }
      return true;
    } catch {
      return false;
    }
  }

  private m1ddcPath(): string {
    const bundled = path.join(path.dirname(fileURLToPath(import.meta.url)), "m1ddc");
    if (existsSync(bundled)) return bundled;
    return "/opt/homebrew/bin/m1ddc"; // dev fallback
  }

  private m1ddc(...args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(this.m1ddcPath(), ["display", this.displayUuid, ...args], { timeout: 5000 }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.trim());
      });
    });
  }

  // ---- luminance ----

  /** Returns current luminance, or null if the display is not enumerated (TB link down). */
  async getLuminance(): Promise<number | null> {
    try {
      const out = await this.m1ddc("get", "luminance");
      const v = parseInt(out, 10);
      return Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  }

  /**
   * Change brightness by delta. Attributed to the input we believe is active,
   * keeping the input-detection profile map in sync.
   */
  async changeBrightness(delta: number): Promise<number | null> {
    try {
      const out = await this.m1ddc("chg", "luminance", String(delta));
      const v = parseInt(out, 10);
      if (Number.isFinite(v)) {
        this.profiles[this.assumedInput] = v;
        await this.persistProfiles();
        return v;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async persistProfiles(): Promise<void> {
    await streamDeck.settings.setGlobalSettings({ profiles: this.profiles, uuid: this.displayUuid });
  }

  // ---- input detection ----

  private classify(luminance: number | null): ActiveInput {
    if (luminance === null) return "offline";
    const matches = (Object.keys(this.profiles) as InputSource[]).filter((k) => this.profiles[k] === luminance);
    if (matches.length === 1) return matches[0];
    // Ambiguous profiles or transitional value (e.g. 30 during a switch):
    // trust our last assumption if it is one of the matches.
    if (matches.includes(this.assumedInput)) return this.assumedInput;
    return "unknown";
  }

  async detectActiveInput(): Promise<ActiveInput> {
    let lum = await this.getLuminance();
    if (lum === null) {
      // Display gone: UUID may have changed on re-enumeration — rediscover.
      if (await this.discoverDisplay()) lum = await this.getLuminance();
    }
    const active = this.classify(lum);
    if (active !== this.lastActive) {
      this.lastActive = active;
      if (active !== "unknown" && active !== "offline") this.assumedInput = active;
      this.notify();
    }
    return active;
  }

  get active(): ActiveInput {
    return this.lastActive;
  }

  // ---- switching ----

  /**
   * Switch input with verify-and-retry: the monitor occasionally drops a
   * switch write (especially while a live source is handshaking), and it
   * sometimes refuses to switch to an input with no signal.
   *
   * A lockout (SWITCH_LOCK_MS from the accepted press, extended by however
   * long the retry loop runs) rejects further switch commands so rapid
   * presses can't queue conflicting transitions mid-switch.
   */
  async setInput(target: InputSource): Promise<SwitchResult> {
    if (this.switching || Date.now() < this.lockedUntil) return "locked";
    this.switching = true;
    this.lockedUntil = Date.now() + SWITCH_LOCK_MS;
    try {
      for (let attempt = 1; attempt <= SWITCH_MAX_TRIES; attempt++) {
        try {
          await this.m1ddc("set", "input-alt", String(INPUT_ALT_CODE[target]));
        } catch (e) {
          streamDeck.logger.warn(`setInput write failed (attempt ${attempt}): ${e}`);
        }
        await sleep(SWITCH_RETRY_MS);
        const lum = await this.getLuminance();
        const active = this.classify(lum);
        streamDeck.logger.info(`setInput ${target} attempt ${attempt}: luminance=${lum} → ${active}`);
        if (active === target) {
          this.assumedInput = target;
          this.lastActive = target;
          this.notify();
          return "ok";
        }
        // Switching away from the Mac can succeed without us being able to
        // verify (e.g. target profile collides, or the display vanished).
        if (target !== "tb" && (active === "offline" || active === "unknown")) {
          this.assumedInput = target;
          this.lastActive = active;
          this.notify();
          return "ok";
        }
      }
      return "failed";
    } finally {
      this.switching = false;
      // Re-arm the lock from completion time: presses that queued up while we
      // were switching arrive now and must still be discarded.
      this.lockedUntil = Date.now() + SWITCH_LOCK_MS;
    }
  }

  // ---- poller ----

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(async () => {
      if (this.switching) return;
      if (this.listeners.size === 0) return;
      await this.detectActiveInput();
    }, POLL_INTERVAL_MS);
  }

  onActiveChanged(listener: (active: ActiveInput) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) {
      try {
        l(this.lastActive);
      } catch (e) {
        streamDeck.logger.error(`listener error: ${e}`);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const displayController = new DisplayController();
