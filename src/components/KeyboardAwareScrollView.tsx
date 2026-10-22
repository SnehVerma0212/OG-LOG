import { useCallback, useRef, type ReactNode } from 'react';
import {
  ScrollView,
  TextInput,
  type KeyboardEvent,
  type ScrollViewInstance,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { spacing } from '../theme';

interface KeyboardAwareScrollViewProps {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  // Space kept below the content when the keyboard is closed (e.g. the safe-area inset).
  bottomPadding: number;
}

// A ScrollView that makes room for the keyboard and scrolls the focused
// field into view if the keyboard would cover it. Works in Expo Go on
// Android and iOS without an extra keyboard library.
export function KeyboardAwareScrollView({ children, contentContainerStyle, bottomPadding }: KeyboardAwareScrollViewProps) {
  const scrollRef = useRef<ScrollViewInstance>(null);
  const scrollOffset = useRef(0);

  const revealFocusedInput = useCallback((event: KeyboardEvent) => {
    const input = TextInput.State.currentlyFocusedInput();
    if (!input) {
      return;
    }
    const keyboardTop = event.endCoordinates.screenY;
    // Wait one frame so the extra bottom padding is laid out before scrolling.
    requestAnimationFrame(() => {
      input.measureInWindow((_x, y, _width, height) => {
        const overlap = y + height + spacing.xl - keyboardTop;
        if (overlap > 0) {
          scrollRef.current?.scrollTo({ y: scrollOffset.current + overlap, animated: true });
        }
      });
    });
  }, []);

  const keyboardHeight = useKeyboardHeight(revealFocusedInput);

  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1 }}
      contentContainerStyle={[contentContainerStyle, { paddingBottom: bottomPadding + keyboardHeight }]}
      onScroll={(event) => {
        scrollOffset.current = event.nativeEvent.contentOffset.y;
      }}
      scrollEventThrottle={16}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      {children}
    </ScrollView>
  );
}
