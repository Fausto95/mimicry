# Modern device profiles (2026)

Mimicry simulates **the APIs and rendering surfaces that an app sees**. Device hardware is visualized in Studio, but the app's logical viewport and OS widgets are rendered by the engine. There is no iOS Simulator, Android Emulator, streaming, screenshot scraping, or native VM in the browser.

## Device selection

Studio defaults to **iPhone 18 Pro (iOS 27)** and **Pixel 11 Pro (Android 17 / API 37)**. Select a model and hardware finish from the toolbar, rotate it, and change its appearance. Finish changes update *only the exterior shell*; they do not interrupt the running React Native app, change its viewport or contaminate device-resolution screenshots.

| Platform | Device family | Initial availability |
| --- | --- | --- |
| iOS 27 | iPhone 18 Pro, 18 Pro Max | Model profiles and enclosure finishes; cutout and insets estimated |
| iOS 27 | iPhone 17, 17 Pro, 17 Pro Max | Model profiles and enclosure finishes |
| iOS 27 | iPhone 16, 16 Plus, 16 Pro, 16 Pro Max, 16e | Model profiles; notch and safe areas differ by model |
| iPadOS 27 | iPad Pro M5 (11/13"), iPad Air M4 (11/13") | Both orientations and regular size class |
| Android 17 (API 37) | Pixel 11 Pro/XL; Galaxy S26/S26 Ultra | Model profiles and Android shell finishes; insets and density estimated |
| Android | Pixel 9, Galaxy S25, Pixel Tablet | Backwards-compatible profiles |

Older device presets remain available for compatibility.

## What is real and what is simulated?

- **Real**: the bundle being executed by Mimicry, React reconciliation, Yoga layout, browser pointer/keyboard input, binary draw-command protocol, rendering/compositing and the Studio inspector.
- **Reimplemented**: UIKit / Core Animation-inspired interfaces, Liquid Glass effects, Android View and Material widgets, OS status chrome, gestures, navigation behavior and module adapters.
- **Visual-only**: side rails, physical buttons, bezels, and chosen hardware finishes around the viewport.
- **Approximate**: brand-new display corner radii, dynamic cutout dimensions, density and safe-area values until verified against current official simulator captures.

iOS 27 and Android 17 *version metadata do not imply full parity with Apple's or Google's current OS release*. Most UIKit Liquid Glass behavior currently derives from captured iOS 26 geometry, and Android's Material widgets still require fresh Android 17 / Material 3 Expressive oracle comparisons.

This separation is intentional: we can model more iOS/Android APIs without depending on the real simulators at runtime. The real OS is used only as an offline test oracle.

## Validation

Run:

```sh
npm run typecheck
npm test
npm run dev
# with Studio running on port 5180:
npm run test:browser
```

For pixel accuracy, capture the same scene in the matching iOS/Android simulator and compare it using `mimicry oracle`. Profiles labeled **estimated geometry** in Studio need reference captures before removing their `approximate` flag.

Manufacturer references for screen sizes and model information:

- [Apple iPhone 18 Pro specifications](https://www.apple.com/fr/iphone-18-pro/specs/)
- [Apple iPad Pro M5](https://www.apple.com/newsroom/2025/10/apple-introduces-the-powerful-new-ipad-pro-with-the-m5-chip/)
- [Apple iPad Air M4](https://www.apple.com/newsroom/2026/03/apple-introduces-the-new-ipad-air-powered-by-m4/)
- [Google Pixel 11 Pro specifications](https://store.google.com/us/product/pixel_11_pro_specs?hl=en-US)
- [Android 17 platform announcement](https://android-developers.googleblog.com/2026/06/Android-17.html)
- [Samsung Galaxy S26 Ultra](https://www.samsung.com/us/smartphones/galaxy-s26-ultra/)
- [Apple Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/liquid-glass)
