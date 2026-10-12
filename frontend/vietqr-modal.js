/**
 * LIME AI Video Studio — VietQR Payment Controller
 * Manages dynamic VietQR generation, countdown timer, copy-to-clipboard,
 * billing cycle toggles and payment verification simulation.
 */

(function initVietQR() {
    // Bank & Merchant Configuration
    const BANK_CONFIG = {
        bankId: 'MB', // MBBank (Ngân hàng Quân Đội)
        bankName: 'MBBank (Quân Đội)',
        accountNo: '0982618707',
        accountName: 'NGUYEN QUANG KHANH',
        template: 'compact2',
    };

    // Plan pricing details
    const PLAN_PRICES = {
        pro: {
            name: 'Gói Pro',
            monthly: 99000,
            yearly: 948000, // 79k/tháng x 12
            monthlyLabel: '99.000 đ',
            yearlyLabel: '948.000 đ',
            features: '200 token / tháng · Giọng đọc đa dạng · Brand kit & Chèn watermark riêng',
        },
        max: {
            name: 'Gói Max',
            monthly: 499000,
            yearly: 4788000, // 399k/tháng x 12
            monthlyLabel: '499.000 đ',
            yearlyLabel: '4.788.000 đ',
            features: 'Mở khoá toàn bộ giới hạn · Không giới hạn token · Chèn watermark riêng & 4K Turbo',
        }
    };

    let currentOrder = {
        code: '',
        plan: 'pro',
        cycle: 'month',
        amount: 99000,
        expireAt: 0,
        timerInterval: null
    };

    function getModal() {
        return document.getElementById('vietqr-modal');
    }

    function generateOrderCode() {
        // Format: LIME + 4 số ngẫu nhiên
        const rand = Math.floor(1000 + Math.random() * 9000);
        return `LIME ${rand}`;
    }

    function formatVND(amount) {
        return new Intl.NumberFormat('vi-VN').format(amount) + ' đ';
    }

    function getVietQRUrl(amount, orderCode) {
        const encodedMemo = encodeURIComponent(orderCode);
        const encodedName = encodeURIComponent(BANK_CONFIG.accountName);
        return `https://img.vietqr.io/image/${BANK_CONFIG.bankId}-${BANK_CONFIG.accountNo}-${BANK_CONFIG.template}.png?amount=${amount}&addInfo=${encodedMemo}&accountName=${encodedName}`;
    }

    function updateQRDisplay() {
        const qrImg = document.getElementById('vietqr-img');
        const amountEl = document.getElementById('vietqr-val-amount');
        const memoEl = document.getElementById('vietqr-val-memo');
        const orderCodeEl = document.getElementById('vietqr-order-code');

        if (!qrImg || !amountEl || !memoEl) return;

        const qrUrl = getVietQRUrl(currentOrder.amount, currentOrder.code);
        qrImg.style.opacity = '0.4';

        const temp = new Image();
        temp.onload = () => {
            qrImg.src = qrUrl;
            qrImg.style.opacity = '1';
        };
        temp.onerror = () => {
            qrImg.src = qrUrl;
            qrImg.style.opacity = '1';
        };
        temp.src = qrUrl;

        amountEl.textContent = formatVND(currentOrder.amount);
        amountEl.setAttribute('data-copy', currentOrder.amount.toString());

        memoEl.textContent = currentOrder.code;
        memoEl.setAttribute('data-copy', currentOrder.code);

        const accountEl = document.getElementById('vietqr-val-account');
        const nameEl = document.getElementById('vietqr-val-name');
        if (accountEl) {
            accountEl.textContent = BANK_CONFIG.accountNo;
            accountEl.setAttribute('data-copy', BANK_CONFIG.accountNo);
        }
        if (nameEl) {
            nameEl.textContent = BANK_CONFIG.accountName;
        }

        if (orderCodeEl) orderCodeEl.textContent = currentOrder.code;
    }

    function startTimer(durationSeconds = 900) {
        const timerText = document.getElementById('vietqr-timer-text');
        const timerPill = document.querySelector('.vietqr-timer-pill');
        if (!timerText) return;

        clearInterval(currentOrder.timerInterval);
        currentOrder.expireAt = Date.now() + durationSeconds * 1000;

        function updateTick() {
            const remain = Math.max(0, Math.floor((currentOrder.expireAt - Date.now()) / 1000));
            const m = Math.floor(remain / 60).toString().padStart(2, '0');
            const s = (remain % 60).toString().padStart(2, '0');
            timerText.textContent = `${m}:${s}`;

            if (timerPill) {
                if (remain <= 300) {
                    timerPill.classList.add('warning');
                } else {
                    timerPill.classList.remove('warning');
                }
            }

            if (remain <= 0) {
                clearInterval(currentOrder.timerInterval);
                timerText.textContent = 'Hết hạn';
            }
        }

        updateTick();
        currentOrder.timerInterval = setInterval(updateTick, 1000);
    }

    function switchCycle(cycle) {
        currentOrder.cycle = cycle;
        const plan = PLAN_PRICES[currentOrder.plan] || PLAN_PRICES.pro;
        currentOrder.amount = (cycle === 'year') ? plan.yearly : plan.monthly;

        const planMetaTitle = document.querySelector('.vietqr-plan-meta h3');
        const planMetaDesc = document.querySelector('.vietqr-plan-meta p');
        if (planMetaTitle) planMetaTitle.textContent = `✦ ${plan.name}`;
        if (planMetaDesc) planMetaDesc.textContent = plan.features;

        document.querySelectorAll('.vietqr-cycle-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-cycle') === cycle);
        });

        updateQRDisplay();
    }

    function copyToClipboard(text, btnEl) {
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
            if (btnEl) {
                btnEl.classList.add('copied');
                setTimeout(() => btnEl.classList.remove('copied'), 1500);
            }
        }).catch(() => {
            // Fallback
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            if (btnEl) {
                btnEl.classList.add('copied');
                setTimeout(() => btnEl.classList.remove('copied'), 1500);
            }
        });
    }

    function openModal(options = {}) {
        const modal = getModal();
        if (!modal) return;

        // Reset views
        const grid = modal.querySelector('.vietqr-body-grid');
        const success = modal.querySelector('.vietqr-success-card');
        const submitBtn = document.getElementById('vietqr-submit-btn');

        if (grid) grid.style.display = 'grid';
        if (success) success.style.display = 'none';
        if (submitBtn) {
            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;
        }

        // Initialize state
        currentOrder.plan = (options.plan === 'max') ? 'max' : 'pro';
        currentOrder.code = options.code || generateOrderCode();
        const initialCycle = options.cycle || (document.querySelector('.bill-toggle span.on')?.getAttribute('data-period') === 'year' ? 'year' : 'month');

        switchCycle(initialCycle);
        startTimer(900); // 15 phút

        modal.classList.add('show');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        const modal = getModal();
        if (!modal) return;
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
        clearInterval(currentOrder.timerInterval);
        document.body.style.overflow = '';
    }

    function handlePaymentConfirmation() {
        const submitBtn = document.getElementById('vietqr-submit-btn');
        const modal = getModal();
        if (!submitBtn || !modal) return;

        submitBtn.classList.add('loading');
        submitBtn.disabled = true;

        // Simulate banking webhook verification
        setTimeout(() => {
            const grid = modal.querySelector('.vietqr-body-grid');
            const success = modal.querySelector('.vietqr-success-card');
            const successPlanName = document.getElementById('vietqr-success-plan-name');
            const successCode = document.getElementById('vietqr-success-code');

            if (grid) grid.style.display = 'none';
            if (success) success.style.display = 'flex';

            if (successPlanName) {
                const plan = PLAN_PRICES[currentOrder.plan] || PLAN_PRICES.pro;
                successPlanName.textContent = currentOrder.cycle === 'year' ? `${plan.name} (1 Năm)` : `${plan.name} (1 Tháng)`;
            }
            if (successCode) {
                successCode.textContent = currentOrder.code;
            }

            clearInterval(currentOrder.timerInterval);
        }, 1200);
    }

    function downloadQR() {
        const qrImg = document.getElementById('vietqr-img');
        if (!qrImg || !qrImg.src) return;

        const a = document.createElement('a');
        a.href = qrImg.src;
        a.download = `VietQR-${currentOrder.code.replace(/\s+/g, '_')}.png`;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    function bindEvents() {
        const modal = getModal();
        if (!modal) return;

        // Close handlers
        const closeBtn = document.getElementById('vietqr-close-btn');
        if (closeBtn) closeBtn.addEventListener('click', closeModal);

        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });

        // Cycle toggle inside modal
        document.querySelectorAll('.vietqr-cycle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const cycle = btn.getAttribute('data-cycle');
                if (cycle) switchCycle(cycle);
            });
        });

        // Copy buttons
        modal.querySelectorAll('.vietqr-copy-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const targetId = btn.getAttribute('data-target');
                const targetEl = document.getElementById(targetId);
                const textToCopy = targetEl ? (targetEl.getAttribute('data-copy') || targetEl.textContent.trim()) : '';
                copyToClipboard(textToCopy, btn);
            });
        });

        // Download button
        const dlBtn = document.getElementById('vietqr-download-btn');
        if (dlBtn) dlBtn.addEventListener('click', downloadQR);

        // Submit confirmation button
        const submitBtn = document.getElementById('vietqr-submit-btn');
        if (submitBtn) submitBtn.addEventListener('click', handlePaymentConfirmation);

        // Success proceed button
        const successBtn = document.getElementById('vietqr-success-btn');
        if (successBtn) {
            successBtn.addEventListener('click', () => {
                closeModal();
                if (typeof window.goStudio === 'function') {
                    window.goStudio();
                } else {
                    const studioBtn = document.getElementById('nav-studio-btn') || document.querySelector('a[href="#studio"]');
                    if (studioBtn) studioBtn.click();
                    else window.location.href = '/workspace.html';
                }
            });
        }

        // Attach to Pricing Plan buttons
        document.querySelectorAll('[data-plan="pro"], [data-plan="creator"], .plan.hot .plan-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openModal({ plan: 'pro' });
            });
        });

        document.querySelectorAll('[data-plan="max"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openModal({ plan: 'max' });
            });
        });

        // Keyboard ESC to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('show')) {
                closeModal();
            }
        });
    }

    // Export globally
    window.openVietQRModal = openModal;
    window.closeVietQRModal = closeModal;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindEvents);
    } else {
        bindEvents();
    }
})();
