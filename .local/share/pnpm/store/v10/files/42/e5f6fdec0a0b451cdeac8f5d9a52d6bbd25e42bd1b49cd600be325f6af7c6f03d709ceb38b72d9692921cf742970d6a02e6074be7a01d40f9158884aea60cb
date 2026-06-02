function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
import React, { forwardRef } from "react";
import { Platform } from "react-native";
import Reanimated, { useAnimatedProps, useSharedValue } from "react-native-reanimated";
import { ClippingScrollView } from "../../bindings";
import styles from "./styles";
const OS = Platform.OS;
const ReanimatedClippingScrollView = OS === "android" ? Reanimated.createAnimatedComponent(ClippingScrollView) : ClippingScrollView;
const ScrollViewWithBottomPadding = /*#__PURE__*/forwardRef(({
  ScrollViewComponent,
  bottomPadding,
  scrollIndicatorPadding,
  contentInset,
  scrollIndicatorInsets,
  inverted,
  contentOffsetY,
  applyWorkaroundForContentInsetHitTestBug,
  children,
  ...rest
}, ref) => {
  const prevContentOffsetY = useSharedValue(null);
  const animatedProps = useAnimatedProps(() => {
    const insetTop = inverted ? bottomPadding.value : 0;
    const insetBottom = !inverted ? bottomPadding.value : 0;
    const bottom = insetBottom + ((contentInset === null || contentInset === void 0 ? void 0 : contentInset.bottom) || 0);
    const top = insetTop + ((contentInset === null || contentInset === void 0 ? void 0 : contentInset.top) || 0);
    const indicatorPadding = scrollIndicatorPadding ?? bottomPadding;
    const indicatorTop = (inverted ? indicatorPadding.value : 0) + ((scrollIndicatorInsets === null || scrollIndicatorInsets === void 0 ? void 0 : scrollIndicatorInsets.top) || 0);
    const indicatorBottom = (!inverted ? indicatorPadding.value : 0) + ((scrollIndicatorInsets === null || scrollIndicatorInsets === void 0 ? void 0 : scrollIndicatorInsets.bottom) || 0);
    const result = {
      // iOS prop
      contentInset: {
        bottom: bottom,
        top: top,
        right: contentInset === null || contentInset === void 0 ? void 0 : contentInset.right,
        left: contentInset === null || contentInset === void 0 ? void 0 : contentInset.left
      },
      scrollIndicatorInsets: {
        bottom: indicatorBottom,
        top: indicatorTop,
        right: scrollIndicatorInsets === null || scrollIndicatorInsets === void 0 ? void 0 : scrollIndicatorInsets.right,
        left: scrollIndicatorInsets === null || scrollIndicatorInsets === void 0 ? void 0 : scrollIndicatorInsets.left
      },
      // Android prop
      contentInsetBottom: insetBottom,
      contentInsetTop: insetTop
    };
    if (contentOffsetY) {
      const curr = contentOffsetY.value;
      if (curr !== prevContentOffsetY.value) {
        // eslint-disable-next-line react-compiler/react-compiler
        prevContentOffsetY.value = curr;
        result.contentOffset = {
          x: 0,
          y: curr
        };
      }
    }
    return result;
  }, [contentInset === null || contentInset === void 0 ? void 0 : contentInset.bottom, contentInset === null || contentInset === void 0 ? void 0 : contentInset.top, contentInset === null || contentInset === void 0 ? void 0 : contentInset.right, contentInset === null || contentInset === void 0 ? void 0 : contentInset.left, scrollIndicatorInsets === null || scrollIndicatorInsets === void 0 ? void 0 : scrollIndicatorInsets.bottom, scrollIndicatorInsets === null || scrollIndicatorInsets === void 0 ? void 0 : scrollIndicatorInsets.top, scrollIndicatorInsets === null || scrollIndicatorInsets === void 0 ? void 0 : scrollIndicatorInsets.right, scrollIndicatorInsets === null || scrollIndicatorInsets === void 0 ? void 0 : scrollIndicatorInsets.left, inverted, contentOffsetY]);
  return /*#__PURE__*/React.createElement(ReanimatedClippingScrollView, {
    animatedProps: animatedProps,
    applyWorkaroundForContentInsetHitTestBug: applyWorkaroundForContentInsetHitTestBug,
    style: styles.container
  }, /*#__PURE__*/React.createElement(ScrollViewComponent, _extends({
    ref: ref,
    animatedProps: animatedProps
  }, rest), children));
});
export default ScrollViewWithBottomPadding;
//# sourceMappingURL=index.js.map