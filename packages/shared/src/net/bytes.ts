// Minimal binary writer/reader for snapshots and user commands.

export class ByteWriter {
  private buf: ArrayBuffer;
  private view: DataView;
  private arr: Uint8Array<ArrayBuffer>;
  offset = 0;

  constructor(initial = 1024) {
    this.buf = new ArrayBuffer(initial);
    this.view = new DataView(this.buf);
    this.arr = new Uint8Array(this.buf);
  }

  private ensure(n: number): void {
    if (this.offset + n <= this.buf.byteLength) return;
    let size = this.buf.byteLength * 2;
    while (size < this.offset + n) size *= 2;
    const nb = new ArrayBuffer(size);
    new Uint8Array(nb).set(this.arr.subarray(0, this.offset));
    this.buf = nb;
    this.view = new DataView(nb);
    this.arr = new Uint8Array(nb);
  }

  u8(v: number): this {
    this.ensure(1);
    this.view.setUint8(this.offset, v);
    this.offset += 1;
    return this;
  }
  u16(v: number): this {
    this.ensure(2);
    this.view.setUint16(this.offset, v, true);
    this.offset += 2;
    return this;
  }
  i16(v: number): this {
    this.ensure(2);
    this.view.setInt16(this.offset, Math.max(-32768, Math.min(32767, Math.round(v))), true);
    this.offset += 2;
    return this;
  }
  u32(v: number): this {
    this.ensure(4);
    this.view.setUint32(this.offset, v >>> 0, true);
    this.offset += 4;
    return this;
  }
  f32(v: number): this {
    this.ensure(4);
    this.view.setFloat32(this.offset, v, true);
    this.offset += 4;
    return this;
  }
  f64(v: number): this {
    this.ensure(8);
    this.view.setFloat64(this.offset, v, true);
    this.offset += 8;
    return this;
  }
  i8(v: number): this {
    this.ensure(1);
    this.view.setInt8(this.offset, Math.max(-128, Math.min(127, Math.round(v))));
    this.offset += 1;
    return this;
  }
  /** Unit vector packed into 3 signed bytes. */
  dir8(x: number, y: number, z: number): this {
    return this.i8(x * 127).i8(y * 127).i8(z * 127);
  }
  bool(b: boolean): this {
    return this.u8(b ? 1 : 0);
  }
  /** Angle in degrees packed into 16 bits. */
  angle16(deg: number): this {
    return this.u16(Math.round((((deg % 360) + 360) % 360) * (65536 / 360)) & 0xffff);
  }
  str(s: string): this {
    const b = new TextEncoder().encode(s);
    this.u16(b.length);
    this.ensure(b.length);
    this.arr.set(b, this.offset);
    this.offset += b.length;
    return this;
  }
  bytes(): Uint8Array<ArrayBuffer> {
    return this.arr.slice(0, this.offset);
  }
}

export class ByteReader {
  private view: DataView;
  offset = 0;
  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  get remaining(): number {
    return this.data.byteLength - this.offset;
  }
  u8(): number {
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }
  u16(): number {
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }
  i16(): number {
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }
  f32(): number {
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }
  f64(): number {
    const v = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return v;
  }
  i8(): number {
    const v = this.view.getInt8(this.offset);
    this.offset += 1;
    return v;
  }
  dir8(): { x: number; y: number; z: number } {
    const x = this.i8() / 127;
    const y = this.i8() / 127;
    const z = this.i8() / 127;
    const l = Math.hypot(x, y, z) || 1;
    return { x: x / l, y: y / l, z: z / l };
  }
  bool(): boolean {
    return this.u8() !== 0;
  }
  angle16(): number {
    const a = (this.u16() * 360) / 65536;
    return a > 180 ? a - 360 : a;
  }
  str(): string {
    const n = this.u16();
    const s = new TextDecoder().decode(this.data.subarray(this.offset, this.offset + n));
    this.offset += n;
    return s;
  }
}
