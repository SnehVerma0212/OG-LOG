import { useEffect, useState } from 'react';
import { Keyboard, type KeyboardEvent } from 'react-native';

// Current on-screen keyboard height (0 when hidden), plus an optional callback
// fired once the keyboard has finished opening.
export function useKeyboardHeight(onShow?: (event: KeyboardEvent) => void): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      setHeight(event.endCoordinates.height);
      onShow?.(event);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [onShow]);

  return height;
}
