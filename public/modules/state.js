/**
 * Application State
 */

export const state = {
  autoRefreshEnabled: true,
  userIsScrolling: false,
  lastScrollPosition: 0,
  ws: null,
  idleTimer: null,
  lastHash: "",
  currentMode: "Fast",
  lastLoadTime: 0,
  isNewConversation: false,
};

export const CONSTANTS = {
  SCROLL_SYNC_DEBOUNCE: 50,
  DEFAULT_THINKING_TEXT: "Thinking..",
  APP_TITLE_DEFAULT: "Antigravity Web",
  LOAD_DEBOUNCE_MS: 300,
};
