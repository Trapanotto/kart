// Input devices. Owner: physics. Touch controls are built by the UI team as another InputSource.
import type { InputSource } from '../core/types';
import { createGamepadInput } from './gamepad';
import { createKeyboardInput } from './keyboard';

export { createKeyboardInput } from './keyboard';
export { createGamepadInput, rumble, connectRumble } from './gamepad';

/** Default device list for the app: gamepad first (analog wins when touched), then keyboard. */
export function createInputSources(): InputSource[] {
  return [createGamepadInput(), createKeyboardInput()];
}
