/**
 * Ported from doodle-anim (https://github.com/feitangyuan/doodle-anim)
 * Author: feitangyuan
 * License: MIT
 */

import { type SkeletalPose } from "./rig.js";
import { getLocomotionPose, getIdlePose, getWalkPose, getRunPose } from "./locomotion.js";

export type ActionType = "enter" | "walk" | "run" | "idle" | "emote" | "exit";
export type CharacterDirection = "left" | "right";
export type EmoteType = "happy" | "sad" | "surprised" | "angry" | "thinking";

export interface CharacterActionItem {
  characterId: string;
  action: ActionType;
  tStart: number;
  tEnd: number;
  emote?: EmoteType;
  position?: { x: number; y: number };
  scale?: number;
  direction?: CharacterDirection;
}

export interface CharacterStagingState {
  visible: boolean;
  x: number;
  y: number;
  scale: number;
  direction: CharacterDirection;
  currentAction: ActionType;
  pose: SkeletalPose;
  emote?: EmoteType;
  opacity: number;
}

const DEFAULT_ENTER_OFFSET = 260;
const DEFAULT_EXIT_OFFSET = 260;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Đánh giá trạng thái dàn dựng (staging state) của nhân vật tại thời điểm t.
 * Hàm thuần túy (pure function) — đảm bảo tính tất định tuyệt đối khi seek timeline.
 */
export function evaluateStagingState(
  actions: readonly CharacterActionItem[],
  t: number,
  fallbackPosition = { x: 960, y: 720 }
): CharacterStagingState | null {
  if (!actions || actions.length === 0) {
    return null;
  }

  // Sắp xếp các hành động theo thứ tự tStart tăng dần
  const sorted = [...actions].sort((a, b) => a.tStart - b.tStart);
  const firstAction = sorted[0];
  const lastAction = sorted[sorted.length - 1];

  // Trước khi hành động đầu tiên bắt đầu
  if (t < firstAction.tStart) {
    if (firstAction.action === "enter") {
      return {
        visible: false,
        x: firstAction.position?.x ?? fallbackPosition.x,
        y: firstAction.position?.y ?? fallbackPosition.y,
        scale: firstAction.scale ?? 1,
        direction: firstAction.direction ?? "right",
        currentAction: "enter",
        pose: getIdlePose(t, 0, 0),
        opacity: 0,
      };
    }
  }

  // Sau khi hành động cuối cùng kết thúc
  if (t > lastAction.tEnd) {
    if (lastAction.action === "exit") {
      return {
        visible: false,
        x: lastAction.position?.x ?? fallbackPosition.x,
        y: lastAction.position?.y ?? fallbackPosition.y,
        scale: lastAction.scale ?? 1,
        direction: lastAction.direction ?? "right",
        currentAction: "exit",
        pose: getIdlePose(t, 0, 0),
        opacity: 0,
      };
    }
  }

  // Tìm hành động đang diễn ra tại thời điểm t
  let activeIndex = sorted.findIndex((act) => t >= act.tStart && t <= act.tEnd);
  let activeItem: CharacterActionItem;

  if (activeIndex === -1) {
    // Nếu t rơi vào khoảng trống giữa 2 hành động, lấy hành động kế trước
    if (t > lastAction.tEnd) {
      activeItem = lastAction;
    } else {
      let prevIndex = 0;
      for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].tStart <= t) prevIndex = i;
        else break;
      }
      activeItem = sorted[prevIndex];
    }
  } else {
    activeItem = sorted[activeIndex];
  }

  const duration = Math.max(0.001, activeItem.tEnd - activeItem.tStart);
  const progress = Math.max(0, Math.min(1, (t - activeItem.tStart) / duration));
  const easedProgress = smoothstep(0, 1, progress);

  const targetX = activeItem.position?.x ?? fallbackPosition.x;
  const targetY = activeItem.position?.y ?? fallbackPosition.y;
  const scale = activeItem.scale ?? 1;
  const direction = activeItem.direction ?? "right";

  let posX = targetX;
  let posY = targetY;
  let pose: SkeletalPose;
  let opacity = 1;

  switch (activeItem.action) {
    case "enter": {
      // Đi vào khung hình từ phía ngoài
      const sign = direction === "right" ? -1 : 1;
      const startX = targetX + sign * DEFAULT_ENTER_OFFSET;
      posX = startX + (targetX - startX) * easedProgress;
      // Dùng bước đi (walk) khi enter
      pose = getWalkPose(t, 0, 0);
      opacity = Math.min(1, progress * 4); // Làm mờ nhanh ở 25% thời lượng đầu
      break;
    }

    case "exit": {
      // Đi ra khỏi khung hình
      const sign = direction === "right" ? 1 : -1;
      const endX = targetX + sign * DEFAULT_EXIT_OFFSET;
      posX = targetX + (endX - targetX) * easedProgress;
      pose = getWalkPose(t, 0, 0);
      opacity = Math.max(0, 1 - Math.max(0, (progress - 0.75) * 4)); // Mờ dần ở 25% cuối
      break;
    }

    case "walk": {
      posX = targetX;
      posY = targetY;
      pose = getWalkPose(t, 0, 0);
      break;
    }

    case "run": {
      posX = targetX;
      posY = targetY;
      pose = getRunPose(t, 0, 0);
      break;
    }

    case "emote":
    case "idle":
    default: {
      posX = targetX;
      posY = targetY;
      pose = getIdlePose(t, 0, 0);
      break;
    }
  }

  return {
    visible: opacity > 0,
    x: posX,
    y: posY,
    scale,
    direction,
    currentAction: activeItem.action,
    pose,
    emote: activeItem.emote,
    opacity,
  };
}
