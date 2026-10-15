import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { chromium, type Browser } from "playwright";

import {
    subsetFontsForHtml,
    extractGlyphsFromHtml,
    DEFAULT_VIETNAMESE_UNICODES,
    isCoveredByDefaultRanges,
    assertNoExternalFontUrls,
    findPyftsubsetBinary,
    resolveFontSourcePath,
    detectFontFamilyFromHtml,
} from "../../src/pipeline/fontSubset.js";
import { assembleHTML } from "../../src/pipeline/assembleHtml.js";
import { type videoScript, type durationMap } from "../../src/llm/schema.js";

describe("Workstream WS-H (Spec H): Font Subsetting & Self-Contained Typography Comps", () => {
    let testTempDir: string;
    let browser: Browser | null = null;

    before(async () => {
        try {
            browser = await chromium.launch({ headless: true });
        } catch (e) {
            console.warn("[Test Setup] Không thể khởi động Playwright Chromium:", e);
        }
    });

    after(async () => {
        if (browser) {
            await browser.close();
            browser = null;
        }
    });

    beforeEach(() => {
        testTempDir = mkdtempSync(join(tmpdir(), "lime-spec-h-test-"));
    });

    afterEach(() => {
        if (existsSync(testTempDir)) {
            try {
                rmSync(testTempDir, { recursive: true, force: true });
            } catch {
                // ignore cleanup error
            }
        }
    });

    const mockSampleScript: videoScript = {
        id: "script-mock-h-1",
        title: "Khám Phá Hà Nội 36 Phố Phường",
        description: "Hành trình khám phá thủ đô ngàn năm văn hiến",
        globalStyles: "",
        globalSetupJs: "",
        colorPalette: {
            primary: "#ffffff",
            secondary: "#000000",
            accent: "#ff0000",
            background: "#000000",
            text: "#ffffff",
        },
        fontFamily: "Inter",
        scenes: [
            {
                id: "scene-1",
                title: "Hồ Gươm Sáng Sớm",
                voiceOverText: "Chào mừng bạn đến với thủ đô Hà Nội ngàn năm văn hiến.",
                visualDescription: "Cảnh Hồ Gươm lung linh trong nắng sớm",
                htmlCode: '<div class="banner"><h1>Hà Nội Cổ Kính</h1><p>Giá chỉ từ 199.000₫</p></div>',
                cssCode: ".banner { font-size: 28px; color: #ffffff; }",
                jsCode: `
                    const tl = gsap.timeline();
                    tl.to(".banner", { opacity: 1, duration: {{SCENE_DURATION}} });
                `,
            },
            {
                id: "scene-2",
                title: "Ẩm Thực Phố Cổ",
                voiceOverText: "Thưởng thức phở gia truyền thơm ngon đậm đà.",
                visualDescription: "Bát phở bò bốc khói nghi ngút",
                htmlCode: '<div class="content"><p>“Phở gia truyền — Trần đời có một không hai!”</p></div>',
                cssCode: ".content { font-size: 24px; color: #f1f2f6; }",
                jsCode: `
                    const tl = gsap.timeline();
                    tl.to(".content", { y: -20, duration: {{SCENE_DURATION}} });
                `,
            },
        ],
        boundaries: [
            {
                id: "b1",
                fromScene: "scene-1",
                toScene: "scene-2",
                carry: {
                    element: ".banner",
                    mechanism: "morph",
                },
            },
        ],
    };

    const mockDurations: durationMap = {
        "scene-1": 4.0,
        "scene-2": 6.0,
    };

    // =========================================================================
    // Test 1: Quét glyphs trích xuất đúng và đầy đủ dải Unicode tiếng Việt
    // =========================================================================
    describe("Test 1: Quét glyphs trích xuất đúng và đầy đủ dải Unicode tiếng Việt", () => {
        it("phải luôn bao gồm đầy đủ 10 dải Unicode tiếng Việt bắt buộc ngay cả với comp HTML đơn giản", () => {
            const simpleHtml = "<div>Hello World</div>";
            const result = extractGlyphsFromHtml(simpleHtml);

            // Kiểm tra các dải cơ sở
            assert.ok(result.unicodesArg.includes("U+0020-007E"), "Phải chứa Basic Latin U+0020-007E");
            assert.ok(result.unicodesArg.includes("U+00A0-00FF"), "Phải chứa Latin-1 Supplement U+00A0-00FF");
            assert.ok(result.unicodesArg.includes("U+0102-0103"), "Phải chứa Ă, ă (U+0102-0103)");
            assert.ok(result.unicodesArg.includes("U+0110-0111"), "Phải chứa Đ, đ (U+0110-0111)");
            assert.ok(result.unicodesArg.includes("U+0128-0129"), "Phải chứa Ĩ, ĩ (U+0128-0129)");
            assert.ok(result.unicodesArg.includes("U+0168-0169"), "Phải chứa Ũ, ũ (U+0168-0169)");
            assert.ok(result.unicodesArg.includes("U+01A0-01A1"), "Phải chứa Ơ, ơ (U+01A0-01A1)");
            assert.ok(result.unicodesArg.includes("U+01AF-01B0"), "Phải chứa Ư, ư (U+01AF-01B0)");
            assert.ok(result.unicodesArg.includes("U+1EA0-1EF9"), "Phải chứa toàn bộ Latin Extended Additional U+1EA0-1EF9");
            assert.ok(result.unicodesArg.includes("U+20AB"), "Phải chứa ký tự tiền tệ ₫ (U+20AB)");
        });

        it("phải phát hiện và trích xuất chính xác các ký tự đặc thù ngoài dải cơ sở (ngoặc kép, gạch ngang, bullet, icon)", () => {
            const richHtml = `
                <div>
                    <p>“LIME Motion — Đột phá sáng tạo • Xem ngay → ★”</p>
                    <span>Giá: 50€ hoặc 100¥</span>
                </div>
            `;
            const result = extractGlyphsFromHtml(richHtml);

            // Ký tự “ (U+201C) và ” (U+201D)
            assert.ok(result.unicodesArg.includes("U+201C"), "Phải chứa U+201C (mở ngoặc kép cong)");
            assert.ok(result.unicodesArg.includes("U+201D"), "Phải chứa U+201D (đóng ngoặc kép cong)");
            // Ký tự — (U+2014)
            assert.ok(result.unicodesArg.includes("U+2014"), "Phải chứa U+2014 (em-dash)");
            // Ký tự • (U+2022)
            assert.ok(result.unicodesArg.includes("U+2022"), "Phải chứa U+2022 (bullet)");
            // Ký tự → (U+2192)
            assert.ok(result.unicodesArg.includes("U+2192"), "Phải chứa U+2192 (right arrow)");
            // Ký tự ★ (U+2605)
            assert.ok(result.unicodesArg.includes("U+2605"), "Phải chứa U+2605 (star)");
            // Ký tự € (U+20AC)
            assert.ok(result.unicodesArg.includes("U+20AC"), "Phải chứa U+20AC (euro)");

            assert.ok(result.extraChars.includes("“"));
            assert.ok(result.extraChars.includes("”"));
            assert.ok(result.extraChars.includes("—"));
            assert.ok(result.extraChars.includes("•"));
            assert.ok(result.extraChars.includes("→"));
        });

        it("hàm isCoveredByDefaultRanges phải bao phủ 100% nguyên âm tiếng Việt có dấu thanh và dấu mũ/móc", () => {
            // Mẫu tất cả các nguyên âm và phụ âm tiếng Việt đặc thù
            const vietnameseChars = [
                // a, ă, â
                "a", "á", "à", "ả", "ã", "ạ",
                "ă", "ắ", "ằ", "ẳ", "ẵ", "ặ",
                "â", "ấ", "ầ", "ẩ", "ẫ", "ậ",
                // e, ê
                "e", "é", "è", "ẻ", "ẽ", "ẹ",
                "ê", "ế", "ề", "ể", "ễ", "ệ",
                // i
                "i", "í", "ì", "ỉ", "ĩ", "ị",
                // o, ô, ơ
                "o", "ó", "ò", "ỏ", "õ", "ọ",
                "ô", "ố", "ồ", "ổ", "ỗ", "ộ",
                "ơ", "ớ", "ờ", "ở", "ỡ", "ợ",
                // u, ư
                "u", "ú", "ù", "ủ", "ũ", "ụ",
                "ư", "ứ", "ừ", "ử", "ữ", "ự",
                // y
                "y", "ý", "ỳ", "ỷ", "ỹ", "ỵ",
                // đ, ₫
                "đ", "Đ", "₫",
                // Chữ hoa
                "Ă", "Ắ", "Ằ", "Ẳ", "Ẵ", "Ặ",
                "Â", "Ấ", "Ầ", "Ẩ", "Ẫ", "Ậ",
                "Ê", "Ế", "Ề", "Ể", "Ễ", "Ệ",
                "Ô", "Ố", "Ồ", "Ổ", "Ỗ", "Ộ",
                "Ơ", "Ớ", "Ờ", "Ở", "Ỡ", "Ợ",
                "Ư", "Ứ", "Ừ", "Ử", "Ữ", "Ự",
            ];

            for (const char of vietnameseChars) {
                const cp = char.codePointAt(0)!;
                assert.strictEqual(
                    isCoveredByDefaultRanges(cp),
                    true,
                    `Ký tự '${char}' (U+${cp.toString(16).toUpperCase()}) phải được bao phủ bởi dải Unicode mặc định`
                );
            }
        });
    });

    // =========================================================================
    // Test 2: Cắt font thành woff2 với pyftsubset, dung lượng giảm đáng kể (< 300KB)
    // =========================================================================
    describe("Test 2: Cắt font thành woff2 với pyftsubset, dung lượng giảm đáng kể (< 300KB)", () => {
        it("cắt font Inter: woff2 kết quả phải có dung lượng < 300KB và tỷ lệ nén > 75%", async () => {
            const html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Test Inter Subset</title>
                    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" rel="stylesheet">
                </head>
                <body>
                    <h1>Xin chào Việt Nam, đỉnh cao đồ họa LIME</h1>
                </body>
                </html>
            `;

            const res = await subsetFontsForHtml(html, { fontFamily: "Inter" });

            assert.strictEqual(res.subsetStats.skipped, false, "Không được bỏ qua khi pyftsubset khả dụng");
            assert.strictEqual(res.subsetStats.fontFamily, "Inter");
            assert.ok(res.subsetStats.subsetSize !== undefined);
            assert.ok(res.subsetStats.originalSize !== undefined);

            // Dung lượng woff2 phải < 300KB (307,200 bytes)
            assert.ok(
                res.subsetStats.subsetSize < 300 * 1024,
                `Kích thước woff2 (${res.subsetStats.subsetSize} bytes) phải nhỏ hơn 300KB`
            );

            // Font Inter gốc ~876KB, woff2 ~52KB -> tỷ lệ nén > 80%
            assert.ok(
                (res.subsetStats.compressionRatio || 0) > 75,
                `Tỷ lệ nén (${res.subsetStats.compressionRatio}%) phải đạt trên 75%`
            );
        });

        it("cắt font Space Grotesk: woff2 kết quả phải có dung lượng < 300KB và giữ đúng brand font", async () => {
            const html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Test Space Grotesk Subset</title>
                    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;700&display=swap" rel="stylesheet">
                </head>
                <body>
                    <h1>Space Grotesk Kinetic Motion Design ₫</h1>
                </body>
                </html>
            `;

            const res = await subsetFontsForHtml(html, { fontFamily: "Space Grotesk" });

            assert.strictEqual(res.subsetStats.skipped, false);
            assert.strictEqual(res.subsetStats.fontFamily, "Space Grotesk");
            assert.ok(
                (res.subsetStats.subsetSize || 0) < 300 * 1024,
                `Space Grotesk woff2 (${res.subsetStats.subsetSize} bytes) phải < 300KB`
            );
        });
    });

    // =========================================================================
    // Test 3: Inline base64 thành công vào HTML, loại bỏ hoàn toàn external links
    // =========================================================================
    describe("Test 3: Inline base64 thành công vào HTML, loại bỏ hoàn toàn các external link fonts.googleapis.com", () => {
        it("phải chèn thẻ style id='lime-embedded-fonts' chứa @font-face dạng data:font/woff2;base64", async () => {
            const html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Typography Comp</title>
                    <link rel="preconnect" href="https://fonts.googleapis.com">
                    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
                    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700;800;900&display=swap" rel="stylesheet">
                    <style>
                        body { font-family: 'Inter', sans-serif; }
                    </style>
                </head>
                <body>
                    <h1>LIME Self-Contained Comp</h1>
                </body>
                </html>
            `;

            const res = await subsetFontsForHtml(html);
            const outputHtml = res.html;

            // Kiểm tra có thẻ <style id="lime-embedded-fonts">
            assert.ok(outputHtml.includes('id="lime-embedded-fonts"'), "Phải có thẻ style id='lime-embedded-fonts'");
            assert.ok(outputHtml.includes("@font-face"), "Phải chứa khai báo @font-face");
            assert.ok(outputHtml.includes("font-family: 'Inter'"), "Phải khai báo font-family Inter");
            assert.ok(outputHtml.includes("font-weight: 300 900;"), "Phải hỗ trợ weight range 300 900");
            assert.ok(outputHtml.includes("src: url(data:font/woff2;base64,"), "Phải có Data URI woff2 base64");
            assert.ok(outputHtml.includes("format('woff2')"), "Phải khai báo format woff2");
        });

        it("phải loại bỏ 100% các external link font và vượt qua kiểm tra tĩnh assertNoExternalFontUrls", async () => {
            const htmlWithExternalLinks = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>External Links Test</title>
                    <link rel="preconnect" href="https://fonts.googleapis.com">
                    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
                    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" rel="stylesheet">
                </head>
                <body><h1>Nội dung</h1></body>
                </html>
            `;

            const res = await subsetFontsForHtml(htmlWithExternalLinks);
            const outputHtml = res.html;

            // Kiểm tra không còn URL google fonts hoặc gstatic
            assert.strictEqual(outputHtml.includes("fonts.googleapis.com"), false, "Không được còn fonts.googleapis.com");
            assert.strictEqual(outputHtml.includes("fonts.gstatic.com"), false, "Không được còn fonts.gstatic.com");
            assert.strictEqual(outputHtml.includes("cdnfonts.com"), false, "Không được còn cdnfonts.com");

            // Kiểm tra tĩnh phải thành công
            assert.doesNotThrow(() => {
                assertNoExternalFontUrls(outputHtml);
            }, "HTML sau khi inline font phải vượt qua assertNoExternalFontUrls");

            // Đảm bảo assertNoExternalFontUrls phát hiện nếu có link sót lại
            assert.throws(() => {
                assertNoExternalFontUrls('<link href="https://fonts.googleapis.com/css?family=Inter">');
            }, /URL font ngoài/);
        });
    });

    // =========================================================================
    // Test 4: Tiếng Việt pangram test ("Trần đời có một không hai, ăn quả nhớ kẻ trồng cây...")
    // =========================================================================
    describe("Test 4: Tiếng Việt pangram test ('Trần đời có một không hai, ăn quả nhớ kẻ trồng cây...')", () => {
        it("đảm bảo toàn bộ ký tự trong pangram tiếng Việt phức tạp đều được bao hàm và decode cmap woff2 đầy đủ", async () => {
            const pangramText = "Trần đời có một không hai, ăn quả nhớ kẻ trồng cây, uống nước nhớ nguồn, ngàn năm bia miệng vẫn còn trơ trơ. Khát khao vươn tới đỉnh cao: 123.456₫!";

            const html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Pangram Test</title>
                    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" rel="stylesheet">
                </head>
                <body>
                    <div id="pangram">${pangramText}</div>
                </body>
                </html>
            `;

            const res = await subsetFontsForHtml(html, { fontFamily: "Inter" });
            assert.strictEqual(res.subsetStats.skipped, false);

            // Trích xuất base64 từ output HTML
            const match = res.html.match(/src:\s*url\(data:font\/woff2;base64,([^)]+)\)\s*format\('woff2'\)/);
            assert.ok(match && match[1], "Phải trích xuất được base64 woff2 từ HTML");

            const base64Data = match[1];
            const tempWoff2Path = join(testTempDir, "pangram_check.woff2");
            writeFileSync(tempWoff2Path, Buffer.from(base64Data, "base64"));

            // Dùng python fonttools để kiểm tra cmap của file woff2 kết quả
            const pyScriptPath = join(testTempDir, "check_pangram.py");
            const pyChecker = `import io, sys
from fontTools.ttLib import TTFont

with open(r'${tempWoff2Path}', 'rb') as f:
    font = TTFont(io.BytesIO(f.read()))
    cmap = font.getBestCmap()
    pangram = "${pangramText}"
    missing = [c for c in pangram if ord(c) not in cmap]
    if missing:
        print(f"MISSING: {missing}", file=sys.stderr)
        sys.exit(1)
    print("ALL_PRESENT")
`;
            writeFileSync(pyScriptPath, pyChecker, "utf-8");

            // Tự động tìm python runner có fontTools (từ PATH hoặc pipx venv tiêu chuẩn)
            let pythonCmd: string | null = null;
            const pythonCandidates = [
                "python3",
                "python",
                process.env.HOME ? join(process.env.HOME, ".local/share/pipx/venvs/fonttools/bin/python") : null,
                "/usr/bin/python3",
            ].filter(Boolean) as string[];

            for (const cand of pythonCandidates) {
                try {
                    execSync(`${cand} -c "from fontTools.ttLib import TTFont" 2>/dev/null`);
                    pythonCmd = cand;
                    break;
                } catch {
                    // ignore
                }
            }

            if (pythonCmd) {
                const checkResult = execSync(
                    `${pythonCmd} "${pyScriptPath}"`,
                    { encoding: "utf-8" }
                ).trim();
                assert.strictEqual(checkResult, "ALL_PRESENT", "100% các ký tự trong pangram phải có mặt trong cmap woff2");
            } else {
                // Fallback khi môi trường CI không có fontTools python: kiểm tra tĩnh dải unicode
                const glyphs = extractGlyphsFromHtml(sampleHtml);
                for (const char of pangramText) {
                    assert.ok(isCoveredByDefaultRanges(char.charCodeAt(0)) || glyphs.extraChars.includes(char));
                }
            }
        });
    });

    // =========================================================================
    // Test 5: Graceful fallback khi tool không khả dụng (mock tool missing)
    // =========================================================================
    describe("Test 5: Graceful fallback khi tool không khả dụng (mock tool missing)", () => {
        it("khi pyftsubset không tồn tại: không ném lỗi, trả về HTML gốc kèm subsetStats.skipped = true", async () => {
            const html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap" rel="stylesheet">
                </head>
                <body><h1>Fallback Test</h1></body>
                </html>
            `;

            const res = await subsetFontsForHtml(html, {
                pyftsubsetPath: "/duong/dan/hoan/toan/khong/ton/tai/pyftsubset-missing",
            });

            // Không ném Exception
            assert.ok(res, "Phải trả về kết quả hợp lệ");
            assert.strictEqual(res.subsetStats.skipped, true, "Phải đánh dấu skipped = true");
            assert.strictEqual(res.subsetStats.reason, "pyftsubset_not_available");
            // HTML gốc phải được giữ nguyên
            assert.ok(res.html.includes("fonts.googleapis.com"), "Phải giữ nguyên font link ngoài khi công cụ thiếu");
        });

        it("khi cờ skip: true được bật: bỏ qua việc cắt font và trả về lý do skipped_by_options", async () => {
            const html = `<div>Skip test</div>`;
            const res = await subsetFontsForHtml(html, { skip: true });

            assert.strictEqual(res.subsetStats.skipped, true);
            assert.strictEqual(res.subsetStats.reason, "skipped_by_options");
            assert.strictEqual(res.html, html);
        });

        it("tích hợp assembleHTML: khi bật skipFontSubset = true thì comp giữ nguyên link font ngoài", async () => {
            const result = await assembleHTML(
                mockSampleScript,
                mockDurations,
                1920,
                1080,
                testTempDir,
                undefined,
                { skipFontSubset: true }
            );

            assert.match(result.htmlContent, /fonts\.googleapis\.com\/css2\?family=Inter/);
            assert.strictEqual(result.htmlContent.includes("lime-embedded-fonts"), false);
        });
    });

    // =========================================================================
    // Test 6: Offline render test (Playwright)
    // =========================================================================
    describe("Test 6: Offline render test (Playwright)", () => {
        it("chặn 100% request HTTP/HTTPS: comp HTML tự chứa nạp font Inter offline thành công mà không gọi ra ngoài", async () => {
            if (!browser) {
                console.warn("[Test 6] Bỏ qua test Playwright do không khởi động được browser");
                return;
            }

            // 1. Tạo comp tự chứa bằng assembleHTML (mặc định đã bật font subsetting)
            const result = await assembleHTML(
                mockSampleScript,
                mockDurations,
                1920,
                1080,
                testTempDir
            );

            // Kiểm tra comp đã được nhúng font subset
            assert.ok(result.htmlContent.includes('id="lime-embedded-fonts"'));
            assertNoExternalFontUrls(result.htmlContent);

            const context = await browser.newContext();
            const page = await context.newPage();

            const interceptedExternalRequests: string[] = [];

            // Thiết lập tường lửa chặn 100% kết nối mạng bên ngoài
            await page.route("**/*", (route) => {
                const url = route.request().url();
                // Chỉ cho phép data URI và local
                if (url.startsWith("data:") || url.startsWith("file://") || url === "about:blank") {
                    route.continue();
                } else {
                    interceptedExternalRequests.push(url);
                    route.abort("blockedbyclient");
                }
            });

            // Nạp nội dung HTML vào trang
            await page.setContent(result.htmlContent, { waitUntil: "load" });

            // 1. Xác nhận KHÔNG có bất kỳ request font ngoài nào trỏ tới Google Fonts / gstatic
            const fontRequests = interceptedExternalRequests.filter(
                (url) => url.includes("googleapis.com") || url.includes("gstatic.com") || url.includes("cdnfonts")
            );
            assert.strictEqual(
                fontRequests.length,
                0,
                `Không được có bất kỳ request nào gửi tới Google Fonts hoặc CDN font. Đã chặn: ${fontRequests.join(", ")}`
            );

            // 2. Chờ font được load qua document.fonts.ready
            await page.evaluate(async () => {
                if (document.fonts) {
                    await document.fonts.ready;
                }
            });

            // 3. Kiểm tra font status trong page context
            const fontLoaded = await page.evaluate(() => {
                const fonts = Array.from((document as any).fonts || []);
                const interFont = fonts.find((f: any) => f.family.includes("Inter"));
                return {
                    totalFonts: fonts.length,
                    hasInter: !!interFont,
                    interStatus: interFont ? (interFont as any).status : null,
                };
            });

            assert.ok(fontLoaded.hasInter, "Document phải nạp font Inter từ Embedded woff2");
            assert.strictEqual(fontLoaded.interStatus, "loaded", "Trạng thái font Inter phải là 'loaded'");

            // 4. Đo kích thước text tiếng Việt để chắc chắn typography render hợp lệ
            const textMetrics = await page.evaluate(() => {
                const h1 = document.querySelector(".banner h1");
                if (!h1) return null;
                const rect = h1.getBoundingClientRect();
                return {
                    text: h1.textContent,
                    width: rect.width,
                    height: rect.height,
                };
            });

            assert.ok(textMetrics !== null, "Phải tìm thấy thẻ heading");
            assert.ok(textMetrics.width > 0, "Heading phải có chiều rộng > 0");
            assert.ok(textMetrics.height > 0, "Heading phải có chiều cao > 0");

            await context.close();
        });
    });
});
