const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('wav');
// three/drei ship .cjs + package exports; keep resolution strict to their RN builds
config.resolver.unstable_enablePackageExports = true;
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  crypto: require.resolve('react-native-get-random-values'),
};
module.exports = config;
