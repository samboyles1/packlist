// Guards the placeholder identity from decision D7.
//
// This is the one file that must be edited to rename the app, so it is worth
// asserting that it stays internally consistent and loadable. A mistake here
// breaks every EAS build and store submission, and neither typecheck nor lint
// would catch it.
import config from '../../app.config';

const identity = config.extra?.identity;

describe('app config', () => {
  it('loads', () => {
    expect(config).toBeDefined();
  });

  it('uses a valid reverse-DNS bundle ID for iOS', () => {
    expect(config.ios?.bundleIdentifier).toMatch(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/);
  });

  it('uses a valid package name for Android', () => {
    expect(config.android?.package).toMatch(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/);
  });

  it('keeps the top-level fields and the runtime mirror in sync', () => {
    // These are duplicated on purpose so app code can read them from
    // Constants.expoConfig. Drift between them would be a silent bug.
    expect(identity?.name).toBe(config.name);
    expect(identity?.slug).toBe(config.slug);
    expect(identity?.scheme).toBe(config.scheme);
    expect(identity?.iosBundleId).toBe(config.ios?.bundleIdentifier);
    expect(identity?.androidPackage).toBe(config.android?.package);
  });

  it('has a non-empty slug, which is permanent once EAS is initialised', () => {
    expect(config.slug).toBeTruthy();
  });

  it('omits eas.projectId entirely when EAS_PROJECT_ID is unset', () => {
    // Regression: setting projectId to null made every `eas` command fail with
    // "must be a string, found object", and blocked the CLI from
    // auto-configuring the project. The key must be absent, never null.
    const eas = config.extra?.eas as { projectId?: unknown } | undefined;

    if (process.env.EAS_PROJECT_ID) {
      expect(eas?.projectId).toBe(process.env.EAS_PROJECT_ID);
    } else {
      expect(config.extra).not.toHaveProperty('eas');
      expect(eas).toBeUndefined();
    }
  });
});
