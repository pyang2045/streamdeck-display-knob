import { action } from "@elgato/streamdeck";
import { displayController } from "../display-controller";
import { StepAction } from "./step-action";

const SPEAKER = `<path d="M16 26 h8 l10 -9 v26 l-10 -9 h-8 z" fill="#5fd3a5"/><path d="M40 24 a10 10 0 0 1 0 12 M45 19 a17 17 0 0 1 0 22" stroke="#5fd3a5" stroke-width="4" fill="none" stroke-linecap="round"/>`;

@action({ UUID: "dev.sheepy.display-knob.volume" })
export class Volume extends StepAction {
  protected readonly glyph = SPEAKER;
  protected readonly color = "#5fd3a5";
  protected readonly defaultStep = 5;
  protected change(delta: number): Promise<number | null> {
    return displayController.changeVolume(delta);
  }
}
