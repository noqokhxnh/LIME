/**
 * Ported from doodle-anim (https://github.com/feitangyuan/doodle-anim)
 * Author: feitangyuan
 * License: MIT
 */

export type EmoteType = "happy" | "sad" | "surprised" | "angry" | "thinking";

export interface EmotePrimitive {
  type: "arc" | "line" | "path" | "circle" | "text" | "quad";
  color?: string;
  fill?: boolean;
  stroke?: boolean;
  lineWidth?: number;
  params: Record<string, number | string>;
}

export interface EmoteDefinition {
  type: EmoteType;
  eyes: EmotePrimitive[];
  eyebrows: EmotePrimitive[];
  mouth: EmotePrimitive[];
  accentMarks: EmotePrimitive[];
}

/**
 * Trả về tập hợp các primitive hình học Canvas 2D cấu tạo nên biểu cảm khuôn mặt.
 * Thuần túy không phụ thuộc tài nguyên ảnh bên ngoài (Zero external image assets).
 */
export function getEmoteDefinition(
  emote: EmoteType,
  radius = 26,
  strokeColor = "#111827",
  accentColor = "#ef4444"
): EmoteDefinition {
  const eyeOffsetX = radius * 0.4;
  const eyeOffsetY = -radius * 0.1;
  const eyeRadius = radius * 0.12;

  switch (emote) {
    case "happy":
      return {
        type: "happy",
        eyebrows: [
          { type: "arc", color: strokeColor, lineWidth: 2, params: { cx: -eyeOffsetX, cy: eyeOffsetY - 6, r: 5, startAngle: Math.PI, endAngle: 0 } },
          { type: "arc", color: strokeColor, lineWidth: 2, params: { cx: eyeOffsetX, cy: eyeOffsetY - 6, r: 5, startAngle: Math.PI, endAngle: 0 } },
        ],
        eyes: [
          { type: "arc", color: strokeColor, lineWidth: 2.5, params: { cx: -eyeOffsetX, cy: eyeOffsetY, r: eyeRadius, startAngle: Math.PI, endAngle: 0 } },
          { type: "arc", color: strokeColor, lineWidth: 2.5, params: { cx: eyeOffsetX, cy: eyeOffsetY, r: eyeRadius, startAngle: Math.PI, endAngle: 0 } },
        ],
        mouth: [
          { type: "arc", color: strokeColor, lineWidth: 2.5, fill: true, params: { cx: 0, cy: radius * 0.25, r: radius * 0.35, startAngle: 0, endAngle: Math.PI } },
        ],
        accentMarks: [
          // Hai vệt ửng hồng má (blush)
          { type: "circle", color: "#fca5a5", fill: true, params: { cx: -eyeOffsetX - 4, cy: radius * 0.15, r: 4 } },
          { type: "circle", color: "#fca5a5", fill: true, params: { cx: eyeOffsetX + 4, cy: radius * 0.15, r: 4 } },
        ],
      };

    case "sad":
      return {
        type: "sad",
        eyebrows: [
          { type: "line", color: strokeColor, lineWidth: 2, params: { x1: -eyeOffsetX - 5, y1: eyeOffsetY - 4, x2: -eyeOffsetX + 5, y2: eyeOffsetY - 8 } },
          { type: "line", color: strokeColor, lineWidth: 2, params: { x1: eyeOffsetX - 5, y1: eyeOffsetY - 8, x2: eyeOffsetX + 5, y2: eyeOffsetY - 4 } },
        ],
        eyes: [
          { type: "circle", color: strokeColor, fill: true, params: { cx: -eyeOffsetX, cy: eyeOffsetY, r: eyeRadius } },
          { type: "circle", color: strokeColor, fill: true, params: { cx: eyeOffsetX, cy: eyeOffsetY, r: eyeRadius } },
        ],
        mouth: [
          { type: "arc", color: strokeColor, lineWidth: 2.5, params: { cx: 0, cy: radius * 0.45, r: radius * 0.25, startAngle: Math.PI, endAngle: 0 } },
        ],
        accentMarks: [
          // Giọt nước mắt rơi bên má
          { type: "circle", color: "#60a5fa", fill: true, params: { cx: eyeOffsetX + 3, cy: radius * 0.2, r: 3.5 } },
        ],
      };

    case "surprised":
      return {
        type: "surprised",
        eyebrows: [
          { type: "arc", color: strokeColor, lineWidth: 2, params: { cx: -eyeOffsetX, cy: eyeOffsetY - 10, r: 6, startAngle: Math.PI, endAngle: 0 } },
          { type: "arc", color: strokeColor, lineWidth: 2, params: { cx: eyeOffsetX, cy: eyeOffsetY - 10, r: 6, startAngle: Math.PI, endAngle: 0 } },
        ],
        eyes: [
          { type: "circle", color: "#ffffff", fill: true, stroke: true, lineWidth: 1.5, params: { cx: -eyeOffsetX, cy: eyeOffsetY, r: eyeRadius * 1.5 } },
          { type: "circle", color: strokeColor, fill: true, params: { cx: -eyeOffsetX, cy: eyeOffsetY, r: eyeRadius * 0.7 } },
          { type: "circle", color: "#ffffff", fill: true, stroke: true, lineWidth: 1.5, params: { cx: eyeOffsetX, cy: eyeOffsetY, r: eyeRadius * 1.5 } },
          { type: "circle", color: strokeColor, fill: true, params: { cx: eyeOffsetX, cy: eyeOffsetY, r: eyeRadius * 0.7 } },
        ],
        mouth: [
          { type: "circle", color: strokeColor, fill: true, params: { cx: 0, cy: radius * 0.3, r: radius * 0.22 } },
        ],
        accentMarks: [
          // Vệt giật mình trên đỉnh đầu
          { type: "line", color: accentColor, lineWidth: 2.5, params: { x1: 0, y1: -radius - 4, x2: 0, y2: -radius - 12 } },
          { type: "line", color: accentColor, lineWidth: 2, params: { x1: -8, y1: -radius - 3, x2: -14, y2: -radius - 10 } },
          { type: "line", color: accentColor, lineWidth: 2, params: { x1: 8, y1: -radius - 3, x2: 14, y2: -radius - 10 } },
        ],
      };

    case "angry":
      return {
        type: "angry",
        eyebrows: [
          { type: "line", color: strokeColor, lineWidth: 3, params: { x1: -eyeOffsetX - 6, y1: eyeOffsetY - 8, x2: -eyeOffsetX + 6, y2: eyeOffsetY - 3 } },
          { type: "line", color: strokeColor, lineWidth: 3, params: { x1: eyeOffsetX - 6, y1: eyeOffsetY - 3, x2: eyeOffsetX + 6, y2: eyeOffsetY - 8 } },
        ],
        eyes: [
          { type: "circle", color: strokeColor, fill: true, params: { cx: -eyeOffsetX, cy: eyeOffsetY, r: eyeRadius } },
          { type: "circle", color: strokeColor, fill: true, params: { cx: eyeOffsetX, cy: eyeOffsetY, r: eyeRadius } },
        ],
        mouth: [
          { type: "line", color: strokeColor, lineWidth: 3, params: { x1: -radius * 0.25, y1: radius * 0.3, x2: radius * 0.25, y2: radius * 0.3 } },
        ],
        accentMarks: [
          // Ký hiệu gân nổi cáu đỏ trên trán
          { type: "line", color: accentColor, lineWidth: 2.5, params: { x1: eyeOffsetX + 6, y1: -radius * 0.6, x2: eyeOffsetX + 14, y2: -radius * 0.6 } },
          { type: "line", color: accentColor, lineWidth: 2.5, params: { x1: eyeOffsetX + 10, y1: -radius * 0.6 - 4, x2: eyeOffsetX + 10, y2: -radius * 0.6 + 4 } },
        ],
      };

    case "thinking":
    default:
      return {
        type: "thinking",
        eyebrows: [
          // Một bên mày nhướng cao hơn một bên
          { type: "line", color: strokeColor, lineWidth: 2, params: { x1: -eyeOffsetX - 5, y1: eyeOffsetY - 5, x2: -eyeOffsetX + 5, y2: eyeOffsetY - 5 } },
          { type: "arc", color: strokeColor, lineWidth: 2, params: { cx: eyeOffsetX, cy: eyeOffsetY - 8, r: 5, startAngle: Math.PI, endAngle: 0 } },
        ],
        eyes: [
          // Mắt liếc góc trên
          { type: "circle", color: strokeColor, fill: true, params: { cx: -eyeOffsetX + 1, cy: eyeOffsetY - 2, r: eyeRadius } },
          { type: "circle", color: strokeColor, fill: true, params: { cx: eyeOffsetX + 1, cy: eyeOffsetY - 2, r: eyeRadius } },
        ],
        mouth: [
          { type: "line", color: strokeColor, lineWidth: 2, params: { x1: -radius * 0.15, y1: radius * 0.28, x2: radius * 0.15, y2: radius * 0.24 } },
        ],
        accentMarks: [
          // Dấu hỏi chấm lơ lửng bên thái dương
          { type: "text", color: accentColor, params: { text: "?", x: eyeOffsetX + 10, y: -radius * 0.5, font: "bold 14px sans-serif" } },
        ],
      };
  }
}

/**
 * Vẽ biểu cảm khuôn mặt lên Canvas 2D context.
 */
export function drawEmoteOnCanvas(
  ctx: any,
  emote: EmoteType,
  headCenterX: number,
  headCenterY: number,
  radius: number,
  strokeColor: string,
  accentColor: string
): void {
  const def = getEmoteDefinition(emote, radius, strokeColor, accentColor);
  ctx.save();
  ctx.translate(headCenterX, headCenterY);

  const allParts = [...def.eyebrows, ...def.eyes, ...def.mouth, ...def.accentMarks];
  for (const part of allParts) {
    ctx.save();
    if (part.color) {
      ctx.strokeStyle = part.color;
      ctx.fillStyle = part.color;
    }
    if (part.lineWidth) ctx.lineWidth = part.lineWidth;

    if (part.type === "circle") {
      ctx.beginPath();
      ctx.arc(part.params.cx, part.params.cy, part.params.r, 0, Math.PI * 2);
      if (part.fill) ctx.fill();
      if (part.stroke) ctx.stroke();
    } else if (part.type === "arc") {
      ctx.beginPath();
      ctx.arc(part.params.cx, part.params.cy, part.params.r, part.params.startAngle, part.params.endAngle);
      if (part.fill) ctx.fill();
      else ctx.stroke();
    } else if (part.type === "line") {
      ctx.beginPath();
      ctx.moveTo(part.params.x1, part.params.y1);
      ctx.lineTo(part.params.x2, part.params.y2);
      ctx.stroke();
    } else if (part.type === "text") {
      ctx.font = part.params.font;
      ctx.fillText(part.params.text, part.params.x, part.params.y);
    }
    ctx.restore();
  }

  ctx.restore();
}
