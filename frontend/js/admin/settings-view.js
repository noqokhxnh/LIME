/**
 * System Settings View
 * Aligned with .env.example LLM & TTS provider definitions.
 * Minimalist, high-contrast, zero emojis.
 */

import { AdminApi } from './api.js';
import { Toast } from './components.js';

const LLM_PROVIDERS = [
    {
        id: 'deepseek',
        name: 'DeepSeek AI',
        badge: 'Khuyên dùng',
        badgeType: 'badge-success',
        models: [
            { id: 'deepseek-chat', label: 'deepseek-chat (Mặc định kịch bản)' },
            { id: 'deepseek-reasoner', label: 'deepseek-reasoner (Suy luận sâu)' },
        ],
        defaultModel: 'deepseek-chat',
        envKey: 'DEEPSEEK_API_KEY',
        description: 'Tối ưu chi phí, hỗ trợ JSON Mode, sinh kịch bản video tiếng Việt mượt mà.'
    },
    {
        id: 'gemini',
        name: 'Google Gemini',
        badge: 'Tốc độ cao',
        badgeType: 'badge-info',
        models: [
            { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro (Mặc định chất lượng cao)' },
            { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash (Phản hồi nhanh)' },
            { id: 'gemini-3.5-flash', label: 'gemini-3.5-flash (Thế hệ mới)' },
        ],
        defaultModel: 'gemini-2.5-pro',
        envKey: 'GEMINI_API_KEY',
        description: 'Độ trễ thấp, context window lớn, tự động chuyển đổi candidate model khi nghẽn.'
    },
    {
        id: 'claude',
        name: 'Anthropic Claude',
        badge: 'Chất lượng cao',
        badgeType: 'badge-info',
        models: [
            { id: 'claude-sonnet-4-20250514', label: 'claude-sonnet-4-20250514 (Mặc định)' },
            { id: 'claude-sonnet-4.5', label: 'claude-sonnet-4.5' },
        ],
        defaultModel: 'claude-sonnet-4-20250514',
        envKey: 'ANTHROPIC_API_KEY',
        description: 'Kịch bản điện ảnh sắc sảo, tuân thủ chặt chẽ HTML/CSS/GSAP contract.'
    },
    {
        id: 'openai',
        name: 'OpenAI GPT',
        badge: 'Tiêu chuẩn',
        badgeType: '',
        models: [
            { id: 'gpt-4o', label: 'gpt-4o (Mặc định Omni)' },
            { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
        ],
        defaultModel: 'gpt-4o',
        envKey: 'OPENAI_API_KEY',
        description: 'Độ ổn định cao, cấu trúc JSON chặt chẽ và nhất quán.'
    },
    {
        id: '9router',
        name: '9router (Local AI Gateway)',
        badge: 'Local AI',
        badgeType: 'badge-warning',
        models: [
            { id: 'ag/gemini-3.8-flash-high', label: 'ag/gemini-3.8-flash-high (Mặc định)' },
            { id: 'oc/deepseek-v4.1-flash-free', label: 'oc/deepseek-v4.1-flash-free (Miễn phí)' },
        ],
        defaultModel: 'ag/gemini-3.8-flash-high',
        envKey: 'NINEROUTER_API_KEY',
        description: 'Cổng Gateway Local AI (http://localhost:20128/v1), tự động đọc API Key từ sqlite.'
    },
];

const TTS_PROVIDERS = [
    {
        id: 'edge',
        name: 'Edge TTS (Miễn phí 100%)',
        badge: 'Miễn phí',
        badgeType: 'badge-success',
        voices: [
            { id: 'vi-VN-HoaiMyNeural', label: 'vi-VN-HoaiMyNeural (Nữ - Truyền cảm, khuyên dùng)' },
            { id: 'vi-VN-NamMinhNeural', label: 'vi-VN-NamMinhNeural (Nam - Trầm ấm, rõ ràng)' },
        ],
        defaultVoice: 'vi-VN-HoaiMyNeural',
        description: 'Không cần API Key, chất lượng nơ-ron tự nhiên, ổn định cao.'
    },
    {
        id: 'vieneu',
        name: 'VieNeu-TTS (Local AI Offline)',
        badge: 'Offline Docker',
        badgeType: 'badge-info',
        voices: [
            { id: 'Minh Quân', label: 'Minh Quân (Nam chuẩn miền Bắc)' },
            { id: 'Mai Anh', label: 'Mai Anh (Nữ chuẩn miền Bắc)' },
            { id: 'Adam', label: 'Adam' },
            { id: 'Ái Hân', label: 'Ái Hân (Nữ ngọt ngào)' },
            { id: 'Mỹ Duyên', label: 'Mỹ Duyên (Nữ truyền cảm)' },
            { id: 'Đức Trí', label: 'Đức Trí' },
            { id: 'Hữu Quân', label: 'Hữu Quân' },
            { id: 'Xuân Tiên', label: 'Xuân Tiên' },
            { id: 'Trúc Ly', label: 'Trúc Ly' },
            { id: 'Anh Khôi', label: 'Anh Khôi' },
            { id: 'Mạnh Dũng', label: 'Mạnh Dũng' },
        ],
        defaultVoice: 'Minh Quân',
        envKey: 'VIENEU_TTS_URL',
        description: '100% Offline chạy qua Docker/Python cổng 7860 (http://127.0.0.1:7860).'
    },
    {
        id: 'openai',
        name: 'OpenAI Text-to-Speech',
        badge: 'Studio Voice',
        badgeType: 'badge-info',
        voices: [
            { id: 'alloy', label: 'alloy (Mặc định trung tính)' },
            { id: 'echo', label: 'echo (Nam ấm áp)' },
            { id: 'fable', label: 'fable (Kể chuyện truyền cảm)' },
            { id: 'onyx', label: 'onyx (Nam trầm sâu lắng)' },
            { id: 'nova', label: 'nova (Nữ năng động)' },
            { id: 'shimmer', label: 'shimmer (Nữ trong trẻo)' },
        ],
        defaultVoice: 'alloy',
        envKey: 'OPENAI_API_KEY',
        description: 'Giọng đọc chuẩn phòng thu quốc tế, âm hưởng sống động.'
    },
    {
        id: 'google',
        name: 'Google Cloud TTS',
        badge: 'Cloud Neural',
        badgeType: '',
        voices: [
            { id: 'vi-VN-Standard-A', label: 'vi-VN-Standard-A (Nữ Standard)' },
            { id: 'vi-VN-Standard-B', label: 'vi-VN-Standard-B (Nam Standard)' },
            { id: 'vi-VN-Wavenet-A', label: 'vi-VN-Wavenet-A (Nữ WaveNet)' },
            { id: 'vi-VN-Wavenet-B', label: 'vi-VN-Wavenet-B (Nam WaveNet)' },
        ],
        defaultVoice: 'vi-VN-Standard-A',
        envKey: 'GOOGLE_TTS_API_KEY',
        description: 'Google Cloud Speech Synthesis, đa dạng giọng tiếng Việt chuẩn.'
    },
    {
        id: 'elevenlabs',
        name: 'ElevenLabs AI Voice',
        badge: 'Premium Clone',
        badgeType: 'badge-warning',
        voices: [],
        defaultVoice: '',
        envKey: 'ELEVENLABS_API_KEY',
        description: 'Công nghệ giọng đọc cảm xúc cao cấp, cho phép nhập Custom Voice ID.'
    },
];

export const SettingsView = {
    containerEl: null,
    providersStatus: { llm: {}, tts: {} },

    init(container) {
        this.containerEl = container;
        this.renderStructure();
        this.fetchSettings();
    },

    renderStructure() {
        this.containerEl.innerHTML = `
            <div style="max-width: 900px; display: flex; flex-direction: column; gap: 24px;">
                <form id="admin-settings-form" style="display: flex; flex-direction: column; gap: 24px;">

                    <!-- Card 1: LLM Provider Configuration -->
                    <div class="table-panel" style="padding: 24px;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
                            <div>
                                <div style="font-size: 15px; font-weight: 700; color: var(--text-main);">Nhà cung cấp LLM (Sinh Kịch Bản Video)</div>
                                <div style="font-size: 12px; color: var(--text-dim); margin-top: 2px;">Cấu hình mô hình ngôn ngữ lớn theo danh mục nhà cung cấp trong tệp .env.example.</div>
                            </div>
                            <span class="badge badge-info" id="llm-status-badge">Đang tải...</span>
                        </div>

                        <div class="form-row-2">
                            <div class="form-group">
                                <label class="form-label" for="setting-llm-provider">Nhà cung cấp LLM mặc định</label>
                                <select class="select-custom" id="setting-llm-provider" style="width: 100%;">
                                    ${LLM_PROVIDERS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label" for="setting-llm-model">Mô hình AI (LLM Model)</label>
                                <input type="text" class="form-input" id="setting-llm-model" list="llm-model-datalist" placeholder="vd: deepseek-chat">
                                <datalist id="llm-model-datalist"></datalist>
                            </div>
                        </div>

                        <!-- Quick Model Suggestions -->
                        <div style="margin-top: 10px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <span style="font-size: 11px; color: var(--text-dim);">Gợi ý model:</span>
                            <div id="llm-model-chips" style="display: flex; gap: 6px; flex-wrap: wrap;"></div>
                        </div>

                        <!-- Provider Info & Status Box -->
                        <div style="margin-top: 14px; padding: 12px 14px; background: var(--bg-surface-alt); border: 1px solid var(--border-color); border-radius: var(--radius-md); display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
                            <div style="font-size: 12px; color: var(--text-muted); line-height: 1.5;" id="llm-provider-description"></div>
                            <button type="button" class="btn btn-secondary" id="btn-test-llm" style="height: 32px; font-size: 12px; white-space: nowrap;">Kiểm tra kết nối LLM</button>
                        </div>
                    </div>

                    <!-- Card 2: TTS Voice Provider Configuration -->
                    <div class="table-panel" style="padding: 24px;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
                            <div>
                                <div style="font-size: 15px; font-weight: 700; color: var(--text-main);">Động cơ Giọng Đọc Lồng Tiếng (TTS Voice)</div>
                                <div style="font-size: 12px; color: var(--text-dim); margin-top: 2px;">Cấu hình giọng đọc thuyết minh và động cơ chuyển văn bản thành tiếng nói.</div>
                            </div>
                            <span class="badge badge-success" id="tts-status-badge">Đang tải...</span>
                        </div>

                        <div class="form-row-2">
                            <div class="form-group">
                                <label class="form-label" for="setting-tts-provider">Động cơ TTS mặc định</label>
                                <select class="select-custom" id="setting-tts-provider" style="width: 100%;">
                                    ${TTS_PROVIDERS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label" for="setting-tts-voice">Giọng đọc (Voice / Voice ID)</label>
                                <input type="text" class="form-input" id="setting-tts-voice" list="tts-voice-datalist" placeholder="vd: vi-VN-HoaiMyNeural">
                                <datalist id="tts-voice-datalist"></datalist>
                            </div>
                        </div>

                        <!-- Quick Voice Suggestions -->
                        <div style="margin-top: 10px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <span style="font-size: 11px; color: var(--text-dim);">Gợi ý giọng đọc:</span>
                            <div id="tts-voice-chips" style="display: flex; gap: 6px; flex-wrap: wrap;"></div>
                        </div>

                        <!-- Sample Sentence Input for Voice Testing -->
                        <div class="form-group" style="margin-top: 14px;">
                            <label class="form-label" for="setting-tts-sample-text">Văn bản mẫu nghe thử giọng đọc</label>
                            <input type="text" class="form-input" id="setting-tts-sample-text" value="Xin chào! Đây là giọng đọc thử nghiệm của hệ thống LIME VidTML." placeholder="Nhập câu nói ví dụ để nghe thử giọng...">
                        </div>

                        <!-- Audio Player Preview Container -->
                        <div id="tts-audio-preview-container" style="display: none; margin-top: 14px; padding: 12px 14px; background: var(--bg-surface-alt); border: 1px solid var(--border-color); border-radius: var(--radius-md);">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                <span style="font-size: 12px; font-weight: 600; color: var(--text-main);" id="tts-audio-preview-title">Mẫu phát giọng đọc:</span>
                                <span style="font-size: 11px; color: var(--text-dim); font-family: var(--font-mono);" id="tts-audio-preview-time"></span>
                            </div>
                            <audio id="tts-audio-player" controls style="width: 100%; height: 36px; outline: none;"></audio>
                        </div>

                        <!-- TTS Provider Info & Test Box -->
                        <div style="margin-top: 14px; padding: 12px 14px; background: var(--bg-surface-alt); border: 1px solid var(--border-color); border-radius: var(--radius-md); display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
                            <div style="font-size: 12px; color: var(--text-muted); line-height: 1.5; flex: 1; min-width: 240px;" id="tts-provider-description"></div>
                            <div style="display: flex; gap: 8px;">
                                <button type="button" class="btn btn-secondary" id="btn-test-tts" style="height: 32px; font-size: 12px; white-space: nowrap;">Kiểm tra kết nối</button>
                                <button type="button" class="btn btn-primary" id="btn-play-tts-sample" style="height: 32px; font-size: 12px; white-space: nowrap;">Nghe thử giọng đọc</button>
                            </div>
                        </div>
                    </div>

                    <!-- Card 3: Operations & Resource Limits -->
                    <div class="table-panel" style="padding: 24px;">
                        <div style="font-size: 15px; font-weight: 700; color: var(--text-main); margin-bottom: 4px;">Vận Hành Hệ Thống & Hạn Mức</div>
                        <div style="font-size: 12px; color: var(--text-dim); margin-bottom: 20px;">Quản lý luồng xử lý video song song, chính sách credits đăng ký và chế độ hệ thống.</div>

                        <div class="form-row-2">
                            <div class="form-group">
                                <label class="form-label" for="setting-render-concurrency">Giới hạn render song song (Parallel Concurrency)</label>
                                <input type="number" class="form-input" id="setting-render-concurrency" min="1" max="16" value="4">
                                <span style="font-size: 11px; color: var(--text-dim);">Số tiến trình Chromium chạy render đồng thời (RENDER_MAX_CONCURRENCY).</span>
                            </div>
                            <div class="form-group">
                                <label class="form-label" for="setting-free-credits">Credits tặng khi đăng ký mới</label>
                                <input type="number" class="form-input" id="setting-free-credits" min="0" max="1000" value="20">
                                <span style="font-size: 11px; color: var(--text-dim);">Số credits cấp mặc định cho tài khoản người dùng mới tạo.</span>
                            </div>
                        </div>

                        <div class="form-group" style="margin-top: 14px;">
                            <label class="form-label" for="setting-system-notice">Thông báo toàn hệ thống (Global Notice Banner)</label>
                            <input type="text" class="form-input" id="setting-system-notice" placeholder="Nội dung banner thông báo hiển thị cho tất cả người dùng (để trống nếu không có)...">
                        </div>

                        <!-- System Toggles Grid -->
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--border-color);">
                            <!-- Toggle: Registration -->
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; background: var(--bg-surface-alt); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
                                <div>
                                    <div style="font-size: 12px; font-weight: 600; color: var(--text-main);">Mở đăng ký tự do</div>
                                    <div style="font-size: 11px; color: var(--text-dim);">Cho phép người dùng mới tạo tài khoản</div>
                                </div>
                                <label class="status-toggle">
                                    <input type="checkbox" id="setting-registration-enabled" checked>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>

                            <!-- Toggle: Sandbox Payments -->
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; background: var(--bg-surface-alt); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
                                <div>
                                    <div style="font-size: 12px; font-weight: 600; color: var(--text-main);">Thanh toán Sandbox</div>
                                    <div style="font-size: 11px; color: var(--text-dim);">Hiển thị nút giả lập thanh toán test</div>
                                </div>
                                <label class="status-toggle">
                                    <input type="checkbox" id="setting-sandbox-payments" checked>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>

                            <!-- Toggle: Maintenance Mode -->
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; background: var(--bg-surface-alt); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
                                <div>
                                    <div style="font-size: 12px; font-weight: 600; color: var(--text-main);">Chế độ bảo trì</div>
                                    <div style="font-size: 11px; color: var(--text-dim);">Tạm dừng nhận job tạo video mới</div>
                                </div>
                                <label class="status-toggle">
                                    <input type="checkbox" id="setting-maintenance-mode">
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>
                        </div>
                    </div>

                    <!-- Submit Actions -->
                    <div style="display: flex; justify-content: flex-end; gap: 12px; padding-bottom: 30px;">
                        <button type="submit" class="btn btn-primary" id="btn-save-settings" style="height: 40px; padding: 0 24px; font-size: 13px; font-weight: 600;">
                            Lưu cấu hình hệ thống
                        </button>
                    </div>
                </form>
            </div>
        `;

        this.bindEvents();
    },

    bindEvents() {
        const form = this.containerEl.querySelector('#admin-settings-form');
        const llmSelect = this.containerEl.querySelector('#setting-llm-provider');
        const ttsSelect = this.containerEl.querySelector('#setting-tts-provider');
        const btnTestLlm = this.containerEl.querySelector('#btn-test-llm');
        const btnTestTts = this.containerEl.querySelector('#btn-test-tts');
        const btnPlayTts = this.containerEl.querySelector('#btn-play-tts-sample');

        form.onsubmit = (e) => {
            e.preventDefault();
            this.saveSettings();
        };

        llmSelect.onchange = () => {
            this.onLlmProviderChange(true);
        };

        ttsSelect.onchange = () => {
            this.onTtsProviderChange(true);
        };

        btnTestLlm.onclick = () => this.testLlm();
        btnTestTts.onclick = () => this.testTts();
        if (btnPlayTts) {
            btnPlayTts.onclick = () => this.playTtsSample();
        }
    },

    onLlmProviderChange(autoSelectDefaultModel = false) {
        const providerId = this.containerEl.querySelector('#setting-llm-provider').value;
        const provider = LLM_PROVIDERS.find((p) => p.id === providerId) || LLM_PROVIDERS[0];
        const modelInput = this.containerEl.querySelector('#setting-llm-model');
        const datalist = this.containerEl.querySelector('#llm-model-datalist');
        const chipsContainer = this.containerEl.querySelector('#llm-model-chips');
        const descEl = this.containerEl.querySelector('#llm-provider-description');
        const statusBadge = this.containerEl.querySelector('#llm-status-badge');

        // Update datalist options
        datalist.innerHTML = provider.models.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');

        // Update chips
        chipsContainer.innerHTML = provider.models.map((m) => `
            <button type="button" class="btn btn-secondary" style="height: 24px; padding: 0 8px; font-size: 11px; border-radius: 4px;" data-model="${m.id}">
                ${m.id}
            </button>
        `).join('');

        chipsContainer.querySelectorAll('button[data-model]').forEach((btn) => {
            btn.onclick = () => {
                modelInput.value = btn.dataset.model;
            };
        });

        // Auto select default model if asked or if current model is empty
        if (autoSelectDefaultModel || !modelInput.value.trim()) {
            modelInput.value = provider.defaultModel;
        }

        // Update Description
        const keyStatus = this.providersStatus.llm?.[provider.id];
        let keyText = '';
        if (provider.id === '9router') {
            keyText = 'Khóa: Tự động phát hiện qua SQLite hoặc NINEROUTER_API_KEY';
        } else if (keyStatus?.configured) {
            keyText = `Đã cấu hình ${provider.envKey} trong .env`;
        } else {
            keyText = `Chưa cấu hình ${provider.envKey} trong .env`;
        }

        descEl.innerHTML = `<strong>${provider.name}:</strong> ${provider.description} <br><span style="color: var(--text-dim); font-size: 11px;">${keyText}</span>`;

        // Update Badge
        if (keyStatus?.configured || provider.id === '9router') {
            statusBadge.className = 'badge badge-success';
            statusBadge.textContent = 'Khóa API Đã Sẵn Sàng';
        } else {
            statusBadge.className = 'badge badge-warning';
            statusBadge.textContent = `Chưa Cấu Hình ${provider.envKey}`;
        }
    },

    onTtsProviderChange(autoSelectDefaultVoice = false) {
        const providerId = this.containerEl.querySelector('#setting-tts-provider').value;
        const provider = TTS_PROVIDERS.find((p) => p.id === providerId) || TTS_PROVIDERS[0];
        const voiceInput = this.containerEl.querySelector('#setting-tts-voice');
        const datalist = this.containerEl.querySelector('#tts-voice-datalist');
        const chipsContainer = this.containerEl.querySelector('#tts-voice-chips');
        const descEl = this.containerEl.querySelector('#tts-provider-description');
        const statusBadge = this.containerEl.querySelector('#tts-status-badge');

        // Update datalist options
        datalist.innerHTML = provider.voices.map((v) => `<option value="${v.id}">${v.label}</option>`).join('');

        // Update chips
        if (provider.voices.length > 0) {
            chipsContainer.innerHTML = provider.voices.slice(0, 4).map((v) => `
                <button type="button" class="btn btn-secondary" style="height: 24px; padding: 0 8px; font-size: 11px; border-radius: 4px;" data-voice="${v.id}">
                    ${v.id}
                </button>
            `).join('');

            chipsContainer.querySelectorAll('button[data-voice]').forEach((btn) => {
                btn.onclick = () => {
                    voiceInput.value = btn.dataset.voice;
                };
            });
        } else {
            chipsContainer.innerHTML = '<span style="font-size: 11px; color: var(--text-dim);">Nhập Voice ID từ bảng điều khiển ElevenLabs</span>';
        }

        // Auto select default voice if asked or if current voice is empty
        if (autoSelectDefaultVoice || !voiceInput.value.trim()) {
            voiceInput.value = provider.defaultVoice;
        }

        // Description & Badge
        const keyStatus = this.providersStatus.tts?.[provider.id];
        let keyText = '';
        if (provider.id === 'edge') {
            keyText = 'Dịch vụ miễn phí 100%, không yêu cầu API Key.';
            statusBadge.className = 'badge badge-success';
            statusBadge.textContent = 'Miễn Phí 100%';
        } else if (provider.id === 'vieneu') {
            keyText = 'Động cơ Offline: kết nối tới VIENEU_TTS_URL (mặc định: http://127.0.0.1:7860)';
            statusBadge.className = 'badge badge-info';
            statusBadge.textContent = 'Offline Docker';
        } else if (keyStatus?.configured) {
            keyText = `Đã cấu hình ${provider.envKey} trong .env`;
            statusBadge.className = 'badge badge-success';
            statusBadge.textContent = 'Khóa API Đã Sẵn Sàng';
        } else {
            keyText = `Chưa cấu hình ${provider.envKey} trong .env`;
            statusBadge.className = 'badge badge-warning';
            statusBadge.textContent = `Chưa Cấu Hình ${provider.envKey}`;
        }

        descEl.innerHTML = `<strong>${provider.name}:</strong> ${provider.description} <br><span style="color: var(--text-dim); font-size: 11px;">${keyText}</span>`;
    },

    async fetchSettings() {
        try {
            const res = await AdminApi.getSettings();
            const s = res.settings || {};
            this.providersStatus = res.providersStatus || { llm: {}, tts: {} };

            // LLM Settings
            const llmProvider = s.defaultLlmProvider || s.llmProvider || 'deepseek';
            const llmModel = s.defaultLlmModel || s.llmModel || 'deepseek-chat';
            const llmSelect = this.containerEl.querySelector('#setting-llm-provider');
            if (llmSelect) llmSelect.value = llmProvider;
            this.containerEl.querySelector('#setting-llm-model').value = llmModel;
            this.onLlmProviderChange(false);

            // TTS Settings
            const ttsProvider = s.defaultTtsProvider || s.ttsProvider || 'edge';
            const ttsVoice = s.defaultTtsVoice || s.ttsVoice || 'vi-VN-HoaiMyNeural';
            const ttsSelect = this.containerEl.querySelector('#setting-tts-provider');
            if (ttsSelect) ttsSelect.value = ttsProvider;
            this.containerEl.querySelector('#setting-tts-voice').value = ttsVoice;
            this.onTtsProviderChange(false);

            // Operational Limits
            this.containerEl.querySelector('#setting-render-concurrency').value = s.maxConcurrentJobs ?? s.renderConcurrency ?? 4;
            this.containerEl.querySelector('#setting-free-credits').value = s.freeCreditsOnRegister ?? 20;
            this.containerEl.querySelector('#setting-system-notice').value = s.systemNotice || '';

            // Toggles
            this.containerEl.querySelector('#setting-registration-enabled').checked = s.registrationEnabled !== false;
            this.containerEl.querySelector('#setting-sandbox-payments').checked = s.allowSandboxPayments !== false;
            this.containerEl.querySelector('#setting-maintenance-mode').checked = Boolean(s.maintenanceMode);

        } catch (err) {
            Toast.error(`Lỗi tải cấu hình hệ thống: ${err.message}`);
        }
    },

    async saveSettings() {
        const btnSave = this.containerEl.querySelector('#btn-save-settings');
        btnSave.disabled = true;
        btnSave.textContent = 'Đang lưu cấu hình...';

        const defaultLlmProvider = this.containerEl.querySelector('#setting-llm-provider').value;
        const defaultLlmModel = this.containerEl.querySelector('#setting-llm-model').value.trim();
        const defaultTtsProvider = this.containerEl.querySelector('#setting-tts-provider').value;
        const defaultTtsVoice = this.containerEl.querySelector('#setting-tts-voice').value.trim();
        const maxConcurrentJobs = parseInt(this.containerEl.querySelector('#setting-render-concurrency').value || '4', 10);
        const freeCreditsOnRegister = parseInt(this.containerEl.querySelector('#setting-free-credits').value || '20', 10);
        const systemNotice = this.containerEl.querySelector('#setting-system-notice').value.trim();
        const registrationEnabled = this.containerEl.querySelector('#setting-registration-enabled').checked;
        const allowSandboxPayments = this.containerEl.querySelector('#setting-sandbox-payments').checked;
        const maintenanceMode = this.containerEl.querySelector('#setting-maintenance-mode').checked;

        try {
            await AdminApi.updateSettings({
                defaultLlmProvider,
                defaultLlmModel,
                defaultTtsProvider,
                defaultTtsVoice,
                maxConcurrentJobs,
                freeCreditsOnRegister,
                systemNotice,
                registrationEnabled,
                allowSandboxPayments,
                maintenanceMode,
            });
            Toast.success('Đã lưu toàn bộ cấu hình hệ thống thành công!');
        } catch (err) {
            Toast.error(`Lỗi lưu cấu hình: ${err.message}`);
        } finally {
            btnSave.disabled = false;
            btnSave.textContent = 'Lưu cấu hình hệ thống';
        }
    },

    async testLlm() {
        const provider = this.containerEl.querySelector('#setting-llm-provider').value;
        const model = this.containerEl.querySelector('#setting-llm-model').value.trim();

        Toast.info(`Đang kiểm tra kết nối với LLM [${provider.toUpperCase()}]...`);
        try {
            const res = await AdminApi.testProvider(provider, model, 'llm');
            if (res.success) {
                Toast.success(res.message || `Kết nối ${provider} thành công!`);
            } else {
                Toast.error(res.message || `Kết nối ${provider} thất bại.`);
            }
        } catch (err) {
            Toast.error(`Lỗi kiểm tra kết nối: ${err.message}`);
        }
    },

    async testTts() {
        const provider = this.containerEl.querySelector('#setting-tts-provider').value;
        const voice = this.containerEl.querySelector('#setting-tts-voice').value.trim();

        Toast.info(`Đang kiểm tra động cơ giọng đọc [${provider.toUpperCase()}]...`);
        try {
            const res = await AdminApi.testProvider(provider, '', 'tts', voice);
            if (res.success) {
                Toast.success(res.message || `Động cơ ${provider} đã sẵn sàng!`);
            } else {
                Toast.error(res.message || `Động cơ ${provider} chưa sẵn sàng.`);
            }
        } catch (err) {
            Toast.error(`Lỗi kiểm tra động cơ: ${err.message}`);
        }
    },

    async playTtsSample() {
        const provider = this.containerEl.querySelector('#setting-tts-provider').value;
        const voice = this.containerEl.querySelector('#setting-tts-voice').value.trim();
        const sampleText = (this.containerEl.querySelector('#setting-tts-sample-text').value || '').trim() || 'Xin chào! Đây là giọng đọc thử nghiệm của hệ thống LIME VidTML.';
        const btnPlay = this.containerEl.querySelector('#btn-play-tts-sample');
        const previewContainer = this.containerEl.querySelector('#tts-audio-preview-container');
        const audioPlayer = this.containerEl.querySelector('#tts-audio-player');
        const previewTitle = this.containerEl.querySelector('#tts-audio-preview-title');
        const previewTime = this.containerEl.querySelector('#tts-audio-preview-time');

        btnPlay.disabled = true;
        btnPlay.textContent = 'Đang tổng hợp...';
        Toast.info(`Đang tạo giọng đọc mẫu cho [${voice || provider}]...`);

        try {
            const res = await AdminApi.testProvider(provider, '', 'tts', voice, sampleText, true);
            if (res.success && res.audioBase64) {
                previewContainer.style.display = 'block';
                previewTitle.textContent = `Mẫu giọng đọc [${res.voice || voice}] (${provider.toUpperCase()}):`;
                previewTime.textContent = `${res.latencyMs || 0}ms`;
                const audioSrc = `data:audio/mp3;base64,${res.audioBase64}`;
                audioPlayer.src = audioSrc;
                audioPlayer.play().catch(() => {});
                Toast.success(res.message || 'Đã phát mẫu giọng đọc thành công!');
            } else {
                Toast.error(res.message || 'Không thể tổng hợp giọng đọc mẫu.');
            }
        } catch (err) {
            Toast.error(`Lỗi nghe thử giọng đọc: ${err.message}`);
        } finally {
            btnPlay.disabled = false;
            btnPlay.textContent = 'Nghe thử giọng đọc';
        }
    }
};
