import { action } from "@elgato/streamdeck";
import { displayController } from "../display-controller";
import { StepAction } from "./step-action";

const SUN = `<circle cx="36" cy="30" r="9.5" fill="#f0c94e"/><g stroke="#f0c94e" stroke-width="3.2" stroke-linecap="round"><line x1="36" y1="11" x2="36" y2="16"/><line x1="36" y1="44" x2="36" y2="49"/><line x1="17" y1="30" x2="22" y2="30"/><line x1="50" y1="30" x2="55" y2="30"/><line x1="23" y1="17" x2="26.5" y2="20.5"/><line x1="45.5" y1="39.5" x2="49" y2="43"/><line x1="49" y1="17" x2="45.5" y2="20.5"/><line x1="26.5" y1="39.5" x2="23" y2="43"/></g>`;

@action({ UUID: "com.sheepy.display-knob.brightness" })
export class Brightness extends StepAction {
  protected readonly glyph = SUN;
  protected readonly color = "#f0c94e";
  protected readonly defaultStep = 10;
  protected change(delta: number): Promise<number | null> {
    return displayController.changeBrightness(delta);
  }
}
