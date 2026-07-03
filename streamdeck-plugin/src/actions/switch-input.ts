import { action, Action, DidReceiveSettingsEvent, KeyDownEvent, SingletonAction, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { displayController, InputSource, INPUTS } from "../display-controller";

type Settings = {
  target?: InputSource;
};

@action({ UUID: "dev.sheepy.display-knob.switch-input" })
export class SwitchInput extends SingletonAction<Settings> {
  private unsubscribe?: () => void;

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    if (!this.unsubscribe) {
      // Active-input change only affects which key is highlighted (state).
      this.unsubscribe = displayController.onActiveChanged(() => this.refreshStates());
    }
    await this.renderKey(ev.action, ev.payload.settings.target);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
    // Property-inspector change (e.g. Input dropdown) — re-render title + state.
    await this.renderKey(ev.action, ev.payload.settings.target);
  }

  override onWillDisappear(_ev: WillDisappearEvent<Settings>): void {
    if (this.actions[Symbol.iterator]().next().done) {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
    }
  }

  override onKeyDown(ev: KeyDownEvent<Settings>): void {
    // Deliberately not awaited: setInput holds a multi-second time lock, and
    // blocking here would make later presses queue up and run after the lock
    // expired instead of being discarded.
    void this.performSwitch(ev);
  }

  private async performSwitch(ev: KeyDownEvent<Settings>): Promise<void> {
    const target = ev.payload.settings.target ?? "tb";
    const result = await displayController.setInput(target);
    if (result === "ok") {
      // A successful switch fires onActiveChanged → refreshStates; just confirm.
      await ev.action.showOk();
    } else if (result === "failed") {
      await ev.action.showAlert();
    } else {
      // locked: switch in progress / cooling down — discard with a brief hint
      await ev.action.setTitle("⏳");
      setTimeout(() => void this.renderKey(ev.action, target), 1000);
    }
  }

  /** Full render of one key: title (invariant) and highlight state. */
  private async renderKey(action: Action<Settings>, target: InputSource = "tb"): Promise<void> {
    if (!action.isKey()) return;
    await Promise.all([action.setTitle(INPUTS[target].label), action.setState(displayController.active === target ? 1 : 0)]);
  }

  /** Highlight-only refresh across all keys — for active-input changes. */
  private async refreshStates(): Promise<void> {
    const active = displayController.active;
    await Promise.all(
      [...this.actions].map(async (a) => {
        if (!a.isKey()) return;
        const { target = "tb" } = await a.getSettings();
        await a.setState(active === target ? 1 : 0);
      }),
    );
  }
}
