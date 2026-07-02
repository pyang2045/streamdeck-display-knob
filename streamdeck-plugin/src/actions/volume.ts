import { action, KeyDownEvent, SingletonAction, WillAppearEvent } from "@elgato/streamdeck";
import { displayController } from "../display-controller";

type Settings = {
  direction?: "up" | "down";
  step?: number;
};

const TITLE_RESET_MS = 1500;

@action({ UUID: "com.sheepy.display-knob.volume" })
export class Volume extends SingletonAction<Settings> {
  private titleTimer?: NodeJS.Timeout;

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    if (ev.action.isKey()) {
      await ev.action.setTitle(this.glyph(ev.payload.settings));
    }
  }

  /** One press = one step, same as brightness. */
  override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
    const settings = ev.payload.settings;
    const step = Math.abs(settings.step ?? 5) * (settings.direction === "down" ? -1 : 1);
    const value = await displayController.changeVolume(step);
    if (ev.action.isKey()) {
      if (value === null) {
        await ev.action.showAlert();
      } else {
        await ev.action.setTitle(String(value));
        clearTimeout(this.titleTimer);
        this.titleTimer = setTimeout(() => {
          void ev.action.setTitle(this.glyph(ev.payload.settings));
        }, TITLE_RESET_MS);
      }
    }
  }

  private glyph(settings: Settings): string {
    return settings.direction === "down" ? "♪ −" : "♪ +";
  }
}
