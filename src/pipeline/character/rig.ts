/**
 * Ported from doodle-anim (https://github.com/feitangyuan/doodle-anim)
 * Author: feitangyuan
 * License: MIT
 */

import { type AvatarProportions } from "./avatar.js";

export interface Point2D {
  x: number;
  y: number;
}

export interface SkeletalPose {
  rootX: number;
  rootY: number;
  torsoAngle: number;
  headAngle: number;
  leftUpperArmAngle: number;
  leftLowerArmAngle: number;
  rightUpperArmAngle: number;
  rightLowerArmAngle: number;
  leftUpperLegAngle: number;
  leftLowerLegAngle: number;
  rightUpperLegAngle: number;
  rightLowerLegAngle: number;
}

export interface RigJoints {
  root: Point2D;
  neck: Point2D;
  head: Point2D;
  leftShoulder: Point2D;
  leftElbow: Point2D;
  leftHand: Point2D;
  rightShoulder: Point2D;
  rightElbow: Point2D;
  rightHand: Point2D;
  leftHip: Point2D;
  leftKnee: Point2D;
  leftFoot: Point2D;
  rightHip: Point2D;
  rightKnee: Point2D;
  rightFoot: Point2D;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Nội suy góc theo cung ngắn nhất để tránh hiện tượng xoay ngược 360 độ.
 */
export function lerpAngle(a: number, b: number, t: number): number {
  const diff = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + diff * t;
}

/**
 * Nội suy mượt mà giữa hai tư thế khung xương Pose A và Pose B theo tỉ lệ t trong [0, 1].
 * Hàm thuần túy (pure function) không phụ thuộc trạng thái ngoài.
 */
export function interpolatePose(poseA: SkeletalPose, poseB: SkeletalPose, t: number): SkeletalPose {
  const clampedT = Math.max(0, Math.min(1, t));
  return {
    rootX: lerp(poseA.rootX, poseB.rootX, clampedT),
    rootY: lerp(poseA.rootY, poseB.rootY, clampedT),
    torsoAngle: lerpAngle(poseA.torsoAngle, poseB.torsoAngle, clampedT),
    headAngle: lerpAngle(poseA.headAngle, poseB.headAngle, clampedT),
    leftUpperArmAngle: lerpAngle(poseA.leftUpperArmAngle, poseB.leftUpperArmAngle, clampedT),
    leftLowerArmAngle: lerpAngle(poseA.leftLowerArmAngle, poseB.leftLowerArmAngle, clampedT),
    rightUpperArmAngle: lerpAngle(poseA.rightUpperArmAngle, poseB.rightUpperArmAngle, clampedT),
    rightLowerArmAngle: lerpAngle(poseA.rightLowerArmAngle, poseB.rightLowerArmAngle, clampedT),
    leftUpperLegAngle: lerpAngle(poseA.leftUpperLegAngle, poseB.leftUpperLegAngle, clampedT),
    leftLowerLegAngle: lerpAngle(poseA.leftLowerLegAngle, poseB.leftLowerLegAngle, clampedT),
    rightUpperLegAngle: lerpAngle(poseA.rightUpperLegAngle, poseB.rightUpperLegAngle, clampedT),
    rightLowerLegAngle: lerpAngle(poseA.rightLowerLegAngle, poseB.rightLowerLegAngle, clampedT),
  };
}

/**
 * Tính toán tọa độ không gian 2D cho toàn bộ khớp xương (Forward Kinematics).
 */
export function computeRigJoints(pose: SkeletalPose, prop: AvatarProportions): RigJoints {
  const root: Point2D = { x: pose.rootX, y: pose.rootY };

  // Cột sống nối từ hông lên cổ
  const neck: Point2D = {
    x: root.x + Math.sin(pose.torsoAngle) * prop.torsoLength,
    y: root.y - Math.cos(pose.torsoAngle) * prop.torsoLength,
  };

  // Đầu gắn vào cổ
  const totalHeadAngle = pose.torsoAngle + pose.headAngle;
  const head: Point2D = {
    x: neck.x + Math.sin(totalHeadAngle) * prop.headRadius,
    y: neck.y - Math.cos(totalHeadAngle) * prop.headRadius,
  };

  // Vai trái và vai phải
  const shoulderNormalX = Math.cos(pose.torsoAngle);
  const shoulderNormalY = Math.sin(pose.torsoAngle);
  const halfShoulder = prop.shoulderWidth / 2;

  const leftShoulder: Point2D = {
    x: neck.x - shoulderNormalX * halfShoulder,
    y: neck.y - shoulderNormalY * halfShoulder,
  };
  const rightShoulder: Point2D = {
    x: neck.x + shoulderNormalX * halfShoulder,
    y: neck.y + shoulderNormalY * halfShoulder,
  };

  // Tay trái (khuỷu tay và bàn tay)
  const leftElbow: Point2D = {
    x: leftShoulder.x + Math.sin(pose.leftUpperArmAngle) * prop.upperArmLength,
    y: leftShoulder.y + Math.cos(pose.leftUpperArmAngle) * prop.upperArmLength,
  };
  const leftHand: Point2D = {
    x: leftElbow.x + Math.sin(pose.leftLowerArmAngle) * prop.lowerArmLength,
    y: leftElbow.y + Math.cos(pose.leftLowerArmAngle) * prop.lowerArmLength,
  };

  // Tay phải (khuỷu tay và bàn tay)
  const rightElbow: Point2D = {
    x: rightShoulder.x + Math.sin(pose.rightUpperArmAngle) * prop.upperArmLength,
    y: rightShoulder.y + Math.cos(pose.rightUpperArmAngle) * prop.upperArmLength,
  };
  const rightHand: Point2D = {
    x: rightElbow.x + Math.sin(pose.rightLowerArmAngle) * prop.lowerArmLength,
    y: rightElbow.y + Math.cos(pose.rightLowerArmAngle) * prop.lowerArmLength,
  };

  // Hông trái và hông phải
  const halfHip = prop.hipWidth / 2;
  const leftHip: Point2D = {
    x: root.x - shoulderNormalX * halfHip,
    y: root.y - shoulderNormalY * halfHip,
  };
  const rightHip: Point2D = {
    x: root.x + shoulderNormalX * halfHip,
    y: root.y + shoulderNormalY * halfHip,
  };

  // Chân trái (đầu gối và bàn chân)
  const leftKnee: Point2D = {
    x: leftHip.x + Math.sin(pose.leftUpperLegAngle) * prop.upperLegLength,
    y: leftHip.y + Math.cos(pose.leftUpperLegAngle) * prop.upperLegLength,
  };
  const leftFoot: Point2D = {
    x: leftKnee.x + Math.sin(pose.leftLowerLegAngle) * prop.lowerLegLength,
    y: leftKnee.y + Math.cos(pose.leftLowerLegAngle) * prop.lowerLegLength,
  };

  // Chân phải (đầu gối và bàn chân)
  const rightKnee: Point2D = {
    x: rightHip.x + Math.sin(pose.rightUpperLegAngle) * prop.upperLegLength,
    y: rightHip.y + Math.cos(pose.rightUpperLegAngle) * prop.upperLegLength,
  };
  const rightFoot: Point2D = {
    x: rightKnee.x + Math.sin(pose.rightLowerLegAngle) * prop.lowerLegLength,
    y: rightKnee.y + Math.cos(pose.rightLowerLegAngle) * prop.lowerLegLength,
  };

  return {
    root,
    neck,
    head,
    leftShoulder,
    leftElbow,
    leftHand,
    rightShoulder,
    rightElbow,
    rightHand,
    leftHip,
    leftKnee,
    leftFoot,
    rightHip,
    rightKnee,
    rightFoot,
  };
}
