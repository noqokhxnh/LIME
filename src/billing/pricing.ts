import type { BillingCycle, Plan } from './types.js';

/**
 * Chiết khấu khi trả trọn năm (20% ⇒ trả 12 tháng, tính tiền 9,6 tháng).
 *
 * Giá năm được tính từ `plans.price_vnd` (giá tháng) thay vì hard-code để
 * admin đổi giá tháng trong trang quản trị là giá năm tự cập nhật theo.
 */
export const YEARLY_DISCOUNT = 0.2;

/** Số tháng của một chu kỳ năm. */
export const YEARLY_MONTHS = 12;

/** Số ngày cộng vào hạn gói khi mua gói năm. */
export const YEARLY_DAYS = 365;

/**
 * Giá một tháng khi trả trọn năm: giảm 20% rồi làm tròn xuống nghìn đồng
 * (99.000 → 79.000; 499.000 → 399.000) để khớp số niêm yết trên bảng giá.
 */
export function yearlyMonthlyPrice(monthlyPriceVnd: number): number {
    const discounted = Math.round((monthlyPriceVnd * (1 - YEARLY_DISCOUNT)) / 1000) * 1000;
    return Math.max(1000, discounted);
}

/** Tổng tiền phải chuyển cho một chu kỳ. */
export function cycleAmount(monthlyPriceVnd: number, cycle: BillingCycle): number {
    return cycle === 'year' ? yearlyMonthlyPrice(monthlyPriceVnd) * YEARLY_MONTHS : monthlyPriceVnd;
}

export interface CycleEntitlement {
    /** Số tiền phải chuyển (VND). */
    amount: number;
    /** Số ngày cộng vào hạn gói khi thanh toán thành công. */
    days: number;
    /** Số credit/video cộng vào tài khoản khi thanh toán thành công. */
    quota: number;
}

/**
 * Quy đổi (gói, chu kỳ) thành số tiền + quyền lợi được cộng khi thanh toán.
 *
 * Gói năm cộng 365 ngày và quota gấp 12 lần gói tháng — nhờ vậy webhook chỉ
 * cần đọc `order.cycle` là kích hoạt đúng, kể cả khi admin sửa giá/quota gói
 * sau lúc đơn được tạo.
 */
export function resolveCycleEntitlement(plan: Plan, cycle: BillingCycle): CycleEntitlement {
    if (cycle === 'year') {
        return {
            amount: cycleAmount(plan.price_vnd, 'year'),
            days: YEARLY_DAYS,
            quota: plan.quota_video * YEARLY_MONTHS,
        };
    }
    return {
        amount: plan.price_vnd,
        days: plan.days,
        quota: plan.quota_video,
    };
}

/** Chuẩn hoá giá trị chu kỳ nhận từ client/DB về đúng 2 giá trị hợp lệ. */
export function normalizeCycle(value: unknown): BillingCycle {
    return value === 'year' ? 'year' : 'month';
}
