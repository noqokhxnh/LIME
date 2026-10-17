/**
 * Ported from doodle-anim (https://github.com/feitangyuan/doodle-anim)
 * Author: feitangyuan
 * License: MIT
 */

import { RNG, hashString32, getElementSeed } from "../rng.js";

export type HeadShape = "round" | "square" | "oval";
export type HairStyle = "none" | "short" | "spiky" | "curls" | "ponytail";
export type Accessory = "none" | "glasses" | "cap" | "tie";

export interface AvatarProportions {
  headRadius: number;
  torsoLength: number;
  upperArmLength: number;
  lowerArmLength: number;
  upperLegLength: number;
  lowerLegLength: number;
  shoulderWidth: number;
  hipWidth: number;
  strokeWidth: number;
}

export interface AvatarStyle {
  strokeColor: string;
  fillColor: string;
  accentColor: string;
  headShape: HeadShape;
  hairStyle: HairStyle;
  accessory: Accessory;
}

export interface AvatarConfig {
  characterId: string;
  seed: number;
  proportions: AvatarProportions;
  style: AvatarStyle;
}

const STROKE_PALETTES = [
  "#1e293b", // Slate
  "#0f172a", // Dark slate
  "#18181b", // Zinc
  "#111827", // Gray
  "#262626", // Neutral
  "#312e81", // Indigo deep
  "#1e1b4b", // Midnight
  "#3b0764", // Purple deep
];

const FILL_PALETTES = [
  "#ffffff", // White
  "#f8fafc", // Snow
  "#f1f5f9", // Crisp
  "#fef3c7", // Warm cream
  "#e0f2fe", // Ice blue
  "#fed7aa", // Peach
  "#fce7f3", // Soft pink
  "#dcfce7", // Mint
];

const ACCENT_PALETTES = [
  "#ef4444", // Red
  "#f59e0b", // Amber
  "#10b981", // Emerald
  "#06b6d4", // Cyan
  "#3b82f6", // Blue
  "#8b5cf6", // Purple
  "#ec4899", // Pink
  "#f97316", // Orange
];

const HEAD_SHAPES: HeadShape[] = ["round", "square", "oval"];
const HAIR_STYLES: HairStyle[] = ["none", "short", "spiky", "curls", "ponytail"];
const ACCESSORIES: Accessory[] = ["none", "glasses", "cap", "tie"];

function pickItem<T>(arr: readonly T[], randVal: number): T {
  const index = Math.floor(randVal * arr.length) % arr.length;
  return arr[index];
}

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t;
}

/**
 * Sinh cấu hình ngoại hình Avatar tất định từ seed và characterId.
 * Cùng cặp (seed, characterId) luôn tạo ra Avatar giống hệt nhau.
 */
export function generateAvatar(seed: number | string, characterId: string): AvatarConfig {
  const baseSeed = typeof seed === "number" ? seed >>> 0 : hashString32(String(seed));
  const charSeed = getElementSeed(baseSeed, characterId);
  const nextRand = RNG(charSeed);

  const headRadius = Math.round(lerp(22, 30, nextRand()));
  const torsoLength = Math.round(lerp(50, 70, nextRand()));
  const upperArmLength = Math.round(lerp(26, 36, nextRand()));
  const lowerArmLength = Math.round(lerp(24, 34, nextRand()));
  const upperLegLength = Math.round(lerp(34, 46, nextRand()));
  const lowerLegLength = Math.round(lerp(32, 44, nextRand()));
  const shoulderWidth = Math.round(lerp(18, 26, nextRand()));
  const hipWidth = Math.round(lerp(14, 22, nextRand()));
  const strokeWidth = Math.round(lerp(3, 5, nextRand()));

  const strokeColor = pickItem(STROKE_PALETTES, nextRand());
  const fillColor = pickItem(FILL_PALETTES, nextRand());
  const accentColor = pickItem(ACCENT_PALETTES, nextRand());
  const headShape = pickItem(HEAD_SHAPES, nextRand());
  const hairStyle = pickItem(HAIR_STYLES, nextRand());
  const accessory = pickItem(ACCESSORIES, nextRand());

  return {
    characterId,
    seed: charSeed,
    proportions: {
      headRadius,
      torsoLength,
      upperArmLength,
      lowerArmLength,
      upperLegLength,
      lowerLegLength,
      shoulderWidth,
      hipWidth,
      strokeWidth,
    },
    style: {
      strokeColor,
      fillColor,
      accentColor,
      headShape,
      hairStyle,
      accessory,
    },
  };
}
