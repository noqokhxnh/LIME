/**
 * Interactive In-Browser GSAP Live Preview Player (Issue #36)
 * 
 * Trình phát preview trực tiếp trong browser cho phép:
 * - Xem chuyển động GSAP mượt mà
 * - Tua timeline (scrubbing) thời gian thực
 * - Đồng bộ âm thanh TTS
 * - Điều hướng giữa các scene
 * 
 * Sử dụng window.__seekTo(time) từ HTML đã assemble.
 */

export class PreviewPlayer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            throw new Error(`Container #${containerId} not found`);
        }
        
        this.jobId = null;
        this.iframe = null;
        this.audio = null;
        this.isPlaying = false;
        this.duration = 0;
        this.currentTime = 0;
        this.scenes = [];
        this.playInterval = null;
        
        this.initUI();
    }
    
    initUI() {
        this.container.innerHTML = `
            <div class="preview-player">
                <div class="pp-viewport">
                    <iframe id="pp-iframe" sandbox="allow-scripts allow-same-origin" 
                            style="width:100%;height:100%;border:none;"></iframe>
                    <div class="pp-loading">Đang tải preview...</div>
                </div>
                <div class="pp-controls">
                    <button class="pp-btn" id="pp-play" title="Phát/Tạm dừng">▶</button>
                    <button class="pp-btn" id="pp-rewind" title="Về đầu">⏮</button>
                    <button class="pp-btn" id="pp-prev-scene" title="Scene trước">◀ Scene</button>
                    <button class="pp-btn" id="pp-next-scene" title="Scene sau">Scene ▶</button>
                    <input type="range" id="pp-scrubber" min="0" max="100" value="0" step="0.1">
                    <span class="pp-time" id="pp-time">00:00 / 00:00</span>
                </div>
                <audio id="pp-audio" preload="auto"></audio>
            </div>
        `;
        
        this.iframe = this.container.querySelector(#pp-iframe);
        this.audio = this.container.querySelector(#pp-audio);
        this.playBtn = this.container.querySelector(#pp-play);
        this.scrubber = this.container.querySelector(#pp-scrubber);
        this.timeDisplay = this.container.querySelector(#pp-time);
        
        this.bindEvents();
    }
    
    bindEvents() {
        this.playBtn.addEventListener(click, () => this.togglePlay());
        this.container.querySelector(#pp-rewind).addEventListener(click, () => this.seek(0));
        this.container.querySelector(#pp-prev-scene).addEventListener(click, () => this.prevScene());
        this.container.querySelector(#pp-next-scene).addEventListener(click, () => this.nextScene());
        
        // Scrubber: seek khi kéo
        let isScrubbing = false;
        this.scrubber.addEventListener(input, (e) => {
            isScrubbing = true;
            const t = (parseFloat(e.target.value) / 100) * this.duration;
            this.seek(t);
        });
        this.scrubber.addEventListener(change, () => {
            isScrubbing = false;
        });
        
        // Audio events để đồng bộ
        this.audio.addEventListener(timeupdate, () => {
            if (!isScrubbing && this.isPlaying) {
                this.currentTime = this.audio.currentTime;
                this.updateUI();
            }
        });
        
        this.audio.addEventListener(ended, () => {
            this.pause();
        });
    }
    
    async load(jobId) {
        this.jobId = jobId;
        this.showLoading(true);
        
        try {
            // Load HTML vào iframe
            const htmlUrl = `/api/jobs/${jobId}/html`;
            this.iframe.src = htmlUrl;
            
            // Chờ iframe ready
            await this.waitForIframeReady();
            
            // Lấy duration từ iframe
            const iframeWin = this.iframe.contentWindow;
            this.duration = iframeWin.__duration || 0;
            
            // Load audio
            this.audio.src = `/api/jobs/${jobId}/audio`;
            await this.audio.load();
            
            // Lấy thông tin scenes (nếu có)
            await this.loadScenes();
            
            this.showLoading(false);
            this.seek(0);
            
        } catch (err) {
            console.error([PreviewPlayer] Load failed:, err);
            this.showLoading(false);
            throw err;
        }
    }
    
    waitForIframeReady(timeout = 15000) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const check = () => {
                try {
                    const win = this.iframe.contentWindow;
                    if (win && win.__ready === true) {
                        resolve();
                    } else if (Date.now() - start > timeout) {
                        reject(new Error(Iframe ready timeout));
                    } else {
                        setTimeout(check, 100);
                    }
                } catch (err) {
                    reject(err);
                }
            };
            this.iframe.onload = () => setTimeout(check, 500);
            check();
        });
    }
    
    async loadScenes() {
        try {
            const res = await fetch(`/api/jobs/${this.jobId}`);
            const job = await res.json();
            // Giả định job.result.scenes hoặc job.scenes chứa thông tin scene
            this.scenes = job.result?.scenes || job.scenes || [];
        } catch (err) {
            console.warn([PreviewPlayer] Could not load scenes:, err);
            this.scenes = [];
        }
    }
    
    seek(timeSec) {
        timeSec = Math.max(0, Math.min(timeSec, this.duration));
        this.currentTime = timeSec;
        
        try {
            const win = this.iframe.contentWindow;
            if (win && win.__seekTo) {
                win.__seekTo(timeSec);
            }
        } catch (err) {
            console.warn([PreviewPlayer] Seek failed:, err);
        }
        
        if (this.audio) {
            try {
                this.audio.currentTime = timeSec;
            } catch (err) {
                // Audio chưa load xong, bỏ qua
            }
        }
        
        this.updateUI();
    }
    
    play() {
        if (this.isPlaying) return;
        
        this.isPlaying = true;
        this.playBtn.textContent = ⏸;
        this.playBtn.title = Tạm dừng;
        
        // Phát audio
        this.audio.play().catch(err => {
            console.warn([PreviewPlayer] Audio play failed:, err);
        });
        
        // Cập nhật UI theo thời gian thực
        const startTime = this.currentTime;
        const startTimestamp = Date.now();
        
        this.playInterval = setInterval(() => {
            const elapsed = (Date.now() - startTimestamp) / 1000;
            const t = startTime + elapsed;
            
            if (t >= this.duration) {
                this.pause();
                this.seek(this.duration);
            } else {
                this.seek(t);
            }
        }, 50); // Cập nhật 20fps
    }
    
    pause() {
        if (!this.isPlaying) return;
        
        this.isPlaying = false;
        this.playBtn.textContent = ▶;
        this.playBtn.title = Phát;
        
        this.audio.pause();
        
        if (this.playInterval) {
            clearInterval(this.playInterval);
            this.playInterval = null;
        }
    }
    
    togglePlay() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }
    
    prevScene() {
        if (this.scenes.length === 0) {
            this.seek(Math.max(0, this.currentTime - 5));
            return;
        }
        
        // Tìm scene hiện tại và nhảy về đầu scene trước
        for (let i = this.scenes.length - 1; i >= 0; i--) {
            const sceneStart = this.scenes[i].startTime || 0;
            if (sceneStart < this.currentTime - 0.5) {
                this.seek(sceneStart);
                return;
            }
        }
        this.seek(0);
    }
    
    nextScene() {
        if (this.scenes.length === 0) {
            this.seek(Math.min(this.duration, this.currentTime + 5));
            return;
        }
        
        for (const scene of this.scenes) {
            const sceneStart = scene.startTime || 0;
            if (sceneStart > this.currentTime + 0.5) {
                this.seek(sceneStart);
                return;
            }
        }
        this.seek(this.duration);
    }
    
    updateUI() {
        // Cập nhật scrubber
        if (this.duration > 0) {
            const pct = (this.currentTime / this.duration) * 100;
            this.scrubber.value = pct;
        }
        
        // Cập nhật time display
        this.timeDisplay.textContent = `${this.formatTime(this.currentTime)} / ${this.formatTime(this.duration)}`;
    }
    
    formatTime(sec) {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${String(m).padStart(2, 0)}:${String(s).padStart(2, 0)}`;
    }
    
    showLoading(show) {
        const loading = this.container.querySelector(.pp-loading);
        if (loading) {
            loading.style.display = show ? flex : none;
        }
    }
    
    destroy() {
        this.pause();
        if (this.audio) {
            this.audio.src = ;
        }
        if (this.iframe) {
            this.iframe.src = about:blank;
        }
        this.container.innerHTML = ;
    }
}

// Export cho sử dụng global
if (typeof window !== undefined) {
    window.PreviewPlayer = PreviewPlayer;
}
