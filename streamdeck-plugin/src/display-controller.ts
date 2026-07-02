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
const SWITCH_MAX_SENDS = 3;
const VERIFY_POLL_MS = 2000;
/** The 6K Thunderbolt link renegotiation is slow — re-sending the switch
 * command while it is still handshaking restarts it (visible screen flashes),
 * so give TB a long verify window before ever re-sending. */
const VERIFY_DEADLINE_MS: Record<InputSource, number> = { tb: 12000, hdmi: 8000, dp: 8000 };
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
    streamDeck.logger.info(`profiles: ${JSON.stringify(this.profiles)} uuid: ${this.displayUuid}`);
    const values = Object.values(this.profiles);
    if (new Set(values).size !== values.length) {
      streamDeck.logger.warn("profile collision: two inputs share a brightness value — input detection is degraded; set distinct brightness per input");
    }
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

  private classify(luminance: number | null, expected?: InputSource): ActiveInput {
    if (luminance === null) return "offline";
    const matches = (Object.keys(this.profiles) as InputSource[]).filter((k) => this.profiles[k] === luminance);
    // Profile values can collide (two inputs set to the same brightness).
    // When verifying a switch we just commanded, a reading that matches the
    // commanded target counts as that target — otherwise the verifier keeps
    // re-sending and restarts the transition (visible flashing).
    if (expected && matches.includes(expected)) return expected;
    if (matches.length === 1) return matches[0];
    if (matches.includes(this.assumedInput)) return this.assumedInput;
    return "unknown";
  }

  private idleUnknownLum: number | null = null;
  private idleUnknownStreak = 0;

  async detectActiveInput(): Promise<ActiveInput> {
    let lum = await this.getLuminance();
    if (lum === null) {
      // Display gone: UUID may have changed on re-enumeration — rediscover.
      if (await this.discoverDisplay()) lum = await this.getLuminance();
    }
    let active = this.classify(lum);
    // Self-heal drift while idle: a stable reading that matches no profile
    // means the brightness of the current input changed behind our back
    // (monitor joystick, other software). Attribute it to the input we last
    // knew we were on.
    if (active === "unknown" && lum !== null && lum >= 0) {
      if (lum === this.idleUnknownLum) this.idleUnknownStreak++;
      else {
        this.idleUnknownLum = lum;
        this.idleUnknownStreak = 1;
      }
      if (this.idleUnknownStreak >= 3) {
        streamDeck.logger.info(`adopting drifted profile ${this.assumedInput}=${lum}`);
        this.profiles[this.assumedInput] = lum;
        await this.persistProfiles();
        this.idleUnknownStreak = 0;
        active = this.assumedInput;
      }
    } else {
      this.idleUnknownLum = null;
      this.idleUnknownStreak = 0;
    }
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
      for (let attempt = 1; attempt <= SWITCH_MAX_SENDS; attempt++) {
        try {
          await this.m1ddc("set", "input-alt", String(INPUT_ALT_CODE[target]));
        } catch (e) {
          streamDeck.logger.warn(`setInput write failed (attempt ${attempt}): ${e}`);
        }
        // Send once, then poll patiently — never re-send inside the verify
        // window, or an in-progress transition gets restarted (screen flash).
        const deadline = Date.now() + VERIFY_DEADLINE_MS[target];
        let stableLum: number | null = null;
        let stableCount = 0;
        while (Date.now() < deadline) {
          await sleep(VERIFY_POLL_MS);
          const lum = await this.getLuminance();
          const active = this.classify(lum, target);
          streamDeck.logger.info(`setInput ${target} attempt ${attempt}: luminance=${lum} → ${active}`);
          if (active === target) {
            this.assumedInput = target;
            this.lastActive = target;
            this.notify();
            return "ok";
          }
          // Self-heal profile drift: a reading that is stable across several
          // polls but matches no stored profile means the map is stale (the
          // brightness was changed outside the plugin). The monitor has
          // settled after our command — adopt the reading as the target's
          // profile instead of re-sending (which would flash the screen).
          if (active === "unknown" && lum !== null && lum >= 0) {
            if (lum === stableLum) stableCount++;
            else {
              stableLum = lum;
              stableCount = 1;
            }
            if (stableCount >= 3) {
              streamDeck.logger.info(`adopting drifted profile ${target}=${lum}`);
              this.profiles[target] = lum;
              await this.persistProfiles();
              this.assumedInput = target;
              this.lastActive = target;
              this.notify();
              return "ok";
            }
          } else {
            stableLum = null;
            stableCount = 0;
          }
          // Switching away from the Mac: the display going dark/unreachable
          // means the switch happened even though we can't verify it.
          if (target !== "tb" && active === "offline") {
            this.assumedInput = target;
            this.lastActive = active;
            this.notify();
            return "ok";
          }
        }
        // Deadline passed with no verification: for non-TB targets an
        // ambiguous probe most likely means it switched (profile collision);
        // accept rather than re-send and yank the monitor around.
        if (target !== "tb" && this.classify(await this.getLuminance(), target) === "unknown") {
          this.assumedInput = target;
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
