import type { ExpoConfig } from 'expo/config';

/**
 * Central app identity — PLACEHOLDER VALUES (decision D7).
 *
 * To rename the app: change the constants below, then update store metadata at
 * release time. Nothing else in the codebase hardcodes the name or bundle IDs.
 *
 * This file is deliberately SELF-CONTAINED. It looks like it should be able to
 * import from `src/`, but it cannot: Expo compiles app.config.ts to CommonJS
 * before evaluating it, so ES module imports of sibling TypeScript files do not
 * bind correctly and the config fails to load. Keeping the literals here means
 * this file is the single place to edit, and it is directly testable.
 *
 * Note: `slug` is baked into the EAS project and native project identity, so
 * changing it after the first EAS build is disruptive. `iosBundleId` and
 * `androidPackage` are permanent once shipped — the stores reject changes to a
 * published app's identifier.
 */
const NAME = 'Packlist';
const SLUG = 'packlist';
const SCHEME = 'packlist';
const IOS_BUNDLE_ID = 'com.example.packlist';
const ANDROID_PACKAGE = 'com.example.packlist';

// EAS project id. Committed on purpose: cloud builds read app.config.ts and
// would not see an id that only existed in a gitignored .env. Override locally
// with EAS_PROJECT_ID if you ever need to point at a different project.
//
// `eas init` cannot write this file automatically ("Cannot automatically write
// to dynamic config at: app.config.ts") because it is TS, so it is maintained
// by hand.
const EAS_PROJECT_ID =
  process.env.EAS_PROJECT_ID ?? '3b072857-8434-40dc-bee6-dee4ca3fd471';

const config: ExpoConfig = {
  name: NAME,
  slug: SLUG,
  scheme: SCHEME,
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  platforms: ['ios', 'android'],
  ios: {
    bundleIdentifier: IOS_BUNDLE_ID,
    supportsTablet: true,
  },
  android: {
    package: ANDROID_PACKAGE,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: ['expo-router'],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    /**
     * Mirrored for runtime access via `Constants.expoConfig` (expo-constants).
     * Supabase keys are added in Stage 2 (S2-01); declared now so the shape is
     * fixed and CI can assert on it.
     */
    identity: {
      name: NAME,
      slug: SLUG,
      scheme: SCHEME,
      iosBundleId: IOS_BUNDLE_ID,
      androidPackage: ANDROID_PACKAGE,
    },
    supabase: {
      url: process.env.EXPO_PUBLIC_SUPABASE_URL ?? null,
      anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? null,
    },
    // `eas.projectId` must be a string or the key must be ABSENT. Setting it to
    // null makes every `eas` command fail with a type error, and it also stops
    // the CLI auto-configuring the project on the next run. See appConfig.test.ts.
    ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
  },
};

export default config;
