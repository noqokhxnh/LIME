/**
 * Ported from doodle-anim (https://github.com/feitangyuan/doodle-anim)
 * Author: feitangyuan
 * License: MIT
 */

export { drawCharacter } from "./renderer.js";

/**
 * Mã nguồn JavaScript đóng gói toàn bộ Character Runtime để nhúng vào HTML comp.
 */
export const CHARACTER_RUNTIME_JS = `
// Spec F Procedural Character Runtime
// Ported from doodle-anim (https://github.com/feitangyuan/doodle-anim), MIT License.
(function() {
    window.__sceneCharacterActions = window.__sceneCharacterActions || {};
    window.__avatarCache = window.__avatarCache || {};

    function getAvatar(seed, characterId) {
        var key = seed + ':' + characterId;
        if (window.__avatarCache[key]) return window.__avatarCache[key];

        var charSeed = window.getElementSeed ? window.getElementSeed(seed, characterId) : (window.hashString32(seed + ':' + characterId));
        var nextRand = window.RNG(charSeed);

        function lerp(min, max, t) { return min + (max - min) * t; }
        function pick(arr, r) { return arr[Math.floor(r * arr.length) % arr.length]; }

        var STROKE_PALETTES = ['#1e293b', '#0f172a', '#18181b', '#111827', '#262626', '#312e81', '#1e1b4b', '#3b0764'];
        var FILL_PALETTES = ['#ffffff', '#f8fafc', '#f1f5f9', '#fef3c7', '#e0f2fe', '#fed7aa', '#fce7f3', '#dcfce7'];
        var ACCENT_PALETTES = ['#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#f97316'];

        var avatar = {
            characterId: characterId,
            seed: charSeed,
            proportions: {
                headRadius: Math.round(lerp(22, 30, nextRand())), torsoLength: Math.round(lerp(50, 70, nextRand())),
                upperArmLength: Math.round(lerp(26, 36, nextRand())), lowerArmLength: Math.round(lerp(24, 34, nextRand())),
                upperLegLength: Math.round(lerp(34, 46, nextRand())), lowerLegLength: Math.round(lerp(32, 44, nextRand())),
                shoulderWidth: Math.round(lerp(18, 26, nextRand())), hipWidth: Math.round(lerp(14, 22, nextRand())),
                strokeWidth: Math.round(lerp(3, 5, nextRand()))
            },
            style: {
                strokeColor: pick(STROKE_PALETTES, nextRand()), fillColor: pick(FILL_PALETTES, nextRand()),
                accentColor: pick(ACCENT_PALETTES, nextRand()), headShape: pick(['round', 'square', 'oval'], nextRand()),
                hairStyle: pick(['none', 'short', 'spiky', 'curls', 'ponytail'], nextRand()),
                accessory: pick(['none', 'glasses', 'cap', 'tie'], nextRand())
            }
        };
        window.__avatarCache[key] = avatar;
        return avatar;
    }

    function evaluateStaging(actions, t, fallbackPos) {
        if (!actions || actions.length === 0) return null;
        var sorted = actions.slice().sort(function(a, b) { return a.tStart - b.tStart; });
        var first = sorted[0];
        var last = sorted[sorted.length - 1];

        if (t < first.tStart) {
            if (first.action === 'enter') return null;
        }
        if (t > last.tEnd) {
            if (last.action === 'exit') return null;
        }

        var activeItem = sorted[0];
        for (var i = 0; i < sorted.length; i++) {
            if (t >= sorted[i].tStart && t <= sorted[i].tEnd) {
                activeItem = sorted[i];
                break;
            }
            if (sorted[i].tStart <= t) activeItem = sorted[i];
        }

        var duration = Math.max(0.001, activeItem.tEnd - activeItem.tStart);
        var progress = Math.max(0, Math.min(1, (t - activeItem.tStart) / duration));
        var p = progress * progress * (3 - 2 * progress);

        var targetX = activeItem.position ? activeItem.position.x : fallbackPos.x;
        var targetY = activeItem.position ? activeItem.position.y : fallbackPos.y;
        var scale = activeItem.scale || 1;
        var direction = activeItem.direction || 'right';

        var posX = targetX;
        var posY = targetY;
        var opacity = 1;

        if (activeItem.action === 'enter') {
            var sign = direction === 'right' ? -1 : 1;
            var startX = targetX + sign * 260;
            posX = startX + (targetX - startX) * p;
            opacity = Math.min(1, progress * 4);
        } else if (activeItem.action === 'exit') {
            var s = direction === 'right' ? 1 : -1;
            var endX = targetX + s * 260;
            posX = targetX + (endX - targetX) * p;
            opacity = Math.max(0, 1 - Math.max(0, (progress - 0.75) * 4));
        }

        return {
            visible: opacity > 0,
            x: posX,
            y: posY,
            scale: scale,
            direction: direction,
            action: activeItem.action,
            emote: activeItem.emote,
            opacity: opacity,
            t: t
        };
    }

    function renderPose(ctx, avatar, state) {
        var t = state.t;
        var cycle = state.action === 'run' ? 0.45 : (state.action === 'walk' || state.action === 'enter' || state.action === 'exit' ? 0.8 : 2.0);
        var phase = (((t % cycle) + cycle) % cycle) / cycle * 2 * Math.PI;
        var sinP = Math.sin(phase);
        var cosP = Math.cos(phase);

        var prop = avatar.proportions;
        var bob = 0;
        var torsoAngle = 0;
        var headAngle = 0;
        var lUpperArm = 0.12, lLowerArm = 0.15, rUpperArm = -0.12, rLowerArm = -0.15;
        var lUpperLeg = -0.04, lLowerLeg = 0.04, rUpperLeg = 0.04, rLowerLeg = -0.04;

        if (state.action === 'run') {
            bob = -Math.abs(sinP) * 7.5;
            torsoAngle = 0.18 + sinP * 0.03;
            headAngle = -0.08 + cosP * 0.03;
            lUpperArm = -sinP * 0.9; lLowerArm = 1.15;
            rUpperArm = sinP * 0.9; rLowerArm = 1.15;
            lUpperLeg = sinP * 0.88; lLowerLeg = Math.max(0.1, -sinP) * 0.95 + 0.15;
            rUpperLeg = -sinP * 0.88; rLowerLeg = Math.max(0.1, sinP) * 0.95 + 0.15;
        } else if (state.action === 'walk' || state.action === 'enter' || state.action === 'exit') {
            bob = -Math.abs(sinP) * 3.5;
            torsoAngle = 0.05 + sinP * 0.02;
            headAngle = -0.03 + cosP * 0.02;
            lUpperArm = -sinP * 0.45; lLowerArm = Math.max(0.1, -sinP * 0.25 + 0.2);
            rUpperArm = sinP * 0.45; rLowerArm = Math.max(0.1, sinP * 0.25 + 0.2);
            lUpperLeg = sinP * 0.48; lLowerLeg = Math.max(0, -sinP) * 0.42;
            rUpperLeg = -sinP * 0.48; rLowerLeg = Math.max(0, sinP) * 0.42;
        } else {
            bob = Math.sin(phase) * 2;
            torsoAngle = Math.sin(phase * 0.5) * 0.02;
            headAngle = Math.sin(phase) * 0.02;
        }

        ctx.save();
        ctx.globalAlpha = state.opacity;
        ctx.translate(state.x, state.y + bob);
        var scaleX = state.direction === 'left' ? -state.scale : state.scale;
        ctx.scale(scaleX, state.scale);

        ctx.strokeStyle = avatar.style.strokeColor;
        ctx.fillStyle = avatar.style.fillColor;
        ctx.lineWidth = prop.strokeWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        var rootX = 0, rootY = 0;
        var neckX = rootX + Math.sin(torsoAngle) * prop.torsoLength;
        var neckY = rootY - Math.cos(torsoAngle) * prop.torsoLength;
        var headX = neckX + Math.sin(torsoAngle + headAngle) * prop.headRadius;
        var headY = neckY - Math.cos(torsoAngle + headAngle) * prop.headRadius;

        var halfShoulder = prop.shoulderWidth / 2;
        var lShoulderX = neckX - Math.cos(torsoAngle) * halfShoulder, lShoulderY = neckY - Math.sin(torsoAngle) * halfShoulder;
        var rShoulderX = neckX + Math.cos(torsoAngle) * halfShoulder, rShoulderY = neckY + Math.sin(torsoAngle) * halfShoulder;

        var lElbowX = lShoulderX + Math.sin(lUpperArm) * prop.upperArmLength, lElbowY = lShoulderY + Math.cos(lUpperArm) * prop.upperArmLength;
        var lHandX = lElbowX + Math.sin(lLowerArm) * prop.lowerArmLength, lHandY = lElbowY + Math.cos(lLowerArm) * prop.lowerArmLength;

        var rElbowX = rShoulderX + Math.sin(rUpperArm) * prop.upperArmLength, rElbowY = rShoulderY + Math.cos(rUpperArm) * prop.upperArmLength;
        var rHandX = rElbowX + Math.sin(rLowerArm) * prop.lowerArmLength, rHandY = rElbowY + Math.cos(rLowerArm) * prop.lowerArmLength;

        var halfHip = prop.hipWidth / 2;
        var lHipX = rootX - halfHip, lHipY = rootY;
        var rHipX = rootX + halfHip, rHipY = rootY;

        var lKneeX = lHipX + Math.sin(lUpperLeg) * prop.upperLegLength, lKneeY = lHipY + Math.cos(lUpperLeg) * prop.upperLegLength;
        var lFootX = lKneeX + Math.sin(lLowerLeg) * prop.lowerLegLength, lFootY = lKneeY + Math.cos(lLowerLeg) * prop.lowerLegLength;

        var rKneeX = rHipX + Math.sin(rUpperLeg) * prop.upperLegLength, rKneeY = rHipY + Math.cos(rUpperLeg) * prop.upperLegLength;
        var rFootX = rKneeX + Math.sin(rLowerLeg) * prop.lowerLegLength, rFootY = rKneeY + Math.cos(rLowerLeg) * prop.lowerLegLength;

        // Limbs & Body
        ctx.beginPath(); ctx.moveTo(lHipX, lHipY); ctx.lineTo(lKneeX, lKneeY); ctx.lineTo(lFootX, lFootY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(rHipX, rHipY); ctx.lineTo(rKneeX, rKneeY); ctx.lineTo(rFootX, rFootY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(rootX, rootY); ctx.lineTo(neckX, neckY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(lShoulderX, lShoulderY); ctx.lineTo(lElbowX, lElbowY); ctx.lineTo(lHandX, lHandY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(rShoulderX, rShoulderY); ctx.lineTo(rElbowX, rElbowY); ctx.lineTo(rHandX, rHandY); ctx.stroke();

        // Head
        ctx.beginPath(); ctx.arc(headX, headY, prop.headRadius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

        // Emote face
        var emote = state.emote || 'happy';
        var eyeOff = prop.headRadius * 0.4;
        if (emote === 'happy') {
            ctx.beginPath(); ctx.arc(headX - eyeOff, headY - 2, 3, Math.PI, 0); ctx.stroke();
            ctx.beginPath(); ctx.arc(headX + eyeOff, headY - 2, 3, Math.PI, 0); ctx.stroke();
            ctx.beginPath(); ctx.arc(headX, headY + 5, prop.headRadius * 0.35, 0, Math.PI); ctx.stroke();
        } else if (emote === 'sad') {
            ctx.beginPath(); ctx.arc(headX - eyeOff, headY, 2.5, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(headX + eyeOff, headY, 2.5, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(headX, headY + 10, prop.headRadius * 0.25, Math.PI, 0); ctx.stroke();
        } else if (emote === 'surprised') {
            ctx.beginPath(); ctx.arc(headX - eyeOff, headY, 3.5, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.arc(headX + eyeOff, headY, 3.5, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.arc(headX, headY + 7, prop.headRadius * 0.22, 0, Math.PI * 2); ctx.fill();
        } else if (emote === 'angry') {
            ctx.beginPath(); ctx.moveTo(headX - eyeOff - 4, headY - 6); ctx.lineTo(headX - eyeOff + 4, headY - 2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(headX + eyeOff - 4, headY - 2); ctx.lineTo(headX + eyeOff + 4, headY - 6); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(headX - 6, headY + 7); ctx.lineTo(headX + 6, headY + 7); ctx.stroke();
        } else {
            // thinking
            ctx.beginPath(); ctx.arc(headX - eyeOff, headY - 3, 2.5, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(headX + eyeOff, headY - 3, 2.5, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.moveTo(headX - 5, headY + 6); ctx.lineTo(headX + 5, headY + 5); ctx.stroke();
        }

        ctx.restore();
    }

    window.__renderCharacters = function(globalTime) {
        var elapsed = 0;
        for (var sceneId in window.__sceneDurations) {
            var dur = window.__sceneDurations[sceneId];
            var sceneStart = elapsed;
            var sceneEnd = elapsed + dur;
            var tLocal = globalTime - sceneStart;
            var canvas = document.getElementById('char_canvas_' + sceneId.replace(/[^a-zA-Z0-9_]/g, '_'));

            if (canvas) {
                var ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                if (tLocal >= 0 && tLocal <= dur) {
                    var actions = window.__sceneCharacterActions[sceneId];
                    if (actions && actions.length > 0) {
                        var state = evaluateStaging(actions, tLocal, { x: canvas.width / 2, y: canvas.height * 0.72 });
                        if (state && state.visible) {
                            var charId = actions[0].characterId || 'guide';
                            var seed = window.__sceneSeeds[sceneId] || window.__renderSeed || 12345;
                            var avatar = getAvatar(seed, charId);
                            renderPose(ctx, avatar, state);
                        }
                    }
                }
            }
            elapsed += dur;
        }
    };
})();
`;
