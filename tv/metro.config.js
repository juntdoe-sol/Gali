/**
 * Metro for the TV project. The TV code lives in ../app/src/tv and reuses the phone app's chain, engine and art
 * files, so Metro watches ../app, and a package imported from there resolves from this folder's node_modules (the
 * one with react-native-tvos). Hierarchical lookup stays on: packages such as @solana/web3.js carry their own
 * nested versions of @noble/*, and turning it off hands them the wrong one. The worktree has no app/node_modules.
 */
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const appRoot = path.resolve(__dirname, '../app');
const config = getDefaultConfig(__dirname);

config.watchFolders = [appRoot];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
config.resolver.assetExts.push('wav');
// honour package "exports" (noble, anchor), as the phone build does
config.resolver.unstable_enablePackageExports = true;
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  crypto: require.resolve('react-native-get-random-values'),
};
module.exports = config;
