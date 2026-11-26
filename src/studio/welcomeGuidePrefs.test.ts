import test from 'node:test';
import assert from 'node:assert/strict';
import {
  setHideWelcomeGuidePreference,
  shouldShowWelcomeGuide,
  StorageLike,
  WELCOME_GUIDE_STORAGE_KEY,
} from './welcomeGuidePrefs';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

test('shouldShowWelcomeGuide defaults to true on first visit', () => {
  const storage = createMemoryStorage();
  assert.equal(shouldShowWelcomeGuide(storage), true);
  assert.equal(shouldShowWelcomeGuide(null), true);
});

test('setHideWelcomeGuidePreference persists opt-out and allows re-enabling', () => {
  const storage = createMemoryStorage();

  setHideWelcomeGuidePreference(true, storage);
  assert.equal(storage.getItem(WELCOME_GUIDE_STORAGE_KEY), '1');
  assert.equal(shouldShowWelcomeGuide(storage), false);

  setHideWelcomeGuidePreference(false, storage);
  assert.equal(storage.getItem(WELCOME_GUIDE_STORAGE_KEY), null);
  assert.equal(shouldShowWelcomeGuide(storage), true);
});

test('welcome guide preference helpers degrade safely when storage throws', () => {
  const brokenStorage: StorageLike = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {
      throw new Error('SecurityError');
    },
  };

  assert.equal(shouldShowWelcomeGuide(brokenStorage), true);
  assert.doesNotThrow(() => setHideWelcomeGuidePreference(true, brokenStorage));
  assert.doesNotThrow(() => setHideWelcomeGuidePreference(false, brokenStorage));
});
