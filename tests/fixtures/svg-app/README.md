# react-native-svg fixture

A tiny app for `tests/e2e/svg.test.ts`. It runs the real react-native-svg
JavaScript (vendored by the compiler, as for any app) against Mimicry's native
SVG side.

```sh
npm install --prefix tests/fixtures/svg-app --ignore-scripts --no-package-lock --legacy-peer-deps
```

The test is skipped when `node_modules` is missing.
