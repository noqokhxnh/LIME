/**
 * LIME Motion Design Tokens & Anti-Slop Constitution
 * Single source of truth for animation timing, easing curves, staggers, and quality rules.
 */

export const MOTION_DURATION_TOKENS = {
    'dur.micro': {
        minMs: 150,
        maxMs: 200,
        minSec: 0.15,
        maxSec: 0.20,
        description: 'Phản hồi nhỏ: hover, nhấn, tick'
    },
    'dur.fast': {
        minMs: 250,
        maxMs: 350,
        minSec: 0.25,
        maxSec: 0.35,
        description: 'Phần tử phụ xuất hiện / rời đi'
    },
    'dur.base': {
        minMs: 450,
        maxMs: 600,
        minSec: 0.45,
        maxSec: 0.60,
        description: 'Chuyển động mặc định của scene'
    },
    'dur.slow': {
        minMs: 700,
        maxMs: 900,
        minSec: 0.70,
        maxSec: 0.90,
        description: 'Nhấn mạnh, chuyển trọng tâm'
    },
    'dur.cinematic': {
        minMs: 1000,
        maxMs: 1400,
        minSec: 1.00,
        maxSec: 1.40,
        description: 'Cold-open, camera move lớn, outro'
    }
} as const;

export const MOTION_EASING_TOKENS = {
    'ease.enter': {
        gsap: 'expo.out',
        description: 'Phần tử vào khung: nhanh đầu, đáp mềm'
    },
    'ease.pop': {
        gsap: 'back.out(1.7)',
        description: 'Xuất hiện cần overshoot nhẹ: badge, thẻ'
    },
    'ease.playful': {
        gsap: 'elastic.out(1, 0.5)',
        description: 'Điểm nhấn vui, cảm xúc, max 1 lần/scene'
    },
    'ease.camera': {
        gsap: 'circ.out',
        description: 'Camera pan/zoom, di chuyển dài'
    },
    'ease.flow': {
        gsap: 'sine.inOut',
        description: 'Chuyển động nền liên tục, dao động nhẹ'
    }
} as const;

export const MOTION_STAGGER_TOKENS = {
    'stagger.grid': {
        sec: 0.04,
        description: 'Lưới nhiều phần tử, icon, ô'
    },
    'stagger.list': {
        sec: 0.08,
        description: 'Danh sách, checklist, dòng chữ lần lượt'
    },
    'stagger.dramatic': {
        sec: 0.15,
        description: 'Dồn dập có kịch tính, ít phần tử'
    }
} as const;

export const ANTI_SLOP_LAWS = [
    '1. Cấm fade opacity 0->1 làm chuyển động duy nhất của một phần tử; mọi lần xuất hiện phải kèm transform (vị trí, tỉ lệ) hoặc mask.',
    '2. Cấm easing tuyến tính (linear / none trong GSAP) cho mọi chuyển động trừ thanh tiến trình và chuyển động nền tốc độ hằng số có lý do ghi rõ.',
    '3. Mọi move phải có damping hoặc overshoot: hoặc dùng token easing ở bảng 1.3, hoặc khai báo spring; cấm tween "đi đều rồi dừng đột ngột".',
    '4. Cấm 2 scene liên tiếp dùng cùng một cơ chế vào cảnh (entrance) — sự lặp lại là dấu hiệu slideshow.',
    '5. Mọi duration/easing/stagger phải tham chiếu token; tự chế ngoài token là lỗi, Phase 1 phải reject và retry.'
] as const;
