/**
 * Structured motion grammar parsed from an opuscar style preset (#123).
 *
 * Preset `.md` files already carry §5 Motion quality, §6 Camera grammar and
 * §8 Native moves as prose + a table. Prose is great for a human, useless for a
 * validator, so this module turns those sections into data:
 *
 * - `camera.allowed` — the core `scene.camera.move` values the preset permits;
 * - `camera.moves`   — the preset's own move names, mapped to core moves;
 * - `motionQuality`  — rules + fps stepping;
 * - `nativeMoves`    — the preset's native move menu.
 *
 * The parser is deliberately tolerant: a preset without §6 (or with a table it
 * cannot map) falls back to the full core vocabulary so a job never fails just
 * because a markdown file is shaped differently.
 */
import { CAMERA_MOVE_IDS, type CameraMove } from '../../pipeline/camera.js';

export interface StyleCameraMove {
    /** Tên move theo preset (vd "Slow push"). */
    label: string;
    /** Move lõi mà pipeline thi hành được; rỗng nếu preset dùng move riêng. */
    core: CameraMove[];
    /** Ý nghĩa biểu đạt theo preset. */
    expresses: string;
    /** Ngữ cảnh phục vụ theo preset. */
    serves: string;
}

export interface StyleCameraGrammar {
    /** Move lõi được phép. Luôn chứa `locked`. */
    allowed: CameraMove[];
    moves: StyleCameraMove[];
    framing?: string;
    transitions?: string;
    source: 'preset' | 'fallback';
}

export interface StyleMotionQuality {
    /** Các bullet của §5, đã bỏ markdown. */
    rules: string[];
    /** Các mốc fps nhắc trong §5 (vd 12, 24). */
    fps: number[];
    raw: string;
}

export interface StyleNativeMove {
    title: string;
    description: string;
    /** Các use-case sau "Fits content like:". */
    fits: string[];
}

export interface StyleMotionSpec {
    camera: StyleCameraGrammar;
    motionQuality: StyleMotionQuality;
    nativeMoves: StyleNativeMove[];
}

const ALL_CORE_MOVES: CameraMove[] = [...CAMERA_MOVE_IDS];

/** Preset không parse được → cho phép toàn bộ vocabulary lõi. */
export function fallbackMotionSpec(): StyleMotionSpec {
    return {
        camera: {
            allowed: [...ALL_CORE_MOVES],
            moves: [],
            source: 'fallback',
        },
        motionQuality: { rules: [], fps: [], raw: '' },
        nativeMoves: [],
    };
}

// ---------------------------------------------------------------------------
// Section extraction
// ---------------------------------------------------------------------------

/**
 * Tách preset thành các section theo heading `## <số>. <tên>`.
 * Trả về map số → nội dung (không gồm heading).
 */
function extractSections(markdown: string): Map<number, string> {
    const sections = new Map<number, string>();
    const lines = markdown.split('\n');
    let current: number | null = null;
    let buffer: string[] = [];

    const flush = () => {
        if (current !== null) sections.set(current, buffer.join('\n').trim());
    };

    for (const line of lines) {
        const heading = /^##\s+(\d+)\.\s+/.exec(line);
        if (heading) {
            flush();
            current = Number(heading[1]);
            buffer = [];
            continue;
        }
        if (current !== null) buffer.push(line);
    }
    flush();
    return sections;
}

function stripMarkdown(text: string): string {
    return text
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/`(.+?)`/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
}

// ---------------------------------------------------------------------------
// §6 Camera grammar
// ---------------------------------------------------------------------------

/**
 * Ánh xạ tên move tự do của preset về vocabulary lõi (#122).
 *
 * Đây là heuristic có chủ đích: preset dùng ngôn ngữ điện ảnh ("crane up",
 * "whip pan", "turntable"), pipeline chỉ thi hành được 7 move. Move không map
 * được vẫn được giữ trong `moves` để hiển thị cho LLM, chỉ không tham gia
 * allow-list.
 */
export function mapCameraLabel(label: string): CameraMove[] {
    const text = label.toLowerCase();
    const out = new Set<CameraMove>();

    const locked = /\b(static|locked|dead still|hold still|camera still|fixed frame|still frame|frame itself)\b/;
    const pan = /\b(pan|whip[- ]?pan|sweep|glide|track|tracking|truck|lateral|side angle|side tracking|orbit|turntable)\b/;
    const tilt = /\b(tilt|crane|rise|climb|ascend|descend|fall|elevation change|vertical scroll|vertical rise)\b/;
    const push = /\b(push|zoom|punch|dive|snap zoom|rush zoom|truck[- ]?in|dolly[- ]?in|approach|move in)\b/;
    const pull = /\b(pull|pull[- ]?back|pull[- ]?out|zoom out|dolly[- ]?out|retreat|shrink)\b/;

    if (locked.test(text)) out.add('locked');

    if (pull.test(text)) {
        out.add('pull-back');
    } else {
        if (pan.test(text)) {
            if (/\bleft\b/.test(text)) out.add('pan-left');
            else if (/\bright\b/.test(text)) out.add('pan-right');
            else {
                out.add('pan-left');
                out.add('pan-right');
            }
        }
        if (tilt.test(text)) {
            if (/\b(up|rise|climb|ascend|crane)\b/.test(text)) out.add('tilt-up');
            else if (/\b(down|descend|fall)\b/.test(text)) out.add('tilt-down');
            else {
                out.add('tilt-up');
                out.add('tilt-down');
            }
        }
    }

    if (push.test(text)) out.add('push-in');

    return [...out];
}

interface ParsedTableRow {
    cells: string[];
}

function parseTableRows(section: string): ParsedTableRow[] {
    const rows: ParsedTableRow[] = [];
    for (const rawLine of section.split('\n')) {
        const line = rawLine.trim();
        if (!line.startsWith('|')) continue;
        const cells = line
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map((cell) => cell.trim());
        if (cells.length < 2) continue;
        if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
        if (cells[0].toLowerCase() === 'move') continue;
        rows.push({ cells });
    }
    return rows;
}

function extractLabeledParagraph(section: string, label: RegExp, next?: RegExp): string | undefined {
    const match = label.exec(section);
    if (!match) return undefined;
    let rest = section.slice(match.index + match[0].length);
    if (next) {
        const stop = next.exec(rest);
        if (stop) rest = rest.slice(0, stop.index);
    } else {
        // Dừng ở dòng trống kép hoặc cuối section.
        const stop = /\n\s*\n/.exec(rest);
        if (stop) rest = rest.slice(0, stop.index);
    }
    const text = stripMarkdown(rest).replace(/^[:\-–]\s*/, '').trim();
    return text || undefined;
}

/**
 * Preset không ghi nhãn "Framing:"/"Transitions:" nhưng thường để một đoạn prose
 * ngay dưới bảng. Tách đoạn đó thành framing + transitions.
 */
function parseTailParagraph(section: string): { framing?: string; transitions?: string } {
    const lines = section.split('\n');
    let lastTableLine = -1;
    lines.forEach((line, index) => {
        if (line.trim().startsWith('|')) lastTableLine = index;
    });
    if (lastTableLine < 0) return {};
    const tail = stripMarkdown(lines.slice(lastTableLine + 1).join('\n'));
    if (!tail) return {};
    const cleanFraming = (text: string) =>
        text.replace(/^Framing\b[:\-–]?\s*/i, '').trim() || undefined;
    const marker = /\bTransitions?\b/i.exec(tail);
    if (!marker) return { framing: cleanFraming(tail) };
    return {
        framing: cleanFraming(tail.slice(0, marker.index)),
        transitions: tail.slice(marker.index).trim() || undefined,
    };
}

function parseCameraGrammar(section: string | undefined): StyleCameraGrammar {
    if (!section) {
        return { allowed: [...ALL_CORE_MOVES], moves: [], source: 'fallback' };
    }

    const moves: StyleCameraMove[] = [];
    const allowed = new Set<CameraMove>();

    for (const row of parseTableRows(section)) {
        const label = stripMarkdown(row.cells[0] || '');
        if (!label) continue;
        const expresses = stripMarkdown(row.cells[1] || '');
        const serves = stripMarkdown(row.cells[2] || '');
        const core = mapCameraLabel(label);
        moves.push({ label, core, expresses, serves });
        core.forEach((id) => allowed.add(id));
    }

    // Grammar đôi khi chỉ nằm ở đoạn prose dưới bảng ("pull out of one set...").
    for (const id of mapCameraLabel(stripMarkdown(section))) allowed.add(id);

    // Một khung tĩnh có chủ đích luôn hợp lệ.
    allowed.add('locked');

    const tail = parseTailParagraph(section);
    const framing =
        tail.framing ??
        extractLabeledParagraph(section, /\bFraming\b[:\-–]?\s*/i, /\bTransitions?\b/i);
    const transitions =
        tail.transitions ??
        extractLabeledParagraph(section, /\bTransitions?\b[:\-–]?\s*/i);

    // Quá ít move map được ⇒ bảng dùng ngôn ngữ quá xa vocabulary; đừng chặn oan.
    if (allowed.size < 3) {
        return {
            allowed: [...ALL_CORE_MOVES],
            moves,
            framing,
            transitions,
            source: 'fallback',
        };
    }

    return {
        allowed: ALL_CORE_MOVES.filter((id) => allowed.has(id)),
        moves,
        framing,
        transitions,
        source: 'preset',
    };
}

// ---------------------------------------------------------------------------
// §5 Motion quality & §8 Native moves
// ---------------------------------------------------------------------------

function parseMotionQuality(section: string | undefined): StyleMotionQuality {
    if (!section) return { rules: [], fps: [], raw: '' };
    const rules = section
        .split('\n')
        .filter((line) => /^[-*]\s+/.test(line.trim()))
        .map((line) => stripMarkdown(line.trim().replace(/^[-*]\s+/, '')))
        .filter(Boolean);
    const fps = new Set<number>();
    for (const match of section.matchAll(/(\d+)\s*(?:fps|frames?\s+per\s+second)/gi)) {
        fps.add(Number(match[1]));
    }
    return { rules, fps: [...fps].sort((a, b) => a - b), raw: section.trim() };
}

function parseNativeMoves(section: string | undefined): StyleNativeMove[] {
    if (!section) return [];
    const moves: StyleNativeMove[] = [];
    for (const rawLine of section.split('\n')) {
        const line = rawLine.trim();
        if (!/^[-*]\s+/.test(line)) continue;
        const match = /^[-*]\s+\*\*(.+?)\*\*\s*[:\-–]?\s*(.*)$/.exec(line);
        if (!match) continue;
        const title = stripMarkdown(match[1]);
        let rest = match[2] || '';
        const fitsMatch = /\*?Fits content like:\*?\s*(.*)$/i.exec(rest);
        const fits = fitsMatch
            ? fitsMatch[1]
                  .split(';')
                  .map((item) => stripMarkdown(item))
                  .filter(Boolean)
            : [];
        if (fitsMatch) rest = rest.slice(0, fitsMatch.index);
        moves.push({
            title,
            description: stripMarkdown(rest),
            fits,
        });
    }
    return moves;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Parse một preset markdown thành motion spec có cấu trúc. */
export function parseStyleMotionSpec(markdown: string): StyleMotionSpec {
    const sections = extractSections(markdown);
    return {
        camera: parseCameraGrammar(sections.get(6)),
        motionQuality: parseMotionQuality(sections.get(5)),
        nativeMoves: parseNativeMoves(sections.get(8)),
    };
}

/**
 * Đoạn prompt ngắn chèn ngay sau style spec: LLM thấy rõ move nào bị ràng buộc,
 * thay vì phải suy ra từ bảng markdown.
 */
export function formatStyleMotionPrompt(spec: StyleMotionSpec, slug?: string): string {
    const lines: string[] = [];
    lines.push(`--- STYLE MOTION GRAMMAR (enforced${slug ? ` — ${slug}` : ''}) ---`);
    lines.push(
        `Allowed scene.camera.move: ${spec.camera.allowed.join(', ')}. Any other move is rejected by validation.`
    );

    if (spec.camera.moves.length) {
        lines.push('Preset camera moves (preset name → pipeline move):');
        for (const move of spec.camera.moves) {
            const core = move.core.length ? move.core.join('/') : '(not expressible — use the closest allowed move)';
            const meaning = [move.expresses, move.serves ? `serves: ${move.serves}` : '']
                .filter(Boolean)
                .join(' — ');
            lines.push(`- ${move.label} → ${core}${meaning ? ` | ${meaning}` : ''}`);
        }
    }
    if (spec.camera.framing) lines.push(`Framing: ${spec.camera.framing}`);
    if (spec.camera.transitions) {
        lines.push(
            /^Transitions?\b/i.test(spec.camera.transitions)
                ? spec.camera.transitions
                : `Transitions: ${spec.camera.transitions}`
        );
    }

    if (spec.motionQuality.rules.length) {
        lines.push('Motion quality rules:');
        for (const rule of spec.motionQuality.rules.slice(0, 6)) lines.push(`- ${rule}`);
    }

    if (spec.nativeMoves.length) {
        const menu = spec.nativeMoves
            .map((move) => (move.fits.length ? `${move.title} (${move.fits.slice(0, 2).join('; ')})` : move.title))
            .join('; ');
        lines.push(`Native moves for this preset: ${menu}`);
    }

    return lines.join('\n');
}
