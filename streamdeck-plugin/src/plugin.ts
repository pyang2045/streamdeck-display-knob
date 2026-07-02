import streamDeck, { LogLevel } from "@elgato/streamdeck";
import { displayController } from "./display-controller";
import { SwitchInput } from "./actions/switch-input";
import { Brightness } from "./actions/brightness";
import { Volume } from "./actions/volume";
import { Mute } from "./actions/mute";

streamDeck.logger.setLevel(LogLevel.INFO);

streamDeck.actions.registerAction(new SwitchInput());
streamDeck.actions.registerAction(new Brightness());
streamDeck.actions.registerAction(new Volume());
streamDeck.actions.registerAction(new Mute());

await streamDeck.connect();
await displayController.init();
streamDeck.logger.info("display-knob plugin connected");
