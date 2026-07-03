import { action, DidReceiveSettingsEvent, KeyDownEvent, SingletonAction, WillAppearEvent } from "@elgato/streamdeck";
import { displayController } from "../display-controller";
import { directionBadge } from "../key-images";

type Settings = {
  direction?: "up" | "down";
  step?: number;
};

const TITLE_RESET_MS = 1500;

const SUN = `<circle cx="36" cy="30" r="9.5" fill="#f0c94e"/><g stroke="#f0c94e" stroke-width="3.2" stroke-linecap="round"><line x1="36" y1="11" x2="36" y2="16"/><line x1="36" y1="44" x2="36" y2="49"/><line x1="17" y1="30" x2="22" y2="30"/><line x1="50" y1="30" x2="55" y2="30"/><line x1="23" y1="17" x2="26.5" y2="20.5"/><line x1="45.5" y1="39.5" x2="49" y2="43"/><line x1="49" y1="17" x2="45.5" y2="20.5"/><line x1="26.5" y1="39.5" x2="23" y2="43"/></g>`;

@action({ UUID: "com.sheepy.display-knob.brightness" })
export class Brightness extends SingletonAction<Settings> {
  private titleTimer?: NodeJS.Timeout;

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    if (ev.action.isKey()) {
      await ev.action.setImage(directionBadge(SUN, "#f0c94e", ev.payload.settings.direction ?? "up"));
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
    if (ev.action.isKey()) {
      await ev.action.setImage(directionBadge(SUN, "#f0c94e", ev.payload.settings.direction ?? "up"));
    }
  }

  /** One press = one step. No hold-to-repeat. */
  override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
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
          void ev.action.setTitle();
        }, TITLE_RESET_MS);
      }
    }
  }
}
