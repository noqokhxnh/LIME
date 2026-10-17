/**
 * Ported from doodle-anim (https://github.com/feitangyuan/doodle-anim)
 * Author: feitangyuan
 * License: MIT
 */

import { type SkeletalPose } from "./rig.js";

export type LocomotionAction = "idle" | "walk" | "run";

export const LOCOMOTION_CYCLE_SECONDS = {
  idle: 2.0,
  walk: 0.8,
  run: 0.45,
} as const;

/**
 * Tính toán tư thế đứng nghỉ (idle) với chu kỳ thở và đung đưa tự nhiên.
 * Hàm thuần túy theo thời gian t.
 */
export function getIdlePose(t: number, rootX = 0, rootY = 0): SkeletalPose {
  const cycle = LOCOMOTION_CYCLE_SECONDS.idle;
  const phase = (((t % cycle) + cycle) % cycle) / cycle * 2 * Math.PI;

  const breathe = Math.sin(phase) * 2;
  const sway = Math.sin(phase * 0.5) * 0.02;

  return {
    rootX,
    rootY: rootY + breathe,
    torsoAngle: sway,
    headAngle: -sway * 0.5 + Math.sin(phase) * 0.02,
    leftUpperArmAngle: 0.12 + Math.sin(phase) * 0.03,
    leftLowerArmAngle: 0.15 + Math.sin(phase) * 0.02,
    rightUpperArmAngle: -0.12 - Math.sin(phase) * 0.03,
    rightLowerArmAngle: -0.15 - Math.sin(phase) * 0.02,
    leftUpperLegAngle: -0.04,
    leftLowerLegAngle: 0.04,
    rightUpperLegAngle: 0.04,
    rightLowerLegAngle: -0.04,
  };
}

/**
 * Tính toán tư thế bước đi (walk) với bước sải chân, tay đánh đối xứng và nhấp nhô trọng tâm.
 * Hàm thuần túy theo thời gian t.
 */
export function getWalkPose(t: number, rootX = 0, rootY = 0): SkeletalPose {
  const cycle = LOCOMOTION_CYCLE_SECONDS.walk;
  const phase = (((t % cycle) + cycle) % cycle) / cycle * 2 * Math.PI;

  const sinP = Math.sin(phase);
  const cosP = Math.cos(phase);
  const bob = -Math.abs(sinP) * 3.5;

  return {
    rootX,
    rootY: rootY + bob,
    torsoAngle: 0.05 + sinP * 0.02,
    headAngle: -0.03 + cosP * 0.02,
    // Tay đánh ngược chiều với chân
    leftUpperArmAngle: -sinP * 0.45,
    leftLowerArmAngle: Math.max(0.1, -sinP * 0.25 + 0.2),
    rightUpperArmAngle: sinP * 0.45,
    rightLowerArmAngle: Math.max(0.1, sinP * 0.25 + 0.2),
    // Chân sải và co gối khi lăng chân
    leftUpperLegAngle: sinP * 0.48,
    leftLowerLegAngle: Math.max(0, -sinP) * 0.42,
    rightUpperLegAngle: -sinP * 0.48,
    rightLowerLegAngle: Math.max(0, sinP) * 0.42,
  };
}

/**
 * Tính toán tư thế chạy (run) với biên độ sải lớn, tay co góc vuông và độ nảy cao.
 * Hàm thuần túy theo thời gian t.
 */
export function getRunPose(t: number, rootX = 0, rootY = 0): SkeletalPose {
  const cycle = LOCOMOTION_CYCLE_SECONDS.run;
  const phase = (((t % cycle) + cycle) % cycle) / cycle * 2 * Math.PI;

  const sinP = Math.sin(phase);
  const cosP = Math.cos(phase);
  const bob = -Math.abs(sinP) * 7.5;

  return {
    rootX,
    rootY: rootY + bob,
    torsoAngle: 0.18 + sinP * 0.03,
    headAngle: -0.08 + cosP * 0.03,
    // Tay co gập ~90 độ đánh mạnh
    leftUpperArmAngle: -sinP * 0.9,
    leftLowerArmAngle: 1.15,
    rightUpperArmAngle: sinP * 0.9,
    rightLowerArmAngle: 1.15,
    // Chân sải rộng và gập gối mạnh khi chạy
    leftUpperLegAngle: sinP * 0.88,
    leftLowerLegAngle: Math.max(0.1, -sinP) * 0.95 + 0.15,
    rightUpperLegAngle: -sinP * 0.88,
    rightLowerLegAngle: Math.max(0.1, sinP) * 0.95 + 0.15,
  };
}

/**
 * Lấy tư thế tương ứng với loại hành động vận động (locomotion) tại thời điểm t.
 */
export function getLocomotionPose(
  action: LocomotionAction,
  t: number,
  rootX = 0,
  rootY = 0
): SkeletalPose {
  switch (action) {
    case "walk":
      return getWalkPose(t, rootX, rootY);
    case "run":
      return getRunPose(t, rootX, rootY);
    case "idle":
    default:
      return getIdlePose(t, rootX, rootY);
  }
}
