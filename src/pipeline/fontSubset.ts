import { existsSync, readFileSync, unlinkSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFile, execSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface FontSubsetOptions {
    fontFamily?: string;
    customFontsDir?: string;
    additionalChars?: string;
    pyftsubsetPath?: string;
    skip?: boolean;
}

export interface FontSubsetStats {
    originalSize?: number;
    subsetSize?: number;
    compressionRatio?: number;
    glyphsCount?: number;
    fontFamily?: string;
    skipped?: boolean;
    reason?: string;
    timeMs?: number;
}

/**
 * Danh sách các dải Unicode bắt buộc cho tiếng Việt đầy đủ và ASCII:
 * 1. Basic Latin: U+0020 - U+007E (toàn bộ ký tự ASCII in được)
 * 2. Latin-1 Supplement: U+00A0 - U+00FF (bao gồm à, á, â, ã, è, é, ê, ì, í, ò, ó, ô, õ, ù, ú, ý...)
 * 3. Latin Extended-A & B tiếng Việt:
 *    - U+0102-0103 (Ă, ă)
 *    - U+0110-0111 (Đ, đ)
 *    - U+0128-0129 (Ĩ, ĩ)
 *    - U+0168-0169 (Ũ, ũ)
 *    - U+01A0-01A1 (Ơ, ơ)
 *    - U+01AF-01B0 (Ư, ư)
 * 4. Latin Extended Additional (toàn bộ ký tự tiếng Việt có dấu thanh): U+1EA0 - U+1EF9
 * 5. Ký tự tiền tệ: ₫ (U+20AB)
 */
export const DEFAULT_VIETNAMESE_UNICODES: readonly string[] = [
    "U+0020-007E",
    "U+00A0-00FF",
    "U+0102-0103",
    "U+0110-0111",
    "U+0128-0129",
    "U+0168-0169",
    "U+01A0-01A1",
    "U+01AF-01B0",
    "U+1EA0-1EF9",
    "U+20AB",
];

/**
 * Kiểm tra xem một code point đã nằm trong dải mặc định hay chưa
 */
export function isCoveredByDefaultRanges(cp: number): boolean {
    if (cp >= 0x0020 && cp <= 0x007E) return true;
    if (cp >= 0x00A0 && cp <= 0x00FF) return true;
    if (cp >= 0x0102 && cp <= 0x0103) return true;
    if (cp >= 0x0110 && cp <= 0x0111) return true;
    if (cp >= 0x0128 && cp <= 0x0129) return true;
    if (cp >= 0x0168 && cp <= 0x0169) return true;
    if (cp >= 0x01A0 && cp <= 0x01A1) return true;
    if (cp >= 0x01AF && cp <= 0x01B0) return true;
    if (cp >= 0x1EA0 && cp <= 0x1EF9) return true;
    if (cp === 0x20AB) return true;
    // Bỏ qua các control characters < 0x20 ngoại trừ khoảng trắng
    if (cp < 0x0020) return true;
    return false;
}

/**
 * Bước 1: Quét glyphs từ HTML comp
 * - Thu thập mọi ký tự phân biệt xuất hiện trong comp
 * - Bắt buộc gộp toàn bộ dải Unicode tiếng Việt & ASCII
 * - Bổ sung các ký tự nằm ngoài dải mặc định (U+XXXX)
 */
export function extractGlyphsFromHtml(
    htmlContent: string,
    additionalChars?: string
): { unicodesArg: string; glyphsCount: number; extraChars: string[] } {
    const extraCodePoints = new Set<number>();
    const extraChars: string[] = [];

    const fullText = additionalChars ? htmlContent + additionalChars : htmlContent;

    for (const char of fullText) {
        const cp = char.codePointAt(0);
        if (cp !== undefined && !isCoveredByDefaultRanges(cp)) {
            if (!extraCodePoints.has(cp)) {
                extraCodePoints.add(cp);
                extraChars.push(char);
            }
        }
    }

    const sortedExtras = Array.from(extraCodePoints).sort((a, b) => a - b);
    const formattedExtras = sortedExtras.map(
        (cp) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`
    );

    const unicodesList = [...DEFAULT_VIETNAMESE_UNICODES, ...formattedExtras];
    const unicodesArg = unicodesList.join(",");

    return {
        unicodesArg,
        glyphsCount: unicodesList.length,
        extraChars,
    };
}

/**
 * Tìm đường dẫn thực thi của pyftsubset
 */
export function findPyftsubsetBinary(customPath?: string): string | null {
    if (customPath !== undefined) {
        if (customPath && existsSync(customPath)) {
            return customPath;
        }
        return null;
    }
    try {
        const whichOut = execSync("which pyftsubset 2>/dev/null", { encoding: "utf-8" }).trim();
        if (whichOut && existsSync(whichOut)) {
            return whichOut;
        }
    } catch {
        // ignore
    }

    const standardCandidates = [
        process.env.HOME ? join(process.env.HOME, ".local/bin/pyftsubset") : null,
        "/usr/local/bin/pyftsubset",
        "/usr/bin/pyftsubset",
    ].filter(Boolean) as string[];

    for (const cand of standardCandidates) {
        if (existsSync(cand)) {
            return cand;
        }
    }
    return null;
}

/**
 * Bước 2: Chuẩn bị source fonts từ assets/fonts
 */
export function resolveFontSourcePath(
    fontFamily: string,
    customDir?: string
): { fontPath: string; resolvedFamily: string } | null {
    const candidates = [
        customDir,
        resolve(process.cwd(), "assets/fonts"),
        resolve(__dirname, "../../assets/fonts"),
        resolve(__dirname, "../assets/fonts"),
        resolve(__dirname, "./assets/fonts"),
    ].filter(Boolean) as string[];

    let fontsDir = "";
    for (const dir of candidates) {
        if (existsSync(dir)) {
            fontsDir = dir;
            break;
        }
    }

    if (!fontsDir) {
        return null;
    }

    const normalized = (fontFamily || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");

    if (normalized.includes("space") || normalized.includes("grotesk")) {
        const spacePath = join(fontsDir, "SpaceGrotesk-Variable.ttf");
        if (existsSync(spacePath)) {
            return { fontPath: spacePath, resolvedFamily: "Space Grotesk" };
        }
    }

    if (normalized.includes("inter")) {
        const interPath = join(fontsDir, "Inter-Variable.ttf");
        if (existsSync(interPath)) {
            return { fontPath: interPath, resolvedFamily: "Inter" };
        }
    }

    // Nếu comp yêu cầu font khác không có trong assets/fonts, log cảnh báo rõ ràng và fallback sang Inter
    const fallbackPath = join(fontsDir, "Inter-Variable.ttf");
    if (existsSync(fallbackPath)) {
        console.warn(
            `[FontSubset] Cảnh báo: Font "${fontFamily}" không có sẵn file nguồn cục bộ trong assets/fonts/. Tự động fallback sang font chuẩn thương hiệu "Inter".`
        );
        return { fontPath: fallbackPath, resolvedFamily: "Inter" };
    }

    return null;
}

/**
 * Phát hiện font family từ nội dung HTML
 */
export function detectFontFamilyFromHtml(html: string): string {
    // 1. Thử trích xuất từ link Google Fonts
    const gfontMatch = html.match(/family=([^:&"'\s]+)/);
    if (gfontMatch && gfontMatch[1]) {
        const decoded = decodeURIComponent(gfontMatch[1]).replace(/\+/g, " ");
        if (/space\s*grotesk/i.test(decoded)) return "Space Grotesk";
        if (/inter/i.test(decoded)) return "Inter";
        return decoded;
    }

    // 2. Thử trích xuất từ CSS font-family
    const cssMatch = html.match(/font-family:\s*['"]?([^,'";]+)/i);
    if (cssMatch && cssMatch[1]) {
        const fam = cssMatch[1].trim();
        if (/space\s*grotesk/i.test(fam)) return "Space Grotesk";
        if (/inter/i.test(fam)) return "Inter";
        return fam;
    }

    return "Inter";
}

/**
 * Kiểm tra tĩnh (static assertion): Trong HTML đầu ra KHÔNG CÒN bất kỳ URL font nào trỏ ra internet
 */
export function assertNoExternalFontUrls(html: string): void {
    const forbiddenDomains = [
        "fonts.googleapis.com",
        "fonts.gstatic.com",
        "cdnfonts.com",
        "use.typekit.net",
        "fonts.cdnfonts.com",
        "cdnjs.cloudflare.com/ajax/libs/font-awesome",
    ];

    for (const domain of forbiddenDomains) {
        if (html.includes(domain)) {
            throw new Error(`[FontSubset] HTML vẫn còn chứa URL font ngoài: ${domain}`);
        }
    }

    // Kiểm tra các thẻ <link> nạp font từ bên ngoài
    const linkFontMatch = html.match(/<link\s+[^>]*href=["']https?:\/\/[^"']*(?:font|typekit)[^"']*["'][^>]*>/i);
    if (linkFontMatch) {
        throw new Error(`[FontSubset] HTML vẫn còn chứa thẻ <link> trỏ tới font ngoài: ${linkFontMatch[0]}`);
    }

    // Kiểm tra @import trỏ tới font ngoài
    const importFontMatch = html.match(/@import\s+(?:url\(['"]?)?https?:\/\/[^'")]+(?:font|typekit)[^'")]+['"]?\)?;?/i);
    if (importFontMatch) {
        throw new Error(`[FontSubset] HTML vẫn còn chứa @import font ngoài: ${importFontMatch[0]}`);
    }

    // Kiểm tra @font-face chứa url(http...)
    const urlFontMatch = html.match(/src:\s*url\(["']?https?:\/\/[^"')]*\.(?:woff2?|ttf|otf|eot)/i);
    if (urlFontMatch) {
        throw new Error(`[FontSubset] HTML vẫn còn chứa @font-face url ngoài: ${urlFontMatch[0]}`);
    }
}

/**
 * In-memory cache cho kết quả pyftsubset theo key sourceFontPath + unicodesArg
 * Tránh chạy lặp lại pyftsubset 2 lần khi assembleHTML gọi ở preview và render
 */
const subsetCache = new Map<string, { base64Woff2: string; originalSize: number; subsetSize: number }>();

export function clearFontSubsetCache(): void {
    subsetCache.clear();
}

/**
 * Cắt 1 file font sang woff2 với pyftsubset (kèm caching)
 */
export async function subsetFontFile(
    pyftsubsetBin: string,
    sourceFontPath: string,
    unicodesArg: string
): Promise<{ base64Woff2: string; originalSize: number; subsetSize: number }> {
    const cacheKey = `${sourceFontPath}::${unicodesArg}`;
    const cached = subsetCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const tempOutput = join(
        tmpdir(),
        `lime-font-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.woff2`
    );

    try {
        const origSize = statSync(sourceFontPath).size;
        await execFileAsync(pyftsubsetBin, [
            sourceFontPath,
            `--output-file=${tempOutput}`,
            "--flavor=woff2",
            "--layout-features=kern,liga",
            `--unicodes=${unicodesArg}`,
        ]);

        if (!existsSync(tempOutput)) {
            throw new Error(`pyftsubset không sinh ra output tại ${tempOutput}`);
        }

        const buf = readFileSync(tempOutput);
        const result = {
            base64Woff2: buf.toString("base64"),
            originalSize: origSize,
            subsetSize: buf.length,
        };
        subsetCache.set(cacheKey, result);
        return result;
    } finally {
        try {
            if (existsSync(tempOutput)) {
                unlinkSync(tempOutput);
            }
        } catch {
            // ignore
        }
    }
}

/**
 * Thay thế link font ngoài bằng thẻ <style id="lime-embedded-fonts">
 */
export function inlineSubsetFontsIntoHtml(
    html: string,
    fontDeclarations: Array<{ fontFamily: string; base64Woff2: string }>
): string {
    const fontFaces = fontDeclarations
        .map(
            (decl) => `@font-face {
  font-family: '${decl.fontFamily}';
  font-style: normal;
  font-weight: 300 900;
  font-display: swap;
  src: url(data:font/woff2;base64,${decl.base64Woff2}) format('woff2');
}`
        )
        .join("\n\n");

    const fontStyleBlock = `\n    <style id="lime-embedded-fonts">\n${fontFaces}\n    </style>`;

    // 1. Xóa các thẻ preconnect và stylesheet liên quan đến Google Fonts và external font CDNs
    let cleaned = html;

    // Xóa thẻ <link rel="preconnect" ...>
    cleaned = cleaned.replace(
        /<link\s+[^>]*rel=["']preconnect["'][^>]*href=["'][^"']*(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^"']*["'][^>]*>/gi,
        ""
    );
    cleaned = cleaned.replace(
        /<link\s+[^>]*href=["'][^"']*(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^"']*["'][^>]*rel=["']preconnect["'][^>]*>/gi,
        ""
    );

    // Xóa thẻ <link ... href="...fonts.googleapis.com..." ...>
    cleaned = cleaned.replace(
        /<link\s+[^>]*href=["'][^"']*(?:fonts\.googleapis\.com|fonts\.gstatic\.com|cdnfonts\.com)[^"']*["'][^>]*>/gi,
        ""
    );

    // Xóa @import nếu có trong inline style
    cleaned = cleaned.replace(
        /@import\s+(?:url\(['"]?)?https?:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|cdnfonts\.com)[^'")]+['"]?\)?;?/gi,
        ""
    );

    // 2. Chèn <style id="lime-embedded-fonts"> vào trong <head>
    if (cleaned.includes("</title>")) {
        cleaned = cleaned.replace("</title>", `</title>${fontStyleBlock}`);
    } else if (cleaned.includes("<head>")) {
        cleaned = cleaned.replace("<head>", `<head>${fontStyleBlock}`);
    } else {
        cleaned = fontStyleBlock + "\n" + cleaned;
    }

    return cleaned;
}

/**
 * Hàm chính của Spec H: Cắt font và nhúng trực tiếp Base64 woff2 vào file HTML comp
 */
export async function subsetFontsForHtml(
    htmlContent: string,
    options?: FontSubsetOptions
): Promise<{ html: string; subsetStats: FontSubsetStats }> {
    const startTime = Date.now();

    // Nếu người dùng yêu cầu bỏ qua
    if (options?.skip) {
        return {
            html: htmlContent,
            subsetStats: {
                skipped: true,
                reason: "skipped_by_options",
                timeMs: 0,
            },
        };
    }

    // 1. Kiểm tra sự tồn tại của pyftsubset
    const pyftsubsetBin = findPyftsubsetBinary(options?.pyftsubsetPath);
    if (!pyftsubsetBin) {
        console.warn("[FontSubset] pyftsubset không khả dụng, giữ nguyên font link ngoài...");
        return {
            html: htmlContent,
            subsetStats: {
                skipped: true,
                reason: "pyftsubset_not_available",
                timeMs: Date.now() - startTime,
            },
        };
    }

    // 2. Xác định danh sách font families cần subset
    // Hỗ trợ cả 2 font nếu cả 2 xuất hiện trong comp, hoặc ưu tiên theo options
    const targetFamilies: string[] = [];
    if (options?.fontFamily) {
        targetFamilies.push(options.fontFamily);
    } else {
        const detected = detectFontFamilyFromHtml(htmlContent);
        targetFamilies.push(detected);
    }

    // Bổ sung thêm font thương hiệu LIME khác nếu comp có sử dụng (ví dụ: heading dùng Space Grotesk, body dùng Inter)
    if (/space\s*grotesk/i.test(htmlContent) && !targetFamilies.some((f) => /space/i.test(f))) {
        targetFamilies.push("Space Grotesk");
    }
    if (/\binter\b/i.test(htmlContent) && !targetFamilies.some((f) => /inter/i.test(f))) {
        targetFamilies.push("Inter");
    }

    // 3. Bước 1: Quét glyphs từ comp HTML
    const { unicodesArg, glyphsCount } = extractGlyphsFromHtml(
        htmlContent,
        options?.additionalChars
    );

    const fontDeclarations: Array<{ fontFamily: string; base64Woff2: string }> = [];
    let totalOrigSize = 0;
    let totalSubsetSize = 0;
    let primaryResolvedFamily = "";

    try {
        for (const family of targetFamilies) {
            const fontSource = resolveFontSourcePath(family, options?.customFontsDir);
            if (!fontSource) {
                console.warn(`[FontSubset] Không tìm thấy font source cho '${family}'`);
                continue;
            }

            // Tránh subset trùng cùng 1 font file
            if (fontDeclarations.some((d) => d.fontFamily === fontSource.resolvedFamily)) {
                continue;
            }

            if (!primaryResolvedFamily) {
                primaryResolvedFamily = fontSource.resolvedFamily;
            }

            const { base64Woff2, originalSize, subsetSize } = await subsetFontFile(
                pyftsubsetBin,
                fontSource.fontPath,
                unicodesArg
            );

            fontDeclarations.push({
                fontFamily: fontSource.resolvedFamily,
                base64Woff2,
            });

            totalOrigSize += originalSize;
            totalSubsetSize += subsetSize;
        }

        if (fontDeclarations.length === 0) {
            console.warn("[FontSubset] Không có font nào được xử lý thành công, giữ nguyên font link ngoài...");
            return {
                html: htmlContent,
                subsetStats: {
                    skipped: true,
                    reason: "font_source_not_found",
                    timeMs: Date.now() - startTime,
                },
            };
        }

        // 4. Bước 4: Inline vào HTML
        const inlinedHtml = inlineSubsetFontsIntoHtml(htmlContent, fontDeclarations);

        // Kiểm tra tĩnh loại bỏ toàn bộ external font URL
        assertNoExternalFontUrls(inlinedHtml);

        const compressionRatio =
            totalOrigSize > 0
                ? Number(((1 - totalSubsetSize / totalOrigSize) * 100).toFixed(1))
                : 0;

        const subsetStats: FontSubsetStats = {
            originalSize: totalOrigSize,
            subsetSize: totalSubsetSize,
            compressionRatio,
            glyphsCount,
            fontFamily: primaryResolvedFamily,
            skipped: false,
            timeMs: Date.now() - startTime,
        };

        return {
            html: inlinedHtml,
            subsetStats,
        };
    } catch (err: any) {
        console.warn("[FontSubset] Lỗi khi cắt font, giữ nguyên font link ngoài:", err?.message || err);
        return {
            html: htmlContent,
            subsetStats: {
                skipped: true,
                reason: "subset_failed",
                fontFamily: primaryResolvedFamily || targetFamilies[0],
                timeMs: Date.now() - startTime,
            },
        };
    }
}
