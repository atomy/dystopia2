import {
  type NetLocal,
  type NetRules,
  type NetPlayer,
  type PlayerInfo,
  type Vec3,
  WEAPONS,
  IMPLANTS,
  ImplantId,
  hasImplant,
  PROGRAMS,
  STEP_LABELS,
  TEAM_COLORS,
  TEAM_NAMES,
  Team,
  CLASSES,
  CyberWeapon,
  PF,
  Cause,
} from '@d2/shared';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

export interface HudObjective {
  label: string;
  desc: string;
  stage: number;
  done: boolean;
  optional: boolean;
}

export interface HudProgram {
  key: number;
  program: number;
  available: boolean;
}

export interface HudMarker {
  x: number;
  y: number;
  kind: 'iff' | 'objective';
  text: string;
  color: string;
  hp?: number;
  armor?: number;
  offscreen?: boolean;
}

export interface HudState {
  local: NetLocal | null;
  rules: NetRules | null;
  me: NetPlayer | null;
  team: number;
  objectives: HudObjective[];
  prompt: string;
  useProgress: number;
  programs: HudProgram[];
  programTarget: string;
  radar: { me: Vec3; yaw: number; blips: { pos: Vec3; color: string; size: number }[] };
  fps: number;
  ping: number;
  thermal: boolean;
  stealth: boolean;
}

const CAUSE_NAMES: Record<number, string> = {
  [Cause.Fall]: 'gravity',
  [Cause.Goomba]: 'GOOMBA',
  [Cause.Dumpshock]: 'dumpshock',
  [Cause.Suicide]: 'tactical respawn',
  [Cause.Turret]: 'turret',
  [Cause.Cyber]: 'CYBER-EJECT',
  [Cause.World]: 'the world',
  [Cause.Explosion]: 'explosion',
};

export class Hud {
  readonly root: HTMLDivElement;
  private readonly crosshair: HTMLDivElement;
  private readonly hitmarker: HTMLDivElement;
  private readonly hp: HTMLElement;
  private readonly armor: HTMLElement;
  private readonly energy: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly armorText: HTMLElement;
  private readonly energyText: HTMLElement;
  private readonly ammo: HTMLDivElement;
  private readonly implants: HTMLDivElement;
  private readonly timer: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  private readonly waves: HTMLDivElement;
  private readonly objectives: HTMLDivElement;
  private readonly killfeed: HTMLDivElement;
  private readonly notice: HTMLDivElement;
  private readonly center: HTMLDivElement;
  private readonly respawn: HTMLDivElement;
  private readonly alarm: HTMLDivElement;
  private readonly flash: HTMLDivElement;
  private readonly dmgdir: HTMLDivElement;
  private readonly programs: HTMLDivElement;
  private readonly minigame: HTMLDivElement;
  private readonly scoreboard: HTMLDivElement;
  private readonly cyberlabel: HTMLDivElement;
  private readonly info: HTMLDivElement;
  private readonly radar: HTMLCanvasElement;
  private readonly fpsEl: HTMLDivElement;
  readonly chatLog: HTMLDivElement;
  private readonly markerLayer: HTMLDivElement;
  private readonly markerPool: HTMLDivElement[] = [];
  private noticeTimer = 0;
  private lastHtml = new Map<HTMLElement, string>();

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud', parent);
    this.markerLayer = el('div', 'markers', this.root);
    this.crosshair = el('div', 'crosshair', this.root);
    this.hitmarker = el('div', 'hitmarker', this.root);
    this.alarm = el('div', 'alarm', this.root);
    this.flash = el('div', 'damage-flash', this.root);
    this.dmgdir = el('div', 'dmgdir', this.root);
    const bars = el('div', 'bars', this.root);
    const mk = (cls: string) => {
      const b = el('div', `bar ${cls}`, bars);
      const i = el('i', undefined, b);
      const s = el('span', undefined, b);
      return [i, s] as const;
    };
    [this.armor, this.armorText] = mk('armor');
    [this.hp, this.hpText] = mk('hp');
    [this.energy, this.energyText] = mk('energy');
    this.ammo = el('div', 'ammo', this.root);
    this.implants = el('div', 'implantbar', this.root);
    const top = el('div', 'top-center', this.root);
    this.timer = el('div', 'timer', top);
    this.stage = el('div', 'stage', top);
    this.waves = el('div', 'stage', top);
    this.objectives = el('div', 'objectives', this.root);
    this.killfeed = el('div', 'killfeed', this.root);
    this.notice = el('div', 'notice', this.root);
    this.center = el('div', 'centerinfo', this.root);
    this.respawn = el('div', 'respawn', this.root);
    this.programs = el('div', 'programs', this.root);
    this.minigame = el('div', 'minigame', this.root);
    this.cyberlabel = el('div', 'cyberlabel', this.root);
    this.radar = el('canvas', 'radar', this.root);
    this.radar.width = this.radar.height = 190;
    this.info = el('div', 'info-top-right', this.root);
    this.chatLog = el('div', 'chat', this.root);
    this.scoreboard = el('div', 'scoreboard', this.root);
    this.scoreboard.style.display = 'none';
    this.fpsEl = el('div', 'fps', this.root);
  }

  private set(e: HTMLElement, html: string): void {
    if (this.lastHtml.get(e) === html) return;
    this.lastHtml.set(e, html);
    e.innerHTML = html;
  }

  markers(list: HudMarker[]): void {
    while (this.markerPool.length < list.length) this.markerPool.push(el('div', 'marker', this.markerLayer));
    this.markerPool.forEach((d, i) => {
      const m = list[i];
      if (!m) {
        d.style.display = 'none';
        return;
      }
      d.style.display = '';
      d.className = `marker ${m.kind}${m.offscreen ? ' off' : ''}`;
      d.style.transform = `translate(${Math.round(m.x)}px, ${Math.round(m.y)}px)`;
      d.style.color = m.color;
      const html =
        m.kind === 'iff'
          ? `<span>${esc(m.text)}</span><i class="hpb"><b style="width:${Math.round((m.hp ?? 0) * 100)}%"></b></i><i class="arb"><b style="width:${Math.round((m.armor ?? 0) * 100)}%"></b></i>`
          : `<em>◆</em><span>${esc(m.text)}</span>`;
      if (d.dataset['h'] !== html) {
        d.dataset['h'] = html;
        d.innerHTML = html;
      }
    });
  }

  hit(kill: boolean): void {
    this.hitmarker.classList.toggle('kill', kill);
    this.hitmarker.style.transition = 'none';
    this.hitmarker.style.opacity = '1';
    requestAnimationFrame(() => {
      this.hitmarker.style.transition = 'opacity 0.25s';
      this.hitmarker.style.opacity = '0';
    });
  }

  damaged(amount: number, angleDeg: number | null): void {
    this.flash.style.transition = 'none';
    this.flash.style.opacity = String(Math.min(0.9, 0.25 + amount / 60));
    requestAnimationFrame(() => {
      this.flash.style.transition = 'opacity 0.5s';
      this.flash.style.opacity = '0';
    });
    if (angleDeg !== null) {
      const i = el('i', undefined, this.dmgdir);
      i.style.transform = `rotate(${angleDeg}deg)`;
      i.style.transformOrigin = '40px 130px';
      setTimeout(() => i.remove(), 1200);
    }
  }

  showNotice(text: string, color = 'var(--yellow)', seconds = 4): void {
    this.notice.textContent = text;
    this.notice.style.color = color;
    this.notice.style.opacity = '1';
    clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => (this.notice.style.opacity = '0'), seconds * 1000);
  }

  kill(killer: string, killerTeam: number, victim: string, victimTeam: number, weapon: number, headshot: boolean, mine: boolean): void {
    const d = el('div', mine ? 'me' : undefined);
    const w = CAUSE_NAMES[weapon] ?? WEAPONS[weapon]?.name ?? '?';
    const kc = TEAM_COLORS[killerTeam] ?? '#ccc';
    const vc = TEAM_COLORS[victimTeam] ?? '#ccc';
    d.innerHTML = killer
      ? `<span style="color:${kc}">${esc(killer)}</span> [${esc(w)}${headshot ? ' ✦' : ''}] <span style="color:${vc}">${esc(victim)}</span>`
      : `<span style="color:${vc}">${esc(victim)}</span> [${esc(w)}]`;
    this.killfeed.prepend(d);
    while (this.killfeed.children.length > 6) this.killfeed.lastChild?.remove();
    setTimeout(() => d.remove(), 6000);
  }

  chat(name: string, team: number, text: string, teamOnly: boolean): void {
    const d = el('div', 'line', this.chatLog);
    const c = TEAM_COLORS[team] ?? '#ccc';
    d.innerHTML = `${teamOnly ? '<span style="color:var(--dim)">(team)</span> ' : ''}<b style="color:${c}">${esc(name)}</b>: ${esc(text)}`;
    const lines = this.chatLog.querySelectorAll('.line');
    if (lines.length > 8) lines[0]?.remove();
    setTimeout(() => d.remove(), 12000);
  }

  system(text: string): void {
    const d = el('div', 'line', this.chatLog);
    d.innerHTML = `<span style="color:var(--cyan)">» ${esc(text)}</span>`;
    const lines = this.chatLog.querySelectorAll('.line');
    if (lines.length > 8) lines[0]?.remove();
    setTimeout(() => d.remove(), 12000);
  }

  showScoreboard(show: boolean, players: PlayerInfo[], net: Map<number, NetPlayer>, me: number): void {
    this.scoreboard.style.display = show ? 'grid' : 'none';
    if (!show) return;
    let html = '';
    for (const team of [Team.Punk, Team.Corp]) {
      const list = players.filter((p) => p.team === team).sort((a, b) => b.score - a.score);
      html += `<div><h2 style="color:${TEAM_COLORS[team]}">${TEAM_NAMES[team]} <span style="font-size:13px;color:var(--dim)">(${list.length})</span></h2><table><tr><th>Name</th><th>Class</th><th>Score</th><th>Deaths</th><th>Ping</th></tr>`;
      for (const p of list) {
        const n = net.get(p.id);
        const cls = n ? CLASSES[n.cls]?.name ?? '' : '';
        const dead = n && !(n.flags & PF.ALIVE);
        const decked = n && n.flags & PF.DECKED;
        html += `<tr class="${p.id === me ? 'me' : ''} ${dead ? 'dead' : ''}"><td>${esc(p.name)}${decked ? ' <span style="color:var(--cyan)">⌁</span>' : ''}</td><td>${cls}</td><td>${p.score}</td><td>${p.deaths}</td><td>${p.bot ? 'BOT' : p.ping}</td></tr>`;
      }
      html += '</table></div>';
    }
    const spec = players.filter((p) => p.team !== Team.Punk && p.team !== Team.Corp);
    if (spec.length) html += `<div style="grid-column:1/3;color:var(--dim)">Spectators: ${spec.map((p) => esc(p.name)).join(', ')}</div>`;
    this.set(this.scoreboard, html);
  }

  update(s: HudState): void {
    const L = s.local;
    const decked = !!L?.cyber;
    const alive = !!s.me && (s.me.flags & PF.ALIVE) !== 0;
    this.crosshair.classList.toggle('cyber', decked);
    this.crosshair.style.display = alive ? '' : 'none';
    this.cyberlabel.textContent = decked ? '/// CYBERSPACE ///' : '';
    this.fpsEl.textContent = `${s.fps.toFixed(0)} fps · ${s.ping.toFixed(0)} ms`;

    // Vitals.
    if (L && s.me) {
      const c = CLASSES[L.cls]!;
      const hp = Math.max(0, s.me.health);
      this.hp.style.width = `${(hp / c.health) * 100}%`;
      this.hpText.textContent = `HP ${Math.ceil(hp)}`;
      this.armor.style.width = `${(s.me.armor / Math.max(1, c.armor)) * 100}%`;
      this.armorText.textContent = `ARMOR ${Math.ceil(s.me.armor)}`;
      this.energy.style.width = `${(L.energy / L.maxEnergy) * 100}%`;
      this.energyText.textContent = `${decked ? 'CYBER ' : ''}ENERGY ${Math.floor(L.energy)}${L.emp > 0 ? '  ⚡EMP' : ''}`;
    }

    // Weapon / ammo.
    if (L && alive) {
      if (decked) {
        const mode = L.cyberMode === CyberWeapon.Hitscan ? 'HITSCAN' : 'SHAFT';
        const ready = L.cyberMode === CyberWeapon.Hitscan ? (L.hitscanReady > 0 ? `${L.hitscanReady.toFixed(1)}s` : 'READY') : 'BEAM';
        this.set(this.ammo, `<div class="wname">${mode} · R to switch</div><div class="clip">${ready}</div><div class="reserve">ALT: PROJECTILE</div>`);
      } else {
        const w = WEAPONS[L.weap.current];
        if (w) {
          const clip = L.weap.clip[w.id] ?? 0;
          const res = L.weap.reserve[w.id] ?? 0;
          const body =
            w.kind === 'melee' ? '<div class="clip">—</div>' : w.kind === 'grenade' ? `<div class="clip">${clip}</div>` : `<div class="clip">${clip}</div><div class="reserve">/ ${res}</div>`;
          this.set(this.ammo, `<div class="wname">${w.name}${L.weap.reloadEnd > 0 ? ' · RELOADING' : ''}</div>${body}`);
        }
      }
    } else this.set(this.ammo, '');

    // Implant bar with fixed keys.
    if (L && alive) {
      let html = '';
      const emp = L.emp > 0;
      for (const d of IMPLANTS) {
        if (!hasImplant(L.implants, d.id)) continue;
        let on = false;
        if (d.id === ImplantId.Stealth) on = s.stealth;
        if (d.id === ImplantId.Thermal) on = s.thermal;
        if ((d.id === ImplantId.Cyberdeck || d.id === ImplantId.EnhancedDeck) && decked) on = true;
        const cd = d.id === ImplantId.TacScan && L.tacCooldown > 0 ? ` ${L.tacCooldown.toFixed(0)}s` : '';
        html += `<div class="imp ${on ? 'on' : ''} ${emp && d.id !== ImplantId.Scs ? 'off' : ''}"><span class="k">${d.key}</span>${d.short}${cd}</div>`;
      }
      this.set(this.implants, html);
    } else this.set(this.implants, '');

    // Round info.
    const r = s.rules;
    if (r) {
      const t = Math.max(0, r.timeLeft);
      this.timer.textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
      const atk = r.attackers === s.team;
      this.stage.textContent = r.phase === 2 ? (r.winner === s.team ? 'VICTORY' : 'DEFEAT') : `STAGE ${r.stage}/${r.stageCount} · ${atk ? 'ATTACK' : 'DEFEND'}`;
      const myWave = s.team === Team.Punk ? r.wavePunk : r.waveCorp;
      this.waves.textContent = `NEXT WAVE ${Math.ceil(myWave)}s`;
    }
    let oh = '';
    for (const o of s.objectives) {
      if (r && o.stage !== r.stage && !o.done) continue;
      if (r && o.stage < r.stage - 1) continue;
      oh += `<div class="obj ${o.done ? 'done' : ''} ${o.optional ? 'opt' : ''}">${o.optional ? '◇' : '◆'} ${esc(o.label)}${!o.done && r && o.stage === r.stage ? `<div class="desc">${esc(o.desc)}</div>` : ''}</div>`;
    }
    this.set(this.objectives, oh);

    // Center prompts & progress.
    let center = '';
    if (s.prompt) center += `<div class="prompt">${esc(s.prompt)}</div>`;
    if (s.useProgress >= 0) center += `<div class="progress"><i style="width:${Math.round(s.useProgress * 100)}%"></i></div>`;
    this.set(this.center, center);

    // Respawn countdown.
    if (L && !alive) {
      this.set(this.respawn, `<div>RESPAWN IN</div><div class="big">${Math.ceil(L.respawnIn)}</div><div class="hint">M: change team / loadout · K next life applies loadout</div>`);
    } else this.set(this.respawn, '');

    // Decker alarm: body under attack.
    const alarmOn = decked && L !== null && L.bodyAlarm < 1.2;
    this.alarm.style.opacity = alarmOn ? String(0.4 + 0.4 * Math.sin(performance.now() / 90)) : '0';

    // Programs & minigame.
    if (decked && L) {
      if (L.program) {
        const def = PROGRAMS[L.program.program]!;
        const cur = Math.min(L.program.step, def.steps.length - 1);
        const steps = def.steps.map((st, i) => `<span class="${i === cur ? 'cur' : ''}">${esc(st)}</span>`).join(' › ');
        const enhanced = hasImplant(L.implants, ImplantId.EnhancedDeck);
        const btns = enhanced ? L.program.buttons.map((b, i) => `<div><b>${i + 1}</b>${esc(STEP_LABELS[b] ?? '?')}</div>`).join('') : '';
        this.set(
          this.minigame,
          `<div class="steps">${esc(def.name)}: ${steps}</div><div class="progress"><i style="width:${Math.round(L.program.progress * 100)}%"></i></div>${enhanced ? `<div class="buttons" style="margin-top:8px">${btns}</div><div class="hint">press the matching step to speed up</div>` : ''}`,
        );
        this.set(this.programs, '');
      } else {
        this.set(this.minigame, '');
        let ph = s.programTarget ? `<div class="hint" style="margin-bottom:4px">${esc(s.programTarget)}</div>` : '';
        for (const p of s.programs) {
          const def = PROGRAMS[p.program]!;
          ph += `<div class="p ${p.available ? '' : 'off'}"><b>${p.available ? p.key : '·'}</b>${esc(def.name)}${p.available ? `<div class="hint">${esc(def.desc)}</div>` : ''}</div>`;
        }
        this.set(this.programs, ph);
      }
    } else {
      this.set(this.programs, '');
      this.set(this.minigame, '');
    }

    const extra: string[] = [];
    if (r?.ff) extra.push('friendly fire ON');
    this.set(this.info, extra.join('<br>'));
    this.drawRadar(s.radar, decked);
  }

  private drawRadar(r: HudState['radar'], decked: boolean): void {
    const g = this.radar.getContext('2d')!;
    const W = 190;
    const scale = decked ? 0.06 : 0.045;
    g.clearRect(0, 0, W, W);
    g.save();
    g.translate(W / 2, W / 2);
    g.strokeStyle = 'rgba(39,230,255,0.18)';
    g.beginPath();
    g.arc(0, 0, 40, 0, Math.PI * 2);
    g.arc(0, 0, 80, 0, Math.PI * 2);
    g.stroke();
    // Rotate so the view direction points up.
    const a = ((r.yaw - 90) * Math.PI) / 180;
    for (const b of r.blips) {
      const dx = b.pos.x - r.me.x;
      const dy = b.pos.y - r.me.y;
      const x = (dx * Math.cos(-a) - dy * Math.sin(-a)) * scale;
      const y = -(dx * Math.sin(-a) + dy * Math.cos(-a)) * scale;
      const d = Math.hypot(x, y);
      const k = d > 90 ? 90 / d : 1;
      g.fillStyle = b.color;
      g.beginPath();
      g.arc(x * k, y * k, b.size, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(0, -7);
    g.lineTo(5, 5);
    g.lineTo(-5, 5);
    g.closePath();
    g.fill();
    g.restore();
  }
}

export { TEAM_COLORS };
