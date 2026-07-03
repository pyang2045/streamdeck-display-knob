import { DidReceiveSettingsEvent, KeyDownEvent, SingletonAction, WillAppearEvent } from "@elgato/streamdeck";
import { directionBadge } from "../key-images";

export type StepSettings = {
  direction?: "up" | "down";
  step?: number;
};

const TITLE_RESET_MS = 1500;

/**
 * A key that nudges a DDC value up or down by a step on each press: renders a
 * glyph with a +/− direction badge, and flashes the new value on the key.
 * Shared by the Brightness and Volume actions.
 */
export abstract class StepAction extends SingletonAction<StepSettings> {
  protected abstract readonly glyph: string;
  protected abstract readonly color: string;
  protected abstract readonly defaultStep: number;
  /** Apply a signed delta to the underlying control; returns the new value or null. */
  protected abstract change(delta: number): Promise<number | null>;

  private titleTimer?: NodeJS.Timeout;

  override async onWillAppear(ev: WillAppearEvent<StepSettings>): Promise<void> {
    await this.render(ev);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<StepSettings>): Promise<void> {
    await this.render(ev);
  }

  private async render(ev: WillAppearEvent<StepSettings> | DidReceiveSettingsEvent<StepSettings>): Promise<void> {
    if (ev.action.isKey()) {
      await ev.action.setImage(directionBadge(this.glyph, this.color, ev.payload.settings.direction ?? "up"));
    }
  }

  /** One press = one step. No hold-to-repeat. */
  override async onKeyDown(ev: KeyDownEvent<StepSettings>): Promise<void> {
    const { direction, step } = ev.payload.settings;
    const delta = Math.abs(step ?? this.defaultStep) * (direction === "down" ? -1 : 1);
    const value = await this.change(delta);
    if (!ev.action.isKey()) return;
    if (value === null) {
      await ev.action.showAlert();
      return;
    }
    await ev.action.setTitle(String(value));
    clearTimeout(this.titleTimer);
    this.titleTimer = setTimeout(() => {
      void ev.action.setTitle();
    }, TITLE_RESET_MS);
  }
}
