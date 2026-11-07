// Bit i = RETRO_DEVICE_ID_JOYPAD_i de libretro.h (los 16 ids del joypad)
export const Btn = {
  B: 1 << 0,
  Y: 1 << 1,
  SELECT: 1 << 2,
  START: 1 << 3,
  UP: 1 << 4,
  DOWN: 1 << 5,
  LEFT: 1 << 6,
  RIGHT: 1 << 7,
  A: 1 << 8,
  X: 1 << 9,
  L: 1 << 10,
  R: 1 << 11,
  L2: 1 << 12,
  R2: 1 << 13,
  L3: 1 << 14,
  R3: 1 << 15,
} as const;
