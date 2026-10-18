/* =====================================================================
 * Support Widget — widget nổi "Hỗ trợ" cho mọi trang người dùng LIME.
 *
 * Tính năng:
 *  - Tạo yêu cầu hỗ trợ mới (báo lỗi / yêu cầu tính năng / ...) kèm tối đa
 *    3 ảnh chụp màn hình được upload qua POST /api/support/attachments.
 *  - Xem danh sách yêu cầu của mình, mở hội thoại, trả lời thêm.
 *  - Nhận phản hồi từ Admin ngay trong widget (ghi chú nội bộ của Admin
 *    không bao giờ hiện cho người dùng).
 *
 * Kiểu viết:
 *  - IIFE tự chứa, không phụ thuộc thư viện bên ngoài.
 *  - Mọi nội dung động đều chèn bằng textContent / createElement
 *    (nội dung do người dùng/admin nhập không bao giờ chạy innerHTML).
 * ===================================================================== */
(function () {
    'use strict';

    if (window.__limeSupportWidget) return;
    window.__limeSupportWidget = true;

    var ROOT_ID = 'lime-support-root';

    var TICKET_STATUSES = {
        open: 'Mới',
        in_progress: 'Đang xử lý',
        waiting_user: 'Chờ phản hồi',
        resolved: 'Đã giải quyết',
        closed: 'Đã đóng'
    };

    var TICKET_CATEGORIES = {
        bug: 'Báo lỗi',
        feature_request: 'Đề xuất tính năng',
        billing: 'Thanh toán & gói cước',
        account: 'Tài khoản',
        render: 'Trình dựng video',
        refund: 'Hoàn tiền',
        other: 'Khác'
    };

    var REFUND_STATUS = {
        pending: 'Chờ xử lý',
        approved: 'Đã duyệt',
        rejected: 'Bị từ chối',
        refunded: 'Đã hoàn tiền'
    };

    var MAX_FILES = 3;

    function createEl(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function svg(name) {
        var ns = 'http://www.w3.org/2000/svg';
        var el = document.createElementNS(ns, 'svg');
        el.setAttribute('width', '17');
        el.setAttribute('height', '17');
        el.setAttribute('viewBox', '0 0 24 24');
        el.setAttribute('fill', 'none');
        el.setAttribute('stroke', 'currentColor');
        el.setAttribute('stroke-width', '2');
        el.setAttribute('stroke-linecap', 'round');
        el.setAttribute('stroke-linejoin', 'round');
        var d = {
            chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
            back: 'M19 12H5M12 19l-7-7 7-7'
        }[name];
        if (!d) return el;
        var path = document.createElementNS(ns, 'path');
        path.setAttribute('d', d);
        el.appendChild(path);
        return el;
    }

    function formatTime(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        try {
            return new Intl.DateTimeFormat('vi-VN', {
                hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit'
            }).format(d);
        } catch (e) {
            return d.toLocaleString();
        }
    }

    function formatDay(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        try {
            return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
        } catch (e) {
            return d.toLocaleDateString();
        }
    }

    function formatVnd(amount) {
        var n = Number(amount) || 0;
        try {
            return new Intl.NumberFormat('vi-VN').format(n) + ' ₫';
        } catch (e) {
            return n + ' ₫';
        }
    }

    /** Che số tài khoản, chỉ giữ 4 số cuối (giống cách cổng quản trị hiển thị). */
    function maskAccount(acc) {
        var digits = String(acc || '').replace(/\D/g, '');
        if (digits.length <= 4) return '***' + digits;
        return '***' + digits.slice(-4);
    }

    /** Nội dung context.refund của một ticket (nếu có). */
    function refundOf(ticket) {
        return (ticket && ticket.context && ticket.context.refund) || null;
    }

    /**
     * Tải danh sách giao dịch + danh mục ngân hàng cho form hoàn tiền (chỉ một lần).
     *
     * Fail thì để nguyên cờ `loaded = false` để lần mở sau thử lại, tránh khoá cứng
     * giao diện khi mạng chập chờn.
     */
    async function ensureRefundOptions() {
        if (state.refundOptionsLoaded || state.refundOptionsLoading) return;
        state.refundOptionsLoading = true;
        var res = await Promise.all([
            api('/api/billing/orders?status=all'),
            api('/api/billing/banks')
        ]);
        state.refundOptionsLoading = false;

        if (!res[0].ok || !res[1].ok) {
            state.error = (res[0].data && res[0].data.error) || 'Không tải được danh sách giao dịch.';
            if (state.view === 'new') render();
            return;
        }

        state.refundOrders = res[0].data.orders || [];
        state.refundBanks = res[1].data.banks || [];
        state.refundOptionsLoaded = true;
        if (state.view === 'new' && state.newCategory === 'refund') render();
    }

    var state = {
        view: 'idle',      // idle | list | listLoading | new | detail | detailLoading
        tickets: [],
        current: null,     // ticket kèm messages
        files: [],         // ảnh đã upload: { url, name }
        error: '',
        notice: '',
        busy: false,
        // Form tạo mới: giữ nội dung đang nhập khi giao diện vẽ lại (đổi danh mục,
        // tải ảnh lỗi…) để người dùng không mất công gõ lại.
        newCategory: 'bug',
        newSubject: '',
        newBody: '',
        // Danh mục "Hoàn tiền"
        refundOptionsLoading: false,
        refundOptionsLoaded: false,
        refundOrders: null,     // giao dịch của chính người dùng (kèm cờ refundable)
        refundBanks: null,      // danh mục ngân hàng hỗ trợ nhận tiền hoàn
        refundOrderId: '',
        refundBankCode: '',
        refundAccount: '',
        refundHolder: ''
    };

    var root, panelBody, panel, toggleBtn;

    /* ── Khởi tạo cấu trúc gốc ─────────────────────────────────────── */

    function ensureRoot() {
        if (document.getElementById(ROOT_ID)) return document.getElementById(ROOT_ID);
        root = createEl('div', 'lime-support-root');
        root.id = ROOT_ID;

        toggleBtn = createEl('button', 'lime-support-toggle');
        toggleBtn.type = 'button';
        toggleBtn.appendChild(svg('chat'));
        toggleBtn.appendChild(createEl('span', null, 'Hỗ trợ'));
        toggleBtn.addEventListener('click', function () {
            root.classList.toggle('lime-support-open');
            if (root.classList.contains('lime-support-open')) {
                openList();
            }
        });

        panel = createEl('div', 'lime-support-panel');

        var head = createEl('div', 'lime-support-head');
        var title = createEl('div', 'lime-support-head-title');
        title.appendChild(createEl('span', 'lime-support-dot'));
        title.appendChild(createEl('span', null, 'Hỗ trợ LIME'));
        head.appendChild(title);

        var closeBtn = createEl('button', 'lime-support-close', '✕');
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Đóng hỗ trợ');
        closeBtn.addEventListener('click', function () {
            root.classList.remove('lime-support-open');
        });
        head.appendChild(closeBtn);

        panelBody = createEl('div', 'lime-support-body');

        panel.appendChild(head);
        panel.appendChild(panelBody);

        root.appendChild(toggleBtn);
        root.appendChild(panel);
        return root;
    }

    function setBodyClass(cls) {
        panelBody.classList.remove('lime-support-body--list', 'lime-support-body--detail');
        if (cls) panelBody.classList.add(cls);
    }

    function noticeNode(text, cls) {
        return createEl('div', cls, text);
    }

    /* ── Gọi API ───────────────────────────────────────────────────── */

    async function api(path, options) {
        var opts = Object.assign({ credentials: 'include' }, options || {});
        if (opts.body && typeof opts.body !== 'string') {
            opts.body = JSON.stringify(opts.body);
            opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
        }
        var res = await fetch(path, opts);
        var data = null;
        try { data = await res.json(); } catch (e) { /* no body */ }
        return { status: res.status, ok: res.ok, data: data };
    }

    /* ── Danh sách yêu cầu ─────────────────────────────────────────── */

    async function openList() {
        if (state.busy) return;
        state.state_reset_view = null;
        state.view = 'listLoading';
        state.error = '';
        state.notice = '';
        render();

        var res = await api('/api/support/tickets?limit=50&page=1');
        if (res.status === 401) {
            state.view = 'login';
        } else if (res.ok) {
            state.tickets = res.data.items || [];
            state.view = 'list';
        } else {
            state.view = 'list';
            state.error = (res.data && res.data.error) || 'Không tải được danh sách yêu cầu.';
        }
        render();
    }

    function renderTicketItem(t) {
        var item = createEl('button', 'lime-support-item');
        item.type = 'button';

        var top = createEl('div', 'lime-support-item-top');
        top.appendChild(createEl('span', 'lime-support-item-code', t.code));
        top.appendChild(createEl('span',
            'lime-support-badge lime-support-badge--status lime-support-badge--' + t.status,
            TICKET_STATUSES[t.status] || t.status));
        var refund = refundOf(t);
        if (refund) {
            top.appendChild(createEl('span',
                'lime-support-badge lime-support-badge--refund-' + refund.status,
                'Hoàn tiền: ' + (REFUND_STATUS[refund.status] || refund.status)));
        }
        item.appendChild(top);

        item.appendChild(createEl('div', 'lime-support-item-subject', t.subject));

        var meta = createEl('div', 'lime-support-item-meta');
        var cat = createEl('span', null, (TICKET_CATEGORIES[t.category] || t.category));
        meta.appendChild(cat);
        meta.appendChild(createEl('span', null, '·'));
        meta.appendChild(createEl('span', null, 'Cập nhật ' + formatTime(t.lastMessageAt)));
        item.appendChild(meta);

        item.addEventListener('click', function () { openDetail(t.id); });
        return item;
    }

    function renderList() {
        setBodyClass('lime-support-body--list');

        var head = createEl('div', 'lime-support-empty');
        head.style.padding = '18px 15px 10px';
        head.style.alignItems = 'flex-start';
        head.style.textAlign = 'left';
        head.appendChild(createEl('div', 'lime-support-item-subject',
            'Gặp lỗi hoặc cần hỗ trợ? Báo chúng tôi ngay tại đây — kèm ảnh chụp màn hình để xử lý nhanh hơn.'));
        var newBtn = createEl('button', 'lime-support-btn lime-support-btn--primary', '+ Yêu cầu mới');
        newBtn.type = 'button';
        newBtn.addEventListener('click', function () {
            state.view = 'new';
            state.files = [];
            state.error = '';
            state.newCategory = 'bug';
            render();
        });
        head.appendChild(newBtn);
        panelBody.appendChild(head);

        if (state.error) {
            panelBody.appendChild(noticeNode(state.error, 'lime-support-msg-error'));
        }

        if (!state.tickets.length) {
            var empty = createEl('div', 'lime-support-empty');
            empty.appendChild(svg('chat'));
            empty.appendChild(createEl('div', null, 'Bạn chưa có yêu cầu nào. Mọi yêu cầu sẽ được xem và phản hồi bởi đội ngũ LIME.'));
            panelBody.appendChild(empty);
            return;
        }

        var list = createEl('div', 'lime-support-list');
        for (var i = 0; i < state.tickets.length; i++) list.appendChild(renderTicketItem(state.tickets[i]));
        panelBody.appendChild(list);
    }

    function renderLogin() {
        setBodyClass(null);
        var box = createEl('div', 'lime-support-empty');
        box.appendChild(svg('chat'));
        box.appendChild(createEl('div', 'lime-support-item-subject', 'Đăng nhập để tiếp tục'));
        box.appendChild(createEl('div', null, 'Bạn cần đăng nhập để gửi và theo dõi yêu cầu hỗ trợ.'));
        var loginBtn = createEl('a', 'lime-support-btn lime-support-btn--primary', 'Đăng nhập');
        loginBtn.href = '/';
        box.appendChild(loginBtn);
        panelBody.appendChild(box);
    }

    /* ── Form tạo mới ──────────────────────────────────────────────── */

    /** Nhãn một giao dịch trong ô chọn của form hoàn tiền. */
    function refundOrderLabel(o) {
        var parts = [o.planName || o.planId || 'Giao dịch', formatVnd(o.amountVnd), o.payCode];
        if (o.createdAt) parts.push(formatDay(o.createdAt));
        var label = parts.join(' · ');
        if (o.refundStatus === 'pending' || o.refundStatus === 'approved') {
            label += ' — đang chờ xử lý hoàn tiền';
        } else if (o.refundStatus === 'refunded') {
            label += ' — đã hoàn tiền';
        } else if (o.status === 'paid') {
            label += ' — đã thanh toán thành công, không hoàn được';
        } else {
            label += ' — giao dịch chưa xử lý';
        }
        return label;
    }

    /** Ô chọn giao dịch lỗi cần hoàn tiền. */
    function buildRefundOrderSelect() {
        var sel = createEl('select');
        var orders = state.refundOrders || [];
        var refundable = orders.filter(function (o) { return o.refundable; });

        var placeholder = createEl('option', null,
            refundable.length ? '— Chọn giao dịch —' : 'Không có giao dịch nào đủ điều kiện hoàn tiền');
        placeholder.value = '';
        sel.appendChild(placeholder);

        orders.forEach(function (o) {
            var opt = createEl('option', null, refundOrderLabel(o));
            opt.value = o.id;
            if (!o.refundable) opt.disabled = true;
            if (o.id === state.refundOrderId) opt.selected = true;
            sel.appendChild(opt);
        });

        sel.addEventListener('change', function () {
            state.refundOrderId = sel.value;
            var chosen = orders.filter(function (o) { return o.id === sel.value; })[0];
            // Điền sẵn tiêu đề cho gõ nhanh; người dùng vẫn sửa được.
            var subjectInput = document.getElementById('lime-support-subject');
            if (subjectInput && chosen) {
                var auto = 'Yêu cầu hoàn tiền giao dịch ' + chosen.payCode;
                if (!subjectInput.value.trim() || subjectInput.value.indexOf('Yêu cầu hoàn tiền giao dịch') === 0) {
                    subjectInput.value = auto;
                    state.newSubject = auto;
                }
            }
        });
        return sel;
    }

    /** Các ô chỉ xuất hiện khi chọn danh mục "Hoàn tiền". */
    function buildRefundFields(form) {
        var box = createEl('div', 'lime-support-refund');
        box.appendChild(createEl('div', 'lime-support-refund-title', 'Thông tin nhận tiền hoàn'));
        box.appendChild(createEl('div', 'lime-support-hint',
            'Chỉ hoàn tiền cho giao dịch lỗi hoặc chưa được xử lý. Giao dịch đã thanh toán thành công và đã kích hoạt gói thì không thể hoàn tiền.'));

        if (!state.refundOptionsLoaded) {
            box.appendChild(createEl('div', 'lime-support-hint', 'Đang tải danh sách giao dịch...'));
            form.appendChild(box);
            ensureRefundOptions();
            return { orderSelect: null, bankSelect: null, accountInput: null, holderInput: null };
        }

        var orderWrap = createEl('label');
        orderWrap.appendChild(createEl('span', null, 'Giao dịch lỗi cần hoàn tiền'));
        var orderSelect = buildRefundOrderSelect();
        orderWrap.appendChild(orderSelect);
        box.appendChild(orderWrap);

        var accountWrap = createEl('label');
        accountWrap.appendChild(createEl('span', null, 'Số tài khoản nhận tiền'));
        var accountInput = createEl('input');
        accountInput.type = 'text';
        accountInput.inputMode = 'numeric';
        accountInput.autocomplete = 'off';
        accountInput.maxLength = 30;
        accountInput.placeholder = 'VD: 0011002233445';
        accountInput.value = state.refundAccount;
        accountInput.addEventListener('input', function () { state.refundAccount = accountInput.value; });
        accountWrap.appendChild(accountInput);
        box.appendChild(accountWrap);

        var bankWrap = createEl('label');
        bankWrap.appendChild(createEl('span', null, 'Ngân hàng nhận tiền'));
        var bankSelect = createEl('select');
        var bankPlaceholder = createEl('option', null, '— Chọn ngân hàng —');
        bankPlaceholder.value = '';
        bankSelect.appendChild(bankPlaceholder);
        (state.refundBanks || []).forEach(function (b) {
            var opt = createEl('option', null, b.name);
            opt.value = b.code;
            if (b.code === state.refundBankCode) opt.selected = true;
            bankSelect.appendChild(opt);
        });
        bankSelect.addEventListener('change', function () { state.refundBankCode = bankSelect.value; });
        bankWrap.appendChild(bankSelect);
        box.appendChild(bankWrap);

        var holderWrap = createEl('label');
        holderWrap.appendChild(createEl('span', null, 'Chủ tài khoản'));
        holderWrap.appendChild(createEl('span', 'lime-support-hint', 'Không bắt buộc — giúp chuyển khoản chính xác hơn'));
        var holderInput = createEl('input');
        holderInput.type = 'text';
        holderInput.maxLength = 100;
        holderInput.placeholder = 'VD: NGUYEN VAN A';
        holderInput.value = state.refundHolder;
        holderInput.addEventListener('input', function () { state.refundHolder = holderInput.value; });
        holderWrap.appendChild(holderInput);
        box.appendChild(holderWrap);

        form.appendChild(box);
        return { orderSelect: orderSelect, bankSelect: bankSelect, accountInput: accountInput, holderInput: holderInput };
    }

    function renderNew() {
        setBodyClass(null);

        var back = createEl('button', 'lime-support-back');
        back.type = 'button';
        back.appendChild(svg('back'));
        back.appendChild(createEl('span', null, 'Danh sách yêu cầu'));
        back.addEventListener('click', openList);
        panelBody.appendChild(back);

        var form = createEl('div', 'lime-support-form');
        var isRefund = state.newCategory === 'refund';

        var catWrap = createEl('label');
        catWrap.appendChild(createEl('span', null, 'Danh mục'));
        var cat = createEl('select');
        Object.keys(TICKET_CATEGORIES).forEach(function (key) {
            var opt = createEl('option', null, TICKET_CATEGORIES[key]);
            opt.value = key;
            if (key === state.newCategory) opt.selected = true;
            cat.appendChild(opt);
        });
        catWrap.appendChild(cat);
        form.appendChild(catWrap);

        var refundFields = { orderSelect: null, bankSelect: null, accountInput: null, holderInput: null };
        if (isRefund) {
            refundFields = buildRefundFields(form);

            // Mở sẵn từ Hồ sơ (openRefund): điền tiêu đề theo giao dịch đã chọn.
            if (state.refundOrderId && !state.newSubject) {
                var pre = (state.refundOrders || []).filter(function (o) { return o.id === state.refundOrderId; })[0];
                if (pre) state.newSubject = 'Yêu cầu hoàn tiền giao dịch ' + pre.payCode;
            }
        }

        cat.addEventListener('change', function () {
            state.newCategory = cat.value;
            render();
        });

        var subjectWrap = createEl('label');
        subjectWrap.appendChild(createEl('span', null, 'Tiêu đề'));
        subjectWrap.appendChild(createEl('span', 'lime-support-hint', '5 – 200 ký tự, nêu rõ vấn đề'));
        var subject = createEl('input');
        subject.type = 'text';
        subject.id = 'lime-support-subject';
        subject.maxLength = 200;
        subject.placeholder = isRefund
            ? 'VD: Yêu cầu hoàn tiền giao dịch LIME-XXXX'
            : 'VD: Không tải được video đã dựng';
        subject.value = state.newSubject;
        subject.addEventListener('input', function () { state.newSubject = subject.value; });
        subjectWrap.appendChild(subject);
        form.appendChild(subjectWrap);

        var bodyWrap = createEl('label');
        bodyWrap.appendChild(createEl('span', null, isRefund ? 'Lý do hoàn tiền' : 'Mô tả chi tiết'));
        bodyWrap.appendChild(createEl('span', 'lime-support-hint', isRefund
            ? 'Bạn đã chuyển khoản lúc nào, giao dịch lỗi ra sao?'
            : 'Bạn gặp lỗi gì, lúc nào, bước tái hiện?'));
        var body = createEl('textarea');
        body.maxLength = 5000;
        body.placeholder = isRefund
            ? 'VD: Tôi chuyển khoản đúng nội dung nhưng đơn vẫn báo chưa thanh toán...'
            : 'Mô tả lỗi hoặc nhu cầu của bạn...';
        body.value = state.newBody;
        body.addEventListener('input', function () { state.newBody = body.value; });
        bodyWrap.appendChild(body);
        form.appendChild(bodyWrap);

        // Ảnh đính kèm
        var fileWrap = createEl('label');
        fileWrap.appendChild(createEl('span', null, isRefund
            ? 'Ảnh chụp màn hình đã chuyển tiền (không bắt buộc)'
            : 'Ảnh đính kèm (tối đa ' + MAX_FILES + ')'));
        fileWrap.appendChild(createEl('span', 'lime-support-hint', 'PNG / JPG / WEBP, mỗi ảnh ≤ 5MB'));

        var fileRow = createEl('div', 'lime-support-file-row');
        var fileInput = createEl('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/png,image/jpeg,image/webp,image/svg+xml';
        fileInput.style.display = 'none';
        fileRow.appendChild(fileInput);

        var uploadBtn = createEl('button', 'lime-support-btn', '📎 Chọn ảnh');
        uploadBtn.type = 'button';
        uploadBtn.appendChild(fileInput);
        uploadBtn.addEventListener('click', function () { fileInput.click(); });
        fileRow.appendChild(uploadBtn);

        var pillBox = createEl('div');
        fileRow.appendChild(pillBox);
        var syncPills = function () {
            pillBox.textContent = '';
            state.files.forEach(function (f, idx) {
                var pill = createEl('span', 'lime-support-file-pill');
                pill.appendChild(createEl('span', 'name', f.name || f.url.split('/').pop()));
                var rm = createEl('button', 'rm', '✕');
                rm.type = 'button';
                rm.addEventListener('click', function () {
                    state.files.splice(idx, 1);
                    syncPills();
                });
                pill.appendChild(rm);
                pillBox.appendChild(pill);
            });
            uploadBtn.disabled = state.files.length >= MAX_FILES;
        };
        fileWrap.appendChild(fileRow);
        form.appendChild(fileWrap);

        var errBox = createEl('div');
        form.appendChild(errBox);
        syncPills();

        var showError = function (message) {
            errBox.textContent = '';
            errBox.appendChild(noticeNode(message, 'lime-support-msg-error'));
        };

        fileInput.addEventListener('change', async function () {
            var file = fileInput.files && fileInput.files[0];
            fileInput.value = '';
            if (!file) return;
            if (state.files.length >= MAX_FILES) {
                showError('Tối đa ' + MAX_FILES + ' ảnh đính kèm.');
                return;
            }
            uploadBtn.disabled = true;
            var fd = new FormData();
            fd.append('file', file);
            var res = await api('/api/support/attachments', { method: 'POST', body: fd });
            uploadBtn.disabled = false;
            if (res.ok && res.data && res.data.url) {
                state.files.push({ url: res.data.url, name: file.name });
                syncPills();
            } else {
                showError((res.data && res.data.error) || 'Không tải được ảnh lên.');
            }
        });

        var submit = createEl('button', 'lime-support-btn lime-support-btn--primary', 'Gửi yêu cầu');
        submit.type = 'button';
        submit.disabled = state.busy;
        form.appendChild(submit);

        submit.addEventListener('click', async function () {
            errBox.textContent = '';
            var s = subject.value.trim();
            var b = body.value.trim();
            if (s.length < 5) { showError('Tiêu đề cần ít nhất 5 ký tự.'); return; }
            if (b.length < 5) { showError('Nội dung cần ít nhất 5 ký tự.'); return; }

            var payload = {
                subject: s,
                body: b,
                category: cat.value,
                attachments: state.files,
                context: { url: window.location.href, userAgent: navigator.userAgent }
            };

            if (cat.value === 'refund') {
                var orderId = refundFields.orderSelect ? refundFields.orderSelect.value : '';
                var bankCode = refundFields.bankSelect ? refundFields.bankSelect.value : '';
                var account = refundFields.accountInput ? refundFields.accountInput.value.trim() : '';
                var holder = refundFields.holderInput ? refundFields.holderInput.value.trim() : '';

                if (!orderId) {
                    showError(state.refundOptionsLoaded
                        ? 'Chọn giao dịch lỗi cần hoàn tiền (chỉ giao dịch chưa xử lý mới hoàn được).'
                        : 'Đang tải danh sách giao dịch, vui lòng thử lại sau ít giây.');
                    return;
                }
                if (!/^[0-9]{6,30}$/.test(account.replace(/[\s.\-]/g, ''))) {
                    showError('Số tài khoản phải gồm 6 – 30 chữ số.');
                    return;
                }
                if (!bankCode) {
                    showError('Chọn ngân hàng nhận tiền hoàn.');
                    return;
                }
                payload.refund = {
                    orderId: orderId,
                    bankCode: bankCode,
                    bankAccount: account,
                    accountHolder: holder
                };
            }

            state.busy = true;
            submit.disabled = true;
            var res = await api('/api/support/tickets', { method: 'POST', body: payload });
            state.busy = false;
            submit.disabled = false;

            if (res.ok && res.data && res.data.ticket) {
                state.current = res.data.ticket;
                state.files = [];
                state.newSubject = '';
                state.newBody = '';
                state.refundOrderId = '';
                state.refundAccount = '';
                state.refundHolder = '';
                state.refundBankCode = '';
                state.refundOptionsLoaded = false;   // lần sau tải lại (trạng thái đơn có thể đổi)
                state.notice = 'Đã gửi yêu cầu. Chúng tôi sẽ phản hồi sớm nhất.';
                state.view = 'detail';
                render();
            } else {
                showError((res.data && res.data.error) || 'Không gửi được yêu cầu.');
            }
        });

        panelBody.appendChild(form);
    }

    /* ── Khối tóm tắt yêu cầu hoàn tiền trong chi tiết ─────────────── */

    function refundSummaryNode(ticket) {
        var r = refundOf(ticket);
        if (!r) return null;

        var box = createEl('div', 'lime-support-refund lime-support-refund--summary');
        var top = createEl('div', 'lime-support-refund-title');
        top.appendChild(createEl('span', null, 'Yêu cầu hoàn tiền'));
        top.appendChild(createEl('span',
            'lime-support-badge lime-support-badge--refund-' + r.status,
            REFUND_STATUS[r.status] || r.status));
        box.appendChild(top);

        var rows = [
            ['Giao dịch', (r.payCode || '—') + (r.planName ? ' · ' + r.planName : '')],
            ['Số tiền', formatVnd(r.amountVnd)],
            ['Nhận về', (r.bankName || '—') + ' · ' + maskAccount(r.bankAccount)]
        ];
        rows.forEach(function (row) {
            var line = createEl('div', 'lime-support-refund-row');
            line.appendChild(createEl('span', null, row[0]));
            line.appendChild(createEl('strong', null, row[1]));
            box.appendChild(line);
        });

        if (r.status === 'pending') {
            box.appendChild(createEl('div', 'lime-support-hint',
                'Đội ngũ LIME đang kiểm tra giao dịch và sẽ phản hồi trong hội thoại này.'));
        } else if (r.status === 'rejected' && r.adminNote) {
            box.appendChild(createEl('div', 'lime-support-refund-note', 'Lý do từ chối: ' + r.adminNote));
        } else if (r.status === 'refunded' && r.refundedAt) {
            box.appendChild(createEl('div', 'lime-support-hint', 'Đã chuyển tiền hoàn · ' + formatTime(r.refundedAt)));
        }

        return box;
    }

    /* ── Hội thoại chi tiết ────────────────────────────────────────── */

    async function openDetail(id) {
        if (state.busy) return;
        state.view = 'detailLoading';
        state.error = '';
        state.notice = '';
        render();
        var res = await api('/api/support/tickets/' + encodeURIComponent(id));
        if (res.ok && res.data && res.data.ticket) {
            state.current = res.data.ticket;
            state.view = 'detail';
        } else {
            state.view = 'list';
            state.error = (res.data && res.data.error) || 'Không tải được hội thoại.';
        }
        render();
    }

    function renderMessages(thread, ticket) {
        (ticket.messages || []).forEach(function (m) {
            if (m.isInternal) return; // ghi chú nội bộ chỉ dành cho Admin

            var msg = createEl('div', 'lime-support-msg lime-support-msg--' + m.senderType);

            var bubble = createEl('div', 'lime-support-bubble', m.body);

            if (m.attachments && m.attachments.length) {
                var att = createEl('div', 'lime-support-attachments');
                m.attachments.forEach(function (a) {
                    var img = createEl('img');
                    img.src = a.url;
                    img.alt = (a.name || 'Ảnh đính kèm');
                    img.loading = 'lazy';
                    img.addEventListener('click', function () { openLightbox(a.url); });
                    att.appendChild(img);
                });
                msg.appendChild(att);
            }

            msg.appendChild(bubble);

            var meta = createEl('div', 'lime-support-msg-meta' + (m.senderType === 'user' ? ' lime-support-msg-meta--user' : ''));
            var who = m.senderType === 'user' ? 'Bạn' : (m.senderType === 'system' ? 'Hệ thống' : 'Đội ngũ LIME');
            meta.textContent = who + ' · ' + formatTime(m.createdAt);
            msg.appendChild(meta);

            thread.appendChild(msg);
        });
    }

    function renderDetail() {
        setBodyClass('lime-support-body--detail');
        var t = state.current;
        if (!t) { state.view = 'list'; render(); return; }

        var back = createEl('button', 'lime-support-back');
        back.type = 'button';
        back.appendChild(svg('back'));
        back.appendChild(createEl('span', null, 'Danh sách yêu cầu'));
        back.addEventListener('click', openList);
        panelBody.appendChild(back);

        var head = createEl('div', 'lime-support-empty');
        head.style.padding = '13px 15px 11px';
        head.style.alignItems = 'flex-start';
        head.style.textAlign = 'left';
        head.style.borderBottom = '1px solid rgba(20,22,15,0.06)';

        var topRow = createEl('div', 'lime-support-item-top');
        topRow.appendChild(createEl('span', 'lime-support-item-code', t.code));
        topRow.appendChild(createEl('span',
            'lime-support-badge lime-support-badge--status lime-support-badge--' + t.status,
            TICKET_STATUSES[t.status] || t.status));
        head.appendChild(topRow);

        head.appendChild(createEl('div', 'lime-support-item-subject', t.subject));
        head.appendChild(createEl('div', 'lime-support-item-meta',
            (TICKET_CATEGORIES[t.category] || t.category)));
        panelBody.appendChild(head);

        var refundSummary = refundSummaryNode(t);
        if (refundSummary) panelBody.appendChild(refundSummary);

        if (state.notice) {
            panelBody.appendChild(noticeNode(state.notice, 'lime-support-msg-success'));
        }

        var thread = createEl('div', 'lime-support-thread');
        if (!(t.messages || []).length) {
            thread.appendChild(createEl('div', 'lime-support-empty', 'Chưa có tin nhắn nào.'));
        } else {
            renderMessages(thread, t);
        }
        panelBody.appendChild(thread);

        var closed = t.status === 'closed';
        var resolved = t.status === 'resolved';

        var composer = createEl('div', 'lime-support-composer');

        if (!closed && !resolved) {
            var fileInput = createEl('input');
            fileInput.type = 'file';
            fileInput.accept = 'image/png,image/jpeg,image/webp,image/svg+xml';
            fileInput.style.display = 'none';

            var pills = createEl('div', 'lime-support-file-row');
            var text = createEl('textarea');
            text.placeholder = 'Nhập phản hồi...';
            text.maxLength = 5000;

            var row = createEl('div', 'lime-support-composer-row');
            var left = createEl('div', 'lime-support-composer-row');
            left.style.display = 'flex';
            left.style.gap = '6px';

            var attachBtn = createEl('button', 'lime-support-btn', '📎');
            attachBtn.type = 'button';
            attachBtn.title = 'Đính kèm ảnh';
            attachBtn.appendChild(fileInput);
            attachBtn.addEventListener('click', function () { fileInput.click(); });
            left.appendChild(attachBtn);
            left.appendChild(pills);

            var send = createEl('button', 'lime-support-btn lime-support-btn--primary', 'Gửi');
            send.type = 'button';

            var errBox = createEl('div');

            var pillState = [];
            var syncPills = function () {
                pills.textContent = '';
                pillState.forEach(function (f, idx) {
                    var pill = createEl('span', 'lime-support-file-pill');
                    pill.appendChild(createEl('span', 'name', f.name || f.url.split('/').pop()));
                    var rm = createEl('button', 'rm', '✕');
                    rm.type = 'button';
                    rm.addEventListener('click', function () {
                        pillState.splice(idx, 1);
                        syncPills();
                    });
                    pill.appendChild(rm);
                    pills.appendChild(pill);
                });
                attachBtn.disabled = pillState.length >= MAX_FILES;
            };

            fileInput.addEventListener('change', async function () {
                var file = fileInput.files && fileInput.files[0];
                fileInput.value = '';
                if (!file) return;
                attachBtn.disabled = true;
                var fd = new FormData();
                fd.append('file', file);
                var res = await api('/api/support/attachments', { method: 'POST', body: fd });
                attachBtn.disabled = false;
                if (res.ok && res.data && res.data.url) {
                    pillState.push({ url: res.data.url, name: file.name });
                    syncPills();
                } else {
                    errBox.textContent = '';
                    errBox.appendChild(noticeNode((res.data && res.data.error) || 'Không tải được ảnh.', 'lime-support-msg-error'));
                }
            });

            send.addEventListener('click', async function () {
                errBox.textContent = '';
                var bodyText = text.value.trim();
                if (!bodyText) {
                    errBox.appendChild(noticeNode('Nhập nội dung phản hồi trước khi gửi.', 'lime-support-msg-error'));
                    return;
                }
                text.disabled = true; send.disabled = true; attachBtn.disabled = true;
                var res = await api('/api/support/tickets/' + encodeURIComponent(state.current.id) + '/messages', {
                    method: 'POST',
                    body: { body: bodyText, attachments: pillState }
                });
                text.disabled = false; send.disabled = false; syncPills();

                if (res.ok && res.data && res.data.ticket) {
                    state.current = res.data.ticket;
                    renderDetail();
                } else {
                    errBox.appendChild(noticeNode((res.data && res.data.error) || 'Không gửi được phản hồi.', 'lime-support-msg-error'));
                }
            });

            row.appendChild(left);
            row.appendChild(send);
            composer.appendChild(text);
            composer.appendChild(row);
            composer.appendChild(errBox);
        } else if (closed) {
            composer.appendChild(noticeNode('Yêu cầu này đã đóng. Vui lòng tạo yêu cầu mới nếu cần hỗ trợ tiếp.', 'lime-support-msg-success'));
        } else {
            composer.appendChild(noticeNode('Đội ngũ LIME đã đánh dấu yêu cầu là đã giải quyết.', 'lime-support-msg-success'));
        }

        /* Người dùng có thể tự đóng yêu cầu của mình */
        if (!closed) {
            var closeRow = createEl('div', 'lime-support-composer');
            closeRow.style.borderTop = 'none';
            closeRow.style.paddingTop = '0';
            var closeBtn = createEl('button', 'lime-support-btn lime-support-btn--danger', 'Đóng yêu cầu này');
            closeBtn.type = 'button';
            closeBtn.addEventListener('click', async function () {
                if (state.busy) return;
                state.busy = true;
                closeBtn.disabled = true;
                var res = await api('/api/support/tickets/' + encodeURIComponent(state.current.id) + '/close', { method: 'POST' });
                state.busy = false;
                closeBtn.disabled = false;
                if (res.ok) {
                    state.current = res.data.ticket || Object.assign({}, state.current, { status: 'closed' });
                    renderDetail();
                }
            });
            closeRow.appendChild(closeBtn);
            panelBody.appendChild(closeRow);
        }

        panelBody.appendChild(composer);
    }

    /* ── Lightbox ảnh đính kèm ────────────────────────────────────── */

    function openLightbox(src) {
        var overlay = createEl('div', 'lime-support-lightbox');
        var img = createEl('img');
        img.src = src;
        overlay.appendChild(img);
        overlay.addEventListener('click', function () {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        });
        document.body.appendChild(overlay);
    }

    /* ── Render chính ─────────────────────────────────────────────── */

    function render() {
        if (!panelBody) return;
        panelBody.textContent = '';
        state.busy = state.busy || false;

        if (state.view === 'listLoading') {
            setBodyClass(null);
            var loading = createEl('div', 'lime-support-empty');
            loading.appendChild(createEl('div', null, 'Đang tải yêu cầu...'));
            panelBody.appendChild(loading);
            return;
        }

        if (state.view === 'login') {
            renderLogin();
            return;
        }

        if (state.view === 'new') {
            renderNew();
            return;
        }

        if (state.view === 'detailLoading') {
            setBodyClass(null);
            var ld = createEl('div', 'lime-support-empty');
            ld.appendChild(createEl('div', null, 'Đang tải hội thoại...'));
            panelBody.appendChild(ld);
            return;
        }

        if (state.view === 'detail') {
            renderDetail();
            return;
        }

        renderList();
    }

    /* ── Gắn vào trang ────────────────────────────────────────────── */

    function init() {
        var existing = ensureRoot();
        document.body.appendChild(existing);
    }

    /**
     * API cho các trang khác (Hồ sơ) mở sẵn form hoàn tiền.
     *
     * `LimeSupport.openRefund({ orderId })` mở widget ở màn hình tạo yêu cầu với
     * danh mục "Hoàn tiền" và chọn sẵn giao dịch — người dùng chỉ còn nhập số tài
     * khoản, ngân hàng, lý do.
     */
    window.LimeSupport = {
        openRefund: function (options) {
            var opts = options || {};
            if (!document.getElementById(ROOT_ID)) init();
            state.view = 'new';
            state.newCategory = 'refund';
            state.newSubject = '';
            state.newBody = '';
            state.files = [];
            state.error = '';
            state.notice = '';
            state.refundOrderId = opts.orderId || '';
            root.classList.add('lime-support-open');
            render();
            ensureRefundOptions();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
