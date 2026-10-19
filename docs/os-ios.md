# os-ios: the simulated iOS

`@mimicry/os-ios` is iOS as an app (or a framework's native half) sees it: UIKit, Core Animation and the parts of Foundation apps reach for, written in TypeScript on the Mimicry kernel (`@mimicry/os-core`). The kernel is the hardware: a display and its vsync, a clock, a text measurer, an image decoder, storage, and the render tree that becomes binary draw commands. os-ios is the operating system on it. React Native runs on top of it, and so can any code written against UIKit.

Names follow Apple's. Classes, methods and properties keep their Swift names, enums keep their cases, and behaviors and timings follow UIKit's. Where a Swift signature cannot be written in TypeScript, the closest natural shape is used, consistently:

- **Argument labels** become positional parameters: `present(vc, animated, completion)`, `setTitle(title, state)`.
- **Overloaded initializers** become static factories named after the label: `UIImage.named`, `UIImage.systemName`, `UIFont.systemFont`, `UIButton.withConfiguration`, `UIBarButtonItem.system`, `UISheetPresentationControllerDetent.medium()`.
- **Labeled initializers with many options** take an options object: `new UIViewPropertyAnimator(0.3, { dampingRatio: 0.8 }, animations)`, and `UIView.animate({ springDuration, bounce }, animations)`.
- **OptionSets** are numeric enums you OR together: `UIViewAnimationOptions.curveEaseOut | UIViewAnimationOptions.allowUserInteraction`.
- **Delegate methods** keep their Swift name with the first label folded in: `tableViewDidSelectRowAt(tableView, indexPath)`, `presentationControllerDidDismiss(controller)`.
- **Swift's `draw(at:)` / `draw(in:)` overloads** are `drawAt` / `drawIn`.

Everything time-based runs on the kernel: frames on `kernel.animator`, timers on `kernel.clock`, and main-queue work on `kernel.defer`. Under test the clock is virtual, so animations, timers and gestures give the same pixels on every run.

## Architecture

```
UIApplication ─ UIWindow ─ UIView ─ CALayer ──▶ os-core RenderLayer tree ──▶ RenderServer ──▶ frame
      │              │         │          │
      │              │         │          └─ animations: model untouched; presentation values written
      │              │         │             into the render fields while the tree draws (see below)
      │              │         └─ drawLayerContent(ctx): fine-grained draw items (labels per line, images)
      │              └─ touch delivery: hit test → gesture recognizers (arbitration) → hit view
      └─ layout pass (layoutSubviews) before every frame; status bar window (SpringBoard) above
```

### How animations reach the screen

Core Animation keeps two trees: the model, which the app reads and writes, and the presentation, which is what shows. os-ios keeps the model in the `RenderLayer` fields (x, y, size, transform, opacity…). Hit testing, layout and React Native's direct field writes all use those fields, so they keep working unchanged.

While the render server records a frame, each `CALayer.drawContent` writes its animated sublayers' presentation values into those fields: the model plus every attached animation at the current media time. Its `drawOverlay` writes the model back. The render server reads a sublayer's geometry between those two calls, so it draws the presentation and nothing else ever sees it. A layer that moves or resizes this way is composited on its own while it animates, so its parent's rasters stay cached.

Animations step once per frame on the kernel's animator. That step starts and stops them (delegates, `isRemovedOnCompletion`, transaction completion blocks). Their values are computed when the frame is drawn.

**Media time.** `CACurrentMediaTime()` follows the kernel clock, slowed by the host's slow-animation factor. It does not follow `animator.animationTime`, which clamps long gaps between frames to 250 ms. An animation committed after the app sat idle starts at its commit time, not partway into its curve.

## What is modeled

### QuartzCore

| API | Notes |
| --- | --- |
| `CALayer` | Geometry (frame, position, bounds, anchorPoint, affineTransform, zPosition), background, cornerRadius + maskedCorners, border, shadow, contents/gravity. `add(_:forKey:)`, `removeAnimation(forKey:)`, `removeAllAnimations()`, `animationKeys()`, `animation(forKey:)`, `presentation()`, `model()` |
| `CABasicAnimation` | from / to / by in every combination; a missing end is the value beneath. `isAdditive`, `isCumulative` |
| `CAKeyframeAnimation` | values, keyTimes, per-segment timingFunctions; calculationMode linear, discrete, paced, cubic (Catmull-Rom), cubicPaced |
| `CASpringAnimation` | Closed-form damped oscillator (under-, critically and over-damped); mass, stiffness, damping, initialVelocity, allowsOverdamping, `settlingDuration`; iOS 17 `init(perceptualDuration:bounce:)`, `perceptualDuration`, `bounce` |
| `CAAnimationGroup` | Children on the group's timeline (warped by its timing function) |
| `CAMediaTiming` | beginTime, duration (0 means the transaction's), speed, timeOffset, repeatCount (`Infinity`), repeatDuration, autoreverses, fillMode |
| `CAMediaTimingFunction` | Named curves with Core Animation's control points; custom control points |
| `CATransaction` | begin / commit / flush, nesting, the implicit transaction, animationDuration, animationTimingFunction, disableActions, completionBlock (runs when every animation added inside has finished or been removed) |
| `CADisplayLink` | timestamp, targetTimestamp, duration, isPaused, preferredFramesPerSecond / preferredFrameRateRange throttling, `add(to:forMode:)`, invalidate |
| Animatable key paths | position(.x/.y), bounds(.origin/.size and components), anchorPoint, opacity, zPosition, transform and transform.scale/.scale.x/.scale.y/.rotation(.z)/.translation(.x/.y), backgroundColor, borderColor, shadowColor, cornerRadius, borderWidth, shadowOpacity, shadowRadius, shadowOffset |
| Snapshots | `recordLayerTree` / `SnapshotLayer` back `snapshotView(afterScreenUpdates:)` and cross-dissolve transitions |

### UIKit: views, animation, drawing

| API | Notes |
| --- | --- |
| `UIView` | Hierarchy, geometry, appearance, traits, safe area, layout pass, hit testing, gestures (unchanged) plus `snapshotView`, `setFrameIfNeeded` |
| `UIView.animate` | Every variant: duration / delay / options (curves, repeat, autoreverse, allowUserInteraction, layoutSubviews, overrideInherited*), `usingSpringWithDamping:initialSpringVelocity:`, iOS 17 `springDuration:bounce:`. Additive animations like UIKit's since iOS 8. Nested blocks inherit duration and curve. Animated views ignore touches unless allowUserInteraction. `layer.cornerRadius` animates in blocks (iOS 11+) |
| `UIView.animateKeyframes` / `addKeyframe` | Relative start times and durations; calculation modes |
| `UIView.transition` | `with:` (old rendering cross-dissolves into the new) and `from:to:` (including showHideTransitionViews) |
| `performWithoutAnimation`, `areAnimationsEnabled` / `setAnimationsEnabled`, `inheritedAnimationDuration` | |
| `UIViewPropertyAnimator` | Curves, control points, damping ratio, `UICubicTimingParameters`, `UISpringTimingParameters` (ratio, mass/stiffness/damping, iOS 17 duration/bounce); addAnimations (with delay factor, mid-flight), addCompletion, start (after delay), pause, `fractionComplete` (scrubsLinearly), `isReversed`, stop (with or without finishing), `finishAnimation(at:)`, pausesOnCompletion, `runningPropertyAnimator` |
| `UIGraphicsGetCurrentContext` | The `CGContext` of the `draw(_:)` running now |

### UIKit: text

| API | Notes |
| --- | --- |
| `UIFont` | systemFont(ofSize:weight:), bold, italic, monospacedDigit, monospaced, preferredFont(forTextStyle:compatibleWith:) with Apple's Dynamic Type table for all twelve categories, `UIFont(name:size:)` for installed and loaded fonts (PostScript suffixes), descriptor traits and design. lineHeight / ascender / descender / capHeight / xHeight of SF Pro |
| `UIFontMetrics` | scaledFont(for:maximumPointSize:compatibleWith:), scaledValue(for:) |
| `NSAttributedString` / `NSMutableAttributedString` | Runs in UTF-16 indices: attributes(at:effectiveRange:), enumerate, substring, set/add/remove attributes, replace / insert / append / delete. NSStringDrawing: `size()`, `boundingRect(with:options:context:)`, `draw…` |
| Attributes | font, foregroundColor, backgroundColor, kern, tracking, paragraphStyle, underline/strikethrough style and color (single, thick, double, dot / dash patterns), shadow (`NSShadow`), baselineOffset, link |
| `NSParagraphStyle` | alignment (natural, left, center, right, justified), lineSpacing, paragraphSpacing(Before), firstLineHeadIndent, headIndent, tailIndent, lineBreakMode, min/max line height, lineHeightMultiple. Extra line height sits above the glyphs, as in TextKit |
| `UILabel` | text / attributedText (missing attributes come from the label), font, textColor, alignment, numberOfLines, every lineBreakMode (word, char, clip, head, middle, tail), truncation by lines and by height, adjustsFontSizeToFitWidth + minimumScaleFactor (one or more lines), sizeThatFits / intrinsicContentSize (pixel-ceiled), preferredMaxLayoutWidth, highlighted / disabled, shadow, Dynamic Type. Vertically centered, one draw item per line |

### UIKit: images

| API | Notes |
| --- | --- |
| `UIImage` | `named` (Mimicry asset catalog: `UIImage.registerAsset`), `contentsOfFile` (paths, file URLs, data URIs; @2x/@3x), `fromData`, `systemName`, size, scale, renderingMode, withRenderingMode, withTintColor, resizableImage (nine-slice), `drawIn` / `drawAt` |
| SF Symbols | Bundled Material Symbols glyphs through `sf-symbols.ts`. `UIImage.SymbolConfiguration` point size, text style, scale, palette / hierarchical color (first color) |
| `UIImageView` | image / highlightedImage, every `UIView.ContentMode`, overflow unless clipsToBounds, template tinting, intrinsic size, animationImages (duration, repeat count), redraw and re-layout when a load finishes |

### UIKit: controls

| API | Notes |
| --- | --- |
| `UIButton` | `UIButton.Configuration`: plain, tinted, gray, filled, borderless, bordered, borderedProminent, borderedTinted, iOS 26 glass and prominentGlass. title, attributedTitle, subtitle, image, imagePlacement, imagePadding, titlePadding, contentInsets, buttonSize, cornerStyle (dynamic = capsule on iOS 26), base colors, configurationUpdateHandler. Legacy: `UIButton(type:)`, per-state title / color / image / background image, titleLabel, imageView, content/title/image edge insets, content alignment. `UIAction` |
| `UISegmentedControl` | Titles or images, insert / remove / enable / width per segment, selectedSegmentIndex, momentary, apportionsSegmentWidthsByContent, selectedSegmentTintColor, title text attributes. The pill springs to a new selection or follows a drag |
| `UISlider` | value / min / max, setValue(animated:), isContinuous, track tints, thumb tint. The thumb must be grabbed |
| `UIStepper` | value / min / max / step, autorepeat (0.5 s, then every 0.1 s), wraps, isContinuous |
| `UIPageControl` | numberOfPages, currentPage, hidesForSinglePage, tints, tap to page, prominent background |
| `UIProgressView` | default / bar style, setProgress(animated:), tints |
| `UIRefreshControl` | `scrollView.refreshControl`, pull trigger, beginRefreshing / endRefreshing, attributedTitle |
| `UIVisualEffectView` | `UIBlurEffect` (every style), `UIVibrancyEffect`, iOS 26 `UIGlassEffect` (regular / clear, tint) through the host's backdrop blur |

### UIKit: containers, bars and presentation

| API | Notes |
| --- | --- |
| `UINavigationController` | viewControllers, push / pop / popToRoot / popTo / setViewControllers (animated), the iOS push (0.5 s critically damped spring, the view below 30% left under a 10% dim, bar items cross-fading, large titles sliding with their views), `interactivePopGestureRecognizer` (velocity carried into the spring), isNavigationBarHidden / setNavigationBarHidden(animated:), delegate willShow / didShow, appearance callbacks in order, visibleViewController |
| `UINavigationBar` / `UINavigationItem` | iOS 26 metrics: title or titleView, Liquid Glass back button, left/right bar button groups, `prefersLargeTitles` + `largeTitleDisplayMode` (collapse and stretch follow the content scroll view), hidesBackButton, leftItemsSupplementBackButton, backButtonTitle / backBarButtonItem, standard and scrollEdge appearances (bar and item; `prompt` and compact appearances are stored, not drawn) |
| `UINavigationBarAppearance` | configureWithDefault / Opaque / TransparentBackground, backgroundColor, backgroundEffect, shadowColor, title and large title text attributes |
| `UIBarButtonItem` | title, image, style (plain, done, prominent), system items (iOS 26 symbols), custom view, primary action, fixed / flexible space, shared glass groups |
| `UITabBarController` / `UITabBar` / `UITabBarItem` | Floating iOS 26 glass bar (62 pt, 25 / 21 pt margins), selected tint, unselected tint, badges (value, color, dot), selectedIndex / selectedViewController, delegate shouldSelect / didSelect, reselecting pops to root, system items. The bar is part of the children's bottom safe area |
| Presentation | `UIPresentationController`: fullScreen (cover vertical; the presenter's view is removed), overFullScreen / overCurrentContext, crossDissolve, will / did appear and disappear in UIKit's order, `isBeingPresented` / `isBeingDismissed`, `UIAdaptivePresentationControllerDelegate` |
| `UISheetPresentationController` | automatic / pageSheet / formSheet on iPhone: card under the status bar, presenter scaled back over black with matching corners, light status bar, detents (medium, large, custom), selectedDetentIdentifier, largestUndimmedDetentIdentifier, prefersGrabberVisible, preferredCornerRadius, prefersScrollingExpandsWhenScrolledToEdge, animateChanges, dragging between detents, swipe and tap-outside dismissal honoring isModalInPresentation |
| `UIAlertController` | alert and actionSheet, `UIAlertAction` styles, preferredAction, one-cancel rule, addTextField (static fields), zoom-in / fade presentation, action sheet from the bottom with tap-outside cancel, handlers after dismissal |
| `UITableView` | plain / grouped / insetGrouped, data source and delegate, reuse, self-sizing, section titles and views, separators, selection, scrollToRow, row lookups, header / footer views |
| `UITableViewCell` | default / subtitle / value1 / value2, accessories and accessory views, highlight and selection backgrounds |
| `UICollectionView` | `UICollectionViewFlowLayout` (vertical / horizontal, sizes, insets, spacings, header / footer reference sizes, flow delegate), registered cells and supplementary views, reuse, selection, scrollToItem, lookups |

### Foundation and system services

| API | Notes |
| --- | --- |
| `NotificationCenter` | addObserver(forName:object:queue:using:) returning a token, target / method-name observers, post, removeObserver. `OperationQueue.main` |
| `UserDefaults` | standard and suites on `kernel.storage` (`NSUserDefaults:<suite>`). Typed property lists (strings, numbers, bools, dates, Data, arrays, dictionaries), Foundation's reader conversions, register(defaults:), removeObject, dictionaryRepresentation, didChangeNotification |
| `Timer` | scheduledTimer(withTimeInterval:repeats:block:), `Timer(timeInterval:repeats:block:)` + `RunLoop.main.add`, fire, invalidate, isValid, fireDate |
| `DispatchQueue` | main.async, asyncAfter(deadline:) with `DispatchTime.now() + seconds`, global(qos:), sync |
| `RunLoop` | main / current, add(_:forMode:), modes |
| `Bundle.main`, `ProcessInfo` | Info.plist basics (hosts configure them), resources; systemUptime, OS version |
| `UIDevice.current` | name, model, systemName, systemVersion (descriptor), idiom, orientation + notifications, battery monitoring |
| `UIPasteboard` | general and named, strings / URLs / images / typed values, changeCount, change notification |
| Haptics | `UIImpactFeedbackGenerator`, `UISelectionFeedbackGenerator`, `UINotificationFeedbackGenerator` (recorded, not felt) |
| `UIScreen` / `UIApplication` | `UIScreen.main`, brightness; open / canOpenURL, sendAction, applicationIconBadgeNumber, preferredContentSizeCategory |

## Deliberate deviations

**Core Animation**

- Implicit layer actions are not run. A standalone `CALayer` whose opacity changes does not fade. `disableActions` exists only for API parity. Explicit animations and UIView blocks are complete.
- Root layers (windows) are not animated: only sublayers get presentation values.
- A layer animating its bounds is redrawn at its presentation size each frame. Core Animation stretches the contents instead, unless contentMode is redraw.
- Transforms are 2D affine. 3D key paths (rotation.x/.y, perspective) are not animatable.
- Snapshots cannot capture backdrop materials, which are composite-time effects.

**UIView animation**

- The damping-ratio spring (`usingSpringWithDamping:`) is solved so that the motion settles exactly when `duration` ends. UIKit compresses its curve to the duration in a similar way, but the exact stiffness may differ.
- Flip and curl transitions draw as cross-dissolves.
- `UIViewPropertyAnimator.continueAnimation(withTimingParameters:)` resumes but keeps the original timing.

**Text**

- With the bundled fonts, Inter stands in for SF Pro, corrected by the kit's tracking and SF's metrics.
- `monospacedDigitSystemFont` draws proportional digits, because a canvas font string cannot request `tnum`.
- Disabled labels draw in `tertiaryLabel`.
- Link ranges draw in the link color without an underline.
- Text is laid out left to right: natural alignment means left, and there is no bidirectional layout.
- `allowsDefaultTighteningForTruncation` is accepted but never tightens letter spacing.

**Images**

- Bitmaps load asynchronously, because the host decodes them. Register catalog assets with their size to know it up front.
- Symbols are Material Symbols at one weight. `.fill` variants draw the outlined glyph, symbol weights are ignored, and multicolor and hierarchical rendering use one color.

**Controls**

- Pressed configuration buttons dim their content (30% for plain, 70% otherwise) and overlay their fill. UIKit's exact highlight colors differ slightly.
- Vibrancy draws the content view at the style's opacity, with no luminance blending.
- Liquid Glass is a blur, a wash, a rim and a shadow, with no refraction.

**Navigation**

- The iOS 26 back button is a chevron in a glass circle, as on the simulator captures the React Native header was matched against. The previous controller's title, its backButtonTitle, or "Back" becomes the button's accessibility label, so `backButtonDisplayMode` does not change the drawing.
- A push or pop started while another transition runs finishes the running one at once. UIKit queues it instead.
- `hidesBottomBarWhenPushed`, toolbars and `UISearchController` are not modeled.

**Presentation**

- Form sheets present like page sheets, as they do on iPhone. Popovers adapt to sheets.
- The presenter behind a large sheet is dimmed by 15%.
- Sheet corner radius comes from `iosKit.tokens.sheetRadius`.

**Alerts**

- Alerts use the kit's system UI tokens: a 270 pt card with hairline-separated buttons, as React Native's alerts do.
- Alert text fields are static boxes until UITextField lands.

**Lists**

- Row and item insert, delete and reload calls reload without animation.
- Self-sizing table rows measure each row's standard content once per reload.
- Plain table headers do not stick to the top.
- There are no swipe actions, editing mode, compositional layout or estimated self-sizing in collection views.

**Foundation**

- There is one thread. Global and private queues run on the main queue later.
- Notifications post synchronously, also to observers registered with `OperationQueue.main`.
- The pasteboard lives in memory and does not read the host clipboard.
- The battery reports full on a charger while monitoring is on.

**Fixed along the way**

- `UIPanGestureRecognizer` reported translation and velocity from an empty centroid once the last finger lifted. Translation jumped to minus the start point at `.ended`. It now holds the last position.
- `UIScrollView` sets its initial offset at `-adjustedContentInset` on its first layout in a window. React Native's scroll views, which manage their own offset, are left alone.

## Testing

`packages/os-ios/test/` boots bare devices with `createDevice()` from `@mimicry/testing`. The tests drive UIKit directly: behavior on the virtual clock, plus pixel checks. The screen tests write PNGs to `artifacts/os-ios/` (gitignored):

- `labels.png`, `symbols.png`, `controls.png`
- `navigation-tabs*.png`, `navigation-push.png`, `navigation-detail.png`, `settings.png`
- `sheet.png`, `sheet-medium.png`
- `alert.png`, `alert-stacked.png`, `action-sheet.png`
- `collection.png`
