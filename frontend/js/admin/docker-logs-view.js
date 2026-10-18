/**
 * Docker Logs Real-time Streaming View
 * Stream trực tiếp `docker logs -f` của 5 containers LIME qua Server-Sent Events (SSE).
 */

import { AdminApi } from './api.js';
import { Toast } from './components.js';

const CONTAINERS = [
    { id: 'lime_server', name: 'lime_server', label: 'API Server', desc: 'Fastify API & Web' },
    { id: 'lime_worker', name: 'lime_worker', label: 'Worker', desc: 'Render & Billing' },
    { id: 'lime_postgres', name: 'lime_postgres', label: 'Postgres', desc: 'Database SQL' },
    { id: 'lime_redis', name: 'lime_redis', label: 'Redis', desc: 'Cache & Queue' },
    { id: 'lime_vieneu_tts', name: 'lime_vieneu_tts', label: 'VieNeu-TTS', desc: 'Neural TTS' },
];

export const DockerLogsView = {
    containerEl: null,
    activeContainer: 'lime_server',
    eventSource: null,
    logLines: [],
    maxLines: 1500,
    isPaused: false,
    autoScroll: true,
    tailLines: 100,
    filterText: '',
    connectionStatus: 'connecting', // 'connecting' | 'live' | 'paused' | 'error' | 'closed'
    reconnectTimer: null,
    statusPollTimer: null,
    containersStatus: {},

    init(container) {
        this.containerEl = container;
        this.isPaused = false;
        this.autoScroll = true;
        this.logLines = [];
        this.filterText = '';

        this.renderStructure();
        this.bindEvents();
        this.loadContainersStatus();
        this.startStream(this.activeContainer);
    },

    destroy() {
        this.stopStream();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.statusPollTimer) {
            clearInterval(this.statusPollTimer);
            this.statusPollTimer = null;
        }
    },

    async loadContainersStatus() {
        try {
            const res = await AdminApi.getDockerContainers();
            if (res.containers && Array.isArray(res.containers)) {
                res.containers.forEach((c) => {
                    this.containersStatus[c.name] = c;
                });
                this.updateContainerTabsUI();
            }
        } catch (err) {
            console.warn('[DockerLogs] Không thể lấy trạng thái containers:', err);
        }
    },

    renderStructure() {
        this.containerEl.innerHTML = `
            <div class="docker-logs-view">
                <!-- Header Card -->
                <div class="docker-logs-header">
                    <div class="docker-logs-title-group">
                        <div class="docker-logs-title">
                            <span class="docker-logs-icon">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
                            </span>
                            <h2>Nhật ký Docker Containers (docker logs -f)</h2>
                        </div>
                        <p class="docker-logs-subtitle">
                            Theo dõi trực tiếp stdout/stderr theo thời gian thực của 5 container chạy hệ sinh thái LIME.
                        </p>
                    </div>

                    <!-- Live Connection Badge -->
                    <div class="docker-live-badge-wrapper">
                        <div class="docker-live-badge status-connecting" id="docker-live-badge">
                            <span class="live-dot"></span>
                            <span class="live-text" id="docker-live-text">Đang kết nối…</span>
                        </div>
                    </div>
                </div>

                <!-- Container Tabs -->
                <div class="docker-tabs-bar" role="tablist" aria-label="Danh sách containers">
                    ${CONTAINERS.map(
                        (c) => `
                        <button type="button" class="docker-tab-btn ${c.id === this.activeContainer ? 'active' : ''}"
                                data-container="${c.id}" role="tab" aria-selected="${c.id === this.activeContainer ? 'true' : 'false'}">
                            <span class="tab-status-dot dot-unknown" id="tab-dot-${c.id}"></span>
                            <div class="tab-btn-content">
                                <span class="tab-btn-name">${c.name}</span>
                                <span class="tab-btn-desc">${c.label}</span>
                            </div>
                        </button>
                    `
                    ).join('')}
                </div>

                <!-- Toolbar Actions -->
                <div class="docker-toolbar">
                    <div class="docker-toolbar-left">
                        <div class="docker-search-box">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                            <input type="text" id="docker-log-search" placeholder="Lọc từ khóa (vd: ERROR, WARN, POST)..." value="${escapeHtml(this.filterText)}">
                            <button type="button" id="docker-search-clear" class="docker-search-clear-btn" style="display: none;">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                            </button>
                        </div>

                        <div class="docker-tail-select-wrapper">
                            <label for="docker-tail-select">Số dòng ban đầu:</label>
                            <select id="docker-tail-select" class="select-custom">
                                <option value="50" ${this.tailLines === 50 ? 'selected' : ''}>50 dòng</option>
                                <option value="100" ${this.tailLines === 100 ? 'selected' : ''}>100 dòng</option>
                                <option value="200" ${this.tailLines === 200 ? 'selected' : ''}>200 dòng</option>
                                <option value="500" ${this.tailLines === 500 ? 'selected' : ''}>500 dòng</option>
                                <option value="1000" ${this.tailLines === 1000 ? 'selected' : ''}>1000 dòng</option>
                            </select>
                        </div>
                    </div>

                    <div class="docker-toolbar-right">
                        <label class="docker-toggle-label" title="Tự động cuộn xuống cuối khi có log mới">
                            <input type="checkbox" id="docker-autoscroll-toggle" ${this.autoScroll ? 'checked' : ''}>
                            <span>Tự cuộn</span>
                        </label>

                        <button type="button" class="btn btn-secondary btn-sm" id="docker-btn-pause" title="Tạm dừng / Tiếp tục stream">
                            <span id="docker-pause-icon">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                            </span>
                            <span id="docker-pause-text">Tạm dừng</span>
                        </button>

                        <button type="button" class="btn btn-secondary btn-sm" id="docker-btn-clear" title="Xóa màn hình console hiện tại">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            <span>Xóa</span>
                        </button>

                        <button type="button" class="btn btn-secondary btn-sm" id="docker-btn-copy" title="Sao chép toàn bộ log hiển thị">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                            <span>Copy</span>
                        </button>

                        <button type="button" class="btn btn-secondary btn-sm" id="docker-btn-download" title="Tải file log về máy (.txt)">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            <span>Tải log</span>
                        </button>
                    </div>
                </div>

                <!-- Terminal Window Container -->
                <div class="docker-terminal-card">
                    <div class="docker-terminal-titlebar">
                        <div class="terminal-dots">
                            <span class="dot dot-red"></span>
                            <span class="dot dot-yellow"></span>
                            <span class="dot dot-green"></span>
                        </div>
                        <div class="terminal-title" id="terminal-current-title">
                            ${this.activeContainer} — bash (docker logs -f)
                        </div>
                        <div class="terminal-meta" id="terminal-line-count">
                            0 dòng
                        </div>
                    </div>

                    <div class="docker-terminal-body" id="docker-terminal-body" tabindex="0" role="region" aria-label="Nội dung log">
                        <div class="terminal-content" id="docker-terminal-content"></div>
                    </div>
                </div>
            </div>
        `;
    },

    bindEvents() {
        // Tab switching
        const tabs = this.containerEl.querySelectorAll('.docker-tab-btn');
        tabs.forEach((tab) => {
            tab.addEventListener('click', () => {
                const target = tab.dataset.container;
                if (target && target !== this.activeContainer) {
                    this.switchContainer(target);
                }
            });
        });

        // Search / filter input
        const searchInput = this.containerEl.querySelector('#docker-log-search');
        const clearBtn = this.containerEl.querySelector('#docker-search-clear');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.filterText = e.target.value;
                if (clearBtn) clearBtn.style.display = this.filterText ? 'block' : 'none';
                this.renderTerminalContent();
            });
        }
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.filterText = '';
                searchInput.value = '';
                clearBtn.style.display = 'none';
                this.renderTerminalContent();
            });
        }

        // Tail select
        const tailSelect = this.containerEl.querySelector('#docker-tail-select');
        if (tailSelect) {
            tailSelect.addEventListener('change', (e) => {
                this.tailLines = parseInt(e.target.value, 10) || 100;
                this.logLines = [];
                this.startStream(this.activeContainer);
            });
        }

        // Auto-scroll toggle
        const autoScrollToggle = this.containerEl.querySelector('#docker-autoscroll-toggle');
        if (autoScrollToggle) {
            autoScrollToggle.addEventListener('change', (e) => {
                this.autoScroll = e.target.checked;
                if (this.autoScroll) this.scrollToBottom();
            });
        }

        // Pause button
        const pauseBtn = this.containerEl.querySelector('#docker-btn-pause');
        if (pauseBtn) {
            pauseBtn.addEventListener('click', () => {
                this.togglePause();
            });
        }

        // Clear button
        const clearConsoleBtn = this.containerEl.querySelector('#docker-btn-clear');
        if (clearConsoleBtn) {
            clearConsoleBtn.addEventListener('click', () => {
                this.logLines = [];
                this.renderTerminalContent();
                Toast.info('Đã xóa bộ đệm hiển thị console');
            });
        }

        // Copy button
        const copyBtn = this.containerEl.querySelector('#docker-btn-copy');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                this.copyCurrentLogs();
            });
        }

        // Download button
        const downloadBtn = this.containerEl.querySelector('#docker-btn-download');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                const url = AdminApi.getDockerLogDownloadUrl(this.activeContainer, Math.max(this.tailLines, 1000));
                window.open(url, '_blank');
            });
        }

        // Smart scroll detection on terminal body
        const terminalBody = this.containerEl.querySelector('#docker-terminal-body');
        if (terminalBody) {
            terminalBody.addEventListener('scroll', () => {
                const atBottom = terminalBody.scrollHeight - terminalBody.scrollTop <= terminalBody.clientHeight + 40;
                if (!atBottom && this.autoScroll) {
                    // Người dùng cuộn ngược lên để xem log cũ -> Tạm dừng tự cuộn
                    this.autoScroll = false;
                    if (autoScrollToggle) autoScrollToggle.checked = false;
                } else if (atBottom && !this.autoScroll) {
                    // Người dùng đã cuộn sát đáy -> Tự động bật lại tự cuộn
                    this.autoScroll = true;
                    if (autoScrollToggle) autoScrollToggle.checked = true;
                }
            });
        }
    },

    switchContainer(containerName) {
        this.activeContainer = containerName;
        this.logLines = [];

        // Cập nhật tab active
        const tabs = this.containerEl.querySelectorAll('.docker-tab-btn');
        tabs.forEach((tab) => {
            const isMatch = tab.dataset.container === containerName;
            tab.classList.toggle('active', isMatch);
            tab.setAttribute('aria-selected', isMatch ? 'true' : 'false');
        });

        // Cập nhật titlebar terminal
        const titleEl = this.containerEl.querySelector('#terminal-current-title');
        if (titleEl) {
            titleEl.textContent = `${containerName} — bash (docker logs -f)`;
        }

        this.startStream(containerName);
    },

    togglePause() {
        this.isPaused = !this.isPaused;
        const pauseBtn = this.containerEl.querySelector('#docker-btn-pause');
        const pauseText = this.containerEl.querySelector('#docker-pause-text');
        const pauseIcon = this.containerEl.querySelector('#docker-pause-icon');

        if (this.isPaused) {
            this.setConnectionStatus('paused', 'Tạm dừng');
            if (pauseText) pauseText.textContent = 'Tiếp tục';
            if (pauseIcon) {
                pauseIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
            }
            if (pauseBtn) pauseBtn.classList.add('btn-warning');
        } else {
            this.setConnectionStatus('live', 'LIVE: Đang stream');
            if (pauseText) pauseText.textContent = 'Tạm dừng';
            if (pauseIcon) {
                pauseIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
            }
            if (pauseBtn) pauseBtn.classList.remove('btn-warning');
            if (this.autoScroll) this.scrollToBottom();
        }
    },

    startStream(containerName) {
        this.stopStream();
        this.setConnectionStatus('connecting', 'Đang kết nối...');

        const url = AdminApi.getDockerLogStreamUrl(containerName, this.tailLines);

        try {
            this.eventSource = new EventSource(url);

            this.eventSource.addEventListener('connected', () => {
                if (!this.isPaused) {
                    this.setConnectionStatus('live', 'LIVE: Đang stream trực tiếp');
                }
            });

            this.eventSource.addEventListener('log', (event) => {
                if (this.isPaused) return;

                try {
                    const data = JSON.parse(event.data);
                    this.appendLogLine(data.text, data.stream || 'stdout', data.timestamp);
                } catch {
                    this.appendLogLine(event.data, 'stdout');
                }
            });

            this.eventSource.addEventListener('err', (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.appendLogLine(`[HỆ THỐNG] Lỗi log stream: ${data.message}`, 'stderr');
                } catch {
                    this.appendLogLine(`[HỆ THỐNG] Lỗi log stream: ${event.data}`, 'stderr');
                }
                this.setConnectionStatus('error', 'Lỗi stream');
            });

            this.eventSource.addEventListener('end', () => {
                this.setConnectionStatus('closed', 'Đã ngắt kết nối');
            });

            this.eventSource.onerror = (err) => {
                console.warn('[DockerLogs] Lỗi kết nối EventSource:', err);
                this.setConnectionStatus('error', 'Mất kết nối — Đang thử lại...');
            };
        } catch (err) {
            console.error('[DockerLogs] Không thể khởi tạo EventSource:', err);
            this.setConnectionStatus('error', 'Lỗi khởi tạo');
        }
    },

    stopStream() {
        if (this.eventSource) {
            try {
                this.eventSource.close();
            } catch {}
            this.eventSource = null;
        }
    },

    appendLogLine(text, stream = 'stdout', timestamp = null) {
        // Tách các dòng xuống hàng nếu có
        const subLines = text.split('\n');
        subLines.forEach((line) => {
            if (line === '' && subLines.length > 1) return;
            this.logLines.push({
                text: line,
                stream,
                timestamp: timestamp || new Date().toISOString(),
                id: Math.random().toString(36).slice(2, 9),
            });
        });

        // Giới hạn buffer tối đa để không gây nặng DOM
        if (this.logLines.length > this.maxLines) {
            this.logLines.splice(0, this.logLines.length - this.maxLines);
        }

        this.renderTerminalContent();

        if (this.autoScroll && !this.isPaused) {
            this.scrollToBottom();
        }
    },

    renderTerminalContent() {
        const contentEl = this.containerEl?.querySelector('#docker-terminal-content');
        const countEl = this.containerEl?.querySelector('#terminal-line-count');
        if (!contentEl) return;

        let filtered = this.logLines;
        if (this.filterText.trim()) {
            const query = this.filterText.toLowerCase();
            filtered = this.logLines.filter((l) => l.text.toLowerCase().includes(query));
        }

        if (countEl) {
            countEl.textContent = `${filtered.length} dòng${this.filterText ? ` (lọc từ ${this.logLines.length})` : ''}`;
        }

        if (filtered.length === 0) {
            if (this.logLines.length === 0) {
                contentEl.innerHTML = `
                    <div class="terminal-placeholder">
                        <span class="spinner-inline"></span>
                        <span>Đang chờ dữ liệu log từ container <code>${escapeHtml(this.activeContainer)}</code>...</span>
                    </div>
                `;
            } else {
                contentEl.innerHTML = `
                    <div class="terminal-placeholder">
                        <span>Không có dòng log nào khớp với từ khóa "<strong>${escapeHtml(this.filterText)}</strong>".</span>
                    </div>
                `;
            }
            return;
        }

        const html = filtered
            .map((line, idx) => {
                const formattedText = this.formatLineText(line.text, this.filterText);
                const streamClass = line.stream === 'stderr' ? 'stream-stderr' : 'stream-stdout';
                const levelClass = this.detectLogLevelClass(line.text);

                return `
                    <div class="terminal-row ${streamClass} ${levelClass}">
                        <span class="row-num">${idx + 1}</span>
                        <span class="row-text">${formattedText}</span>
                    </div>
                `;
            })
            .join('');

        contentEl.innerHTML = html;
    },

    detectLogLevelClass(text) {
        if (/error|exception|fail|failed|fatal|uncaught/i.test(text)) return 'log-level-error';
        if (/warn|warning/i.test(text)) return 'log-level-warn';
        if (/info|success|200 ok|completed/i.test(text)) return 'log-level-info';
        return '';
    },

    formatLineText(text, searchQuery) {
        // Loại bỏ mã ANSI escape sequences
        const clean = text.replace(/\x1b\[[0-9;]*m/g, '');
        let escaped = escapeHtml(clean);

        // Highlight từ khóa tìm kiếm nếu có
        if (searchQuery && searchQuery.trim()) {
            const reg = new RegExp(`(${escapeRegExp(searchQuery)})`, 'gi');
            escaped = escaped.replace(reg, '<mark class="log-highlight">$1</mark>');
        }

        // Highlight HTTP method tags
        escaped = escaped.replace(
            /\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/g,
            '<span class="badge-http-method">$1</span>'
        );

        // Highlight timestamps định dạng ISO ở đầu dòng
        escaped = escaped.replace(
            /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z?)/,
            '<span class="log-time-prefix">$1</span>'
        );

        return escaped;
    },

    scrollToBottom() {
        const bodyEl = this.containerEl?.querySelector('#docker-terminal-body');
        if (bodyEl) {
            requestAnimationFrame(() => {
                bodyEl.scrollTop = bodyEl.scrollHeight;
            });
        }
    },

    setConnectionStatus(status, label) {
        this.connectionStatus = status;
        const badge = this.containerEl?.querySelector('#docker-live-badge');
        const text = this.containerEl?.querySelector('#docker-live-text');
        if (badge) {
            badge.className = `docker-live-badge status-${status}`;
        }
        if (text) {
            text.textContent = label;
        }
    },

    updateContainerTabsUI() {
        CONTAINERS.forEach((c) => {
            const dot = this.containerEl?.querySelector(`#tab-dot-${c.id}`);
            const info = this.containersStatus[c.id];
            if (dot) {
                dot.className = 'tab-status-dot';
                if (info && info.running) {
                    dot.classList.add('dot-running');
                    dot.title = `Đang chạy (${info.status || 'Up'})`;
                } else if (info) {
                    dot.classList.add('dot-stopped');
                    dot.title = `Đã dừng (${info.status || 'Exited'})`;
                } else {
                    dot.classList.add('dot-unknown');
                    dot.title = 'Trạng thái không xác định';
                }
            }
        });
    },

    copyCurrentLogs() {
        const text = this.logLines.map((l) => l.text).join('\n');
        if (!text) {
            Toast.info('Không có log để sao chép');
            return;
        }
        navigator.clipboard
            .writeText(text)
            .then(() => Toast.success(`Đã sao chép ${this.logLines.length} dòng log vào bộ nhớ tạm`))
            .catch(() => Toast.error('Không thể sao chép vào bộ nhớ tạm'));
    },
};

function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
