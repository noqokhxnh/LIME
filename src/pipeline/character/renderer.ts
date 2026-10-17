/**
 * Ported from doodle-anim (https://github.com/feitangyuan/doodle-anim)
 * Author: feitangyuan
 * License: MIT
 */

import { type AvatarConfig } from "./avatar.js";
import { type CharacterStagingState } from "./staging.js";
import { computeRigJoints } from "./rig.js";
import { drawEmoteOnCanvas } from "./emotes.js";

/**
 * Vẽ một nhân vật hoàn chỉnh lên Canvas 2D context từ cấu hình Avatar và trạng thái Staging.
 * Hàm thuần túy dựa trên các phép vẽ hình học Canvas 2D.
 */
export function drawCharacter(
  ctx: any,
  avatar: AvatarConfig,
  state: CharacterStagingState
): void {
  if (!state.visible || state.opacity <= 0) return;

  ctx.save();
  ctx.globalAlpha = state.opacity;
  ctx.translate(state.x, state.y);

  // Lật ngang nếu hướng sang trái
  const scaleX = state.direction === "left" ? -state.scale : state.scale;
  ctx.scale(scaleX, state.scale);

  const prop = avatar.proportions;
  const joints = computeRigJoints(state.pose, prop);

  ctx.strokeStyle = avatar.style.strokeColor;
  ctx.fillStyle = avatar.style.fillColor;
  ctx.lineWidth = prop.strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 1. Chân trái và chân phải
  ctx.beginPath();
  ctx.moveTo(joints.leftHip.x, joints.leftHip.y);
  ctx.lineTo(joints.leftKnee.x, joints.leftKnee.y);
  ctx.lineTo(joints.leftFoot.x, joints.leftFoot.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(joints.rightHip.x, joints.rightHip.y);
  ctx.lineTo(joints.rightKnee.x, joints.rightKnee.y);
  ctx.lineTo(joints.rightFoot.x, joints.rightFoot.y);
  ctx.stroke();

  // 2. Thân mình / cột sống
  ctx.beginPath();
  ctx.moveTo(joints.root.x, joints.root.y);
  ctx.lineTo(joints.neck.x, joints.neck.y);
  ctx.stroke();

  // 3. Tay trái và tay phải
  ctx.beginPath();
  ctx.moveTo(joints.leftShoulder.x, joints.leftShoulder.y);
  ctx.lineTo(joints.leftElbow.x, joints.leftElbow.y);
  ctx.lineTo(joints.leftHand.x, joints.leftHand.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(joints.rightShoulder.x, joints.rightShoulder.y);
  ctx.lineTo(joints.rightElbow.x, joints.rightElbow.y);
  ctx.lineTo(joints.rightHand.x, joints.rightHand.y);
  ctx.stroke();

  // 4. Đầu
  ctx.beginPath();
  if (avatar.style.headShape === "square") {
    const side = prop.headRadius * 1.8;
    ctx.rect(joints.head.x - side / 2, joints.head.y - side / 2, side, side);
  } else if (avatar.style.headShape === "oval") {
    ctx.ellipse(joints.head.x, joints.head.y, prop.headRadius * 0.9, prop.headRadius * 1.2, 0, 0, Math.PI * 2);
  } else {
    ctx.arc(joints.head.x, joints.head.y, prop.headRadius, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();

  // 5. Tóc
  if (avatar.style.hairStyle !== "none") {
    ctx.save();
    ctx.strokeStyle = avatar.style.strokeColor;
    ctx.fillStyle = avatar.style.strokeColor;
    ctx.lineWidth = prop.strokeWidth * 0.8;
    const hx = joints.head.x;
    const hy = joints.head.y;
    const hr = prop.headRadius;

    if (avatar.style.hairStyle === "spiky") {
      ctx.beginPath();
      ctx.moveTo(hx - hr * 0.8, hy - hr * 0.5);
      ctx.lineTo(hx - hr * 0.6, hy - hr * 1.3);
      ctx.lineTo(hx - hr * 0.2, hy - hr * 0.7);
      ctx.lineTo(hx + hr * 0.1, hy - hr * 1.4);
      ctx.lineTo(hx + hr * 0.4, hy - hr * 0.7);
      ctx.lineTo(hx + hr * 0.8, hy - hr * 1.2);
      ctx.lineTo(hx + hr * 0.9, hy - hr * 0.3);
      ctx.stroke();
    } else if (avatar.style.hairStyle === "ponytail") {
      ctx.beginPath();
      ctx.arc(hx, hy - hr * 0.3, hr, Math.PI, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hx - hr * 1.1, hy - hr * 0.6, hr * 0.45, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // short / curls
      ctx.beginPath();
      ctx.arc(hx, hy, hr * 1.05, Math.PI * 0.85, Math.PI * 0.15, true);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 6. Phụ kiện
  if (avatar.style.accessory === "glasses") {
    ctx.save();
    ctx.strokeStyle = avatar.style.accentColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(joints.head.x - prop.headRadius * 0.65, joints.head.y - prop.headRadius * 0.2, prop.headRadius * 0.5, prop.headRadius * 0.4);
    ctx.strokeRect(joints.head.x + prop.headRadius * 0.15, joints.head.y - prop.headRadius * 0.2, prop.headRadius * 0.5, prop.headRadius * 0.4);
    ctx.beginPath();
    ctx.moveTo(joints.head.x - prop.headRadius * 0.15, joints.head.y);
    ctx.lineTo(joints.head.x + prop.headRadius * 0.15, joints.head.y);
    ctx.stroke();
    ctx.restore();
  } else if (avatar.style.accessory === "tie") {
    ctx.save();
    ctx.fillStyle = avatar.style.accentColor;
    ctx.beginPath();
    ctx.moveTo(joints.neck.x - 4, joints.neck.y + 2);
    ctx.lineTo(joints.neck.x + 4, joints.neck.y + 2);
    ctx.lineTo(joints.neck.x + 6, joints.neck.y + 24);
    ctx.lineTo(joints.neck.x, joints.neck.y + 30);
    ctx.lineTo(joints.neck.x - 6, joints.neck.y + 24);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 7. Biểu cảm khuôn mặt (Emote)
  drawEmoteOnCanvas(
    ctx,
    state.emote || "happy",
    joints.head.x,
    joints.head.y,
    prop.headRadius,
    avatar.style.strokeColor,
    avatar.style.accentColor
  );

  ctx.restore();
}
