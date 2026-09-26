// Wire protocol. Control messages are JSON text frames; the hot path
// (user commands up, snapshots down) is binary.

export const PROTOCOL_VERSION = 1;
export const TICK_RATE = 60;
export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_RATE = 30;
/** Clients render remote entities this far in the past, in ms. */
export const INTERP_DELAY_MS = 100;
/** Max lag compensation window, in ms. */
export const MAX_LAG_COMP_MS = 400;

export enum BinMsg {
  UserCmds = 1,
  Snapshot = 2,
}

// ---- client -> server (JSON)

export type ClientMsg =
  | { t: 'hello'; v: number; name: string; room?: string; create?: boolean; map?: string; ff?: boolean; bots?: number }
  | { t: 'team'; team: number }
  | { t: 'loadout'; cls: number; primary: number; implants: number[]; programs: number[] }
  | { t: 'chat'; text: string; teamOnly: boolean }
  | { t: 'addbot'; team: number }
  | { t: 'fillbots'; perTeam: number }
  | { t: 'settings'; ff?: boolean }
  | { t: 'kickbots' }
  | { t: 'ping'; at: number; rtt?: number }
  | { t: 'ready' };

// ---- server -> client (JSON)

export interface PlayerInfo {
  id: number;
  name: string;
  team: number;
  bot: boolean;
  score: number;
  deaths: number;
  ping: number;
}

export type ServerMsg =
  | { t: 'welcome'; you: number; room: string; map: string; tick: number; tickRate: number; host: boolean }
  | { t: 'error'; message: string }
  | { t: 'players'; players: PlayerInfo[] }
  | { t: 'chat'; from: number; name: string; text: string; teamOnly: boolean }
  | { t: 'event'; kind: string; text: string; team?: number }
  | { t: 'pong'; at: number; server: number };
