import React from "react";
import Reanimated from "react-native-reanimated";
import type { ScrollViewProps } from "react-native";
import type { SharedValue } from "react-native-reanimated";
type AnimatedScrollViewProps = React.ComponentProps<typeof Reanimated.ScrollView>;
export type AnimatedScrollViewComponent = React.ForwardRefExoticComponent<AnimatedScrollViewProps & React.RefAttributes<Reanimated.ScrollView>>;
declare const ScrollViewWithBottomPadding: React.ForwardRefExoticComponent<{
    ScrollViewComponent: AnimatedScrollViewComponent;
    children?: React.ReactNode;
    inverted?: boolean;
    bottomPadding: SharedValue<number>;
    /** Padding for scroll indicator insets (excludes blankSpace). Falls back to bottomPadding when not provided. */
    scrollIndicatorPadding?: SharedValue<number>;
    /** Absolute Y content offset (iOS only, for KeyboardChatScrollView). */
    contentOffsetY?: SharedValue<number>;
    applyWorkaroundForContentInsetHitTestBug?: boolean;
} & ScrollViewProps & React.RefAttributes<Reanimated.ScrollView>>;
export default ScrollViewWithBottomPadding;
