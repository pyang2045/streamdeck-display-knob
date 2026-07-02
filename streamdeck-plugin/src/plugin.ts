import streamDeck, { LogLevel } from "@elgato/streamdeck";
import { displayController } from "./display-controller";
import { SwitchInput } from "./actions/switch-input";
import { Brightness } from "./actions/brightness";

streamDeck.logger.setLevel(LogLevel.INFO);

streamDeck.actions.registerAction(new SwitchInput());
streamDeck.actions.registerAction(new Brightness());

await streamDeck.connect();
await displayController.init();
streamDeck.logger.info("display-knob plugin connected");
