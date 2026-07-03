import { action, KeyDownEvent, SingletonAction, WillAppearEvent } from "@elgato/streamdeck";
import { displayController } from "../display-controller";

/**
 * Blind mute toggle. The monitor's mute state can't be read back over DDC, so
 * the controller tracks it by assumption (see DisplayController.toggleMute);
 * this action is a pure view of that state.
 */
@action({ UUID: "dev.sheepy.display-knob.mute" })
export class Mute extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    if (ev.action.isKey()) {
      await ev.action.setState(displayController.muted ? 1 : 0);
    }
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const muted = await displayController.toggleMute();
    if (!ev.action.isKey()) return;
    if (muted === null) {
      await ev.action.showAlert();
      return;
    }
    await Promise.all([...this.actions].map((a) => (a.isKey() ? a.setState(muted ? 1 : 0) : undefined)));
  }
}
