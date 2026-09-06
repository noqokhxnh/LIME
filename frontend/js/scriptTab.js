const scriptEmpty = document.getElementById('script-empty');
const scriptContainer = document.getElementById('script-editor-container');
const sceneContainer = document.getElementById('scene-cards-container');
const scriptStats = document.getElementById('script-stats');
const btnRenderVideo = document.getElementById('btn-render-video');

let currentScriptData = null;
let currentJobIdForScript = null;

const scriptTab = {
    clear() {
        currentScriptData = null;
        currentJobIdForScript = null;
        scriptEmpty.style.display = 'block';
        scriptContainer.style.display = 'none';
        sceneContainer.innerHTML = '';
    },

    loadScript(jobId, scriptData) {
        if (!scriptData || !scriptData.scenes) {
            this.clear();
            return;
        }
        
        currentScriptData = scriptData;
        currentJobIdForScript = jobId;
        
        scriptEmpty.style.display = 'none';
        scriptContainer.style.display = 'block';
        
        // Stats
        scriptStats.innerHTML = `
            <span>Số cảnh: ${scriptData.scenes.length}</span>
            <span>Style: ${scriptData.visualStyle || 'N/A'}</span>
            <span>Est. Duration: ${scriptData.estimatedDuration || 0}s</span>
        `;
        
        // Render Scenes
        sceneContainer.innerHTML = '';
        scriptData.scenes.forEach((scene, index) => {
            const card = document.createElement('div');
            card.className = 'scene-card';
            card.dataset.index = index;
            
            card.innerHTML = `
                <div class="scene-card-header">
                    <span>Scene ${index + 1} (${scene.duration || 5}s)</span>
                    <span>Transition: ${scene.transition || 'none'}</span>
                </div>
                <div class="scene-field">
                    <label>Tiêu đề (Title):</label>
                    <textarea class="edit-title">${scene.title || ''}</textarea>
                </div>
                <div class="scene-field">
                    <label>Lời bình (Voiceover):</label>
                    <textarea class="edit-voiceover">${scene.voiceoverText || ''}</textarea>
                </div>
                <div class="scene-field">
                    <label>Ghi chú Layout (Chỉ đọc):</label>
                    <textarea readonly style="color:var(--text-sub); opacity: 0.8; height:50px;">${scene.layoutNotes || ''}</textarea>
                </div>
            `;
            sceneContainer.appendChild(card);
        });
    },

    getEditedScript() {
        if (!currentScriptData) return null;
        
        // Clone object
        const editedScript = JSON.parse(JSON.stringify(currentScriptData));
        
        const cards = sceneContainer.querySelectorAll('.scene-card');
        cards.forEach(card => {
            const index = parseInt(card.dataset.index);
            const titleVal = card.querySelector('.edit-title').value;
            const voiceoverVal = card.querySelector('.edit-voiceover').value;
            
            if (editedScript.scenes[index]) {
                editedScript.scenes[index].title = titleVal;
                editedScript.scenes[index].voiceoverText = voiceoverVal;
            }
        });
        
        return editedScript;
    }
};

btnRenderVideo.addEventListener('click', () => {
    if (!currentJobIdForScript) return;
    
    if (window.appController) {
        const originalPrompt = window.appController.getCurrentPrompt();
        if (!originalPrompt) {
             alert("LỖI GIỚI HẠN BACKEND:\nKhông thể Render lại Job cũ từ History vì Backend chưa trả về Prompt ban đầu. Vui lòng tạo Draft mới ở cột bên phải để tiếp tục.");
             return;
        }
        
        const editedScript = scriptTab.getEditedScript();
        window.appController.startRender(currentJobIdForScript, editedScript, originalPrompt);
    }
});
