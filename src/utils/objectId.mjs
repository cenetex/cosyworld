import { randomBytes } from 'node:crypto';

const HEX_24 = /^[0-9a-fA-F]{24}$/;

export class ObjectId {
  constructor(value = randomBytes(12).toString('hex')) {
    if (value instanceof ObjectId) {
      this.hex = value.toHexString();
      return;
    }
    if (value && typeof value.toHexString === 'function') {
      this.hex = String(value.toHexString()).toLowerCase();
      return;
    }
    const hex = String(value);
    if (!HEX_24.test(hex)) {
      throw new Error(`Invalid ObjectId: ${value}`);
    }
    this.hex = hex.toLowerCase();
  }

  static isValid(value) {
    if (value instanceof ObjectId) return true;
    if (value && typeof value.toHexString === 'function') {
      return HEX_24.test(String(value.toHexString()));
    }
    return HEX_24.test(String(value));
  }

  static createFromHexString(value) {
    return new ObjectId(value);
  }

  static createFromTime(seconds) {
    const timestamp = Math.trunc(Number(seconds) || 0).toString(16).padStart(8, '0').slice(-8);
    return new ObjectId(`${timestamp}0000000000000000`);
  }

  toHexString() {
    return this.hex;
  }

  toString() {
    return this.hex;
  }

  toJSON() {
    return this.hex;
  }

  valueOf() {
    return this.hex;
  }
}
