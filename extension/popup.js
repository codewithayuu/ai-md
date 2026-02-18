(function () {
  "use strict";

  var _markdown = null;
  var _title = "";
  var _lastTokenCount = 0;
  var DEFAULT_METADATA_FORMAT = "---\nSource: [{title}]({url})";

  function $(id) {
    return document.getElementById(id);
  }
  function show(el) {
    if (el) el.classList.remove("hidden");
  }
  function hide(el) {
    if (el) el.classList.add("hidden");
  }

  function toast(msg, type) {
    var el = $("el-toast");
    if (!el) return;
    el.className = "toast toast--" + (type || "info");
    el.textContent = msg;
    show(el);
    setTimeout(function () {
      hide(el);
    }, 4000);
  }

  function fmtNum(n) {
    if (n == null) return "—";
    return n > 9999 ? (n / 1000).toFixed(1) + "k" : String(n);
  }

  function fmtTime(s) {
    if (!s || s < 0) return "—";
    if (s < 60) return s + "s";
    return Math.floor(s / 60) + "m " + (s % 60) + "s";
  }

  function getActiveTab() {
    return browser.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
      return tabs && tabs[0] ? tabs[0] : null;
    });
  }

  var SETTINGS = {
    "s-meta": { key: "includeMetadata", def: true },
    "s-links": { key: "includeLinks", def: true },
    "s-images": { key: "includeImages", def: true },
    "s-autocopy": { key: "autoCopy", def: false },
    "s-preview": { key: "showPreview", def: true },
    "s-stats": { key: "showStats", def: true },
  };

  var SELECTS = {
    "s-heading": { key: "headingStyle", def: "atx" },
    "s-code": { key: "codeBlockStyle", def: "fenced" },
  };

  function loadSettings() {
    var syncKeyList = ["contentScope"];
    for (var id in SETTINGS) syncKeyList.push(SETTINGS[id].key);
    for (var id2 in SELECTS) syncKeyList.push(SELECTS[id2].key);

    var localKeyList = ["theme"].concat(syncKeyList);

    return Promise.all([browser.storage.sync.get(syncKeyList), browser.storage.local.get(localKeyList)])
      .then(function (res) {
        var syncRaw = res[0] || {};
        var localAll = res[1] || {};

        var defaults = { contentScope: "mainContent" };
        for (var sid in SETTINGS) defaults[SETTINGS[sid].key] = SETTINGS[sid].def;
        for (var sid2 in SELECTS) defaults[SELECTS[sid2].key] = SELECTS[sid2].def;

        var syncData = {};
        var migrate = {};
        for (var i = 0; i < syncKeyList.length; i++) {
          var k = syncKeyList[i];
          if (typeof syncRaw[k] === "undefined") {
            if (typeof localAll[k] !== "undefined") {
              syncData[k] = localAll[k];
              migrate[k] = localAll[k];
            } else {
              syncData[k] = defaults[k];
            }
          } else {
            syncData[k] = syncRaw[k];
          }
        }

        if (Object.keys(migrate).length) {
          browser.storage.sync.set(migrate).catch(function () {});
        }

        for (var sid in SETTINGS) {
          var el = $(sid);
          if (el) el.checked = syncData[SETTINGS[sid].key];
        }

        for (var sid2 in SELECTS) {
          var el2 = $(sid2);
          if (el2) el2.value = syncData[SELECTS[sid2].key];
        }

        var scope = syncData.contentScope || "mainContent";
        var tabs = document.querySelectorAll("#el-tabs .tab");
        tabs.forEach(function (t) {
          t.classList.toggle("on", t.getAttribute("data-scope") === scope);
        });

        if (localAll.theme === "dark") {
          document.documentElement.setAttribute("data-theme", "dark");
          var tb = $("btn-theme");
          if (tb) tb.textContent = "☀️";
        }

        return { sync: syncData, local: localAll };
      })
      .catch(function () {
        return { sync: {}, local: {} };
      });
  }

  function saveSetting(key, val) {
    var o = {};
    o[key] = val;
    var store = key === "theme" ? browser.storage.local : browser.storage.sync;
    store.set(o).catch(function () {});
  }

  function getSettings() {
    var s = { contentScope: "mainContent" };
    var activeTab = document.querySelector("#el-tabs .tab.on");
    if (activeTab) s.contentScope = activeTab.getAttribute("data-scope");

    for (var id in SETTINGS) {
      var el = $(id);
      if (el) s[SETTINGS[id].key] = el.checked;
    }
    for (var id2 in SELECTS) {
      var el2 = $(id2);
      if (el2) s[SELECTS[id2].key] = el2.value;
    }

    s.includeTitle = true;
    s.preserveTables = true;
    s.preserveIframeLinks = true;
    s.metadataFormat = DEFAULT_METADATA_FORMAT;
    s.debugMode = false;
    return s;
  }

  function doConvert() {
    var btn = $("btn-convert");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "⏳ Converting...";
    }

    getActiveTab().then(function (tab) {
      if (!tab) {
        toast("No active tab", "err");
        resetBtn();
        return;
      }

      var settings = getSettings();
      browser.tabs
        .sendMessage(tab.id, {
          action: "convertToMarkdown",
          settings: settings,
        })
        .then(function (result) {
          resetBtn();
          if (!result || !result.markdown) {
            toast("No content extracted", "warn");
            return;
          }

          _markdown = result.markdown;
          _title = result.title || tab.title || "page";
          _lastTokenCount = typeof result.tokenCount === "number" ? result.tokenCount : 0;

          showStats(_markdown, result.tokenCount);

          var previewEl = $("el-preview");
          var showPrev = $("s-preview");
          if (previewEl && (!showPrev || showPrev.checked)) {
            previewEl.textContent =
              _markdown.substring(0, 2000) +
              (_markdown.length > 2000 ? "\n\n... [" + (_markdown.length - 2000) + " more chars]" : "");
            show(previewEl);
          }

          var autoCopy = $("s-autocopy");
          if (autoCopy && autoCopy.checked) {
            copyToClipboard(_markdown).then(function (ok) {
              toast(ok ? "Converted & copied!" : "Converted (copy failed)", ok ? "ok" : "warn");
            });
          } else {
            toast("Converted!", "ok");
          }
        })
        .catch(function (err) {
          resetBtn();
          toast("Error: " + (err.message || err), "err");
        });
    });
  }

  function resetBtn() {
    var btn = $("btn-convert");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = "<span>⚡</span> Convert to Markdown";
    }
  }

  function showStats(md) {
    if (!md) return;
    var showEl = $("s-stats");
    var statsGrid = $("el-stats");
    if (showEl && !showEl.checked) {
      hide(statsGrid);
      return;
    }

    var chars = md.length;
    var words = md
      .split(/\s+/)
      .filter(function (w) {
        return w.length > 0;
      })
      .length;
    var tokens = arguments.length > 1 && typeof arguments[1] === "number" && arguments[1] > 0 ? arguments[1] : Math.round(chars / 4);

    var t = $("el-s-tokens");
    var c = $("el-s-chars");
    var w = $("el-s-words");
    if (t) t.textContent = fmtNum(tokens);
    if (c) c.textContent = fmtNum(chars);
    if (w) w.textContent = fmtNum(words);
    show(statsGrid);
  }

  function copyToClipboard(text) {
    function tryPopupClipboard() {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard
          .writeText(text)
          .then(function () {
            return true;
          })
          .catch(function () {
            return false;
          });
      }

      return Promise.resolve(false);
    }

    function tryExecCommand() {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;left:-9999px;top:-9999px";
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try {
          ok = document.execCommand("copy");
        } catch (e) {}
        document.body.removeChild(ta);
        return Promise.resolve(ok);
      } catch (e2) {
        return Promise.resolve(false);
      }
    }

    function tryContentScript() {
      return getActiveTab()
        .then(function (tab) {
          if (!tab || !tab.id) return false;
          return browser.tabs
            .sendMessage(tab.id, { action: "copyToClipboard", text: text })
            .then(function (r) {
              return !!(r && r.success);
            })
            .catch(function () {
              return false;
            });
        })
        .catch(function () {
          return false;
        });
    }

    return tryPopupClipboard().then(function (ok1) {
      if (ok1) return true;
      return tryExecCommand().then(function (ok2) {
        if (ok2) return true;
        return tryContentScript();
      });
    });
  }

  function downloadMarkdown(md, title) {
    if (!md) {
      toast("Nothing to download", "warn");
      return;
    }
    var fname = (title || "page")
      .replace(/[^a-zA-Z0-9_\-\s]/g, "")
      .replace(/\s+/g, "_")
      .substring(0, 60);
    fname = fname + "_" + new Date().toISOString().split("T")[0] + ".md";

    var blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 3000);
    toast("Downloaded!", "ok");
  }

  var RING_C = 2 * Math.PI * 25;
  var _xpoll = null;

  function xShow() {
    show($("el-xpanel"));
  }
  function xHide() {
    hide($("el-xpanel"));
  }

  function xUpdate(st) {
    if (!st || st.status === "idle") {
      xHide();
      return;
    }
    xShow();

    var running = st.status === "collecting" || st.status === "starting";
    var done = st.status === "complete";
    var err = st.status === "error";

    var ring = $("el-xring");
    if (ring) {
      var offset = RING_C * (1 - (st.progress || 0) / 100);
      ring.style.strokeDashoffset = offset;
      ring.setAttribute("class", "xring-fg" + (done ? " done" : err ? " fail" : ""));
    }
    var pct = $("el-xpct");
    if (pct) pct.textContent = (st.progress || 0) + "%";

    var inner = $("el-xpanel-inner");
    if (inner) inner.setAttribute("data-state", st.status);

    var title = $("el-xtitle");
    if (title) title.textContent = done ? "Export Complete" : err ? "Export Failed" : "Exporting Chat";

    var dot = document.querySelector(".xdot");
    if (dot) dot.style.animationPlayState = running ? "running" : "paused";

    var msgs = $("el-xmsgs");
    if (msgs) msgs.textContent = st.messagesFound || 0;
    var tok = $("el-xtokens");
    if (tok) tok.textContent = st.estimatedTokens ? "~" + fmtNum(st.estimatedTokens) : "—";
    var time = $("el-xtime");
    if (time) time.textContent = fmtTime(st.elapsedSeconds);
    var eta = $("el-xeta");
    if (eta) eta.textContent = fmtTime(st.etaSeconds);
    var etaRow = $("el-xeta-row");
    if (etaRow) etaRow.style.display = running && st.etaSeconds ? "flex" : "none";

    var status = $("el-xstatus");
    if (status) {
      if (done) status.textContent = "✅ Auto-downloaded to Downloads folder";
      else if (err) status.textContent = "❌ " + (st.error || "Error");
      else if (st.phase === "scrolling") status.textContent = "📜 Scanning messages... " + (st.progress || 0) + "%";
      else if (st.phase === "scrolling_to_top") status.textContent = "⬆️ Scrolling to top...";
      else if (st.phase === "scanning_panes") status.textContent = "🔍 Scanning panels...";
      else status.textContent = "🔄 Working...";
    }

    var cancel = $("btn-xcancel");
    if (cancel) cancel.style.display = running ? "" : "none";

    var doneEl = $("el-xdone");
    if (done) {
      show(doneEl);
      var summary = $("el-xsummary");
      if (summary)
        summary.textContent = (st.messagesFound || 0) + " msgs · ~" + fmtNum(st.estimatedTokens) + " tokens";
    } else {
      hide(doneEl);
    }
  }

  function xPoll() {
    browser.runtime
      .sendMessage({ action: "getArenaState" })
      .then(function (st) {
        xUpdate(st);
        if (st && (st.status === "complete" || st.status === "error" || st.status === "idle")) {
          if (_xpoll) {
            clearInterval(_xpoll);
            _xpoll = null;
          }
        }
      })
      .catch(function () {});
  }

  function xStartPoll() {
    if (_xpoll) clearInterval(_xpoll);
    _xpoll = setInterval(xPoll, 500);
    xPoll();
  }

  window.startArenaExport = function (tabId) {
    browser.runtime
      .sendMessage({ action: "startArenaExtraction", tabId: tabId })
      .then(function (r) {
        if (r && r.started) xStartPoll();
      })
      .catch(function (e) {
        toast("Failed: " + e.message, "err");
      });
  };

  document.addEventListener("DOMContentLoaded", function () {
    loadSettings();

    try {
      var m = browser.runtime.getManifest();
      var v = $("el-ver");
      if (v) v.textContent = "v" + m.version;
    } catch (e) {}

    var settingsBtn = $("btn-settings");
    var settingsEl = $("el-settings");
    if (settingsBtn && settingsEl) {
      settingsBtn.addEventListener("click", function () {
        settingsEl.classList.toggle("open");
        settingsBtn.classList.toggle("on");
      });
    }

    var themeBtn = $("btn-theme");
    if (themeBtn) {
      themeBtn.addEventListener("click", function () {
        var isDark = document.documentElement.getAttribute("data-theme") === "dark";
        var next = isDark ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        themeBtn.textContent = next === "dark" ? "☀️" : "🌙";
        saveSetting("theme", next);
      });
    }

    var tabBtns = document.querySelectorAll("#el-tabs .tab");
    tabBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        tabBtns.forEach(function (b) {
          b.classList.remove("on");
        });
        btn.classList.add("on");
        saveSetting("contentScope", btn.getAttribute("data-scope"));
      });
    });

    var convertBtn = $("btn-convert");
    if (convertBtn) convertBtn.addEventListener("click", doConvert);

    var copyBtn = $("btn-copy");
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        if (!_markdown) {
          toast("Convert first", "warn");
          return;
        }
        copyToClipboard(_markdown).then(function (ok) {
          if (ok) {
            toast("Copied to clipboard!", "ok");
            copyBtn.innerHTML = "✅ Copied";
            setTimeout(function () {
              copyBtn.innerHTML = "📋 Copy";
            }, 2000);
          } else {
            toast("Copy failed", "err");
          }
        });
      });
    }

    var dlBtn = $("btn-download");
    if (dlBtn) {
      dlBtn.addEventListener("click", function () {
        if (!_markdown) {
          toast("Convert first", "warn");
          return;
        }
        downloadMarkdown(_markdown, _title);
      });
    }

    for (var sid in SETTINGS) {
      (function (id, cfg) {
        var el = $(id);
        if (el)
          el.addEventListener("change", function () {
            saveSetting(cfg.key, el.checked);

            if (cfg.key === "showPreview") {
              var p = $("el-preview");
              if (p) {
                if (!el.checked) hide(p);
                else if (_markdown) {
                  p.textContent =
                    _markdown.substring(0, 2000) +
                    (_markdown.length > 2000 ? "\n\n... [" + (_markdown.length - 2000) + " more chars]" : "");
                  show(p);
                }
              }
            }

            if (cfg.key === "showStats") {
              var g = $("el-stats");
              if (g) {
                if (!el.checked) hide(g);
                else if (_markdown) showStats(_markdown, _lastTokenCount);
              }
            }
          });
      })(sid, SETTINGS[sid]);
    }
    for (var sid2 in SELECTS) {
      (function (id, cfg) {
        var el = $(id);
        if (el)
          el.addEventListener("change", function () {
            saveSetting(cfg.key, el.value);
          });
      })(sid2, SELECTS[sid2]);
    }

    var xcancel = $("btn-xcancel");
    if (xcancel)
      xcancel.addEventListener("click", function () {
        browser.runtime.sendMessage({ action: "cancelArenaExtraction" }).then(function () {
          xHide();
        });
      });

    var xdl = $("btn-xdownload");
    if (xdl)
      xdl.addEventListener("click", function () {
        browser.runtime.sendMessage({ action: "downloadArenaMarkdown" });
      });

    var xcopy = $("btn-xcopy");
    if (xcopy)
      xcopy.addEventListener("click", function () {
        browser.runtime.sendMessage({ action: "getArenaState" }).then(function (st) {
          if (st && st.markdown) {
            copyToClipboard(st.markdown).then(function (ok) {
              if (ok) {
                xcopy.textContent = "✅ Done";
                setTimeout(function () {
                  xcopy.textContent = "📋 Copy";
                }, 2000);
              }
            });
          }
        });
      });

    var xdismiss = $("btn-xdismiss");
    if (xdismiss)
      xdismiss.addEventListener("click", function () {
        browser.runtime.sendMessage({ action: "resetArenaState" }).then(function () {
          xHide();
        });
      });

    xStartPoll();
  });
})();
