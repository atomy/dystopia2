import {
  CLASSES,
  IMPLANTS,
  ClassId,
  ImplantId,
  Team,
  TEAM_NAMES,
  DEFAULT_LOADOUTS,
  validateLoadout,
  WEAPONS,
  weaponsFor,
} from '@d2/shared';
import { KEY_HELP } from '../input.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface Settings {
  name: string;
  sensitivity: number;
  volume: number;
  quality: 'low' | 'medium' | 'high';
  fov: number;
}

const DEFAULTS: Settings = { name: '', sensitivity: 0.12, volume: 0.8, quality: 'medium', fov: 90 };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('d2.settings');
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem('d2.settings', JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

function keyHelpHtml(): string {
  return `<div class="keys">${KEY_HELP.map(([k, d]) => `<div><b>${k}</b> ${d}</div>`).join('')}</div>`;
}

export interface MainMenuResult {
  name: string;
  create: boolean;
  room?: string;
  bots: number;
  ff: boolean;
}

export function showMainMenu(parent: HTMLElement, settings: Settings, error = ''): Promise<MainMenuResult> {
  return new Promise((resolve) => {
    const s = document.createElement('div');
    s.className = 'screen interactive';
    const code = new URLSearchParams(location.search).get('room') ?? '';
    s.innerHTML = `
      <div class="menu wide" style="display:grid;grid-template-columns:1.1fr 1fr;gap:28px">
        <div>
          <div class="logo">DYSTOPIA<span>2</span></div>
          <p class="tagline">PUNKS VS CORPS · 2080s · JACK IN OR DIE TRYING</p>
          <div class="row"><label>Callsign</label><input type="text" id="name" maxlength="20" value="${esc(settings.name)}" placeholder="Runner"></div>
          <h3>Host a game</h3>
          <div class="row"><label>Bots / team</label><select id="bots">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option ${n === 4 ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          <div class="row"><label>Friendly fire</label><input type="checkbox" id="ff" checked></div>
          <div class="row"><button class="btn magenta" id="host">Host game</button></div>
          <h3>Join a game</h3>
          <div class="row"><label>Room code</label><input type="text" id="code" maxlength="5" value="${esc(code)}" style="text-transform:uppercase"><button class="btn" id="join">Join</button></div>
          <div class="rooms" id="rooms"><div style="color:var(--dim)">looking for rooms…</div></div>
          <div class="error" id="err">${esc(error)}</div>
        </div>
        <div>
          <h3>How it plays</h3>
          <p class="hint">Punks attack a DataTrust arcology in three stages; Corps defend. Deckers (Light/Medium with a Cyberdeck) jack in at terminals (JIPs) to hack doors, turrets, spawns and objectives in cyberspace while their bodies sit defenceless. In cyberspace your <b>energy is your life</b>: grey-grid tiles flip your gravity, hold SPACE to bounce, and running out ejects you with dumpshock.</p>
          ${keyHelpHtml()}
        </div>
      </div>`;
    parent.appendChild(s);
    const $ = <T extends HTMLElement>(id: string) => s.querySelector(`#${id}`) as T;
    const nameEl = $<HTMLInputElement>('name');
    const finish = (create: boolean, room?: string) => {
      const name = nameEl.value.trim() || 'Runner';
      settings.name = name;
      saveSettings(settings);
      s.remove();
      resolve({ name, create, room, bots: Number($<HTMLSelectElement>('bots').value), ff: $<HTMLInputElement>('ff').checked });
    };
    $('host').onclick = () => finish(true);
    $('join').onclick = () => {
      const c = $<HTMLInputElement>('code').value.trim().toUpperCase();
      if (c.length < 4) {
        $('err').textContent = 'Enter a room code.';
        return;
      }
      finish(false, c);
    };
    $<HTMLInputElement>('code').onkeydown = (e) => {
      if (e.key === 'Enter') $('join').click();
    };
    fetch('/api/rooms')
      .then((r) => r.json() as Promise<{ rooms: { code: string; map: string; players: number; bots: number }[] }>)
      .then((d) => {
        const list = $('rooms');
        if (!d.rooms.length) {
          list.innerHTML = '<div style="color:var(--dim)">no open rooms — host one!</div>';
          return;
        }
        list.innerHTML = '';
        for (const r of d.rooms) {
          const row = document.createElement('div');
          row.innerHTML = `<span>${esc(r.code)}</span><span>${esc(r.map)}</span><span>${r.players} players · ${r.bots} bots</span>`;
          row.onclick = () => finish(false, r.code);
          list.appendChild(row);
        }
      })
      .catch(() => ($('rooms').innerHTML = '<div style="color:var(--red)">server unreachable</div>'));
  });
}

export interface LoadoutChoice {
  team: number;
  cls: ClassId;
  implants: ImplantId[];
}

/** Team + class + implant picker. Resolves when the player deploys. */
export function showLoadout(parent: HTMLElement, current: LoadoutChoice, onDone: (c: LoadoutChoice) => void, onClose: () => void): () => void {
  const s = document.createElement('div');
  s.className = 'screen transparent interactive';
  let team = current.team;
  let cls = current.cls;
  let implants = [...current.implants];
  const render = () => {
    const c = CLASSES[cls]!;
    let head = 0;
    let body = 0;
    for (const id of implants) {
      const d = IMPLANTS[id]!;
      if (d.slot === 'head') head += d.cost;
      else body += d.cost;
    }
    const err = validateLoadout(cls, implants);
    const weapons = weaponsFor(cls)
      .map((w) => WEAPONS[w]!.name)
      .join(', ');
    s.innerHTML = `
      <div class="menu wide">
        <h2>Loadout</h2>
        <div class="teams">
          <button class="team-btn punk ${team === Team.Punk ? 'sel' : ''}" data-team="${Team.Punk}">${TEAM_NAMES[Team.Punk]} <span style="font-weight:400;font-size:12px">(attack)</span></button>
          <button class="team-btn corp ${team === Team.Corp ? 'sel' : ''}" data-team="${Team.Corp}">${TEAM_NAMES[Team.Corp]} <span style="font-weight:400;font-size:12px">(defend)</span></button>
          <button class="team-btn ${team === Team.Spectator ? 'sel' : ''}" data-team="${Team.Spectator}">Spectate</button>
        </div>
        <div class="loadout">
          <div>
            <h3>Class</h3>
            <div class="classes">
              ${CLASSES.map(
                (k) => `<div class="class-card ${k.id === cls ? 'sel' : ''}" data-cls="${k.id}">
                  <div class="name">${k.name.toUpperCase()}</div>
                  <div class="stats">HP ${k.health} · ARM ${k.armor}<br>SPD ${k.speed}<br>SLOTS ${k.headSlots}H / ${k.bodySlots}B<br>RESPAWN +${k.respawnPenalty}s</div>
                </div>`,
              ).join('')}
            </div>
            <h3>Weapons</h3>
            <div class="hint">${esc(weapons)}</div>
            <h3>Notes</h3>
            <div class="hint">${cls === ClassId.Light ? 'Only class with Stealth. Ledge grab. Can deck.' : cls === ClassId.Medium ? 'Ledge grab. Can deck and heal. Balanced.' : 'Cannot deck, stealth or ledge grab, but jumps higher and hits hardest.'}</div>
          </div>
          <div>
            <h3>Implants</h3>
            <div class="slotbar">HEAD <b>${head}/${c.headSlots}</b> · BODY <b>${body}/${c.bodySlots}</b> ${err ? `<span style="color:var(--red)">· ${esc(err)}</span>` : ''}</div>
            <div class="implants">
              ${IMPLANTS.map((d) => {
                const avail = d.classes.includes(cls);
                const sel = implants.includes(d.id);
                return `<div class="implant ${sel ? 'sel' : ''} ${avail ? '' : 'na'}" data-imp="${d.id}">
                  <div class="top"><span>${esc(d.name)}</span><span style="color:var(--dim)">${d.slot === 'head' ? 'H' : 'B'}${d.cost} · [${d.key}]</span></div>
                  <div class="desc">${esc(d.desc)}</div></div>`;
              }).join('')}
            </div>
            <div class="row" style="margin-top:14px;justify-content:flex-end">
              <button class="btn small" id="def">Defaults</button>
              <button class="btn magenta" id="go" ${err ? 'disabled' : ''}>Deploy</button>
            </div>
            <div class="hint">Changes apply on your next spawn (or instantly while still on the spawn pad).</div>
          </div>
        </div>
      </div>`;
    s.querySelectorAll<HTMLElement>('[data-team]').forEach((b) => (b.onclick = () => ((team = Number(b.dataset['team'])), render())));
    s.querySelectorAll<HTMLElement>('[data-cls]').forEach(
      (b) =>
        (b.onclick = () => {
          cls = Number(b.dataset['cls']) as ClassId;
          implants = [...DEFAULT_LOADOUTS[cls]!];
          render();
        }),
    );
    s.querySelectorAll<HTMLElement>('[data-imp]').forEach(
      (b) =>
        (b.onclick = () => {
          const id = Number(b.dataset['imp']) as ImplantId;
          if (!IMPLANTS[id]!.classes.includes(cls)) return;
          if (implants.includes(id)) implants = implants.filter((x) => x !== id);
          else {
            implants.push(id);
            // Only one deck at a time.
            if (id === ImplantId.Cyberdeck) implants = implants.filter((x) => x !== ImplantId.EnhancedDeck);
            if (id === ImplantId.EnhancedDeck) implants = implants.filter((x) => x !== ImplantId.Cyberdeck);
          }
          render();
        }),
    );
    (s.querySelector('#def') as HTMLElement).onclick = () => {
      implants = [...DEFAULT_LOADOUTS[cls]!];
      render();
    };
    (s.querySelector('#go') as HTMLElement).onclick = () => {
      if (validateLoadout(cls, implants)) return;
      close();
      onDone({ team, cls, implants });
    };
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Escape' || e.code === 'KeyM') {
      close();
      onClose();
    }
  };
  const close = () => {
    window.removeEventListener('keydown', onKey);
    s.remove();
  };
  render();
  parent.appendChild(s);
  setTimeout(() => window.addEventListener('keydown', onKey), 50);
  return close;
}

export interface PauseActions {
  resume(): void;
  loadout(): void;
  leave(): void;
  settings: Settings;
  applySettings(s: Settings): void;
  host: boolean;
  room: string;
  hostAction(a: { fillbots?: number; kickbots?: boolean; ff?: boolean; addbot?: number }): void;
}

export function showPause(parent: HTMLElement, a: PauseActions): () => void {
  const s = document.createElement('div');
  s.className = 'screen transparent interactive';
  const st = { ...a.settings };
  const link = `${location.origin}${location.pathname}?room=${a.room}`;
  s.innerHTML = `
    <div class="menu">
      <h2>Paused · room ${esc(a.room)}</h2>
      <div class="row"><label>Invite</label><input type="text" readonly value="${esc(link)}" id="link"><button class="btn small" id="copy">Copy</button></div>
      <div class="row"><button class="btn" id="resume">Resume</button><button class="btn" id="loadout">Team / loadout</button><button class="btn magenta" id="leave">Leave</button></div>
      <h3>Settings</h3>
      <div class="row"><label>Sensitivity</label><input type="range" id="sens" min="0.02" max="0.4" step="0.01" value="${st.sensitivity}"><span id="sensv">${st.sensitivity.toFixed(2)}</span></div>
      <div class="row"><label>Volume</label><input type="range" id="vol" min="0" max="1" step="0.05" value="${st.volume}"></div>
      <div class="row"><label>FOV</label><input type="range" id="fov" min="75" max="110" step="1" value="${st.fov}"><span id="fovv">${st.fov}</span></div>
      <div class="row"><label>Quality</label><select id="q"><option value="low">low (no bloom)</option><option value="medium">medium</option><option value="high">high</option></select><span class="hint">reload to apply</span></div>
      ${
        a.host
          ? `<h3>Host controls</h3>
      <div class="row"><label>Bots / team</label><select id="bots">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option>${n}</option>`).join('')}</select><button class="btn small" id="setbots">Set</button><button class="btn small" id="kick">Kick bots</button></div>
      <div class="row"><label>Friendly fire</label><button class="btn small" id="ffon">On</button><button class="btn small" id="ffoff">Off</button></div>`
          : ''
      }
      ${keyHelpHtml()}
    </div>`;
  parent.appendChild(s);
  const $ = <T extends HTMLElement>(id: string) => s.querySelector(`#${id}`) as T | null;
  ($('q') as HTMLSelectElement).value = st.quality;
  const close = () => s.remove();
  $('resume')!.onclick = () => {
    close();
    a.resume();
  };
  $('loadout')!.onclick = () => {
    close();
    a.loadout();
  };
  $('leave')!.onclick = () => {
    close();
    a.leave();
  };
  $('copy')!.onclick = () => void navigator.clipboard?.writeText(link);
  const apply = () => {
    st.sensitivity = Number(($('sens') as HTMLInputElement).value);
    st.volume = Number(($('vol') as HTMLInputElement).value);
    st.fov = Number(($('fov') as HTMLInputElement).value);
    st.quality = ($('q') as HTMLSelectElement).value as Settings['quality'];
    $('sensv')!.textContent = st.sensitivity.toFixed(2);
    $('fovv')!.textContent = String(st.fov);
    a.applySettings({ ...st });
  };
  for (const id of ['sens', 'vol', 'fov', 'q']) $(id)!.oninput = apply;
  if (a.host) {
    $('setbots')!.onclick = () => a.hostAction({ fillbots: Number(($('bots') as HTMLSelectElement).value) });
    $('kick')!.onclick = () => a.hostAction({ kickbots: true });
    $('ffon')!.onclick = () => a.hostAction({ ff: true });
    $('ffoff')!.onclick = () => a.hostAction({ ff: false });
  }
  return close;
}

export function showLoading(parent: HTMLElement, text: string): { set(f: number, t?: string): void; close(): void } {
  const s = document.createElement('div');
  s.className = 'loading';
  s.innerHTML = `<div id="lt">${esc(text)}</div><div class="progress"><i style="width:0%"></i></div>`;
  parent.appendChild(s);
  const bar = s.querySelector('i') as HTMLElement;
  const lt = s.querySelector('#lt') as HTMLElement;
  return {
    set(f, t) {
      bar.style.width = `${Math.round(f * 100)}%`;
      if (t) lt.textContent = t;
    },
    close() {
      s.remove();
    },
  };
}
