import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    countEffectiveWords,
    calculatePunctuationPauseSec,
    estimateTextDuration,
    estimateSceneDuration,
    estimateSceneDurations,
    estimateDuration,
    estimateScriptDuration,
} from '../../src/pipeline/estimateDuration.js';
import { type videoScript, type scene } from '../../src/llm/schema.js';

describe('Module 4: Duration Estimation Algorithm (src/pipeline/estimateDuration.ts)', () => {
    describe('TC-DUR-001: Đếm từ Tiếng Việt và Tiếng Anh tiêu chuẩn', () => {
        it('phải đếm chính xác số từ Tiếng Việt và loại bỏ dấu câu ở biên', () => {
            const text1 = 'Trí tuệ nhân tạo thay đổi thế giới.';
            // 8 âm tiết/từ tiếng Việt: Trí, tuệ, nhân, tạo, thay, đổi, thế, giới
            assert.strictEqual(countEffectiveWords(text1, 'vi'), 8);

            const textWith7Words = 'Công nghệ AI giúp tạo video nhanh.';
            assert.strictEqual(countEffectiveWords(textWith7Words, 'vi'), 7);

            const textWithPunctuation = '“Học lập trình, sáng tạo tương lai!”';
            // 7 từ: Học, lập, trình, sáng, tạo, tương, lai
            assert.strictEqual(countEffectiveWords(textWithPunctuation, 'vi'), 7);
        });

        it('phải đếm chính xác số từ Tiếng Anh tiêu chuẩn', () => {
            const text2 = 'Artificial intelligence is transforming the modern digital world.';
            assert.strictEqual(countEffectiveWords(text2, 'en'), 8);
        });

        it('phải bỏ qua các token chỉ toàn ký tự đặc biệt', () => {
            const textWithSymbols = 'Xin chào -- *** bạn @#$ nhé!';
            // Các token sạch: "Xin", "chào", "bạn", "nhé" -> 4 từ
            assert.strictEqual(countEffectiveWords(textWithSymbols, 'vi'), 4);
        });
    });

    describe('TC-DUR-002: Đếm ký tự cho ngôn ngữ tượng hình CJK (ja, zh, ko)', () => {
        it('phải đếm số ký tự không tính khoảng trắng cho Tiếng Nhật (ja)', () => {
            const jaText = 'こんにちは 世界';
            // "こんにちは" (5) + "世界" (2) = 7 ký tự
            assert.strictEqual(countEffectiveWords(jaText, 'ja'), 7);
        });

        it('phải đếm số ký tự cho Tiếng Trung (zh)', () => {
            const zhText = '人工智能 改变世界';
            // "人工智能" (4) + "改变世界" (4) = 8 ký tự
            assert.strictEqual(countEffectiveWords(zhText, 'zh'), 8);
        });

        it('phải đếm số ký tự cho Tiếng Hàn (ko)', () => {
            const koText = '안녕하세요 세계';
            // "안녕하세요" (5) + "세계" (2) = 7 ký tự
            assert.strictEqual(countEffectiveWords(koText, 'ko'), 7);
        });
    });

    describe('TC-DUR-003: Xử lý số và trọng số phát âm của chuỗi số', () => {
        it('phải áp dụng trọng số phát âm (hệ số 1.2) cho các chuỗi số', () => {
            // "Năm" (1 từ) + "2026" (4 chữ số => Math.ceil(4 * 1.2) = 5 từ) = 6 từ
            const text = 'Năm 2026';
            assert.strictEqual(countEffectiveWords(text, 'vi'), 6);
        });

        it('phải tính toán đúng cho số có độ dài khác nhau', () => {
            // "Số" (1 từ) + "9" (1 chữ số => Math.max(1, Math.ceil(1 * 1.2)) = 2 từ) = 3 từ
            assert.strictEqual(countEffectiveWords('Số 9', 'vi'), 3);

            // "Năm" (1 từ) + "100" (3 chữ số => Math.ceil(3 * 1.2) = 4 từ) = 5 từ
            assert.strictEqual(countEffectiveWords('Năm 100', 'vi'), 5);
        });
    });

    describe('TC-DUR-004: Tính toán thời gian nghỉ theo dấu câu (Punctuation Pauses)', () => {
        it('phải tính 0.35s cho mỗi nhóm dấu câu lớn (. ! ? : ;)', () => {
            const text = 'Một. Hai! Ba? Bốn: Năm;';
            // 5 nhóm dấu câu lớn: 5 * 0.35 = 1.75
            assert.strictEqual(calculatePunctuationPauseSec(text), 1.75);
        });

        it('phải tính 0.2s cho mỗi nhóm dấu câu nhỏ (, — – …)', () => {
            const text = 'Một, hai — ba – bốn… năm,';
            // 5 nhóm dấu câu nhỏ: 5 * 0.2 = 1.0
            const pause = calculatePunctuationPauseSec(text);
            assert.strictEqual(Math.round(pause * 100) / 100, 1.0);
        });

        it('phải tính toán chính xác khi kết hợp cả dấu câu lớn và nhỏ', () => {
            const text = 'Xin chào! Bạn khỏe không? Tôi rất vui, thật sự.';
            // Dấu lớn: '!', '?', '.' => 3 * 0.35 = 1.05s
            // Dấu nhỏ: ',' => 1 * 0.2 = 0.20s
            // Tổng: 1.25s
            const pause = calculatePunctuationPauseSec(text);
            assert.strictEqual(Math.round(pause * 100) / 100, 1.25);
        });

        it('phải trả về 0 nếu không có dấu câu nào', () => {
            assert.strictEqual(calculatePunctuationPauseSec('Không có dấu câu nào ở đây'), 0);
        });
    });

    describe('TC-DUR-005: Ràng buộc ngưỡng thời lượng tối thiểu và khoảng đệm scene', () => {
        it('phải áp dụng thời lượng tối thiểu DEFAULT_MIN_SCENE_DURATION_SEC (2.5s) cho scene ngắn', () => {
            // Text chỉ có 1 từ ngắn, tính toán thực tế < 2.5s => phải trả về 2.5s
            const duration = estimateTextDuration('Chào.');
            assert.strictEqual(duration, 2.5);
        });

        it('phải tính toán chính xác khi thời lượng vượt ngưỡng tối thiểu', () => {
            // Một đoạn văn dài với nhiều từ
            const longText =
                'Trí tuệ nhân tạo đang tạo ra bước ngoặt lớn trong lịch sử công nghệ của toàn nhân loại. ' +
                'Các mô hình ngôn ngữ lớn và công cụ tạo video tự động mở ra kỷ nguyên số hoàn toàn mới cho tất cả mọi người.';
            const duration = estimateTextDuration(longText, { language: 'vi', wpm: 165 });

            assert.ok(duration > 2.5, 'Thời lượng đoạn dài phải vượt quá 2.5s');
            // Kiểm tra làm tròn đến 1 chữ số thập phân
            assert.strictEqual(duration, Math.round(duration * 10) / 10);
        });

        it('phải tôn trọng các options tùy chỉnh: minSceneDurationSec, scenePaddingSec, wpm', () => {
            // Tùy chỉnh minDuration = 5s
            const customMin = estimateTextDuration('Chào bạn', { minSceneDurationSec: 5 });
            assert.strictEqual(customMin, 5);

            // Tùy chỉnh padding = 2.0s
            const customPadding = estimateTextDuration('Một hai ba bốn năm sáu bảy tám chín mười mười một mười hai', {
                scenePaddingSec: 2.0,
            });
            assert.ok(customPadding > 5);
        });
    });

    describe('TC-DUR-006: Xử lý chuỗi rỗng hoặc chỉ có khoảng trắng', () => {
        it('phải trả về thời lượng tối thiểu khi chuỗi rỗng', () => {
            assert.strictEqual(estimateTextDuration(''), 2.5);
        });

        it('phải trả về thời lượng tối thiểu khi chuỗi chỉ toàn khoảng trắng', () => {
            assert.strictEqual(estimateTextDuration('     \n\t  '), 2.5);
        });

        it('phải trả về 0 từ khi gọi countEffectiveWords trên chuỗi rỗng', () => {
            assert.strictEqual(countEffectiveWords('', 'vi'), 0);
            assert.strictEqual(countEffectiveWords('   ', 'en'), 0);
            assert.strictEqual(countEffectiveWords('', 'ja'), 0);
        });
    });

    describe('TC-DUR-007: Tổng hợp thời lượng kịch bản và phân rã chi tiết (Breakdown)', () => {
        const mockScenes: scene[] = [
            {
                id: 'sc-1',
                title: 'Scene Mở Đầu',
                voiceOverText: 'Chào mừng các bạn đến với công nghệ video tự động hóa.',
                visualDescription: 'Logo hiện ra',
                htmlCode: '<div>Intro</div>',
                cssCode: 'div {}',
                jsCode: '',
                transition: 'fade',
                backgroundColor: '#000',
            },
            {
                id: 'sc-2',
                title: 'Scene Nội Dung Chính',
                voiceOverText:
                    'Hệ thống kết hợp sức mạnh của trí tuệ nhân tạo và kỹ thuật đồ họa GSAP hiện đại nhất.',
                visualDescription: 'Biểu đồ chuyển động',
                htmlCode: '<div>Content</div>',
                cssCode: 'div {}',
                jsCode: '',
                transition: 'slide-left',
                backgroundColor: '#111',
            },
            {
                id: 'sc-3',
                title: 'Scene Kết Thúc',
                voiceOverText: 'Hãy bắt đầu trải nghiệm ngay hôm nay!',
                visualDescription: 'Call to action',
                htmlCode: '<div>Outro</div>',
                cssCode: 'div {}',
                jsCode: '',
                transition: 'zoom-in',
                backgroundColor: '#222',
            },
        ];

        const mockScript: videoScript = {
            id: 'test-script-01',
            title: 'Kịch Bản Test',
            description: 'Kịch bản kiểm thử ước lượng thời lượng',
            globalStyles: '',
            globalSetupJs: '',
            scenes: mockScenes,
            colorPalette: {
                primary: '#fff',
                secondary: '#eee',
                accent: '#ddd',
                background: '#000',
                text: '#fff',
            },
            fontFamily: 'Inter',
        };

        it('phải ước lượng đúng thời lượng cho từng scene qua estimateSceneDuration', () => {
            const dur1 = estimateSceneDuration(mockScenes[0]);
            assert.ok(dur1 >= 2.5, 'Thời lượng scene 1 phải >= 2.5s');

            const durMap = estimateSceneDurations(mockScenes);
            assert.strictEqual(Object.keys(durMap).length, 3);
            assert.strictEqual(durMap['sc-1'], dur1);
            assert.ok(durMap['sc-2'] > 0);
            assert.ok(durMap['sc-3'] > 0);
        });

        it('phải tổng hợp thời lượng toàn bộ kịch bản và cung cấp mảng breakdown chi tiết', () => {
            const result = estimateDuration(mockScript);

            // Kiểm tra map sceneDurations
            assert.strictEqual(Object.keys(result.sceneDurations).length, 3);
            assert.ok(result.sceneDurations['sc-1'] > 0);
            assert.ok(result.sceneDurations['sc-2'] > 0);
            assert.ok(result.sceneDurations['sc-3'] > 0);

            // Kiểm tra mảng breakdown
            assert.strictEqual(result.breakdown.length, 3);
            assert.strictEqual(result.breakdown[0].sceneId, 'sc-1');
            assert.strictEqual(result.breakdown[0].title, 'Scene Mở Đầu');
            assert.ok(result.breakdown[0].wordCount > 0);
            assert.strictEqual(result.breakdown[0].durationSec, result.sceneDurations['sc-1']);

            // Kiểm tra tổng thời lượng
            const calculatedTotal =
                result.sceneDurations['sc-1'] +
                result.sceneDurations['sc-2'] +
                result.sceneDurations['sc-3'];
            const roundedCalculatedTotal = Math.round(calculatedTotal * 10) / 10;
            assert.strictEqual(result.totalDurationSec, roundedCalculatedTotal);

            // Kiểm tra alias estimateScriptDuration
            assert.strictEqual(estimateScriptDuration, estimateDuration);
        });
    });
});
