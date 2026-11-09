import { beforeAll } from "vitest";

// Every test file starts with harmless ports and stand-ins for the
// platform's tool sets (names and gates taken from the platform, see
// README). Loaded in beforeAll, after the file's own vi.mock calls, so the
// core modules are never loaded here ahead of a test's mocks.
beforeAll(async () => {
  const support = await import("../src/test-support");
  support.useTestPorts();
  support.registerToolFixtures(support.platformToolFixtures());
});
