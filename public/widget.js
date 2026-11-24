/**
 * InnPilot embeddable concierge widget.
 *
 * Paste one line on a hotel's website:
 *
 *   <script src="https://YOUR_DOMAIN/widget.js" data-hotel="PUBLIC_HOTEL_ID" async></script>
 *
 * No build step, no dependencies, and no access to the hotel page's DOM/CSS:
 * the launcher and panel live in a Shadow Root. The app origin comes from this
 * script's own src, so the same file works in development and in production.
 */
(function () {
  "use strict";

  var GLOBAL_FLAG = "__innpilotWidgetInstalled";
  if (window[GLOBAL_FLAG]) return;

  // For a classic async script, currentScript is the element being executed.
  // The fallback also covers a script injected after page load.
  var script =
    document.currentScript ||
    Array.prototype.slice.call(document.scripts).reverse().find(function (s) {
      return /(^|\/)widget\.js(\?|$)/.test(s.src || "");
    });
  if (!script || !script.src) return;

  var hotelId = (script.getAttribute("data-hotel") || "").trim();
  if (!hotelId) {
    console.warn("[InnPilot] Add data-hotel=\"PUBLIC_HOTEL_ID\" to the widget script tag.");
    return;
  }

  window[GLOBAL_FLAG] = true;

  var appOrigin = new URL(script.src, document.baseURI).origin;
  var conciergeUrl = new URL("/#/c/" + encodeURIComponent(hotelId), appOrigin).href;

  function mount() {
    if (document.getElementById("innpilot-widget-host")) return;

    var host = document.createElement("div");
    host.id = "innpilot-widget-host";
    document.body.appendChild(host);

    var shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML =
      "<style>" +
      ":host{" +
      "all:initial;" +
      "position:fixed;inset:0;z-index:2147483647;" +
      "pointer-events:none;" +
      "font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;" +
      "color:#0f172a;" +
      "}" +
      "*,*::before,*::after{box-sizing:border-box;}" +
      "button,a{font:inherit;}" +
      ".launcher{" +
      "position:absolute;right:20px;bottom:20px;" +
      "width:56px;height:56px;border:0;border-radius:999px;" +
      "background:#0e7490;color:#fff;cursor:pointer;" +
      "display:flex;align-items:center;justify-content:center;" +
      "box-shadow:0 10px 30px rgba(15,23,42,.28);" +
      "pointer-events:auto;" +
      "}" +
      ".launcher:hover{background:#155e75;}" +
      ".launcher:focus-visible,.close:focus-visible,.escape:focus-visible{" +
      "outline:3px solid #67e8f9;outline-offset:2px;}" +
      ".panel{" +
      "position:absolute;right:20px;bottom:88px;" +
      "width:380px;height:600px;max-height:calc(100vh - 108px);" +
      "display:none;flex-direction:column;overflow:hidden;" +
      "background:#fff;border:1px solid #e2e8f0;border-radius:16px;" +
      "box-shadow:0 24px 60px rgba(15,23,42,.28);" +
      "pointer-events:auto;" +
      "}" +
      ":host([open]) .panel{display:flex;}" +
      ".bar{" +
      "display:flex;align-items:center;gap:8px;flex:none;" +
      "padding:10px 12px;border-bottom:1px solid #e2e8f0;background:#f8fafc;}" +
      ".dot{width:8px;height:8px;border-radius:50%;background:#10b981;flex:none;}" +
      ".name{font-size:13px;font-weight:650;color:#0f172a;}" +
      ".escape{margin-left:auto;font-size:11px;color:#0e7490;text-decoration:none;}" +
      ".escape:hover{text-decoration:underline;}" +
      ".close{" +
      "width:26px;height:26px;border:0;border-radius:6px;background:transparent;" +
      "color:#475569;cursor:pointer;font-size:18px;line-height:1;}" +
      ".close:hover{background:#e2e8f0;}" +
      ".frame{display:block;flex:1;width:100%;height:100%;border:0;background:#fff;}" +
      ".fallback{" +
      "display:none;flex:1;flex-direction:column;align-items:center;justify-content:center;" +
      "gap:10px;padding:24px;text-align:center;background:#f8fafc;}" +
      ".fallback p{margin:0;font-size:13px;line-height:1.5;color:#475569;}" +
      ".retry{" +
      "display:inline-block;padding:10px 14px;border-radius:8px;" +
      "background:#0e7490;color:#fff;font-size:13px;font-weight:600;text-decoration:none;}" +
      ".retry:hover{background:#155e75;}" +
      ":host([failed]) .frame{display:none;}" +
      ":host([failed]) .fallback{display:flex;}" +
      "@media (max-width:600px){" +
      ".panel{inset:0;width:100%;height:100%;max-height:none;border:0;border-radius:0;}" +
      ".launcher{right:16px;bottom:16px;}" +
      ":host([open]) .launcher{display:none;}" +
      "}" +
      "@media (max-height:520px) and (min-width:601px){" +
      ".panel{bottom:76px;height:calc(100vh - 96px);}" +
      ".launcher{width:48px;height:48px;right:16px;bottom:14px;}" +
      "}" +
      "</style>" +
      '<div class="panel" role="dialog" aria-label="InnPilot concierge">' +
      '<div class="bar">' +
      '<span class="dot"></span><span class="name">InnPilot concierge</span>' +
      '<a class="escape" target="_blank" rel="noopener noreferrer" href="' + conciergeUrl + '">Open in new tab</a>' +
      '<button class="close" type="button" aria-label="Close chat">&times;</button>' +
      "</div>" +
      '<iframe class="frame" title="InnPilot concierge" src="' + conciergeUrl + '" referrerpolicy="strict-origin-when-cross-origin"></iframe>' +
      '<div class="fallback">' +
      "<p>The chat couldn't load here. You can still open it directly in a new tab.</p>" +
      '<a class="retry" target="_blank" rel="noopener noreferrer" href="' + conciergeUrl + '">Open in new tab</a>' +
      "</div>" +
      "</div>" +
      '<button class="launcher" type="button" aria-label="Open InnPilot concierge" aria-expanded="false">' +
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '<path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4 20l1.8-4.6A7.5 7.5 0 1 1 20 11.5Z" ' +
      'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="8.5" cy="11.5" r="1" fill="currentColor"/>' +
      '<circle cx="12" cy="11.5" r="1" fill="currentColor"/>' +
      '<circle cx="15.5" cy="11.5" r="1" fill="currentColor"/>' +
      "</svg>" +
      "</button>";

    var launcher = shadow.querySelector(".launcher");
    var close = shadow.querySelector(".close");
    var frame = shadow.querySelector(".frame");

    function setOpen(open) {
      if (open) host.setAttribute("open", "");
      else host.removeAttribute("open");
      launcher.setAttribute("aria-expanded", open ? "true" : "false");
      (open ? close : launcher).focus();
    }

    launcher.addEventListener("click", function () {
      setOpen(!host.hasAttribute("open"));
    });
    close.addEventListener("click", function () {
      setOpen(false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && host.hasAttribute("open")) setOpen(false);
    });

    var loaded = false;
    frame.addEventListener("load", function () {
      loaded = true;
    });
    frame.addEventListener("error", function () {
      host.setAttribute("failed", "");
    });
    // Some browsers never fire `error` for a blocked frame; a silent frame is
    // still escapable through the always-visible link in the panel bar.
    setTimeout(function () {
      if (!loaded && !host.hasAttribute("failed")) host.setAttribute("failed", "");
    }, 8000);
  }

  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
})();
