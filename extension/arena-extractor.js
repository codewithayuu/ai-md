function _fastDelay(ms) {
  if (ms <= 0) {
    return new Promise(function (resolve) {
      var ch = new MessageChannel();
      ch.port1.onmessage = function () {
        resolve();
      };
      ch.port2.postMessage(null);
    });
  }
  if (document.hidden || ms < 50) {
    return new Promise(function (resolve) {
      var ch = new MessageChannel();
      ch.port1.onmessage = function () {
        resolve();
      };
      ch.port2.postMessage(null);
    });
  }
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

function _waitForDomSettle(targetEl, maxWaitMs) {
  maxWaitMs = maxWaitMs || 500;
  return new Promise(function (resolve) {
    var done = false;
    var mutated = false;

    var observer = new MutationObserver(function () {
      mutated = true;
    });

    observer.observe(targetEl, {
      childList: true,
      subtree: true,
    });

    var checkCount = 0;
    var maxChecks = 10;

    function check() {
      checkCount++;
      if (done) return;

      if (!mutated || checkCount >= maxChecks) {
        done = true;
        observer.disconnect();
        resolve(mutated);
        return;
      }

      mutated = false;
      _fastDelay(30).then(check);
    }

    _fastDelay(20).then(check);

    _fastDelay(maxWaitMs).then(function () {
      if (!done) {
        done = true;
        observer.disconnect();
        resolve(mutated);
      }
    });
  });
}

function _hashMsg(role, text) {
  var key = role + "|" + text.substring(0, 300) + "|" + text.length;
  var h = 0;
  for (var i = 0; i < key.length; i++) {
    h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

function _sendBg(data) {
  try {
    browser.runtime.sendMessage(Object.assign({ action: "arenaProgress" }, data));
  } catch (e) {}
}

var CHAT_SITES = {
  "arena.ai": { name: "Arena", type: "arena" },
  "www.arena.ai": { name: "Arena", type: "arena" },
  "lmarena.ai": { name: "Arena", type: "arena" },
  "www.lmarena.ai": { name: "Arena", type: "arena" },
  "chat.openai.com": { name: "ChatGPT", type: "chatgpt" },
  "chatgpt.com": { name: "ChatGPT", type: "chatgpt" },
  "claude.ai": { name: "Claude", type: "claude" },
};

function _detectSite() {
  var h = window.location.hostname;
  if (CHAT_SITES[h]) return CHAT_SITES[h];
  for (var domain in CHAT_SITES) {
    if (h.endsWith("." + domain)) return CHAT_SITES[domain];
  }
  return null;
}

function isArenaChatPage() {
  var site = _detectSite();
  if (!site || site.type !== "arena") return false;
  var p = window.location.pathname;
  return p.includes("/c/") || p === "/" || !!document.getElementById("chat-area");
}

function isSupportedChatPage() {
  return isArenaChatPage();
}

function getArenaMode() {
  var params = new URLSearchParams(window.location.search);
  var m = params.get("mode");
  if (m) return m;
  var ca = document.getElementById("chat-area");
  if (!ca) return "direct";
  var t = (ca.innerText || "").substring(0, 500).toLowerCase();
  if (t.includes("battle")) return "battle";
  if (t.includes("side")) return "side-by-side";
  return "direct";
}

var MODEL_KW = [
  "gpt",
  "claude",
  "gemini",
  "llama",
  "mistral",
  "command",
  "phi",
  "qwen",
  "deepseek",
  "grok",
  "sonnet",
  "opus",
  "haiku",
  "flash",
  "thinking",
  "turbo",
  "preview",
  "mini",
  "o1-",
  "o3-",
  "o4-",
];
var SKIP_LBL = new Set([
  "login",
  "copy",
  "share",
  "vote",
  "more",
  "direct",
  "battle",
  "search",
  "new chat",
  "leaderboard",
  "send",
  "terms of use",
  "privacy policy",
  "cookies",
  "battle mode",
  "direct mode",
  "regenerate",
  "edit",
  "retry",
]);

function _isModel(t) {
  if (!t || t.length < 3 || t.length > 80) return false;
  if (SKIP_LBL.has(t.toLowerCase().trim())) return false;
  var l = t.toLowerCase();
  for (var i = 0; i < MODEL_KW.length; i++) {
    if (l.indexOf(MODEL_KW[i]) !== -1) return true;
  }
  return false;
}

function _modelFrom(c) {
  if (!c) return null;
  var prose = c.querySelector(".prose");
  var w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
  var n;
  while ((n = w.nextNode())) {
    var t = n.textContent.trim();
    if (t.length < 3 || t.length > 80) continue;
    if (prose && prose.contains(n)) continue;
    if (_isModel(t)) return t;
  }
  return null;
}

function _headerModels() {
  var ca = document.getElementById("chat-area");
  if (!ca) return [];
  var ol = ca.querySelector("ol");
  var m = [];
  var els = ca.querySelectorAll("button,span,a,div,p");
  for (var i = 0; i < els.length; i++) {
    if (ol && ol.contains(els[i])) continue;
    var t = (els[i].innerText || "").trim();
    if (_isModel(t) && els[i].children.length <= 3 && m.indexOf(t) === -1) m.push(t);
  }
  return m;
}

function _findScroller(ol) {
  if (!ol) return null;
  var el = ol.parentElement;
  while (el && el !== document.body) {
    var s = window.getComputedStyle(el);
    var ov = s.overflowY;
    if ((ov === "auto" || ov === "scroll") && el.scrollHeight > el.clientHeight + 20) return el;
    if (el.scrollHeight > el.clientHeight + 50 && ov === "hidden") {
      var b = el.scrollTop;
      el.scrollTop = 10;
      if (el.scrollTop > 0) {
        el.scrollTop = b;
        return el;
      }
    }
    el = el.parentElement;
  }
  var sels = ['#chat-area [class*="overscroll-none"][class*="overflow"]', '#chat-area [class*="overflow-y-auto"]'];
  for (var i2 = 0; i2 < sels.length; i2++) {
    try {
      var cs = document.querySelectorAll(sels[i2]);
      for (var j = 0; j < cs.length; j++) {
        if (cs[j].scrollHeight > cs[j].clientHeight + 50 && cs[j].contains(ol)) return cs[j];
      }
    } catch (e) {}
  }
  return null;
}

function _parseTurn(turn) {
  var r = [];
  var txt = (turn.innerText || "").trim();
  if (!txt) return r;

  var ub = turn.querySelector('[class*="bg-surface-raised"]');
  if (ub) {
    var up = ub.querySelector(".prose") || ub;
    var ut = (up.innerText || "").trim();
    if (ut) r.push({ role: "user", text: ut, html: up.innerHTML, modelName: null });
    return r;
  }

  var panes = turn.querySelectorAll('[role="group"]');
  if (panes.length >= 2) {
    for (var p = 0; p < panes.length; p++) {
      var mn = _modelFrom(panes[p]);
      var pr = panes[p].querySelector(".prose.prose-sm") || panes[p].querySelector(".prose");
      if (pr) {
        var pt = (pr.innerText || "").trim();
        if (pt)
          r.push({
            role: "assistant",
            text: pt,
            html: pr.innerHTML,
            modelName: mn || "Model " + String.fromCharCode(65 + p),
            paneIndex: p,
          });
      }
    }
    return r;
  }

  var prose = turn.querySelector(".prose.prose-sm") || turn.querySelector(".prose");
  if (prose) {
    var mn2 = _modelFrom(turn);
    var t2 = (prose.innerText || "").trim();
    if (t2)
      r.push({
        role: "assistant",
        text: t2,
        html: prose.innerHTML,
        modelName: mn2,
      });
    return r;
  }

  if (txt.length > 10) {
    r.push({
      role: "unknown",
      text: txt,
      html: turn.innerHTML,
      modelName: null,
    });
  }
  return r;
}

function _collectVisible(ol, seen, list) {
  if (!ol) return 0;
  var c = 0;
  for (var i = 0; i < ol.children.length; i++) {
    var msgs = _parseTurn(ol.children[i]);
    for (var m = 0; m < msgs.length; m++) {
      var h = _hashMsg(msgs[m].role, msgs[m].text);
      if (!seen.has(h)) {
        seen.set(h, true);
        list.push(msgs[m]);
        c++;
      }
    }
  }
  return c;
}

async function _scrollPanes(ol) {
  var scrollers = ol.querySelectorAll('.no-scrollbar, [class*="overflow-y-auto"]');
  for (var i = 0; i < scrollers.length; i++) {
    var s = scrollers[i];
    if (s.scrollHeight <= s.clientHeight + 20) continue;
    s.scrollTop = 0;
    await _fastDelay(0);
    s.scrollTop = s.scrollHeight;
    await _fastDelay(0);
  }
}

function _estimateTokens(text) {
  if (!text) return 0;
  var charEstimate = Math.round(text.length / 4);
  var words = text.split(/\s+/).length;
  var wordEstimate = Math.round(words * 1.3);
  return Math.round((charEstimate + wordEstimate) / 2);
}

function _createTurndown() {
  if (typeof TurndownService === "undefined") return null;
  try {
    var td = new TurndownService({
      headingStyle: "atx",
      hr: "---",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
      emDelimiter: "*",
    });
    td.addRule("fenced", {
      filter: function (n) {
        return n.nodeName === "PRE" && n.querySelector("code");
      },
      replacement: function (_c, n) {
        var code = n.querySelector("code");
        var lang = (code.className || "").replace(/^language-/, "").split(/\s/)[0] || "";
        return "\n```" + lang + "\n" + (code.textContent || "") + "\n```\n";
      },
    });
    td.addRule("inlineCode", {
      filter: function (n) {
        return n.nodeName === "CODE" && (!n.parentNode || n.parentNode.nodeName !== "PRE");
      },
      replacement: function (c) {
        return c ? (c.indexOf("`") !== -1 ? "`` " + c + " ``" : "`" + c + "`") : "";
      },
    });
    return td;
  } catch (_e) {
    return null;
  }
}

function _formatMd(messages, mode, models, td, tokens, chars) {
  var L = [];
  var now = new Date().toISOString();
  var site = _detectSite();
  var siteName = site ? site.name : "AI Chat";

  L.push("# " + (document.title || siteName + " Session"));
  L.push("");
  L.push("| | |");
  L.push("|---|---|");
  L.push("| **Source** | " + window.location.href + " |");
  L.push("| **Captured** | " + now + " |");
  L.push("| **Platform** | " + siteName + " |");
  L.push("| **Mode** | " + mode + " |");
  if (models.length) L.push("| **Models** | " + models.join(", ") + " |");
  L.push("| **Messages** | " + messages.length + " |");
  L.push("| **Est. Tokens** | ~" + (tokens || 0).toLocaleString() + " |");
  L.push("| **Characters** | " + (chars || 0).toLocaleString() + " |");
  L.push("");
  L.push("---");
  L.push("");

  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    if (msg.role === "user") {
      L.push("### 🧑 User");
    } else if (msg.role === "assistant") {
      L.push("### 🤖 Assistant" + (msg.modelName ? " (" + msg.modelName + ")" : ""));
    } else {
      L.push("### " + msg.role);
    }
    L.push("");

    var content = msg.text;
    if (msg.html && td) {
      try {
        var c = td.turndown("<div>" + msg.html + "</div>");
        c = c.replace(/\n{3,}/g, "\n\n").trim();
        if (c) content = c;
      } catch (_e) {}
    }
    L.push(content);
    L.push("");
    if (i < messages.length - 1) {
      L.push("---");
      L.push("");
    }
  }

  L.push("");
  L.push("---");
  L.push("*Exported by AI-MD — " + now + "*");
  return L.join("\n");
}

async function runArenaExtraction(extractionId) {
  window._arenaExtractionCancelled = false;

  var chatArea = document.getElementById("chat-area");
  if (!chatArea) {
    _sendBg({ id: extractionId, status: "error", error: "No chat area found" });
    return;
  }

  var ol = chatArea.querySelector("ol");
  if (!ol || ol.children.length === 0) {
    _sendBg({ id: extractionId, status: "error", error: "No messages found" });
    return;
  }

  var mode = getArenaMode();
  var site = _detectSite();

  _sendBg({
    id: extractionId,
    status: "started",
    mode: mode,
    url: window.location.href,
    title: document.title,
    siteName: site ? site.name : "AI Chat",
  });

  var seen = new Map();
  var allMsgs = [];
  var startTime = Date.now();

  _collectVisible(ol, seen, allMsgs);

  var scroller = _findScroller(ol);
  var needsScroll = scroller && scroller.scrollHeight > scroller.clientHeight + 30;

  if (!needsScroll) {
    allMsgs.reverse();
    _finishExtraction(extractionId, allMsgs, mode, startTime);
    return;
  }

  var totalH = scroller.scrollHeight - scroller.clientHeight;
  if (totalH <= 0) totalH = 1;
  var origScroll = scroller.scrollTop;

  var step = Math.max(500, scroller.clientHeight * 3);

  _sendBg({
    id: extractionId,
    status: "collecting",
    phase: "scrolling_to_top",
    progress: 0,
    messagesFound: allMsgs.length,
  });

  scroller.scrollTop = 0;
  await _waitForDomSettle(ol, 300);
  _collectVisible(ol, seen, allMsgs);

  var lastTop = -1;
  var stale = 0;
  var maxIter = 2000;
  var lastProgressTime = 0;

  for (var iter = 0; iter < maxIter; iter++) {
    if (window._arenaExtractionCancelled) {
      window._arenaExtractionCancelled = false;
      scroller.scrollTop = origScroll;
      _sendBg({ id: extractionId, status: "error", error: "Cancelled" });
      return;
    }

    scroller.scrollTop += step;

    await _waitForDomSettle(ol, 200);

    _collectVisible(ol, seen, allMsgs);

    var curTop = scroller.scrollTop;
    var pct = Math.min(99, Math.round((curTop / totalH) * 100));
    var atBottom = curTop + scroller.clientHeight >= scroller.scrollHeight - 20;

    if (Math.abs(curTop - lastTop) < 3) {
      stale++;
      if (stale > 3) break;
    } else {
      stale = 0;
    }
    lastTop = curTop;

    var now = Date.now();
    if (now - lastProgressTime > 300 || atBottom) {
      var elapsed = Math.round((now - startTime) / 1000);
      var rate = pct > 0 ? elapsed / pct : 0;
      var eta = Math.max(0, Math.round(rate * (100 - pct)));

      _sendBg({
        id: extractionId,
        status: "collecting",
        phase: "scrolling",
        progress: pct,
        messagesFound: allMsgs.length,
        elapsedSeconds: elapsed,
        etaSeconds: eta > 0 ? eta : null,
      });
      lastProgressTime = now;
    }

    if (atBottom) {
      scroller.scrollTop = scroller.scrollHeight;
      await _waitForDomSettle(ol, 200);
      _collectVisible(ol, seen, allMsgs);
      break;
    }
  }

  _sendBg({
    id: extractionId,
    status: "collecting",
    phase: "scanning_panes",
    progress: 97,
    messagesFound: allMsgs.length,
  });
  await _scrollPanes(ol);
  _collectVisible(ol, seen, allMsgs);

  scroller.scrollTop = origScroll;

  allMsgs.reverse();

  _finishExtraction(extractionId, allMsgs, mode, startTime);
}

function _finishExtraction(id, messages, mode, startTime) {
  var models = [];
  var totalChars = 0;
  for (var i = 0; i < messages.length; i++) {
    totalChars += (messages[i].text || "").length;
    if (messages[i].modelName && models.indexOf(messages[i].modelName) === -1) {
      models.push(messages[i].modelName);
    }
  }
  if (!models.length) models = _headerModels();

  var estTokens = _estimateTokens(
    messages
      .map(function (m) {
        return m.text;
      })
      .join(" "),
  );
  var td = _createTurndown();
  var markdown = _formatMd(messages, mode, models, td, estTokens, totalChars);
  var elapsed = Math.round((Date.now() - startTime) / 1000);

  _sendBg({
    id: id,
    status: "complete",
    messagesFound: messages.length,
    markdownLength: markdown.length,
    estimatedTokens: estTokens,
    totalCharacters: totalChars,
    models: models,
    mode: mode,
    elapsedSeconds: elapsed,
    markdown: markdown,
    title: document.title || "AI Chat",
    url: window.location.href,
    autoDownload: true,
  });
}

function tryArenaExtraction() {
  if (!isArenaChatPage()) return null;
  var ca = document.getElementById("chat-area");
  if (!ca) return null;
  var ol = ca.querySelector("ol");
  if (!ol || ol.children.length === 0) return null;

  var seen = new Map();
  var list = [];
  _collectVisible(ol, seen, list);
  if (!list.length) return null;
  list.reverse();

  var mode = getArenaMode();
  var models = [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].modelName && models.indexOf(list[i].modelName) === -1) models.push(list[i].modelName);
  }
  if (!models.length) models = _headerModels();
  var allText = list
    .map(function (m) {
      return m.text;
    })
    .join(" ");
  var tokens = _estimateTokens(allText);
  var chars = allText.length;
  return _formatMd(list, mode, models, _createTurndown(), tokens, chars);
}
