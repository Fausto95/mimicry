const { getDefaultConfig } = require('expo/metro-config');
const { withMimicry } = require('../../packages/runtime/metro.cjs');

const config = getDefaultConfig(__dirname);

// Redirect Expo UI controls to Mimicry's browser emulation layer only for web.
// iOS and Android native builds still resolve @expo/ui normally.
module.exports = withMimicry(config);
