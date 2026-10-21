import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    resolvePeriod,
    computeSignups,
    computeRecurringRevenue,
    computeChurn,
    computeTrialToPaid,
    computeFeatureUsage,
    computePlanDistribution,
    computeAnalytics,
} from '../../src/admin/analytics.js';
import type { AdminUserRecord } from '../../src/admin/userStore.js';
import type { Order, Plan } from '../../src/billing/types.js';

const NOW = new Date('2026-01-31T12:00:00.000Z');

function user(over: Partial<AdminUserRecord> & { id: string }): AdminUserRecord {
    return {
        username: over.id,
        name: over.id,
        email: `${over.id}@lime.test`,
        role: 'user',
        tier: 'free',
        credits: 20,
        totalCredits: 20,
        creditPercent: 100,
        status: 'active',
        provider: 'local',
        createdAt: '2025-12-01T00:00:00.000Z',
        updatedAt: '2025-12-01T00:00:00.000Z',
        deletedAt: null,
        ...over,
    } as AdminUserRecord;
}

function order(over: Partial<Order> & { id: string; user_id: string }): Order {
    return {
        plan_id: 'pro',
        amount_vnd: 249000,
        pay_code: over.id,
        status: 'paid',
        expires_at: '2026-02-15T00:00:00.000Z',
        paid_at: '2025-12-15T00:00:00.000Z',
        created_at: '2025-12-15T00:00:00.000Z',
        ...over,
    } as Order;
}

const PLANS: Plan[] = [
    { id: 'creator', name: 'Sáng Tạo', price_vnd: 149000, quota_video: 50, days: 30, is_active: true },
    { id: 'pro', name: 'Pro', price_vnd: 249000, quota_video: 150, days: 30, is_active: true },
];

describe('Admin analytics engine', () => {
    it('resolvePeriod chuẩn hoá kỳ và mặc định 30d', () => {
        assert.equal(resolvePeriod('7d', NOW).days, 7);
        assert.equal(resolvePeriod('90d', NOW).days, 90);
        assert.equal(resolvePeriod('12m', NOW).days, 365);
        assert.equal(resolvePeriod('bogus', NOW).days, 30);
        assert.equal(resolvePeriod(undefined, NOW).days, 30);
        const window = resolvePeriod('30d', NOW);
        assert.equal(window.to.toISOString(), NOW.toISOString());
        assert.equal(window.from.getTime(), NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
    });

    it('computeSignups đếm đúng và trả chuỗi thời gian đủ nhãn', () => {
        const users = [
            user({ id: 'a', createdAt: '2026-01-05T00:00:00.000Z' }),
            user({ id: 'b', createdAt: '2026-01-05T09:00:00.000Z' }),
            user({ id: 'c', createdAt: '2026-01-20T00:00:00.000Z' }),
            user({ id: 'd', createdAt: '2025-12-01T00:00:00.000Z' }),
        ];
        const result = computeSignups(users, resolvePeriod('30d', NOW));
        assert.equal(result.total, 3);
        assert.equal(result.monthly, false);
        assert.equal(result.series.length, 31); // 30 ngày + hôm nay
        const jan5 = result.series.find((p) => p.date === '2026-01-05');
        assert.equal(jan5?.count, 2);
    });

    it('gộp theo tháng khi kỳ dài hơn 90 ngày', () => {
        const result = computeSignups([], resolvePeriod('12m', NOW));
        assert.equal(result.monthly, true);
        assert.ok(result.series.length >= 12);
    });

    it('computeRecurringRevenue quy đổi gói trả trước về giá trị tháng', () => {
        const users = [
            user({ id: 'a', planId: 'pro', planExpiresAt: '2026-02-15T00:00:00.000Z' }),
            user({ id: 'b', planId: 'creator', planExpiresAt: '2026-02-10T00:00:00.000Z' }),
            // Hết hạn → không tính
            user({ id: 'c', planId: 'pro', planExpiresAt: '2026-01-01T00:00:00.000Z' }),
            // Bị xoá → không tính
            user({ id: 'd', planId: 'pro', planExpiresAt: '2026-03-01T00:00:00.000Z', deletedAt: '2026-01-02T00:00:00.000Z' }),
        ];
        const result = computeRecurringRevenue(users, PLANS, NOW);
        assert.equal(result.activeSubscriptions, 2);
        assert.equal(result.mrrVnd, 249000 + 149000);
        assert.equal(result.arrVnd, (249000 + 149000) * 12);
    });

    it('computeChurn tính tỷ lệ rời bỏ của khách trả phí', () => {
        const orders = [
            // Phủ 2025-12-15 → 2026-01-14: đang hoạt động đầu kỳ và hết hạn trong kỳ ⇒ rời bỏ
            order({ id: 'o1', user_id: 'a', plan_id: 'pro', paid_at: '2025-12-15T00:00:00.000Z' }),
            // Phủ 2026-01-20 → 2026-02-19: mới trong kỳ, còn hạn ⇒ không rời bỏ
            order({ id: 'o2', user_id: 'b', plan_id: 'pro', paid_at: '2026-01-20T00:00:00.000Z' }),
        ];
        const result = computeChurn(orders, PLANS, resolvePeriod('30d', NOW));
        assert.equal(result.activeAtStart, 1);
        assert.equal(result.churned, 1);
        assert.equal(result.rate, 1);
    });

    it('computeChurn trả 0 khi không có khách nào ở đầu kỳ', () => {
        const result = computeChurn([], PLANS, resolvePeriod('30d', NOW));
        assert.equal(result.rate, 0);
        assert.equal(result.activeAtStart, 0);
    });

    it('computeTrialToPaid tính đúng tỷ lệ chuyển đổi và tỷ lệ toàn thời gian', () => {
        const users = [
            user({ id: 'freeOld', createdAt: '2025-11-01T00:00:00.000Z' }),
            user({ id: 'convOld', createdAt: '2025-11-02T00:00:00.000Z' }),
            user({ id: 'convNew', createdAt: '2026-01-10T00:00:00.000Z' }),
        ];
        const orders = [
            // convOld: trả phí lần đầu trong kỳ (đang free ở đầu kỳ ⇒ nằm trong trial pool)
            order({ id: 'o1', user_id: 'convOld', paid_at: '2026-01-08T00:00:00.000Z' }),
            // convNew: đăng ký trong kỳ rồi trả phí
            order({ id: 'o2', user_id: 'convNew', paid_at: '2026-01-25T00:00:00.000Z' }),
        ];
        const result = computeTrialToPaid(users, orders, resolvePeriod('30d', NOW));
        // trialPool = freeOld + convOld (free đầu kỳ) + convNew (đăng ký trong kỳ) = 3
        assert.equal(result.trialPool, 3);
        assert.equal(result.converted, 2);
        assert.equal(Number(result.rate.toFixed(4)), Number((2 / 3).toFixed(4)));
        assert.equal(result.payingCustomers, 2);
        assert.equal(result.totalUsers, 3);
    });

    it('computeFeatureUsage thống kê phân bố và mức độ dùng tính năng', () => {
        const jobs = [
            { request: { aspectRatio: '16:9', style: 'modern', ttsProvider: 'edge', blueprintId: 'cine-1', karaoke: true } },
            { request: { aspectRatio: '16:9', style: 'minimal', ttsProvider: 'vieneu', motionBlockIds: ['m1'] } },
            { request: { aspectRatio: '9:16', style: 'modern', ttsProvider: 'edge', watermark: { enabled: true } } },
        ];
        const result = computeFeatureUsage(jobs, [{ name: '/workspace', count: 10, percentage: 100 }]);
        assert.equal(result.totalJobs, 3);
        const aspect = result.dimensions.find((d) => d.key === 'aspectRatio');
        assert.equal(aspect?.items[0].name, '16:9');
        assert.equal(aspect?.items[0].count, 2);
        assert.equal(aspect?.items[0].percentage, 67);

        const blueprint = result.adoption.find((a) => a.name === 'Blueprint điện ảnh');
        assert.equal(blueprint?.count, 1);
        const motion = result.adoption.find((a) => a.name === 'Motion block');
        assert.equal(motion?.count, 1);
        const karaoke = result.adoption.find((a) => a.name === 'Phụ đề karaoke');
        assert.equal(karaoke?.count, 1);
        const watermark = result.adoption.find((a) => a.name === 'Watermark / Logo');
        assert.equal(watermark?.count, 1);
        assert.equal(result.topPages.length, 1);
    });

    it('computePlanDistribution tổng hợp cơ cấu gói đang hoạt động', () => {
        const users = [
            user({ id: 'a', planId: 'pro', planExpiresAt: '2026-02-15T00:00:00.000Z' }),
            user({ id: 'b', planId: 'pro', planExpiresAt: '2026-02-15T00:00:00.000Z' }),
            user({ id: 'c', planId: 'creator', planExpiresAt: '2026-02-15T00:00:00.000Z' }),
            // Gói đã hết hạn ⇒ không tính
            user({ id: 'd', planId: 'pro', planExpiresAt: '2026-01-01T00:00:00.000Z' }),
            // Không có gói ⇒ không tính
            user({ id: 'e' }),
            // Bị xoá ⇒ không tính
            user({ id: 'f', planId: 'pro', planExpiresAt: '2026-02-15T00:00:00.000Z', deletedAt: '2026-01-10T00:00:00.000Z' }),
        ];
        const dist = computePlanDistribution(users, PLANS, NOW);
        assert.equal(dist.length, 2);
        assert.deepEqual(dist.map((d) => d.planId), ['pro', 'creator']);
        assert.equal(dist[0].name, 'Pro');
        assert.equal(dist[0].count, 2);
        assert.equal(dist[0].percentage, 67);
        assert.equal(dist[0].mrrVnd, 249000 * 2);
        assert.equal(dist[1].count, 1);
        assert.equal(dist[1].mrrVnd, 149000);

        const result = computeAnalytics({ users, orders: [], plans: PLANS, jobs: [], period: '30d', now: NOW });
        assert.equal(result.plansDistribution[0].planId, 'pro');
    });

    it('computeAnalytics trả chỉ số kỳ liền trước (cùng độ dài) để so sánh xu hướng', () => {
        const users = [
            // Nằm trong kỳ trước [2025-12-02, 2026-01-01]
            user({ id: 'prev', createdAt: '2025-12-15T00:00:00.000Z' }),
            // Nằm trong kỳ hiện tại [2026-01-01, 2026-01-31]
            user({ id: 'cur', createdAt: '2026-01-05T00:00:00.000Z', planId: 'pro', planExpiresAt: '2026-02-15T00:00:00.000Z' }),
        ];
        const result = computeAnalytics({ users, orders: [], plans: PLANS, jobs: [], period: '30d', now: NOW });

        assert.equal(result.kpi.newSignups, 1);
        assert.equal(result.previous.kpi.newSignups, 1);
        // Kỳ trước kết thúc đúng lúc kỳ hiện tại bắt đầu
        assert.equal(result.previous.window.to, result.window.from);
        assert.equal(result.previous.window.days, 30);
        assert.ok(Date.parse(result.previous.window.from) < Date.parse(result.previous.window.to));
        // Bộ chỉ số kỳ trước phải ĐỐI XỨNG với kỳ hiện tại (thiếu khoá ⇒ thẻ KPI
        // trên dashboard không có delta).
        assert.deepEqual(
            Object.keys(result.previous.kpi).sort(),
            Object.keys(result.kpi).sort()
        );
        assert.equal(result.previous.kpi.arrVnd, result.previous.kpi.mrrVnd * 12);
    });

    it('computeAnalytics tổng hợp đầy đủ chỉ số và LTV dự phòng khi chưa có churn', () => {
        const users = [
            user({ id: 'a', createdAt: '2026-01-05T00:00:00.000Z' }),
            user({ id: 'b', createdAt: '2025-12-01T00:00:00.000Z' }),
        ];
        const orders = [
            // Một khách đã trả phí nhưng gói đã hết hạn (mrr=0), đủ để tính LTV dự phòng
            order({ id: 'o1', user_id: 'b', plan_id: 'pro', amount_vnd: 249000, paid_at: '2025-11-01T00:00:00.000Z' }),
        ];
        const result = computeAnalytics({
            users,
            orders,
            plans: PLANS,
            jobs: [{ request: { style: 'modern' } }],
            period: '30d',
            now: NOW,
        });
        assert.equal(result.period, '30d');
        assert.equal(result.kpi.newSignups, 1);
        assert.equal(result.kpi.mrrVnd, 0);
        // Không có churn ⇒ LTV = tổng doanh thu ÷ số khách trả phí = 249000
        assert.equal(result.ltvVnd, 249000);
        assert.equal(result.revenue.totalRevenueVnd, 249000);
        assert.equal(result.featureUsage.totalJobs, 1);
    });
});
