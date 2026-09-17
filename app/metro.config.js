const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('wav');
// honour package "exports" (noble, anchor)
config.resolver.unstable_enablePackageExports = true;
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  crypto: require.resolve('react-native-get-random-values'),
};
module.exports = config;
