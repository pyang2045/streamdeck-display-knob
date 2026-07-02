import { action, KeyDownEvent, SingletonAction, WillAppearEvent } from "@elgato/streamdeck";
import { displayController } from "../display-controller";

/**
 * Blind mute toggle: the monitor's mute state can't be read back over DDC,
 * so we track it locally (assume unmuted at start) — consistent with the
 * plugin's send-blindly design.
 */
@action({ UUID: "com.sheepy.display-knob.mute" })
export class Mute extends SingletonAction {
  private muted = false;

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    if (ev.action.isKey()) {
      await ev.action.setState(this.muted ? 1 : 0);
    }
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const next = !this.muted;
    const ok = await displayController.setMute(next);
    if (!ev.action.isKey()) return;
    if (!ok) {
      await ev.action.showAlert();
      return;
    }
    this.muted = next;
    for (const a of this.actions) {
      if (a.isKey()) await a.setState(this.muted ? 1 : 0);
    }
  }
}
