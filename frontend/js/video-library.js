/**
 * "Video của tôi" — thư viện video trong Workspace.
 *
 * Nguyên tắc:
 *  - Chỉ đọc backend thật (`GET /api/jobs`), không mock data.
 *  - Mọi chuỗi do người dùng nhập (prompt/title) được gán bằng textContent,
 *    không nội suy vào innerHTML.
 *  - Một interval poll duy nhất, chỉ chạy khi tab thư viện đang mở và còn job
 *    đang chờ/đang chạy. Rời tab/đóng trang là dừng + abort request.
 *  - Không gọi /api/generate; "Mở trong trình chỉnh sửa" chỉ khôi phục dữ liệu
 *    sẵn có qua cầu nối `window.LimeWorkspace`.
 */
(function () {
    'use strict';

    // Cùng quy tắc với workspace.js: khi UI được phục vụ từ chính cổng 3000 thì
    // dùng URL tương đối để cookie session (same-origin) được gửi kèm. Nếu không,
    // đổi localhost ↔ 127.0.0.1 sẽ thành origin khác và API trả 401.
    const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? ((window.location.origin && window.location.origin.includes(':3000')) ? '' : 'http://localhost:3000')
        : '';
    const PAGE_SIZE = 12;
    const POLL_MS = 5000;

    const STATUS_LABELS = {
        queued: 'Đang chờ',
        running: 'Đang tạo',
        completed: 'Hoàn thành',
        failed: 'Thất bại',
        qa_failed: 'Chưa đạt kiểm định',
        cancelled: 'Đã hủy',
    };
    const ACTIVE_STATUSES = new Set(['queued', 'running']);

    const state = {
        initialized: false,
        loadedOnce: false,
        loading: false,
        silentLoading: false,
        items: [],
        page: 1,
        pageSize: PAGE_SIZE,
        total: 0,
        totalPages: 1,
        totalKnown: false,
        query: '',
        status: 'all',
        sort: 'newest',
        requestSeq: 0,
        controller: null,
        pollTimer: null,
        openMenuJobId: null,
        detail: null,
        detailTrigger: null,
        confirmResolve: null,
        confirmTrigger: null,
    };

    const el = {};
    let searchTimer = null;

    function byId(id) { return document.getElementById(id); }

    function cacheElements() {
        el.tabButtons = document.querySelectorAll('.ws-tab');
        el.section = byId('ws-main-library');
        el.search = byId('vl-search');
        el.status = byId('vl-status');
        el.sort = byId('vl-sort');
        el.refresh = byId('vl-refresh');
        el.alert = byId('vl-alert');
        el.alertText = byId('vl-alert-text');
        el.alertRetry = byId('vl-alert-retry');
        el.loading = byId('vl-loading');
        el.empty = byId('vl-empty');
        el.emptyTitle = byId('vl-empty-title');
        el.emptyDesc = byId('vl-empty-desc');
        el.emptyCta = byId('vl-empty-cta');
        el.grid = byId('vl-grid');
        el.count = byId('vl-count');
        el.pagination = byId('vl-pagination');
        el.prev = byId('vl-prev');
        el.next = byId('vl-next');
        el.pageInfo = byId('vl-page-info');
        el.createBtn = byId('vl-create-btn');
        el.playerOverlay = byId('vl-player-overlay');
        el.playerTitle = byId('vl-player-title');
        el.playerMeta = byId('vl-player-meta');
        el.playerVideo = byId('vl-player-video');
        el.playerFallback = byId('vl-player-fallback');
        el.playerClose = byId('vl-player-close');
        el.playerDownload = byId('vl-player-download');
        el.playerRestore = byId('vl-player-restore');
        el.playerDelete = byId('vl-player-delete');
        el.confirm = byId('vl-confirm');
        el.confirmTitle = byId('vl-confirm-title');
        el.confirmDesc = byId('vl-confirm-desc');
        el.confirmOk = byId('vl-confirm-ok');
        el.confirmCancel = byId('vl-confirm-cancel');
    }

    function bridge() { return window.LimeWorkspace || null; }

    function isLibraryActive() {
        const ws = bridge();
        if (ws && typeof ws.currentTab === 'function') return ws.currentTab() === 'library';
        return Boolean(el.section && el.section.classList.contains('on'));
    }

    function fmtDate(value) {
        const t = Date.parse(value || '');
        if (!Number.isFinite(t)) return '—';
        try {
            return new Intl.DateTimeFormat('vi-VN', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
            }).format(new Date(t));
        } catch (e) {
            return new Date(t).toLocaleString('vi-VN');
        }
    }

    function fmtDuration(sec) {
        const n = Number(sec);
        if (!Number.isFinite(n) || n <= 0) return '—';
        const total = Math.round(n);
        const m = Math.floor(total / 60);
        const s = total % 60;
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    function debounce(fn, ms) {
        let timer = null;
        return function (...args) {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => { timer = null; fn.apply(null, args); }, ms);
        };
    }

    function safeFilename(item) {
        const base = String(item.topic || '').replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ').trim().slice(0, 70);
        const fallback = `video-${item.jobId}`;
        return `${(base || fallback).replace(/\s+/g, ' ')}.mp4`;
    }

    function showAlert(message, retry) {
        if (!el.alert) return;
        if (el.alertText) el.alertText.textContent = message;
        el.alert.hidden = false;
        if (el.alertRetry) el.alertRetry.hidden = retry === false;
    }

    function hideAlert() {
        if (el.alert) el.alert.hidden = true;
    }

    function setLoading(on) {
        state.loading = !!on;
        if (el.loading) el.loading.hidden = !on;
        if (on) {
            hideAlert();
            if (el.empty) el.empty.hidden = true;
        }
    }

    function setCount(total) {
        if (el.count) el.count.textContent = `${total} video`;
    }

    function buildQueryParams() {
        const params = new URLSearchParams();
        params.set('page', String(state.page));
        params.set('pageSize', String(state.pageSize));
        params.set('format', 'page');
        if (state.status && state.status !== 'all') params.set('status', state.status);
        if (state.sort) params.set('sort', state.sort);
        if (state.query) params.set('q', state.query);
        return params;
    }

    /**
     * Tải danh sách. `silent` dùng cho poll/nền: giữ nguyên grid, không nháy
     * spinner, không xoá dữ liệu cũ nếu request lỗi.
     */
    async function load(options = {}) {
        const silent = Boolean(options.silent);
        if (state.loading && !silent) return;
        // Poll nền không được chen ngang một request người dùng đang chờ: huỷ nó
        // sẽ làm cờ loading kẹt và bỏ mất kết quả người dùng vừa yêu cầu.
        if (silent && (state.loading || state.silentLoading)) return;

        if (state.controller) state.controller.abort();
        const controller = new AbortController();
        state.controller = controller;
        const seq = ++state.requestSeq;
        const firstLoad = !state.loadedOnce;

        if (silent) state.silentLoading = true;
        else setLoading(true);

        try {
            const res = await fetch(`${API_BASE}/api/jobs?${buildQueryParams().toString()}`, {
                credentials: 'include',
                signal: controller.signal,
                headers: { Accept: 'application/json' },
            });
            if (seq !== state.requestSeq) return;

            if (res.status === 401) {
                window.location.href = '/?auth=open';
                return;
            }
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `Không tải được danh sách video (${res.status})`);
            }

            const data = await res.json();
            if (seq !== state.requestSeq) return;

            if (Array.isArray(data)) {
                // Server cũ chưa hỗ trợ phân trang: vẫn hiển thị an toàn.
                state.items = data;
                state.total = data.length;
                state.totalPages = 1;
                state.page = 1;
                state.totalKnown = true;
            } else {
                state.items = Array.isArray(data.items) ? data.items : [];
                state.total = Number.isFinite(data.total) ? data.total : state.items.length;
                state.totalPages = Math.max(1, Number(data.totalPages) || 1);
                if (Number(data.page) && Number(data.page) !== state.page) state.page = Number(data.page);
                state.totalKnown = true;
            }
            state.loadedOnce = true;
            hideAlert();
            render();
            updatePolling();
        } catch (err) {
            if (err && err.name === 'AbortError') return;
            if (seq !== state.requestSeq) return;
            if (!state.loadedOnce) {
                state.items = [];
                state.total = 0;
                state.totalKnown = false;
                renderEmptyState('error');
                setCount(0);
                if (el.grid) el.grid.textContent = '';
                if (el.pagination) el.pagination.hidden = true;
            }
            showAlert(err.message || 'Không tải được danh sách video.');
            if (firstLoad && el.count) el.count.textContent = '—';
        } finally {
            if (silent) {
                // Luôn nhả cờ poll, kể cả khi request bị một lần tải thủ công
                // thay thế (seq đổi) — nếu không, poll sẽ bị khoá vĩnh viễn.
                state.silentLoading = false;
            } else if (seq === state.requestSeq) {
                setLoading(false);
            }
        }
    }

    function statusChip(item) {
        const status = item.status || 'queued';
        const chip = document.createElement('span');
        chip.className = `vl-status vl-status--${status}`;
        chip.textContent = STATUS_LABELS[status] || status;
        return chip;
    }

    function makeThumb(item) {
        const thumb = document.createElement('div');
        thumb.className = 'vl-thumb';
        thumb.setAttribute('role', 'button');
        thumb.tabIndex = 0;
        thumb.setAttribute('aria-label', item.videoAvailable ? `Xem video: ${item.topic}` : `${item.topic} — tệp video không còn khả dụng`);

        const fallback = document.createElement('div');
        fallback.className = 'vl-thumb-fallback';
        fallback.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4" width="19" height="16" rx="3"></rect><path d="m10 9 5 3-5 3z"></path></svg>';
        const fallbackText = document.createElement('span');
        fallbackText.textContent = item.videoAvailable ? 'Chưa có ảnh xem trước' : 'Tệp video không còn khả dụng';
        fallback.appendChild(fallbackText);
        thumb.appendChild(fallback);

        if (item.thumbnailUrl) {
            const img = document.createElement('img');
            img.alt = '';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.src = item.thumbnailUrl;
            img.addEventListener('error', () => { img.remove(); });
            thumb.appendChild(img);
        }

        if (item.videoAvailable) {
            const play = document.createElement('span');
            play.className = 'vl-thumb-play';
            play.setAttribute('aria-hidden', 'true');
            play.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>';
            thumb.appendChild(play);
        } else {
            const note = document.createElement('div');
            note.className = 'vl-thumb-unavailable';
            note.textContent = 'Tệp video không còn khả dụng';
            thumb.appendChild(note);
        }

        const activate = () => {
            if (item.videoAvailable) openPlayer(item, thumb);
            else showAlert('Tệp video của job này không còn trên máy chủ. Bạn vẫn có thể xoá mục khỏi thư viện.');
        };
        thumb.addEventListener('click', activate);
        thumb.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                activate();
            }
        });
        return thumb;
    }

    function menuButton(label, iconSvg, onClick, options = {}) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.disabled = Boolean(options.disabled);
        if (options.danger) btn.className = 'danger';
        if (iconSvg) {
            const span = document.createElement('span');
            span.setAttribute('aria-hidden', 'true');
            span.innerHTML = iconSvg;
            btn.appendChild(span);
        }
        const text = document.createElement('span');
        text.textContent = label;
        btn.appendChild(text);
        btn.addEventListener('click', (event) => {
            event.stopPropagation();
            closeMenus();
            onClick();
        });
        return btn;
    }

    function makeMenu(item) {
        const wrap = document.createElement('div');
        wrap.className = 'vl-menu-wrap';

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'vl-menu-btn';
        toggle.textContent = '⋯';
        toggle.setAttribute('aria-haspopup', 'menu');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Tác vụ khác');

        const menu = document.createElement('div');
        menu.className = 'vl-menu';
        menu.setAttribute('role', 'menu');

        menu.appendChild(menuButton('Xem video', '', () => openPlayer(item, toggle), { disabled: !item.videoAvailable }));
        menu.appendChild(menuButton('Tải MP4', '', () => downloadItem(item), { disabled: !item.videoAvailable }));
        menu.appendChild(menuButton('Mở trong trình chỉnh sửa', '', () => restoreItem(item, toggle), { disabled: !item.canRestore }));
        menu.appendChild(menuButton('Xoá khỏi thư viện', '', () => deleteItem(item, toggle), {
            danger: true,
            disabled: ACTIVE_STATUSES.has(item.status),
        }));

        toggle.addEventListener('click', (event) => {
            event.stopPropagation();
            const willOpen = !menu.classList.contains('show');
            closeMenus();
            if (!willOpen) return;
            menu.classList.add('show');
            toggle.setAttribute('aria-expanded', 'true');
            state.openMenuJobId = item.jobId;
            const first = menu.querySelector('button:not([disabled])');
            if (first) first.focus();
        });

        wrap.appendChild(toggle);
        wrap.appendChild(menu);
        return wrap;
    }

    function closeMenus() {
        if (el.grid) {
            el.grid.querySelectorAll('.vl-menu.show').forEach((menu) => menu.classList.remove('show'));
            el.grid.querySelectorAll('.vl-menu-btn[aria-expanded="true"]').forEach((btn) => btn.setAttribute('aria-expanded', 'false'));
        }
        state.openMenuJobId = null;
    }

    function makeCard(item) {
        const card = document.createElement('article');
        card.className = 'vl-card';
        card.setAttribute('data-job-id', item.jobId);

        card.appendChild(makeThumb(item));

        const body = document.createElement('div');
        body.className = 'vl-card-body';

        const topline = document.createElement('div');
        topline.className = 'vl-card-topline';
        topline.appendChild(statusChip(item));
        body.appendChild(topline);

        const title = document.createElement('h3');
        title.className = 'vl-title';
        title.textContent = item.topic || 'Video không có tên';
        title.title = item.topic || '';
        body.appendChild(title);

        const meta = document.createElement('div');
        meta.className = 'vl-meta';
        const created = document.createElement('span');
        created.textContent = fmtDate(item.createdAt);
        meta.appendChild(created);
        meta.appendChild(Object.assign(document.createElement('span'), { className: 'vl-meta-dot', textContent: '·' }));
        const duration = document.createElement('span');
        duration.className = 'vl-meta-mono';
        duration.textContent = fmtDuration(item.durationSec);
        meta.appendChild(duration);
        body.appendChild(meta);

        if (ACTIVE_STATUSES.has(item.status) && typeof item.progress === 'number') {
            const progress = document.createElement('div');
            progress.className = 'vl-progress';
            progress.setAttribute('role', 'progressbar');
            progress.setAttribute('aria-valuemin', '0');
            progress.setAttribute('aria-valuemax', '100');
            progress.setAttribute('aria-valuenow', String(Math.round(item.progress)));
            const fill = document.createElement('i');
            fill.style.width = `${Math.max(0, Math.min(100, item.progress))}%`;
            progress.appendChild(fill);
            body.appendChild(progress);
        }

        const foot = document.createElement('div');
        foot.className = 'vl-card-foot';
        const actions = document.createElement('div');
        actions.className = 'vl-card-actions';

        const view = document.createElement('button');
        view.type = 'button';
        view.className = 'vl-link-btn';
        view.textContent = item.videoAvailable ? 'Xem video' : 'Không khả dụng';
        view.disabled = !item.videoAvailable;
        view.addEventListener('click', () => openPlayer(item, view));
        actions.appendChild(view);
        actions.appendChild(makeMenu(item));
        foot.appendChild(actions);
        body.appendChild(foot);
        card.appendChild(body);
        return card;
    }

    function render() {
        if (!el.grid) return;
        closeMenus();
        el.grid.textContent = '';
        setCount(state.total);

        if (!state.items.length) {
            renderEmptyState(state.totalKnown ? 'empty' : 'error');
            if (el.pagination) el.pagination.hidden = true;
            return;
        }

        if (el.empty) el.empty.hidden = true;
        const fragment = document.createDocumentFragment();
        state.items.forEach((item) => fragment.appendChild(makeCard(item)));
        el.grid.appendChild(fragment);

        if (el.pagination) {
            el.pagination.hidden = state.totalPages <= 1;
            if (el.pageInfo) el.pageInfo.textContent = `Trang ${state.page} / ${state.totalPages}`;
            if (el.prev) el.prev.disabled = state.page <= 1;
            if (el.next) el.next.disabled = state.page >= state.totalPages;
        }
    }

    function hasActiveFilters() {
        return Boolean(state.query) || state.status !== 'all';
    }

    function renderEmptyState(kind) {
        if (!el.empty) return;
        el.empty.hidden = false;
        if (kind === 'error') {
            if (el.emptyTitle) el.emptyTitle.textContent = 'Chưa tải được thư viện';
            if (el.emptyDesc) el.emptyDesc.textContent = 'Kiểm tra kết nối rồi thử lại. Video của bạn vẫn được giữ trên máy chủ.';
            if (el.emptyCta) { el.emptyCta.textContent = 'Thử lại'; el.emptyCta.dataset.action = 'retry'; }
            return;
        }
        if (hasActiveFilters()) {
            if (el.emptyTitle) el.emptyTitle.textContent = 'Không tìm thấy video phù hợp';
            if (el.emptyDesc) el.emptyDesc.textContent = 'Thử từ khoá khác hoặc xoá bộ lọc trạng thái.';
            if (el.emptyCta) { el.emptyCta.textContent = 'Xoá bộ lọc'; el.emptyCta.dataset.action = 'clear'; }
            return;
        }
        if (el.emptyTitle) el.emptyTitle.textContent = 'Chưa có video nào';
        if (el.emptyDesc) el.emptyDesc.textContent = 'Video bạn tạo sẽ xuất hiện ở đây để xem lại và tải xuống.';
        if (el.emptyCta) { el.emptyCta.textContent = 'Tạo video đầu tiên'; el.emptyCta.dataset.action = 'create'; }
    }

    function openLibrary() {
        if (!el.section) return;
        if (!state.loadedOnce && !state.loading) load();
        updatePolling();
    }

    function updatePolling() {
        const shouldPoll = isLibraryActive() && state.items.some((item) => ACTIVE_STATUSES.has(item.status));
        if (shouldPoll) {
            if (!state.pollTimer) {
                state.pollTimer = setInterval(() => {
                    if (!isLibraryActive()) { stopPolling(); return; }
                    load({ silent: true });
                }, POLL_MS);
            }
        } else {
            stopPolling();
        }
    }

    function stopPolling() {
        if (state.pollTimer) {
            clearInterval(state.pollTimer);
            state.pollTimer = null;
        }
    }

    /* ---------------- player ---------------- */

    function openPlayer(item, trigger) {
        if (!item || !item.jobId) return;
        if (!item.videoAvailable) {
            showAlert('Tệp video không còn khả dụng. Video có thể đã bị xoá hoặc hết thời hạn lưu trữ.');
            return;
        }
        state.detailTrigger = trigger || null;
        closeMenus();
        if (el.playerOverlay) el.playerOverlay.hidden = false;
        document.body.style.overflow = 'hidden';
        if (el.playerTitle) el.playerTitle.textContent = item.topic || 'Video';
        if (el.playerMeta) el.playerMeta.textContent = `${fmtDate(item.createdAt)} · ${fmtDuration(item.durationSec)}${item.resolution ? ` · ${item.resolution}` : ''}`;
        showPlayerFallback(false);

        if (el.playerVideo) {
            el.playerVideo.src = `${API_BASE}/api/jobs/${encodeURIComponent(item.jobId)}/video`;
            el.playerVideo.load();
            el.playerVideo.play().catch(() => { });
        }
        if (el.playerDownload) {
            el.playerDownload.href = `${API_BASE}/api/jobs/${encodeURIComponent(item.jobId)}/download`;
            el.playerDownload.setAttribute('download', safeFilename(item));
            el.playerDownload.hidden = false;
        }
        if (el.playerRestore) {
            el.playerRestore.disabled = !item.canRestore;
            el.playerRestore.title = item.canRestore ? '' : 'Job này không lưu kịch bản/prompt để khôi phục.';
        }
        if (el.playerDelete) el.playerDelete.disabled = ACTIVE_STATUSES.has(item.status);
        state.detail = item;
        if (el.playerClose) el.playerClose.focus();
        document.addEventListener('keydown', onPlayerKeydown);
    }

    function showPlayerFallback(show) {
        if (!el.playerVideo || !el.playerFallback) return;
        el.playerVideo.hidden = !!show;
        el.playerFallback.hidden = !show;
        if (show) {
            el.playerFallback.textContent = 'Tệp video không còn khả dụng. Bạn vẫn có thể xoá mục này khỏi thư viện hoặc mở thông tin kịch bản (nếu còn).';
        }
    }

    function closePlayer() {
        if (!el.playerOverlay || el.playerOverlay.hidden) return;
        el.playerOverlay.hidden = true;
        document.body.style.overflow = '';
        document.removeEventListener('keydown', onPlayerKeydown);
        if (el.playerVideo) {
            el.playerVideo.pause();
            el.playerVideo.removeAttribute('src');
            el.playerVideo.load();
        }
        state.detail = null;
        if (state.detailTrigger && typeof state.detailTrigger.focus === 'function') {
            state.detailTrigger.focus();
        }
        state.detailTrigger = null;
    }

    function onPlayerKeydown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            closePlayer();
            return;
        }
        if (event.key !== 'Tab' || !el.playerOverlay) return;
        const focusables = el.playerOverlay.querySelectorAll('button:not([disabled]), a[href], video[controls], [tabindex]:not([tabindex="-1"])');
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    /* ---------------- download / restore / delete ---------------- */

    async function downloadItem(item) {
        if (!item.videoAvailable) {
            showAlert('Tệp video không còn khả dụng nên không thể tải xuống.');
            return;
        }
        try {
            const res = await fetch(`${API_BASE}/api/jobs/${encodeURIComponent(item.jobId)}/download`, {
                method: 'HEAD',
                credentials: 'include',
            });
            if (res.status === 401) { window.location.href = '/?auth=open'; return; }
            if (res.status === 404 || res.status === 410) {
                showAlert('Tệp video không còn khả dụng. Danh sách sẽ được cập nhật.');
                load({ silent: true });
                return;
            }
            if (!res.ok && res.status !== 405) {
                showAlert(`Không tải được video (${res.status}).`);
                return;
            }
        } catch (err) {
            showAlert('Không kiểm tra được tệp video. Vẫn thử tải xuống.');
        }
        const link = document.createElement('a');
        link.href = `${API_BASE}/api/jobs/${encodeURIComponent(item.jobId)}/download`;
        link.download = safeFilename(item);
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        link.remove();
    }

    async function restoreItem(item, trigger) {
        const ws = bridge();
        if (!ws || typeof ws.restoreJob !== 'function') {
            showAlert('Không mở được trình chỉnh sửa trong phiên này.');
            return;
        }
        if (ws.isRendering && ws.isRendering()) {
            showAlert('Đang render video khác. Đợi render xong hoặc huỷ job trước khi mở video cũ.');
            return;
        }
        if (ws.hasUnsavedWork && ws.hasUnsavedWork()) {
            const ok = await askConfirm({
                title: 'Thay thế bản nháp hiện tại?',
                message: 'Bạn đang có prompt hoặc kịch bản chưa lưu. Mở video này sẽ thay thế nội dung trong trình chỉnh sửa (không xoá video đã tạo).',
                okLabel: 'Mở video cũ',
            }, trigger);
            if (!ok) return;
        }
        let detail;
        try {
            const res = await fetch(`${API_BASE}/api/jobs/${encodeURIComponent(item.jobId)}`, {
                credentials: 'include',
                headers: { Accept: 'application/json' },
            });
            if (!res.ok) throw new Error('Không tải được thông tin video.');
            detail = await res.json();
        } catch (err) {
            showAlert(err.message);
            return;
        }
        const result = ws.restoreJob(detail, { force: true });
        if (result && result.ok) {
            closePlayer();
        } else {
            showAlert((result && result.reason) || 'Không mở được video trong trình chỉnh sửa.');
        }
    }

    async function deleteItem(item, trigger) {
        if (ACTIVE_STATUSES.has(item.status)) {
            showAlert('Video đang được tạo, chưa thể xoá. Đợi render xong rồi thử lại.');
            return;
        }
        const ok = await askConfirm({
            title: 'Xoá video này?',
            message: `"${item.topic || item.jobId}" sẽ bị xoá khỏi thư viện và tệp MP4 trên máy chủ. Thao tác này không thể hoàn tác.`,
            okLabel: 'Xoá video',
            danger: true,
        }, trigger);
        if (!ok) return;

        try {
            const res = await fetch(`${API_BASE}/api/jobs/${encodeURIComponent(item.jobId)}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: { Accept: 'application/json' },
            });
            if (res.status === 401) { window.location.href = '/?auth=open'; return; }
            if (res.status === 404) {
                showAlert('Video không còn tồn tại. Danh sách sẽ được cập nhật.');
            } else if (res.status === 409) {
                const body = await res.json().catch(() => ({}));
                showAlert(body.message || 'Video đang được tạo, chưa thể xoá.');
                return;
            } else if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `Không xoá được video (${res.status})`);
            }
            if (state.detail && state.detail.jobId === item.jobId) closePlayer();
            // Cập nhật ngay để UI phản hồi tức thì, rồi đồng bộ lại với server.
            state.items = state.items.filter((row) => row.jobId !== item.jobId);
            state.total = Math.max(0, state.total - 1);
            if (!state.items.length && state.page > 1) state.page -= 1;
            render();
            load({ silent: true });
            window.dispatchEvent(new CustomEvent('lime:jobs-changed'));
        } catch (err) {
            showAlert(err.message || 'Không xoá được video.');
        }
    }

    /* ---------------- confirm dialog ---------------- */

    function askConfirm(options, trigger) {
        if (!el.confirm) return Promise.resolve(window.confirm(options.message));
        if (state.confirmResolve) {
            state.confirmResolve(false);
            state.confirmResolve = null;
        }
        state.confirmTrigger = trigger || document.activeElement;
        if (el.confirmTitle) el.confirmTitle.textContent = options.title || 'Xác nhận';
        if (el.confirmDesc) el.confirmDesc.textContent = options.message || '';
        if (el.confirmOk) {
            el.confirmOk.textContent = options.okLabel || 'Đồng ý';
            el.confirmOk.classList.toggle('vl-danger', Boolean(options.danger));
        }
        el.confirm.hidden = false;
        document.body.style.overflow = 'hidden';
        if (el.confirmCancel) el.confirmCancel.focus();
        document.addEventListener('keydown', onConfirmKeydown);
        return new Promise((resolve) => { state.confirmResolve = resolve; });
    }

    function closeConfirm(value) {
        if (!el.confirm || el.confirm.hidden) return;
        el.confirm.hidden = true;
        document.body.style.overflow = (el.playerOverlay && !el.playerOverlay.hidden) ? 'hidden' : '';
        document.removeEventListener('keydown', onConfirmKeydown);
        const resolve = state.confirmResolve;
        state.confirmResolve = null;
        if (state.confirmTrigger && typeof state.confirmTrigger.focus === 'function') {
            state.confirmTrigger.focus();
        }
        state.confirmTrigger = null;
        if (resolve) resolve(Boolean(value));
    }

    function onConfirmKeydown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeConfirm(false);
        }
    }

    /* ---------------- wiring ---------------- */

    const debouncedSearch = debounce(() => {
        state.query = el.search ? el.search.value.trim() : '';
        state.page = 1;
        load();
    }, 300);

    function bindEvents() {
        if (el.search) {
            el.search.addEventListener('input', debouncedSearch);
            el.search.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' && el.search.value) {
                    el.search.value = '';
                    debouncedSearch();
                }
            });
        }
        if (el.status) {
            el.status.addEventListener('change', () => {
                state.status = el.status.value || 'all';
                state.page = 1;
                load();
            });
        }
        if (el.sort) {
            el.sort.addEventListener('change', () => {
                state.sort = el.sort.value || 'newest';
                state.page = 1;
                load();
            });
        }
        if (el.refresh) el.refresh.addEventListener('click', () => load());
        if (el.alertRetry) el.alertRetry.addEventListener('click', () => load());
        if (el.prev) el.prev.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; load(); } });
        if (el.next) el.next.addEventListener('click', () => { if (state.page < state.totalPages) { state.page += 1; load(); } });

        const goCreate = () => {
            const ws = bridge();
            if (ws && typeof ws.switchTab === 'function') ws.switchTab('script');
            else if (el.section) el.section.classList.remove('on');
        };
        if (el.createBtn) el.createBtn.addEventListener('click', goCreate);
        if (el.emptyCta) {
            el.emptyCta.addEventListener('click', () => {
                const action = el.emptyCta.dataset.action;
                if (action === 'retry') { load(); return; }
                if (action === 'clear') {
                    state.query = '';
                    state.status = 'all';
                    state.page = 1;
                    if (el.search) el.search.value = '';
                    if (el.status) el.status.value = 'all';
                    load();
                    return;
                }
                goCreate();
            });
        }

        if (el.playerClose) el.playerClose.addEventListener('click', closePlayer);
        if (el.playerOverlay) {
            el.playerOverlay.addEventListener('click', (event) => {
                if (event.target === el.playerOverlay) closePlayer();
            });
        }
        if (el.playerVideo) {
            el.playerVideo.addEventListener('error', () => {
                if (el.playerVideo.getAttribute('src')) showPlayerFallback(true);
            });
        }
        if (el.playerDownload) {
            el.playerDownload.addEventListener('click', (event) => {
                if (!state.detail) return;
                event.preventDefault();
                downloadItem(state.detail);
            });
        }
        if (el.playerRestore) {
            el.playerRestore.addEventListener('click', () => {
                if (state.detail) restoreItem(state.detail, el.playerRestore);
            });
        }
        if (el.playerDelete) {
            el.playerDelete.addEventListener('click', () => {
                if (state.detail) deleteItem(state.detail, el.playerDelete);
            });
        }

        if (el.confirmCancel) el.confirmCancel.addEventListener('click', () => closeConfirm(false));
        if (el.confirmOk) el.confirmOk.addEventListener('click', () => closeConfirm(true));
        if (el.confirm) {
            el.confirm.addEventListener('click', (event) => {
                if (event.target === el.confirm) closeConfirm(false);
            });
        }

        document.addEventListener('click', (event) => {
            if (!state.openMenuJobId) return;
            if (event.target.closest && event.target.closest('.vl-menu-wrap')) return;
            closeMenus();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && state.openMenuJobId) {
                closeMenus();
            }
        });

        window.addEventListener('lime:workspace-tab', (event) => {
            if (event.detail && event.detail.tab === 'library') openLibrary();
            else {
                state.controller?.abort?.();
                stopPolling();
                closeMenus();
            }
        });
        window.addEventListener('lime:jobs-changed', () => {
            if (isLibraryActive()) load({ silent: true });
        });
        window.addEventListener('pagehide', () => {
            stopPolling();
            state.controller?.abort?.();
        });
    }

    function init() {
        cacheElements();
        if (!el.section || !el.grid) return;
        bindEvents();
        state.initialized = true;
        // Nếu tải lại trang khi tab thư viện đang mở (hash/không có), vẫn chỉ tải khi active.
        if (isLibraryActive()) openLibrary();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
