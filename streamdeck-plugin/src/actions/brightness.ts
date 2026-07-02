import { action, KeyDownEvent, KeyUpEvent, SingletonAction, WillAppearEvent } from "@elgato/streamdeck";
import { displayController } from "../display-controller";

type Settings = {
  direction?: "up" | "down";
  step?: number;
};

const REPEAT_MS = 250;
const TITLE_RESET_MS = 1500;

@action({ UUID: "com.sheepy.display-knob.brightness" })
export class Brightness extends SingletonAction<Settings> {
  private repeatTimer?: NodeJS.Timeout;
  private titleTimer?: NodeJS.Timeout;

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    if (ev.action.isKey()) {
      await ev.action.setTitle(this.glyph(ev.payload.settings));
    }
  }

  override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
    const apply = async () => {
      const settings = ev.payload.settings;
      const step = Math.abs(settings.step ?? 10) * (settings.direction === "down" ? -1 : 1);
      const value = await displayController.changeBrightness(step);
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
    };
    await apply();
    clearInterval(this.repeatTimer);
    this.repeatTimer = setInterval(apply, REPEAT_MS); // hold to repeat
  }

  override onKeyUp(_ev: KeyUpEvent<Settings>): void {
    clearInterval(this.repeatTimer);
    this.repeatTimer = undefined;
  }

  private glyph(settings: Settings): string {
    return settings.direction === "down" ? "☀ −" : "☀ +";
  }
}
