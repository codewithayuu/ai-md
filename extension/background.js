// AI-MD Background Script
// Handles keyboard shortcuts and background tasks
// Dependencies: libs/jszip.min.js, settings.js, and multi-tab-utils.js
// (loaded via manifest in Firefox, or importScripts in Chrome service worker)

// Load dependencies for Chrome service worker (not needed in Firefox)
if (typeof importScripts === 'function') {
  try {
    importScripts('libs/jszip.min.js', 'settings.js', 'multi-tab-utils.js');
  } catch (e) {
    console.error('Failed to load dependencies:', e);
    throw new Error('Critical dependencies failed to load. Please reinstall the extension.');
  }
}

let _arenaExtractionState = {
  active: false,
  id: null,
  tabId: null,
  status: "idle",
  phase: "",
  progress: 0,
  messagesFound: 0,
  estimatedTokens: 0,
  totalCharacters: 0,
  elapsedSeconds: 0,
  etaSeconds: null,
  autoDownloadEnabled: null,
  autoDownloaded: null,
  models: [],
  mode: "",
  title: "",
  url: "",
  markdown: null,
  error: null,
  startedAt: null,
  completedAt: null,
};

function _getArenaRuntime() {
  if (typeof browser !== "undefined" && browser.runtime) return browser.runtime;
  if (typeof chrome !== "undefined" && chrome.runtime) return chrome.runtime;
  return null;
}

function _getArenaTabs() {
  if (typeof browser !== "undefined" && browser.tabs) return browser.tabs;
  if (typeof chrome !== "undefined" && chrome.tabs) return chrome.tabs;
  return null;
}

function _getArenaStorageLocal() {
  if (typeof browser !== "undefined" && browser.storage && browser.storage.local) return browser.storage.local;
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) return chrome.storage.local;
  return null;
}

function _getArenaActionApi() {
  if (typeof browser !== "undefined") return browser.action || browser.browserAction || null;
  if (typeof chrome !== "undefined") return chrome.action || chrome.browserAction || null;
  return null;
}

function _getArenaDownloads() {
  if (typeof browser !== "undefined" && browser.downloads) return browser.downloads;
  if (typeof chrome !== "undefined" && chrome.downloads) return chrome.downloads;
  return null;
}

function _getArenaNotifications() {
  if (typeof browser !== "undefined" && browser.notifications) return browser.notifications;
  if (typeof chrome !== "undefined" && chrome.notifications) return chrome.notifications;
  return null;
}

function _resetExtractionState() {
  _arenaExtractionState = {
    active: false,
    id: null,
    tabId: null,
    status: "idle",
    phase: "",
    progress: 0,
    messagesFound: 0,
    estimatedTokens: 0,
    totalCharacters: 0,
    elapsedSeconds: 0,
    etaSeconds: null,
    autoDownloadEnabled: null,
    autoDownloaded: null,
    models: [],
    mode: "",
    title: "",
    url: "",
    markdown: null,
    error: null,
    startedAt: null,
    completedAt: null,
  };
}

function _persistArenaState() {
  const storageLocal = _getArenaStorageLocal();
  if (!storageLocal) return;
  try {
    if (typeof storageLocal.set === "function") {
      const res = storageLocal.set({ arenaExtractionState: _arenaExtractionState });
      if (res && typeof res.catch === "function") res.catch(function () {});
    }
  } catch (_e) {}
}

function _updateBadge(text, color) {
  const actionApi = _getArenaActionApi();
  if (!actionApi) return;
  try {
    actionApi.setBadgeText({ text: text });
    actionApi.setBadgeBackgroundColor({ color: color });
  } catch (_e) {}
}

function _clearBadge() {
  _updateBadge("", "#666");
}

function _handleArenaProgress(data, sender) {
  if (!data || !data.id) return;

  const state = _arenaExtractionState;
  if (state.id && state.id !== data.id && state.status !== "idle") return;

  switch (data.status) {
    case "started":
      state.active = true;
      state.id = data.id;
      state.tabId = sender && sender.tab ? sender.tab.id : state.tabId;
      state.status = "collecting";
      state.phase = "starting";
      state.mode = data.mode || "";
      state.url = data.url || "";
      state.title = data.title || "";
      state.startedAt = Date.now();
      state.progress = 0;
      _updateBadge("0%", "#4A90D9");
      break;

    case "collecting":
      state.status = "collecting";
      state.phase = data.phase || "";
      state.progress = data.progress || 0;
      state.messagesFound = data.messagesFound || 0;
      state.elapsedSeconds = data.elapsedSeconds || 0;
      state.etaSeconds = data.etaSeconds;
      _updateBadge(String(state.progress) + "%", "#4A90D9");
      break;

    case "chunk":
      if (data.chunkEnd) state.messagesFound = data.chunkEnd;
      break;

    case "complete":
      state.active = false;
      state.status = "complete";
      state.progress = 100;
      state.messagesFound = data.messagesFound || 0;
      state.estimatedTokens = data.estimatedTokens || 0;
      state.totalCharacters = data.totalCharacters || 0;
      state.models = data.models || [];
      state.mode = data.mode || state.mode;
      state.markdown = data.markdown;
      state.title = data.title || state.title;
      state.url = data.url || state.url;
      state.elapsedSeconds = data.elapsedSeconds || 0;
      state.completedAt = Date.now();
      state.autoDownloaded = null;

      _updateBadge("✓", "#27AE60");

      try {
        const storageLocal = _getArenaStorageLocal();
        if (storageLocal && typeof storageLocal.set === "function") {
          const res = storageLocal.set({ arenaExtractionState: state });
          if (res && typeof res.catch === "function") res.catch(function () {});
        }
      } catch (e) {}

      try {
        const storageLocal = _getArenaStorageLocal();
        const applySettings = function (settingsObj) {
          const autoDownloadEnabled = settingsObj && settingsObj.autoDownload !== undefined ? !!settingsObj.autoDownload : true;
          const showNotification = settingsObj && settingsObj.showNotification !== undefined ? !!settingsObj.showNotification : true;

          state.autoDownloadEnabled = autoDownloadEnabled;
          if (autoDownloadEnabled && state.markdown) {
            try {
              _autoDownloadMarkdown(state);
              state.autoDownloaded = true;
            } catch (_e) {
              state.autoDownloaded = false;
            }
          } else {
            state.autoDownloaded = false;
          }

          if (showNotification) {
            try {
              const notifications = _getArenaNotifications();
              const runtime = _getArenaRuntime();
              if (notifications && runtime && typeof notifications.create === "function") {
                const iconUrl = typeof runtime.getURL === "function" ? runtime.getURL("icons/icon128.png") : undefined;
                const messageSuffix = state.autoDownloaded ? "File downloaded." : "Ready to download.";
                const opts = {
                  type: "basic",
                  iconUrl: iconUrl,
                  title: "AI-MD — Export Complete",
                  message:
                    String(state.messagesFound) +
                    " messages · ~" +
                    Number(state.estimatedTokens || 0).toLocaleString() +
                    " tokens. " +
                    messageSuffix,
                };
                const res = notifications.create("arena-export-done", opts);
                if (res && typeof res.catch === "function") res.catch(function () {});
              }
            } catch (_e2) {}
          }

          _persistArenaState();
        };

        if (storageLocal && typeof storageLocal.get === "function") {
          const defaults = { autoDownload: true, showNotification: true };
          const res = storageLocal.get(defaults);
          if (res && typeof res.then === "function") {
            res.then(applySettings).catch(function () {
              applySettings(defaults);
            });
          } else {
            storageLocal.get(defaults, function (data2) {
              applySettings(data2 || defaults);
            });
          }
        } else {
          applySettings({ autoDownload: true, showNotification: true });
        }
      } catch (_e3) {}

      setTimeout(function () {
        if (_arenaExtractionState.status === "complete") _clearBadge();
      }, 15000);
      break;

    case "error":
      state.active = false;
      state.status = "error";
      state.error = data.error || "Unknown error";
      _updateBadge("!", "#E74C3C");
      setTimeout(_clearBadge, 10000);
      break;
  }

  _persistArenaState();
}

function _startArenaExtraction(tabId) {
  const extractionId = "arena_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
  _resetExtractionState();
  _arenaExtractionState.id = extractionId;
  _arenaExtractionState.tabId = tabId;
  _arenaExtractionState.active = true;
  _arenaExtractionState.status = "starting";
  _arenaExtractionState.startedAt = Date.now();

  _updateBadge("...", "#4A90D9");
  _persistArenaState();

  const tabsApi = _getArenaTabs();
  if (!tabsApi || typeof tabsApi.sendMessage !== "function") {
    _arenaExtractionState.status = "error";
    _arenaExtractionState.error = "Tabs API unavailable";
    _updateBadge("!", "#E74C3C");
    _persistArenaState();
    return extractionId;
  }

  try {
    const res = tabsApi.sendMessage(tabId, { action: "startArenaExtraction", extractionId: extractionId });
    if (res && typeof res.catch === "function") {
      res.catch(function (e) {
        _arenaExtractionState.status = "error";
        _arenaExtractionState.error = "Failed to reach content script: " + (e && e.message ? e.message : "Unknown error");
        _updateBadge("!", "#E74C3C");
        _persistArenaState();
      });
    }
  } catch (e) {
    _arenaExtractionState.status = "error";
    _arenaExtractionState.error = "Failed to reach content script: " + (e && e.message ? e.message : "Unknown error");
    _updateBadge("!", "#E74C3C");
    _persistArenaState();
  }

  return extractionId;
}

function _autoDownloadMarkdown(state) {
  if (!state || !state.markdown) return;

  var filename = (state.title || "ai-chat")
    .replace(/[^a-zA-Z0-9_\-\s]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 80);
  if (!filename) filename = "ai-chat";
  filename = filename + "_" + new Date().toISOString().split("T")[0] + ".md";

  var downloads = _getArenaDownloads();
  if (!downloads || typeof downloads.download !== "function") return;

  try {
    var blob = new Blob([state.markdown], { type: "text/markdown;charset=utf-8" });
    var url = URL.createObjectURL(blob);

    var p = downloads.download({
      url: url,
      filename: filename,
      saveAs: false,
    });

    if (p && typeof p.then === "function") {
      p.then(function (downloadId) {
        console.log("[AI-MD] Auto-downloaded:", filename, "id:", downloadId);
        setTimeout(function () {
          try {
            URL.revokeObjectURL(url);
          } catch (_e) {}
        }, 5000);
      }).catch(function (e) {
        console.error("[AI-MD] Auto-download failed:", e);
        try {
          downloads
            .download({
              url: url,
              filename: filename,
              saveAs: true,
            })
            .catch(function (e2) {
              console.error("[AI-MD] Download fallback also failed:", e2);
            });
        } catch (_e2) {}
      });
    }
  } catch (e) {
    console.error("[AI-MD] Auto-download error:", e);
  }
}

function _downloadArenaMarkdown() {
  const state = _arenaExtractionState;
  if (state.status !== "complete" || !state.markdown) return false;

  const tabsApi = _getArenaTabs();
  const tabId = state.tabId;
  if (!tabsApi || typeof tabsApi.sendMessage !== "function" || !tabId) return false;

  try {
    const res = tabsApi.sendMessage(tabId, {
      action: "downloadMarkdown",
      markdown: state.markdown,
      title: state.title || "AI Chat",
    });

    if (res && typeof res.then === "function") {
      res.then(function () {}).catch(function () {});
    }

    setTimeout(function () {
      _resetExtractionState();
      _clearBadge();
      _persistArenaState();
    }, 2000);
  } catch (_e) {
    return false;
  }

  return true;
}

try {
  const runtime = _getArenaRuntime();
  if (runtime && runtime.onMessage && typeof runtime.onMessage.addListener === "function") {
    runtime.onMessage.addListener(function (message, sender, sendResponse) {
      if (message && message.action === "arenaProgress") {
        _handleArenaProgress(message, sender);
        return;
      }

      if (message && message.action === "getArenaState") {
        sendResponse(_arenaExtractionState);
        return;
      }

      if (message && message.action === "startArenaExtraction") {
        const tabId = message.tabId;
        if (tabId) {
          const id = _startArenaExtraction(tabId);
          sendResponse({ started: true, extractionId: id });
        }
        return;
      }

      if (message && message.action === "downloadArenaMarkdown") {
        const success = _downloadArenaMarkdown();
        sendResponse({ success: success });
        return;
      }

      if (message && message.action === "cancelArenaExtraction") {
        const cancelTabId = _arenaExtractionState.tabId;
        const tabsApi = _getArenaTabs();
        if (cancelTabId && tabsApi && typeof tabsApi.sendMessage === "function") {
          try {
            const r = tabsApi.sendMessage(cancelTabId, { action: "cancelArenaExtraction" });
            if (r && typeof r.catch === "function") r.catch(function () {});
          } catch (_e) {}
        }
        _resetExtractionState();
        _clearBadge();
        _persistArenaState();
        sendResponse({ cancelled: true });
        return;
      }

      if (message && message.action === "resetArenaState") {
        _resetExtractionState();
        _clearBadge();
        _persistArenaState();
        sendResponse({ reset: true });
        return;
      }
    });
  }
} catch (_e) {}

try {
  const storageLocal = _getArenaStorageLocal();
  if (storageLocal && typeof storageLocal.get === "function") {
    const res = storageLocal.get("arenaExtractionState");
    if (res && typeof res.then === "function") {
      res.then(function (data) {
        if (data && data.arenaExtractionState) {
          Object.assign(_arenaExtractionState, data.arenaExtractionState);
          if (_arenaExtractionState.status === "collecting") {
            _arenaExtractionState.status = "error";
            _arenaExtractionState.error = "Extraction interrupted (browser restarted)";
            _arenaExtractionState.active = false;
            _persistArenaState();
          }
        }
      });
    } else {
      storageLocal.get("arenaExtractionState", function (data) {
        if (data && data.arenaExtractionState) {
          Object.assign(_arenaExtractionState, data.arenaExtractionState);
          if (_arenaExtractionState.status === "collecting") {
            _arenaExtractionState.status = "error";
            _arenaExtractionState.error = "Extraction interrupted (browser restarted)";
            _arenaExtractionState.active = false;
            _persistArenaState();
          }
        }
      });
    }
  }
} catch (_e) {}

// Create browser compatibility layer for service worker context
const browserAPI = (function() {
  // Check if we're in Firefox (browser is defined) or Chrome (chrome is defined)
  const isBrowser = typeof browser !== 'undefined';
  const isChrome = typeof chrome !== 'undefined';
  
  // Base object
  const api = {};
  
  // Helper to promisify callback-based Chrome APIs
  function promisify(chromeAPICall, context) {
    return (...args) => {
      return new Promise((resolve, reject) => {
        chromeAPICall.call(context, ...args, (result) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(result);
          }
        });
      });
    };
  }
  
  // Set up APIs
  if (isBrowser) {
    // Firefox already has promise-based APIs
    api.tabs = browser.tabs;
    api.runtime = browser.runtime;
    api.storage = browser.storage;
    api.commands = browser.commands;
    api.scripting = browser.scripting;
    // Use browser.menus for Firefox (more features than contextMenus)
    api.contextMenus = browser.menus || browser.contextMenus;
  } else if (isChrome) {
    // Chrome needs promisification
    api.tabs = {
      query: promisify(chrome.tabs.query, chrome.tabs),
      sendMessage: promisify(chrome.tabs.sendMessage, chrome.tabs),
      onHighlighted: chrome.tabs.onHighlighted,
      onActivated: chrome.tabs.onActivated
    };
    
    api.runtime = {
      onMessage: chrome.runtime.onMessage,
      onInstalled: chrome.runtime.onInstalled,
      onStartup: chrome.runtime.onStartup,
      getURL: chrome.runtime.getURL,
      lastError: chrome.runtime.lastError
    };
    
    api.storage = {
      sync: {
        get: function(keys) {
          return new Promise((resolve, reject) => {
            chrome.storage.sync.get(keys, (result) => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
              } else {
                resolve(result);
              }
            });
          });
        },
        set: function(items) {
          return new Promise((resolve, reject) => {
            chrome.storage.sync.set(items, () => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
              } else {
                resolve();
              }
            });
          });
        }
      }
    };
    
    api.commands = {
      onCommand: chrome.commands.onCommand
    };

    api.scripting = chrome.scripting;

    // Chrome contextMenus has special handling - create() returns ID synchronously
    api.contextMenus = {
      create: function(createProperties) {
        return new Promise((resolve, reject) => {
          const id = chrome.contextMenus.create(createProperties, () => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(id);
            }
          });
        });
      },
      update: promisify(chrome.contextMenus.update, chrome.contextMenus),
      remove: promisify(chrome.contextMenus.remove, chrome.contextMenus),
      removeAll: function() {
        return new Promise((resolve, reject) => {
          chrome.contextMenus.removeAll(() => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve();
            }
          });
        });
      },
      onClicked: chrome.contextMenus.onClicked
    };
  }

  return api;
})();

// Ensure content script is injected before sending messages
async function ensureContentScriptLoaded(tabId) {
  try {
    // Try sending a ping message to check if content script is loaded
    await browserAPI.tabs.sendMessage(tabId, { action: "ping" }).catch(() => {
      // If error, inject the content script
      return browserAPI.scripting.executeScript({
        target: { tabId: tabId },
        files: ["libs/readability.js", "libs/turndown.js", "arena-extractor.js", "content.js"]
      });
    });
    return true;
  } catch (error) {
    console.error("Cannot inject content script:", error);
    return false;
  }
}

// Context Menu Management
const CONTEXT_MENU_IDS = {
  PARENT: 'aimd-parent',
  SINGLE_COPY: 'aimd-single-copy',
  SINGLE_DOWNLOAD: 'aimd-single-download',
  MULTI_COPY: 'aimd-multi-copy',
  MULTI_DOWNLOAD: 'aimd-multi-download',
  MULTI_ZIP: 'aimd-multi-zip'
};

// Current menu state
let currentMenuMode = null; // 'single' or 'multi'
let currentMenuTabCount = 0; // Track tab count for multi-tab mode
let menuUpdateLock = Promise.resolve(); // Mutex lock for menu operations

// Browser-specific contexts ('tab' is Firefox-only)
// Detect Firefox by checking for browser.menus API
// Chrome doesn't support "menus" permission, so browser.menus will be undefined
const isFirefox = typeof browser !== 'undefined' &&
                  typeof browser.menus !== 'undefined';

const PAGE_CONTEXTS = isFirefox
  ? ['page', 'selection', 'link', 'tab']  // Firefox supports 'tab' context
  : ['page', 'selection', 'link'];        // Chrome doesn't support 'tab'

// Helper to run menu operations with mutex lock
async function withMenuLock(operation) {
  menuUpdateLock = menuUpdateLock.then(async () => {
    await operation();
  }).catch(err => {
    console.error('Menu operation error:', err);
  });
  return menuUpdateLock;
}

// Create single-tab context menus
async function createSingleTabMenus() {
  return withMenuLock(async () => {
    await browserAPI.contextMenus.removeAll();

    const parentMenuProps = {
      id: CONTEXT_MENU_IDS.PARENT,
      title: 'AI-MD: Copy to Markdown',
      contexts: PAGE_CONTEXTS
    };

    if (isFirefox) {
      parentMenuProps.icons = {
        16: 'icons/icon16.png',
        32: 'icons/icon48.png'
      };
    }

    await browserAPI.contextMenus.create(parentMenuProps);

    await browserAPI.contextMenus.create({
      id: CONTEXT_MENU_IDS.SINGLE_COPY,
      parentId: CONTEXT_MENU_IDS.PARENT,
      title: 'Copy to Clipboard (Alt+Shift+M)',
      contexts: PAGE_CONTEXTS
    });

    await browserAPI.contextMenus.create({
      id: CONTEXT_MENU_IDS.SINGLE_DOWNLOAD,
      parentId: CONTEXT_MENU_IDS.PARENT,
      title: 'Download as Markdown (Alt+Shift+D)',
      contexts: PAGE_CONTEXTS
    });

    currentMenuMode = 'single';
    currentMenuTabCount = 0;
  });
}

// Create multi-tab context menus
async function createMultiTabMenus(tabCount) {
  return withMenuLock(async () => {
    await browserAPI.contextMenus.removeAll();

    const parentMenuProps = {
      id: CONTEXT_MENU_IDS.PARENT,
      title: `Copy to Markdown (${tabCount} tabs)`,
      contexts: PAGE_CONTEXTS
    };

    if (isFirefox) {
      parentMenuProps.icons = {
        16: 'icons/icon16.png',
        32: 'icons/icon48.png'
      };
    }

    await browserAPI.contextMenus.create(parentMenuProps);

    await browserAPI.contextMenus.create({
      id: CONTEXT_MENU_IDS.MULTI_COPY,
      parentId: CONTEXT_MENU_IDS.PARENT,
      title: 'Copy All Tabs (Alt+Shift+M)',
      contexts: PAGE_CONTEXTS
    });

    await browserAPI.contextMenus.create({
      id: CONTEXT_MENU_IDS.MULTI_DOWNLOAD,
      parentId: CONTEXT_MENU_IDS.PARENT,
      title: 'Download Merged File (Alt+Shift+D)',
      contexts: PAGE_CONTEXTS
    });

    await browserAPI.contextMenus.create({
      id: CONTEXT_MENU_IDS.MULTI_ZIP,
      parentId: CONTEXT_MENU_IDS.PARENT,
      title: 'Download as ZIP (Alt+Shift+Z)',
      contexts: PAGE_CONTEXTS
    });

    currentMenuMode = 'multi';
    currentMenuTabCount = tabCount;
  });
}

// Update context menus based on tab selection
async function updateContextMenus() {
  try {
    const highlightedTabs = await MultiTabUtils.getHighlightedTabs(browserAPI);
    const tabCount = highlightedTabs.length;

    if (tabCount > 1) {
      // Multi-tab mode - recreate if mode changed or tab count changed
      if (currentMenuMode !== 'multi' || currentMenuTabCount !== tabCount) {
        await createMultiTabMenus(tabCount);
      }
    } else {
      // Single-tab mode
      if (currentMenuMode !== 'single') {
        await createSingleTabMenus();
      }
    }
  } catch (error) {
    console.error('Error updating context menus:', error);
  }
}

// Handle context menu clicks
browserAPI.contextMenus.onClicked.addListener(async (info, tab) => {
  const menuItemId = info.menuItemId;

  // Single-tab actions
  if (menuItemId === CONTEXT_MENU_IDS.SINGLE_COPY) {
    // Trigger the keyboard shortcut handler for copy
    await handleKeyboardShortcut('convert_to_markdown');
  } else if (menuItemId === CONTEXT_MENU_IDS.SINGLE_DOWNLOAD) {
    // Trigger the keyboard shortcut handler for download
    await handleKeyboardShortcut('download_markdown');
  }
  // Multi-tab actions
  else if (menuItemId === CONTEXT_MENU_IDS.MULTI_COPY) {
    await handleKeyboardShortcut('convert_to_markdown');
  } else if (menuItemId === CONTEXT_MENU_IDS.MULTI_DOWNLOAD) {
    await handleKeyboardShortcut('download_markdown');
  } else if (menuItemId === CONTEXT_MENU_IDS.MULTI_ZIP) {
    await handleKeyboardShortcut('download_zip');
  }
});

// Listen for tab selection changes to update context menus
browserAPI.tabs.onHighlighted.addListener(() => {
  updateContextMenus();
});

// Listen for tab activation to update context menus
browserAPI.tabs.onActivated.addListener(() => {
  updateContextMenus();
});

// Initialize context menus when extension is installed or updated
browserAPI.runtime.onInstalled.addListener(async () => {
  await createSingleTabMenus();
});

// Initialize context menus when browser starts
browserAPI.runtime.onStartup.addListener(async () => {
  await createSingleTabMenus();
});

// Initialize context menus immediately on script load (for development/reload)
createSingleTabMenus();

// Show notification in the current tab
async function showNotificationInTab(title, message) {
  try {
    const tabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
    if (!tabs || !tabs.length) return;

    const tab = tabs[0];

    // Send message to content script to show notification
    await browserAPI.tabs.sendMessage(tab.id, {
      action: 'showNotification',
      title: title,
      message: message
    });
  } catch (error) {
    console.error('Failed to show notification:', error);
  }
}

// Handle multi-tab commands
async function handleMultiTabCommand(command, tabs) {
  try {
    // Warn about large operations (can't use confirm in background, so just notify)
    if (MultiTabUtils.shouldWarnAboutLargeTabCount(tabs.length)) {
      await showNotificationInTab("Processing Many Tabs", `Converting ${tabs.length} tabs. This may take some time...`);
    }

    // Ensure content scripts are loaded in all tabs
    for (const tab of tabs) {
      await ensureContentScriptLoaded(tab.id);
    }

    // Get user settings
    const settings = await SettingsUtils.getUserSettings(browserAPI);

    // Process all tabs
    const results = await MultiTabUtils.processMultipleTabs(tabs, settings, browserAPI, null);
    const { message, successCount } = MultiTabUtils.getResultsSummary(results);

    if (successCount === 0) {
      await showNotificationInTab("Conversion Failed", "No tabs were successfully converted");
      return;
    }

    // Get token count settings
    let tokenSettings;
    try {
      tokenSettings = await browserAPI.storage.sync.get({
        showTokenCount: true,
        tokenContextLimit: 8192
      });
    } catch (e) {
      tokenSettings = { showTokenCount: true, tokenContextLimit: 8192 };
    }

    // Calculate total token count from all successful tabs
    let totalTokenCount = 0;
    results.forEach(result => {
      if (result.success && result.tokenCount) {
        totalTokenCount += result.tokenCount;
      }
    });

    // Format token count message
    let tokenMessage = "";
    if (tokenSettings.showTokenCount && totalTokenCount > 0) {
      const limit = tokenSettings.tokenContextLimit;
      const percentage = Math.round((totalTokenCount / limit) * 100);
      tokenMessage = `\n${totalTokenCount.toLocaleString()} tokens (${percentage}% of ${(limit/1000).toFixed(0)}K limit)`;
    }

    // Handle different commands
    if (command === "convert_to_markdown") {
      // Copy All: Merge and copy to clipboard
      const merged = MultiTabUtils.mergeMarkdownResults(results);

      // Copy to clipboard via active tab's content script
      const activeTabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
      if (activeTabs && activeTabs.length > 0) {
        await browserAPI.tabs.sendMessage(activeTabs[0].id, {
          action: "copyToClipboard",
          text: merged
        });
        await showNotificationInTab("Success", `${message} copied to clipboard${tokenMessage}`);
      }

    } else if (command === "download_markdown") {
      // Download Merged: Single .md file
      const merged = MultiTabUtils.mergeMarkdownResults(results);
      const filename = `llm-d-merged-${MultiTabUtils.getDateString()}.md`;

      // Trigger download via active tab
      const activeTabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
      if (activeTabs && activeTabs.length > 0) {
        await browserAPI.tabs.sendMessage(activeTabs[0].id, {
          action: "downloadMarkdown",
          markdown: merged,
          title: filename.replace('.md', '')
        });
        await showNotificationInTab("Success", `${message} downloaded as merged file${tokenMessage}`);
      }

    } else if (command === "download_zip") {
      // Download ZIP: Individual files in archive
      const { blob, filename } = await MultiTabUtils.createZipArchive(results);

      // Convert blob to data URL for download
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read blob'));
        reader.readAsDataURL(blob);
      });

      const activeTabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
      if (activeTabs && activeTabs.length > 0) {
        // Send download message to content script
        await browserAPI.tabs.sendMessage(activeTabs[0].id, {
          action: "downloadFile",
          dataUrl: dataUrl,
          filename: filename
        });
        await showNotificationInTab("Success", `ZIP with ${message} downloaded${tokenMessage}`);
      }
    }

  } catch (error) {
    console.error("Multi-tab command error:", error);
    await showNotificationInTab("Error", error.message || "Failed to process multiple tabs");
  }
}

// Handle keyboard shortcut/context menu action
async function handleKeyboardShortcut(command) {
  if (command === "convert_to_markdown" || command === "download_markdown" || command === "download_zip") {
    try {
      // Check if multiple tabs are selected
      const highlightedTabs = await MultiTabUtils.getHighlightedTabs(browserAPI);

      // Route to multi-tab handler if 2+ tabs selected
      if (highlightedTabs.length > 1) {
        await handleMultiTabCommand(command, highlightedTabs);
        return;
      }

      // Single-tab handling (existing behavior)
      const tabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
      if (!tabs || !tabs.length) {
        console.error("No active tab found");
        return;
      }

      const activeTab = tabs[0];
      
      // Check if the URL is valid for content scripts
      const url = activeTab.url || "";
      if (!url || url.startsWith("chrome://") || url.startsWith("edge://") || url.startsWith("about:")) {
        await showNotificationInTab("Cannot Convert", "Cannot run on browser pages. Please try on a regular website.");
        return;
      }
      
      // Ensure content script is loaded
      const isLoaded = await ensureContentScriptLoaded(activeTab.id);
      if (!isLoaded) {
        await showNotificationInTab("Error", "Could not load content script. Try refreshing the page.");
        return;
      }

      // Get user settings
      const settings = await SettingsUtils.getUserSettings(browserAPI);
      
      // Send message to content script to perform conversion
      try {
        const response = await browserAPI.tabs.sendMessage(activeTab.id, {
          action: "convertToMarkdown",
          settings: settings
        });
        
        if (response && response.success) {
          // Get token count settings
          let tokenSettings;
          try {
            tokenSettings = await browserAPI.storage.sync.get({
              showTokenCount: true,
              tokenContextLimit: 8192
            });
          } catch (e) {
            tokenSettings = { showTokenCount: true, tokenContextLimit: 8192 };
          }

          // Format token count message
          let tokenMessage = "";
          if (tokenSettings.showTokenCount && response.tokenCount > 0) {
            const limit = tokenSettings.tokenContextLimit;
            const percentage = Math.round((response.tokenCount / limit) * 100);
            tokenMessage = `\n${response.tokenCount.toLocaleString()} tokens (${percentage}% of ${(limit/1000).toFixed(0)}K limit)`;
          }

          if (command === "download_markdown") {
            // Download as file
            const pageTitle = activeTab.title || "llm-d";
            await browserAPI.tabs.sendMessage(activeTab.id, {
              action: "downloadMarkdown",
              markdown: response.markdown,
              title: pageTitle
            });
            await showNotificationInTab("Success", `Markdown file downloaded${tokenMessage}`);
          } else {
            // Copy to clipboard via content script
            await browserAPI.tabs.sendMessage(activeTab.id, {
              action: "copyToClipboard",
              text: response.markdown
            });
            await showNotificationInTab("Success", `Content converted and copied to clipboard${tokenMessage}`);
          }
        } else {
          await showNotificationInTab("Conversion Failed", response?.error || "Unknown error");
        }
      } catch (error) {
        console.error("Error during conversion:", error);
        await showNotificationInTab("Error", "Could not convert page. Please try again or open the extension popup.");
      }
    } catch (error) {
      console.error("Command handler error:", error);
    }
  }
}

// Handle keyboard shortcuts
browserAPI.commands.onCommand.addListener(async (command) => {
  await handleKeyboardShortcut(command);
});
