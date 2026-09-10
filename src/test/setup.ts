import "fake-indexeddb/auto";
import "@testing-library/jest-dom";
import { afterEach, beforeEach } from "vitest";
import { installFakeStoreFetch, resetAllFakeStores } from "@/test/fakes/install-fake-store-fetch";
import { installWebStoragePolyfill } from "@/test/polyfills/web-storage";

// See the module's own header: on Node >= 22 vitest's jsdom environment leaves
// window.localStorage undefined. Installed here rather than per-file because
// app code reads it too (demo-actor, i18n, session-catalog).
//
// Deliberately NOT reset between tests. jsdom's Storage persisted for the
// lifetime of one test file, and src/clinician/lib/api/pilot-study-api.test.ts relies on
// that: its last test sets no actor and exercises the redaction branch left
// behind by the previous one. Tests that want isolation clear storage
// themselves -- see src/shared/data/db/tbct-source-fidelity-backup.test.ts's own
// beforeEach. Each test file gets a fresh environment, so nothing leaks
// across files.
installWebStoragePolyfill();

// The six Postgres-backed store endpoints are served from in-memory fakes --
// see the installer's own header for why each one is intercepted. The suite
// also fakes the dialogue agent, so tests assert against a realistic
// classification instead of the "provider unavailable" fallback.
installFakeStoreFetch({ interceptDialogueAgent: true });

beforeEach(resetAllFakeStores);
afterEach(resetAllFakeStores);
