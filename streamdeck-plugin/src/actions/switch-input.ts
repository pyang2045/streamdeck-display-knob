import { action, KeyDownEvent, SingletonAction, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { displayController, InputSource, INPUT_LABEL, ActiveInput } from "../display-controller";

type Settings = {
  target?: InputSource;
};

@action({ UUID: "com.sheepy.display-knob.switch-input" })
export class SwitchInput extends SingletonAction<Settings> {
  private unsubscribe?: () => void;

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    if (!this.unsubscribe) {
      this.unsubscribe = displayController.onActiveChanged(() => this.refreshAll());
    }
    await this.refreshAll();
  }

  override onWillDisappear(_ev: WillDisappearEvent<Settings>): void {
    if ([...this.actions].length === 0) {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
    }
  }

  override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
    const target = ev.payload.settings.target ?? "tb";
    const result = await displayController.setInput(target);
    if (result === "ok") {
      await ev.action.showOk();
    } else if (result === "failed") {
      await ev.action.showAlert();
    } else {
      // locked: another switch is in progress / cooling down — brief hint only
      await ev.action.setTitle("⏳");
      setTimeout(() => void this.refreshAll(), 1000);
      return;
    }
    await this.refreshAll();
  }

  /** Highlight the key whose target matches the active input; keep titles in sync. */
  private async refreshAll(): Promise<void> {
    const active: ActiveInput = displayController.active;
    for (const a of this.actions) {
      const settings = await a.getSettings();
      const target = settings.target ?? "tb";
      if (a.isKey()) {
        await a.setState(active === target ? 1 : 0);
        await a.setTitle(INPUT_LABEL[target].replace("Thunderbolt", "TB").replace("DisplayPort", "DP"));
      }
    }
  }
}
