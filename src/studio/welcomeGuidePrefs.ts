export const WELCOME_GUIDE_STORAGE_KEY = 'vanguard_studio_hide_welcome_guide';

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

/** Returns true when the visitor has NOT opted out of the startup welcome controls guide. */
export function shouldShowWelcomeGuide(storage: StorageLike | null = getDefaultStorage()): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(WELCOME_GUIDE_STORAGE_KEY) !== '1';
  } catch {
    return true;
  }
}

/** Persists or clears the user's "Do not show next time" preference safely. */
export function setHideWelcomeGuidePreference(
  hideNextTime: boolean,
  storage: StorageLike | null = getDefaultStorage()
): void {
  if (!storage) return;
  try {
    if (hideNextTime) {
      storage.setItem(WELCOME_GUIDE_STORAGE_KEY, '1');
    } else {
      storage.removeItem(WELCOME_GUIDE_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota/privacy errors in restricted browser contexts
  }
}
