import { action, DidReceiveSettingsEvent, KeyDownEvent, SingletonAction, WillAppearEvent } from "@elgato/streamdeck";
import { displayController } from "../display-controller";
import { directionBadge } from "../key-images";

type Settings = {
  direction?: "up" | "down";
  step?: number;
};

const TITLE_RESET_MS = 1500;

const SPEAKER = `<path d="M16 26 h8 l10 -9 v26 l-10 -9 h-8 z" fill="#5fd3a5"/><path d="M40 24 a10 10 0 0 1 0 12 M45 19 a17 17 0 0 1 0 22" stroke="#5fd3a5" stroke-width="4" fill="none" stroke-linecap="round"/>`;

@action({ UUID: "com.sheepy.display-knob.volume" })
export class Volume extends SingletonAction<Settings> {
  private titleTimer?: NodeJS.Timeout;

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    if (ev.action.isKey()) {
      await ev.action.setImage(directionBadge(SPEAKER, "#5fd3a5", ev.payload.settings.direction ?? "up"));
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
    if (ev.action.isKey()) {
      await ev.action.setImage(directionBadge(SPEAKER, "#5fd3a5", ev.payload.settings.direction ?? "up"));
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
          void ev.action.setTitle();
        }, TITLE_RESET_MS);
      }
    }
  }
}
