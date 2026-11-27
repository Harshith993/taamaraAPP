// Shared helpers for the demo videos (docs/demo/README.md).
// Records the real app with Playwright, with a visible cursor, click highlights, step captions and
// chapter title cards drawn in an overlay. Each "segment" is one browser context (one person on one
// device) recorded to its own WebM; scripts/demo/stitch.cjs joins them into an MP4 with chapters.
require("dotenv/config");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { BASE, resetLoginLimits } = require("../../tests/e2e/lib.cjs");

const PASSWORD = "Taamara@2026";
const DESKTOP = { width: 1440, height: 900 };
const IPAD = { width: 820, height: 1180 };
const PHONE = { width: 393, height: 852 };

// Runs inside every page: draws the cursor, click ripples, the highlight box, captions and cards.
// State that must survive a full page load (caption, cursor position) lives in sessionStorage.
function overlayScript(opts) {
  if (window.__demo) return;
  const small = opts.small;
  const css = `
#demo-layer{position:fixed;inset:0;pointer-events:none;z-index:2147483647;font-family:"Space Grotesk",Geist,system-ui,sans-serif}
#demo-cursor{position:fixed;left:0;top:0;width:${small ? 26 : 28}px;height:${small ? 26 : 28}px;opacity:0;transition:opacity .3s;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
.demo-ripple{position:fixed;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:3px solid #861A41;background:rgba(134,26,65,.18);animation:demo-rip .7s ease-out forwards}
@keyframes demo-rip{to{transform:scale(4.2);opacity:0}}
#demo-hl{position:fixed;border:3px solid #861A41;border-radius:12px;box-shadow:0 0 0 6px rgba(134,26,65,.18),0 0 24px rgba(134,26,65,.35);opacity:0;transition:opacity .25s, left .25s, top .25s, width .25s, height .25s}
#demo-cap{position:fixed;left:50%;bottom:${small ? 84 : 34}px;transform:translate(-50%,12px);max-width:${small ? 92 : 74}%;width:max-content;box-sizing:border-box;background:rgba(43,16,32,.93);color:#FFFCF6;padding:${small ? "10px 14px" : "14px 26px"};border-radius:${small ? 14 : 18}px;font-size:${small ? 15 : 23}px;line-height:1.35;font-weight:500;text-align:center;opacity:0;transition:opacity .35s, transform .35s;box-shadow:0 10px 30px rgba(0,0,0,.25)}
#demo-cap.on{opacity:1;transform:translate(-50%,0)}
#demo-cap b{color:#F3C644;font-weight:600}
#demo-card{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${small ? 12 : 18}px;background:radial-gradient(circle at 50% 38%,#FFFCF6 0,#F6F0E3 60%,#EFE3CC 100%);color:#2B1020;opacity:0;transition:opacity .5s;text-align:center;padding:0 8%}
#demo-card.on{opacity:1}
#demo-card img{width:${small ? 76 : 104}px;height:${small ? 76 : 104}px;border-radius:24px}
#demo-card .k{font-size:${small ? 13 : 17}px;letter-spacing:.18em;text-transform:uppercase;color:#861A41;font-weight:600}
#demo-card .h{font-size:${small ? 32 : 58}px;font-weight:700;line-height:1.1;max-width:1100px}
#demo-card .s{font-size:${small ? 17 : 25}px;color:#6B5560;max-width:900px;line-height:1.4}
#demo-card .bar{width:${small ? 70 : 120}px;height:5px;border-radius:3px;background:linear-gradient(90deg,#DD619A,#E8963A,#F3C644,#85A646,#38BDF8,#8B5CF6)}
`;
  const cursorSvg = small ? `<svg viewBox="0 0 26 26" width="100%" height="100%"><circle cx="13" cy="13" r="11" fill="rgba(134,26,65,.35)" stroke="#fff" stroke-width="2.5"/></svg>` : `<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#2B1020" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  let layer, cursor, cap, card, hl;
  const at = (x, y) => (small ? `translate(${x - 13}px,${y - 13}px)` : `translate(${x - 3}px,${y - 2}px)`);
  const ss = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch {} };
  const ensure = () => {
    if (!document.body) return false;
    if (layer && layer.isConnected) return true;
    layer = document.createElement("div");
    layer.id = "demo-layer";
    layer.innerHTML = `<style>${css}</style><div id="demo-hl"></div><div id="demo-cap"></div><div id="demo-card"></div><div id="demo-cursor">${cursorSvg}</div>`;
    document.body.appendChild(layer);
    cursor = layer.querySelector("#demo-cursor");
    cap = layer.querySelector("#demo-cap");
    card = layer.querySelector("#demo-card");
    hl = layer.querySelector("#demo-hl");
    const pos = (ss("demo-pos") || "").split(",");
    if (pos.length === 2) { cursor.style.transform = at(+pos[0], +pos[1]); cursor.style.opacity = 1; }
    const text = ss("demo-cap");
    if (text) { cap.innerHTML = text; cap.classList.add("on"); }
    return true;
  };
  setInterval(ensure, 300);
  document.addEventListener("DOMContentLoaded", ensure);
  addEventListener("mousemove", (e) => {
    if (!ensure()) return;
    cursor.style.transform = at(e.clientX, e.clientY);
    cursor.style.opacity = 1;
    ss("demo-pos", `${e.clientX},${e.clientY}`);
  }, true);
  addEventListener("mousedown", (e) => {
    if (!ensure()) return;
    const r = document.createElement("div");
    r.className = "demo-ripple";
    r.style.left = e.clientX + "px";
    r.style.top = e.clientY + "px";
    layer.appendChild(r);
    setTimeout(() => r.remove(), 800);
  }, true);
  window.__demo = {
    caption(html) {
      ensure();
      if (!html) { cap.classList.remove("on"); ss("demo-cap", null); return; }
      ss("demo-cap", html);
      cap.classList.remove("on");
      setTimeout(() => { cap.innerHTML = html; cap.classList.add("on"); }, cap.textContent ? 180 : 0);
    },
    card(kicker, heading, sub) {
      ensure();
      if (heading === null) { card.classList.remove("on"); return; }
      card.innerHTML = `<img src="/icons/icon-192.png" alt=""><div class="k">${kicker || ""}</div><div class="h">${heading}</div><div class="bar"></div><div class="s">${sub || ""}</div>`;
      card.classList.add("on");
    },
    hl(x, y, w, h) {
      ensure();
      if (x === null) { hl.style.opacity = 0; return; }
      Object.assign(hl.style, { left: x - 6 + "px", top: y - 6 + "px", width: w + 12 + "px", height: h + 12 + "px", opacity: 1 });
    },
    cursor(show) { ensure(); cursor.style.opacity = show ? 1 : 0; },
  };
  ensure();
}

/** One demo video: an ordered list of recorded segments, plus chapter marks. */
class Demo {
  constructor(name, { workDir, small = false, frame = "desktop" } = {}) {
    this.name = name;
    this.workDir = workDir || path.join(require("os").tmpdir(), `demo-${name}`);
    fs.rmSync(this.workDir, { recursive: true, force: true });
    fs.mkdirSync(this.workDir, { recursive: true });
    this.segments = [];
    this.frame = frame;
    this.small = small;
  }

  async open() {
    this.browser = await chromium.launch();
  }

  async close() {
    await this.browser.close();
    fs.writeFileSync(path.join(this.workDir, "segments.json"), JSON.stringify({ name: this.name, frame: this.frame, segments: this.segments }, null, 2));
    console.log(`${this.segments.length} segments in ${this.workDir}`);
  }

  /** Signs in without recording and returns the cookies, so recordings start on the page itself. */
  async session(login) {
    await resetLoginLimits();
    const ctx = await this.browser.newContext({ viewport: DESKTOP });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`);
    await page.fill('input[name="login"]', login);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
    const state = await ctx.storageState();
    await ctx.close();
    return state;
  }

  /**
   * Records one segment. device: "desktop" | "ipad" | "phone". login: a demo sign-in, or null to
   * start signed out. fn receives the helpers (see Director).
   */
  async segment({ device = "desktop", login = null, intro = false, options = {} }, fn) {
    const viewport = device === "phone" ? PHONE : device === "ipad" ? IPAD : DESKTOP;
    // Playwright records CSS pixels whatever the device scale, so phones are enlarged when stitched.
    const scale = 1;
    const storageState = login ? await this.session(login) : undefined;
    const dir = path.join(this.workDir, `seg-${String(this.segments.length).padStart(2, "0")}`);
    const ctx = await this.browser.newContext({
      viewport,
      deviceScaleFactor: scale,
      storageState,
      recordVideo: { dir, size: { width: viewport.width * scale, height: viewport.height * scale } },
      locale: "en-IN",
      timezoneId: "Asia/Kolkata",
      ...options,
    });
    const small = device === "phone" || this.small;
    await ctx.addInitScript(overlayScript, { small });
    if (intro) await ctx.addInitScript(() => (window.__ttForceIntro = true));
    const page = await ctx.newPage();
    const t0 = Date.now();
    const d = new Director(page, viewport, small);
    let err = null;
    try {
      await fn(d);
    } catch (e) {
      err = e;
      console.error(`segment ${this.segments.length} (${device}) failed: ${e.message.split("\n")[0]}`);
    }
    await page.waitForTimeout(400);
    const video = page.video();
    await ctx.close();
    const file = await video.path();
    const trim = d.startedAt ? (d.startedAt - t0) / 1000 : 0;
    const marks = d.marks.map((m) => ({ ...m, at: (m.t - d.startedAt) / 1000 }));
    this.segments.push({ file, device, trim, marks, error: err ? err.message.split("\n")[0] : null });
    for (const w of d.warnings) console.warn(`  ! ${w}`);
  }
}

/** The on-screen helpers used by the demo scripts. All waits are real time: the video is real time. */
class Director {
  constructor(page, viewport, small) {
    this.page = page;
    this.viewport = viewport;
    this.small = small;
    this.marks = [];
    this.warnings = [];
    this.startedAt = 0;
    this.mouse = { x: viewport.width / 2, y: viewport.height * 0.6 };
  }

  wait(ms) {
    return this.page.waitForTimeout(ms);
  }

  /** Opens the first page of the segment; the video is trimmed to start here. */
  async start(url, { card = null, waitUntil = "networkidle" } = {}) {
    await this.page.goto(BASE + url, { waitUntil });
    if (card) {
      await this.page.evaluate(([k, h, s]) => window.__demo.card(k, h, s), card);
      await this.wait(150);
    }
    this.startedAt = Date.now() - 100;
    if (card) {
      this.marks.push({ t: this.startedAt, title: card[1], kicker: card[0] });
      await this.wait(this.cardTime(card));
      await this.page.evaluate(() => window.__demo.card(null, null));
      await this.wait(600);
    }
  }

  cardTime(card) {
    return 2300 + ((card[2] || "").length + card[1].length) * 28;
  }

  /** A chapter title card in the middle of a segment. */
  async card(kicker, heading, sub = "", ms) {
    await this.caption(null);
    await this.page.evaluate(([k, h, s]) => window.__demo.card(k, h, s), [kicker, heading, sub]);
    this.marks.push({ t: Date.now(), title: heading, kicker });
    await this.wait(ms || this.cardTime([kicker, heading, sub]));
    await this.page.evaluate(() => window.__demo.card(null, null));
    await this.wait(600);
  }

  /** A step caption at the bottom of the screen; waits long enough to read it. */
  async caption(html, ms) {
    await this.page.evaluate((h) => window.__demo.caption(h), html).catch(() => {});
    if (html) await this.wait(ms ?? Math.min(6500, 1700 + html.replace(/<[^>]+>/g, "").length * 52));
  }

  /** Shows a caption without waiting (for captions that sit over a following action). */
  async say(html) {
    await this.page.evaluate((h) => window.__demo.caption(h), html).catch(() => {});
  }

  loc(target) {
    return typeof target === "string" ? this.page.locator(target).first() : target.first();
  }

  async moveTo(x, y, steps) {
    const dist = Math.hypot(x - this.mouse.x, y - this.mouse.y);
    await this.page.mouse.move(x, y, { steps: steps ?? Math.max(12, Math.min(45, Math.round(dist / 18))) });
    this.mouse = { x, y };
  }

  /** Glides the cursor to an element and outlines it. Returns false if it isn't on the page. */
  async point(target, { hl = true, hold = 500, timeout = 6000 } = {}) {
    const el = this.loc(target);
    try {
      await el.waitFor({ state: "visible", timeout });
      // Centre it, so nothing fixed (header, tab bar, caption) sits on top of it.
      const moved = await el.evaluate((e) => {
        const r = e.getBoundingClientRect();
        const off = r.top < 90 || r.bottom > innerHeight - 150;
        if (off) e.scrollIntoView({ block: "center", behavior: "smooth" });
        return off;
      });
      await this.wait(moved ? 900 : 250);
      const b = await el.boundingBox();
      if (!b) return false;
      if (hl) await this.page.evaluate((r) => window.__demo.hl(r.x, r.y, r.width, r.height), b);
      await this.moveTo(b.x + Math.min(b.width / 2, 60 + b.width / 4), b.y + b.height / 2);
      await this.wait(hold);
      return true;
    } catch (e) {
      this.warnings.push(`not found: ${String(target)} (${e.message.split("\n")[0]})`);
      return false;
    }
  }

  async unhl() {
    await this.page.evaluate(() => window.__demo.hl(null)).catch(() => {});
  }

  /** Points at an element, then clicks it. */
  async click(target, { after = 900, hold = 450, force = false } = {}) {
    if (!(await this.point(target, { hold }))) return false;
    await this.unhl();
    try {
      await this.page.mouse.down();
      await this.page.mouse.up();
    } catch {
      await this.loc(target).click({ force });
    }
    await this.wait(after);
    return true;
  }

  /** Clicks a field and types into it at a human pace. */
  async type(target, text, { delay = 55, clear = true } = {}) {
    if (!(await this.click(target, { after: 200 }))) return false;
    const el = this.loc(target);
    if (clear) await el.fill("");
    await el.pressSequentially(text, { delay });
    await this.wait(350);
    return true;
  }

  /** Clicks a button that opens the file picker and picks a file, as a person would. */
  async upload(target, file, inputSelector) {
    const chooser = this.page.waitForEvent("filechooser", { timeout: 6000 }).catch(() => null);
    const clicked = await this.click(target, { after: 100 });
    const fc = clicked ? await chooser : null;
    if (fc) await fc.setFiles(file);
    else if (inputSelector) await this.page.locator(inputSelector).first().setInputFiles(file);
    await this.wait(1200);
  }

  async select(target, option) {
    if (!(await this.point(target))) return false;
    await this.unhl();
    await this.loc(target).selectOption(option);
    await this.wait(700);
    return true;
  }

  /** Scrolls the page smoothly by px (negative scrolls up). */
  async scroll(px, { ms = 1400 } = {}) {
    const steps = Math.max(6, Math.round(Math.abs(px) / 40));
    for (let i = 0; i < steps; i++) {
      await this.page.mouse.wheel(0, px / steps);
      await this.wait(ms / steps);
    }
    await this.wait(400);
  }

  async scrollTop() {
    await this.page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await this.wait(800);
  }

  /** Goes to a page by URL (used when the click path isn't the point of the step). */
  async go(url) {
    await this.page.goto(BASE + url, { waitUntil: "networkidle" }).catch(() => {});
    await this.wait(700);
  }

  async idle() {
    await this.page.waitForLoadState("networkidle").catch(() => {});
  }

  /** Runs a step and keeps going if it fails, so one changed label doesn't spoil a whole take. */
  async step(label, fn) {
    try {
      await fn();
    } catch (e) {
      this.warnings.push(`${label}: ${e.message.split("\n")[0]}`);
      await this.unhl();
    }
  }
}

module.exports = { Demo, BASE, DESKTOP, IPAD, PHONE, PASSWORD };
