/**
 * Analytics engine cho bảng điều khiển (Dashboard) của cổng quản trị.
 *
 * Toàn bộ hàm ở đây là **pure** (không truy cập DB/Redis): nhận dữ liệu thô
 * (`users`, `orders`, `plans`, `jobs`) và trả về các chỉ số SaaS. Nhờ vậy có thể
 * kiểm thử bằng fixture mà không cần PostgreSQL/Redis.
 *
 * Bối cảnh nghiệp vụ: gói cước là **trả trước theo thời hạn** (`plans.days`),
 * không tự động gia hạn. Một khách được coi là "rời bỏ" (churn) khi thời gian
 * phủ của lần thanh toán cuối cùng kết thúc trong kỳ mà không có giao dịch mới.
 */

import type { Order, Plan } from "../billing/types.js";
import type { AdminUserRecord } from "./userStore.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Số ngày của từng kỳ phân tích hợp lệ. */
const PERIOD_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90, "12m": 365 };
const DEFAULT_PERIOD = "30d";
/** Kỳ dùng để quy đổi LTV = ARPU ÷ churn tháng. */
const MONTHLY_WINDOW_DAYS = 30;

export type AnalyticsPeriod = "7d" | "30d" | "90d" | "12m";

export interface AnalyticsWindow {
    from: Date;
    to: Date;
    days: number;
}

/** Một điểm dữ liệu theo thời gian (ngày hoặc tháng). */
export interface TimePoint {
    date: string;
    count: number;
}

/** Một mục trong bảng xếp hạng phân bố tính năng. */
export interface DistributionItem {
    name: string;
    count: number;
    percentage: number;
}

/** Một chiều phân tích tính năng (ví dụ: "Tỷ lệ khung hình"). */
export interface FeatureDimension {
    key: string;
    label: string;
    items: DistributionItem[];
}

/**
 * Chỉ số của kỳ liền trước (cùng độ dài, kết thúc đúng lúc kỳ hiện tại bắt đầu).
 * Dùng để hiển thị mức tăng/giảm trên thẻ KPI.
 */
export interface AnalyticsPrevious {
    window: { from: string; to: string; days: number };
    kpi: {
        newSignups: number;
        activeSubscriptions: number;
        mrrVnd: number;
        arrVnd: number;
        arpuVnd: number;
        ltvVnd: number;
        churnRate: number;
        trialToPaidRate: number;
    };
}

/** Một phần trong cơ cấu gói cước đang hoạt động (nguồn cho biểu đồ tròn). */
export interface PlanDistributionItem {
    planId: string;
    name: string;
    count: number;
    mrrVnd: number;
    percentage: number;
}

export interface FeatureUsageResult {
    totalJobs: number;
    dimensions: FeatureDimension[];
    /** Số job đã bật từng tính năng tùy chọn (blueprint, motion block, karaoke, watermark). */
    adoption: DistributionItem[];
    /** Trang/tính năng được truy cập nhiều nhất (nguồn: page views). */
    topPages: DistributionItem[];
}

/** Đối tượng job tối thiểu mà analytics cần (khớp `JobRecord` của queue). */
export interface AnalyticsJob {
    status?: string;
    request?: {
        aspectRatio?: string;
        style?: string;
        ttsProvider?: string;
        blueprintId?: string;
        motionBlockIds?: string[];
        karaoke?: unknown;
        watermark?: unknown;
    } | null;
}

export interface ComputeAnalyticsInput {
    users: AdminUserRecord[];
    orders: Order[];
    plans: Plan[];
    jobs: AnalyticsJob[];
    /** Danh sách trang truy cập nhiều nhất (từ pageViewTracker.getStats(period).topPages). */
    topPages?: DistributionItem[];
    period?: string;
    now?: Date;
}

export interface AnalyticsResult {
    period: AnalyticsPeriod;
    window: { from: string; to: string; days: number };
    /** Tổng hợp nhanh dùng cho các thẻ KPI. */
    kpi: {
        newSignups: number;
        activeSubscriptions: number;
        mrrVnd: number;
        arrVnd: number;
        arpuVnd: number;
        ltvVnd: number;
        churnRate: number;
        trialToPaidRate: number;
    };
    signups: {
        total: number;
        series: TimePoint[];
        /** true ⇒ series gộp theo tháng, false ⇒ theo ngày. */
        monthly: boolean;
    };
    revenue: {
        mrrVnd: number;
        arrVnd: number;
        totalRevenueVnd: number;
        paidOrders: number;
        payingCustomers: number;
        activeSubscriptions: number;
    };
    arpuVnd: number;
    ltvVnd: number;
    churn: {
        rate: number;
        monthlyRate: number;
        churned: number;
        activeAtStart: number;
    };
    conversion: {
        rate: number;
        allTimeRate: number;
        converted: number;
        trialPool: number;
        payingCustomers: number;
        totalUsers: number;
    };
    featureUsage: FeatureUsageResult;
    /** Chỉ số kỳ liền trước (cùng độ dài) để so sánh xu hướng. */
    previous: AnalyticsPrevious;
    /** Cơ cấu gói cước đang hoạt động. */
    plansDistribution: PlanDistributionItem[];
}

/** Chuẩn hoá kỳ phân tích; kỳ không hợp lệ rơi về `30d`. */
export function resolvePeriod(period: string | undefined, now: Date = new Date()): AnalyticsWindow {
    const key = period && PERIOD_DAYS[period] ? period : DEFAULT_PERIOD;
    const days = PERIOD_DAYS[key];
    const to = new Date(now.getTime());
    const from = new Date(now.getTime() - days * MS_PER_DAY);
    return { from, to, days };
}

function toMs(value?: string | null): number | null {
    if (!value) return null;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
}

/** Map planId → số ngày hiệu lực (mặc định 30 khi không tra được gói). */
function buildPlanDaysMap(plans: Plan[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const plan of plans) {
        map.set(plan.id, Number(plan.days) > 0 ? Number(plan.days) : MONTHLY_WINDOW_DAYS);
    }
    return map;
}

/** Map planId → giá gói (VNĐ). */
function buildPlanPriceMap(plans: Plan[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const plan of plans) {
        map.set(plan.id, Number(plan.price_vnd) || 0);
    }
    return map;
}

function planDaysFor(planDays: Map<string, number>, planId?: string | null): number {
    if (planId && planDays.has(planId)) return planDays.get(planId)!;
    return MONTHLY_WINDOW_DAYS;
}

/** Dịch cửa sổ thời gian về trước (mặc định đúng bằng độ dài của nó). */
function shiftWindowBack(window: AnalyticsWindow, days: number = window.days): AnalyticsWindow {
    const to = new Date(window.from.getTime());
    const from = new Date(to.getTime() - days * MS_PER_DAY);
    return { from, to, days };
}

/** Tổng doanh thu đã thanh toán (tuỳ chọn: chỉ tính giao dịch trước một mốc thời gian). */
function sumPaidRevenue(orders: Order[], beforeMs?: number): number {
    let total = 0;
    for (const order of orders) {
        if (order.status !== "paid") continue;
        const ms = toMs(order.paid_at) ?? toMs(order.created_at);
        if (ms === null) continue;
        if (beforeMs !== undefined && ms > beforeMs) continue;
        total += Number(order.amount_vnd) || 0;
    }
    return total;
}

/** Số khách đã từng trả phí (tuỳ chọn: chỉ tính giao dịch trước một mốc thời gian). */
function countPayingCustomers(orders: Order[], beforeMs?: number): number {
    const ids = new Set<string>();
    for (const order of orders) {
        if (order.status !== "paid") continue;
        const ms = toMs(order.paid_at) ?? toMs(order.created_at);
        if (ms === null) continue;
        if (beforeMs !== undefined && ms > beforeMs) continue;
        ids.add(order.user_id);
    }
    return ids.size;
}

/** Sinh đủ nhãn thời gian cho một kỳ (để biểu đồ không bị hụt ngày không có dữ liệu). */
function buildBuckets(window: AnalyticsWindow): { keys: string[]; monthly: boolean } {
    const monthly = window.days > 90;
    const keys: string[] = [];
    if (monthly) {
        const cursor = new Date(Date.UTC(window.from.getUTCFullYear(), window.from.getUTCMonth(), 1));
        while (cursor.getTime() <= window.to.getTime()) {
            keys.push(cursor.toISOString().slice(0, 7));
            cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        }
    } else {
        const startOfDay = Date.UTC(window.from.getUTCFullYear(), window.from.getUTCMonth(), window.from.getUTCDate());
        for (let i = 0; i <= window.days; i++) {
            keys.push(new Date(startOfDay + i * MS_PER_DAY).toISOString().slice(0, 10));
        }
    }
    return { keys, monthly };
}

function bucketKey(iso: string, monthly: boolean): string {
    return monthly ? iso.slice(0, 7) : iso.slice(0, 10);
}

/** Đếm số người đăng ký mới trong kỳ kèm chuỗi thời gian. */
export function computeSignups(
    users: AdminUserRecord[],
    window: AnalyticsWindow
): { total: number; series: TimePoint[]; monthly: boolean } {
    const { keys, monthly } = buildBuckets(window);
    const counts = new Map<string, number>(keys.map((k) => [k, 0]));
    const fromMs = window.from.getTime();
    const toMsValue = window.to.getTime();
    let total = 0;

    for (const user of users) {
        const ms = toMs(user.createdAt);
        if (ms === null || ms < fromMs || ms > toMsValue) continue;
        total += 1;
        const key = bucketKey(new Date(ms).toISOString(), monthly);
        if (counts.has(key)) counts.set(key, counts.get(key)! + 1);
    }

    return { total, series: keys.map((date) => ({ date, count: counts.get(date)! })), monthly };
}

/** Doanh thu định kỳ: gói trả trước được quy đổi về giá trị tháng (30 ngày). */
export function computeRecurringRevenue(
    users: AdminUserRecord[],
    plans: Plan[],
    now: Date
): { mrrVnd: number; arrVnd: number; activeSubscriptions: number } {
    const planPrices = buildPlanPriceMap(plans);
    const planDays = buildPlanDaysMap(plans);
    const nowMs = now.getTime();
    let mrr = 0;
    let active = 0;

    for (const user of users) {
        if (user.status !== "active" || user.deletedAt) continue;
        if (!user.planId) continue;
        const expiresMs = toMs(user.planExpiresAt);
        if (expiresMs === null || expiresMs <= nowMs) continue;
        const price = planPrices.get(user.planId) ?? 0;
        const days = planDaysFor(planDays, user.planId);
        mrr += price * (MONTHLY_WINDOW_DAYS / days);
        active += 1;
    }

    const mrrVnd = Math.round(mrr);
    return { mrrVnd, arrVnd: mrrVnd * 12, activeSubscriptions: active };
}

/** Dựng thời gian phủ của từng người trả phí từ các đơn đã thanh toán. */
function buildSubscriberCoverage(orders: Order[], plans: Plan[]): Map<string, { starts: number[]; ends: number[] }> {
    const planDays = buildPlanDaysMap(plans);
    const byUser = new Map<string, { starts: number[]; ends: number[] }>();

    for (const order of orders) {
        if (order.status !== "paid") continue;
        const startMs = toMs(order.paid_at) ?? toMs(order.created_at);
        if (startMs === null) continue;
        const days = planDaysFor(planDays, order.plan_id);
        const endMs = startMs + days * MS_PER_DAY;
        const entry = byUser.get(order.user_id) ?? { starts: [], ends: [] };
        entry.starts.push(startMs);
        entry.ends.push(endMs);
        byUser.set(order.user_id, entry);
    }

    return byUser;
}

/**
 * Tỷ lệ rời bỏ của khách trả phí trong `window`.
 *
 * - `activeAtStart`: số khách có thời gian phủ bao trùm thời điểm bắt đầu kỳ.
 * - `churned`: số khách có lần kết thúc thời gian phủ cuối cùng nằm trong kỳ.
 * - `rate = churned / activeAtStart`.
 */
export function computeChurn(
    orders: Order[],
    plans: Plan[],
    window: AnalyticsWindow
): { rate: number; churned: number; activeAtStart: number } {
    const coverage = buildSubscriberCoverage(orders, plans);
    const fromMs = window.from.getTime();
    const toMsValue = window.to.getTime();
    let activeAtStart = 0;
    let churned = 0;

    for (const { starts, ends } of coverage.values()) {
        let lastEnd = 0;
        let active = false;
        for (let i = 0; i < starts.length; i++) {
            const start = starts[i];
            const end = ends[i];
            if (end > lastEnd) lastEnd = end;
            if (start <= fromMs && end >= fromMs) active = true;
        }
        if (active) activeAtStart += 1;
        if (lastEnd >= fromMs && lastEnd <= toMsValue) churned += 1;
    }

    const rate = activeAtStart > 0 ? churned / activeAtStart : 0;
    return { rate, churned, activeAtStart };
}

/**
 * Tỷ lệ chuyển đổi dùng thử → trả phí trong kỳ.
 *
 * `trialPool` = người dùng đang miễn phí ở đầu kỳ (đã đăng ký trước kỳ và chưa
 * từng thanh toán) + người đăng ký mới trong kỳ. `converted` = người có giao dịch
 * trả phí **đầu tiên** trong kỳ.
 */
export function computeTrialToPaid(
    users: AdminUserRecord[],
    orders: Order[],
    window: AnalyticsWindow
): {
    rate: number;
    allTimeRate: number;
    converted: number;
    trialPool: number;
    payingCustomers: number;
    totalUsers: number;
} {
    const fromMs = window.from.getTime();
    const toMsValue = window.to.getTime();
    const firstPaidAt = new Map<string, number>();
    const payingUsers = new Set<string>();

    for (const order of orders) {
        if (order.status !== "paid") continue;
        const paidMs = toMs(order.paid_at) ?? toMs(order.created_at);
        if (paidMs === null) continue;
        payingUsers.add(order.user_id);
        const prev = firstPaidAt.get(order.user_id);
        if (prev === undefined || paidMs < prev) firstPaidAt.set(order.user_id, paidMs);
    }

    let converted = 0;
    let freeAtStart = 0;
    let signupsInPeriod = 0;

    for (const user of users) {
        const createdMs = toMs(user.createdAt);
        if (createdMs === null) continue;
        const firstPaid = firstPaidAt.get(user.id);
        const createdInPeriod = createdMs >= fromMs && createdMs <= toMsValue;

        if (createdInPeriod) {
            signupsInPeriod += 1;
        }

        // Ở đầu kỳ vẫn là khách miễn phí (chưa từng trả phí trước kỳ).
        if (createdMs < fromMs && (firstPaid === undefined || firstPaid >= fromMs)) {
            freeAtStart += 1;
        }

        if (firstPaid !== undefined && firstPaid >= fromMs && firstPaid <= toMsValue) {
            converted += 1;
        }
    }

    const trialPool = freeAtStart + signupsInPeriod;
    const rate = trialPool > 0 ? converted / trialPool : 0;
    const totalUsers = users.length;
    const payingCustomers = payingUsers.size;
    const allTimeRate = totalUsers > 0 ? payingCustomers / totalUsers : 0;

    return { rate, allTimeRate, converted, trialPool, payingCustomers, totalUsers };
}

/** Phân bố theo một trường của job (aspect ratio, style, TTS provider...). */
function distributionBy(jobs: AnalyticsJob[], extract: (job: AnalyticsJob) => string | undefined, labelMap?: Record<string, string>): DistributionItem[] {
    const counts = new Map<string, number>();
    let total = 0;
    for (const job of jobs) {
        const raw = extract(job);
        if (!raw) continue;
        total += 1;
        counts.set(raw, (counts.get(raw) || 0) + 1);
    }
    return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({
            name: labelMap?.[name] || name,
            count,
            percentage: total > 0 ? Math.round((count / total) * 100) : 0,
        }));
}

function isEnabled(value: unknown): boolean {
    if (value === undefined || value === null) return false;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value.trim() !== "" && value !== "0" && value.toLowerCase() !== "false";
    return true;
}

/** Thống kê "chức năng nào được dùng nhiều" từ các job đã tạo. */
export function computeFeatureUsage(jobs: AnalyticsJob[], topPages: DistributionItem[] = []): FeatureUsageResult {
    const totalJobs = jobs.length;

    const dimensions: FeatureDimension[] = [
        {
            key: "aspectRatio",
            label: "Tỷ lệ khung hình",
            items: distributionBy(jobs, (j) => j.request?.aspectRatio),
        },
        {
            key: "style",
            label: "Phong cách hình ảnh",
            items: distributionBy(jobs, (j) => j.request?.style),
        },
        {
            key: "ttsProvider",
            label: "Nhà cung cấp giọng đọc (TTS)",
            items: distributionBy(jobs, (j) => j.request?.ttsProvider, { edge: "Edge (miễn phí)", vieneu: "VieNeu-TTS" }),
        },
    ];

    const adoptionDefs: Array<{ name: string; test: (job: AnalyticsJob) => boolean }> = [
        { name: "Blueprint điện ảnh", test: (j) => isEnabled(j.request?.blueprintId) },
        { name: "Motion block", test: (j) => Array.isArray(j.request?.motionBlockIds) && j.request!.motionBlockIds!.length > 0 },
        { name: "Phụ đề karaoke", test: (j) => isEnabled(j.request?.karaoke) },
        { name: "Watermark / Logo", test: (j) => isEnabled(j.request?.watermark) },
    ];

    const adoption = adoptionDefs.map((def) => {
        let count = 0;
        for (const job of jobs) {
            if (def.test(job)) count += 1;
        }
        return {
            name: def.name,
            count,
            percentage: totalJobs > 0 ? Math.round((count / totalJobs) * 100) : 0,
        };
    });

    return { totalJobs, dimensions, adoption, topPages };
}

/**
 * Cơ cấu gói cước đang hoạt động — cùng tiêu chí với `computeRecurringRevenue`:
 * chỉ tính người dùng đang hoạt động, chưa bị xoá và gói còn hạn.
 */
export function computePlanDistribution(
    users: AdminUserRecord[],
    plans: Plan[],
    now: Date
): PlanDistributionItem[] {
    const planNames = new Map<string, string>();
    for (const plan of plans) planNames.set(plan.id, plan.name || plan.id);

    const planPrices = buildPlanPriceMap(plans);
    const planDays = buildPlanDaysMap(plans);
    const nowMs = now.getTime();
    const buckets = new Map<string, { count: number; mrrVnd: number }>();
    let total = 0;

    for (const user of users) {
        if (user.status !== "active" || user.deletedAt) continue;
        if (!user.planId) continue;
        const expiresMs = toMs(user.planExpiresAt);
        if (expiresMs === null || expiresMs <= nowMs) continue;

        const price = planPrices.get(user.planId) ?? 0;
        const days = planDaysFor(planDays, user.planId);
        const entry = buckets.get(user.planId) ?? { count: 0, mrrVnd: 0 };
        entry.count += 1;
        entry.mrrVnd += price * (MONTHLY_WINDOW_DAYS / days);
        buckets.set(user.planId, entry);
        total += 1;
    }

    return Array.from(buckets.entries())
        .map(([planId, entry]) => ({
            planId,
            name: planNames.get(planId) ?? planId,
            count: entry.count,
            mrrVnd: Math.round(entry.mrrVnd),
            percentage: total > 0 ? Math.round((entry.count / total) * 100) : 0,
        }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Tổng hợp tất cả chỉ số cho bảng điều khiển. */
export function computeAnalytics(input: ComputeAnalyticsInput): AnalyticsResult {
    const now = input.now ?? new Date();
    const window = resolvePeriod(input.period, now);
    const period = (input.period && PERIOD_DAYS[input.period] ? input.period : DEFAULT_PERIOD) as AnalyticsPeriod;

    const signups = computeSignups(input.users, window);
    const revenue = computeRecurringRevenue(input.users, input.plans, now);
    const arpuVnd = revenue.activeSubscriptions > 0 ? Math.round(revenue.mrrVnd / revenue.activeSubscriptions) : 0;

    const churn = computeChurn(input.orders, input.plans, window);
    const monthlyWindow = resolvePeriod("30d", now);
    const monthlyChurn = computeChurn(input.orders, input.plans, monthlyWindow).rate;

    const conversion = computeTrialToPaid(input.users, input.orders, window);

    const totalRevenueVnd = sumPaidRevenue(input.orders);
    const paidOrders = input.orders.filter((o) => o.status === "paid").length;

    // LTV = ARPU ÷ churn tháng; khi chưa có churn thì fallback về doanh thu lịch sử / số khách trả phí.
    const ltvVnd =
        monthlyChurn > 0
            ? Math.round(arpuVnd / monthlyChurn)
            : conversion.payingCustomers > 0
              ? Math.round(totalRevenueVnd / conversion.payingCustomers)
              : 0;

    // ---- Kỳ liền trước (cùng độ dài) để so sánh xu hướng ----
    // MRR/activeSubscriptions là chỉ số thời điểm nên "kỳ trước" = trạng thái tại
    // thời điểm kỳ hiện tại bắt đầu. Churn tháng của kỳ trước lấy cửa sổ 30 ngày
    // kết thúc ngay trước kỳ hiện tại, đúng như công thức LTV đang dùng.
    const previousWindow = shiftWindowBack(window);
    const previousSignups = computeSignups(input.users, previousWindow).total;
    const previousRevenue = computeRecurringRevenue(input.users, input.plans, previousWindow.to);
    const previousArpuVnd =
        previousRevenue.activeSubscriptions > 0
            ? Math.round(previousRevenue.mrrVnd / previousRevenue.activeSubscriptions)
            : 0;
    const previousMonthlyChurn = computeChurn(input.orders, input.plans, shiftWindowBack(monthlyWindow)).rate;
    const previousChurn = computeChurn(input.orders, input.plans, previousWindow);
    const previousConversion = computeTrialToPaid(input.users, input.orders, previousWindow);
    const revenueAsOfPeriodStart = sumPaidRevenue(input.orders, window.from.getTime());
    const payingAsOfPeriodStart = countPayingCustomers(input.orders, window.from.getTime());
    const previousLtvVnd =
        previousMonthlyChurn > 0
            ? Math.round(previousArpuVnd / previousMonthlyChurn)
            : payingAsOfPeriodStart > 0
              ? Math.round(revenueAsOfPeriodStart / payingAsOfPeriodStart)
              : 0;

    const featureUsage = computeFeatureUsage(input.jobs, input.topPages);

    return {
        period,
        window: { from: window.from.toISOString(), to: window.to.toISOString(), days: window.days },
        kpi: {
            newSignups: signups.total,
            activeSubscriptions: revenue.activeSubscriptions,
            mrrVnd: revenue.mrrVnd,
            arrVnd: revenue.arrVnd,
            arpuVnd,
            ltvVnd,
            churnRate: churn.rate,
            trialToPaidRate: conversion.rate,
        },
        signups,
        revenue: {
            mrrVnd: revenue.mrrVnd,
            arrVnd: revenue.arrVnd,
            totalRevenueVnd,
            paidOrders,
            payingCustomers: conversion.payingCustomers,
            activeSubscriptions: revenue.activeSubscriptions,
        },
        arpuVnd,
        ltvVnd,
        churn: {
            rate: churn.rate,
            monthlyRate: monthlyChurn,
            churned: churn.churned,
            activeAtStart: churn.activeAtStart,
        },
        conversion,
        featureUsage,
        previous: {
            window: {
                from: previousWindow.from.toISOString(),
                to: previousWindow.to.toISOString(),
                days: previousWindow.days,
            },
            kpi: {
                newSignups: previousSignups,
                activeSubscriptions: previousRevenue.activeSubscriptions,
                mrrVnd: previousRevenue.mrrVnd,
                arrVnd: previousRevenue.arrVnd,
                arpuVnd: previousArpuVnd,
                ltvVnd: previousLtvVnd,
                churnRate: previousChurn.rate,
                trialToPaidRate: previousConversion.rate,
            },
        },
        plansDistribution: computePlanDistribution(input.users, input.plans, now),
    };
}
