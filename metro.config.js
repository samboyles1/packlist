// Learn more https://docs.expo.dev/guides/customizing-metro
const path = require('node:path');

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const escapeForRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// reference/ holds a de-minified copy of the original web artifact kept for the
// Stage 1 port (see docs/DECISIONS.md D9). It is documentation, not app code.
// Without this, Metro's file watcher indexes ~1.5MB of vendor bundle and slows
// every dev-server start for no benefit.
const referenceDir = path.join(__dirname, 'reference');

const existing = config.resolver.blockList;

config.resolver.blockList = [
  ...(Array.isArray(existing) ? existing : [existing].filter(Boolean)),
  new RegExp(`^${escapeForRegExp(referenceDir)}[\\\\/].*`),
];

module.exports = config;
