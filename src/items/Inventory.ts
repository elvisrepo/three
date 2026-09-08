import type { ItemInstance, ItemSlot } from './Items';

export const INV_SIZE = 24;

export class Inventory {
  slots: (ItemInstance | null)[] = Array.from({ length: INV_SIZE }, () => null);
  gold = 150;

  add(item: ItemInstance): boolean {
    const idx = this.slots.findIndex((s) => s === null);
    if (idx === -1) return false;
    this.slots[idx] = item;
    return true;
  }

  remove(uid: string): ItemInstance | null {
    const idx = this.slots.findIndex((s) => s?.uid === uid);
    if (idx === -1) return null;
    const it = this.slots[idx];
    this.slots[idx] = null;
    return it;
  }

  find(uid: string): ItemInstance | null {
    return this.slots.find((s) => s?.uid === uid) ?? null;
  }

  used(): number {
    return this.slots.filter((s) => s !== null).length;
  }

  toJSON(): (ItemInstance | null)[] {
    return this.slots;
  }

  fromJSON(slots: (ItemInstance | null)[], gold: number): void {
    this.slots = Array.from({ length: INV_SIZE }, (_, i) => slots[i] ?? null);
    this.gold = gold;
  }
}

export type EquipSlots = Record<ItemSlot, ItemInstance | null>;

const EMPTY_EQUIP: EquipSlots = { weapon: null, helm: null, chest: null, boots: null, ring: null };

export class Equipment {
  slots: EquipSlots = { ...EMPTY_EQUIP };

  equip(item: ItemInstance): ItemInstance | null {
    const prev = this.slots[item.slot];
    this.slots[item.slot] = item;
    return prev;
  }

  unequip(slot: ItemSlot): ItemInstance | null {
    const prev = this.slots[slot];
    this.slots[slot] = null;
    return prev;
  }

  all(): (ItemInstance | null)[] {
    return [this.slots.weapon, this.slots.helm, this.slots.chest, this.slots.boots, this.slots.ring];
  }

  toJSON(): EquipSlots {
    return this.slots;
  }

  fromJSON(slots: EquipSlots): void {
    this.slots = { ...EMPTY_EQUIP, ...slots };
  }
}
