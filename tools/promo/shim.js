// Injected into the page before any script runs: replaces the page's clock,
// animation frames and timers with a virtual clock that the recorder advances
// one video frame at a time, and counts WebSocket messages so the recorder can
// wait for snapshots to arrive before rendering.
(() => {
  const P = (window.__promo = { t: 0, rx: 0, timers: [], raf: [], id: 1 });
  performance.now = () => P.t;
  window.requestAnimationFrame = (cb) => {
    const id = P.id++;
    P.raf.push({ id, cb });
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    P.raf = P.raf.filter((r) => r.id !== id);
  };
  const add = (cb, ms, args, every) => {
    const id = P.id++;
    const d = Math.max(every ? 1 : 0, Number(ms) || 0);
    P.timers.push({ id, at: P.t + d, cb, args, every: every ? d : 0 });
    return id;
  };
  window.setTimeout = (cb, ms, ...args) => add(cb, ms, args, false);
  window.setInterval = (cb, ms, ...args) => add(cb, ms, args, true);
  window.clearTimeout = window.clearInterval = (id) => {
    P.timers = P.timers.filter((t) => t.id !== id);
  };
  const run = (fn, ...a) => {
    try {
      fn(...a);
    } catch (e) {
      console.error(e);
    }
  };
  /** Advance virtual time by dt ms: fire due timers in order, then one animation frame. */
  P.advance = (dt) => {
    const end = P.t + dt;
    for (let guard = 0; guard < 1000; guard++) {
      let next = null;
      for (const t of P.timers) if (!next || t.at < next.at) next = t;
      if (!next || next.at > end) break;
      P.t = Math.max(P.t, next.at);
      if (next.every) next.at += next.every;
      else P.timers = P.timers.filter((t) => t !== next);
      if (typeof next.cb === 'function') run(next.cb, ...next.args);
    }
    P.t = end;
    const q = P.raf;
    P.raf = [];
    for (const r of q) run(r.cb, P.t);
  };
  const RealWS = window.WebSocket;
  window.WebSocket = class extends RealWS {
    constructor(...a) {
      super(...a);
      this.addEventListener('message', () => P.rx++);
    }
  };
  // Title typefaces for the overlay layer.
  document.addEventListener('DOMContentLoaded', () => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Rajdhani:wght@500;600;700&family=JetBrains+Mono:wght@400;700&display=block';
    document.head.appendChild(l);
  });
})();
