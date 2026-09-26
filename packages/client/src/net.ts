// WebSocket connection to the room server.

import {
  type ClientMsg,
  type ServerMsg,
  type Snapshot,
  type UserCmd,
  BinMsg,
  PROTOCOL_VERSION,
  decodeSnapshot,
  encodeUserCmds,
} from '@d2/shared';

export interface NetHandlers {
  onJson(msg: ServerMsg): void;
  onSnapshot(s: Snapshot, bytes: number): void;
  onClose(reason: string): void;
}

export class Connection {
  private ws: WebSocket;
  rtt = 0;
  bytesIn = 0;
  private pingTimer = 0;

  constructor(
    hello: Omit<Extract<ClientMsg, { t: 'hello' }>, 't' | 'v'>,
    private readonly h: NetHandlers,
  ) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onopen = () => {
      this.send({ t: 'hello', v: PROTOCOL_VERSION, ...hello });
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping', at: performance.now(), rtt: this.rtt }), 2000);
    };
    this.ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        const msg = JSON.parse(ev.data) as ServerMsg;
        if (msg.t === 'pong') {
          const sample = performance.now() - msg.at;
          this.rtt = this.rtt ? this.rtt * 0.8 + sample * 0.2 : sample;
        }
        this.h.onJson(msg);
        return;
      }
      const data = new Uint8Array(ev.data as ArrayBuffer);
      this.bytesIn += data.byteLength;
      if (data[0] === BinMsg.Snapshot) this.h.onSnapshot(decodeSnapshot(data), data.byteLength);
    };
    this.ws.onclose = (ev) => {
      clearInterval(this.pingTimer);
      this.h.onClose(ev.reason || 'Connection closed');
    };
    this.ws.onerror = () => {
      /* onclose follows */
    };
  }

  get open(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  send(msg: ClientMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  sendCmds(cmds: UserCmd[]): void {
    if (this.ws.readyState === WebSocket.OPEN && cmds.length) this.ws.send(encodeUserCmds(cmds));
  }

  close(): void {
    this.ws.close();
  }
}
