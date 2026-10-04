/**
 * Browser-injected Motion Block runtime.
 * LLM mounts complex DOM via: window.__block(name, container, opts)
 * Then animates with GSAP or window.__block.animate(name, root, tl, opts).
 */
export const BLOCK_HELPERS_JS = `
window.__block = function(name, container, opts) {
    opts = opts || {};
    var el = typeof container === 'string' ? document.querySelector(container) : container;
    if (!el) throw new Error('__block: container not found');
    var root = document.createElement('div');
    root.className = 'vb-block vb-' + name;
    root.setAttribute('data-block', name);
    root.style.cssText = 'position:relative;width:100%;height:100%;box-sizing:border-box;';

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function injectCss(id, css) {
        if (document.getElementById(id)) return;
        var st = document.createElement('style');
        st.id = id;
        st.textContent = css;
        document.head.appendChild(st);
    }

    if (name === 'kinetic-type' || name === 'kinetic-type-beats') {
        injectCss('vb-kinetic-css', [
            '.vb-kinetic{display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:12px;padding:8% 10%;}',
            '.vb-kinetic .vb-kicker{font-size:18px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.7;font-weight:600;}',
            '.vb-kinetic .vb-line{font-size:72px;font-weight:900;line-height:1.05;overflow:hidden;}',
            '.vb-kinetic .vb-word{display:inline-block;margin-right:0.28em;will-change:transform,opacity;}',
            '.vb-kinetic .vb-cursor{display:inline-block;width:0.08em;height:0.9em;background:currentColor;margin-left:4px;vertical-align:-0.05em;}'
        ].join(''));
        var mode = opts.mode || 'stagger-words';
        var text = opts.text || 'Impact Line';
        var kicker = opts.kicker || '';
        var accent = opts.accent || 'var(--vb-accent, #8b5cf6)';
        root.className += ' vb-kinetic';
        root.innerHTML =
            (kicker ? '<div class="vb-kicker" style="color:' + accent + '">' + esc(kicker) + '</div>' : '') +
            '<div class="vb-line" data-mode="' + esc(mode) + '"></div>';
        var line = root.querySelector('.vb-line');
        if (mode === 'typewriter') {
            line.innerHTML = '<span class="vb-tw"></span><span class="vb-cursor"></span>';
            line.setAttribute('data-full', text);
        } else if (mode === 'word-swap') {
            var words = Array.isArray(opts.words) ? opts.words : text.split(/\\s+/);
            line.innerHTML = words.map(function(w, i) {
                return '<span class="vb-word" data-swap="' + i + '" style="position:' + (i === 0 ? 'relative' : 'absolute') + ';opacity:' + (i === 0 ? '1' : '0') + ';">' + esc(w) + '</span>';
            }).join('');
            line.style.position = 'relative';
        } else {
            line.innerHTML = text.split(/\\s+/).map(function(w) {
                return '<span class="vb-word">' + esc(w) + '</span>';
            }).join('');
        }
    } else if (name === 'code-diff' || name === 'terminal-typing') {
        injectCss('vb-code-css', [
            '.vb-code{display:flex;align-items:center;justify-content:center;padding:6%;}',
            '.vb-ide{width:min(920px,92%);background:#0d1117;border:1px solid #30363d;border-radius:14px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,0.45);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}',
            '.vb-ide-bar{display:flex;align-items:center;gap:8px;padding:12px 16px;background:#161b22;border-bottom:1px solid #30363d;}',
            '.vb-dot{width:12px;height:12px;border-radius:50%;}',
            '.vb-ide-title{margin-left:12px;color:#8b949e;font-size:13px;}',
            '.vb-ide-body{padding:18px 20px;font-size:18px;line-height:1.55;color:#e6edf3;min-height:220px;}',
            '.vb-line-row{display:flex;gap:14px;opacity:0;transform:translateY(8px);}',
            '.vb-ln{color:#484f58;min-width:28px;text-align:right;user-select:none;}',
            '.vb-add{background:rgba(46,160,67,0.15);}',
            '.vb-del{background:rgba(248,81,73,0.15);text-decoration:line-through;opacity:0.85;}',
            '.vb-kw{color:#ff7b72;} .vb-str{color:#a5d6ff;} .vb-fn{color:#d2a8ff;} .vb-cm{color:#8b949e;}'
        ].join(''));
        var title = opts.title || 'main.ts';
        var lines = Array.isArray(opts.lines) ? opts.lines : [
            { text: '// before', kind: 'comment' },
            { text: '- const answer = guess()', kind: 'del' },
            { text: '+ const answer = await ask()', kind: 'add' },
            { text: 'return answer;', kind: 'code' }
        ];
        root.className += ' vb-code';
        var body = lines.map(function(L, i) {
            var kind = L.kind || 'code';
            var cls = 'vb-line-row' + (kind === 'add' ? ' vb-add' : kind === 'del' ? ' vb-del' : '');
            var t = esc(L.text || '');
            t = t.replace(/\\b(const|let|return|await|function|import|from)\\b/g, '<span class="vb-kw">$1</span>');
            t = t.replace(/'([^']*)'/g, '<span class="vb-str">\\'$1\\'</span>');
            t = t.replace(/\\/\\/.*$/g, function(m) { return '<span class="vb-cm">' + m + '</span>'; });
            return '<div class="' + cls + '" data-i="' + i + '"><span class="vb-ln">' + (i + 1) + '</span><span class="vb-code-text">' + t + '</span></div>';
        }).join('');
        root.innerHTML =
            '<div class="vb-ide">' +
              '<div class="vb-ide-bar">' +
                '<span class="vb-dot" style="background:#ff5f56"></span>' +
                '<span class="vb-dot" style="background:#ffbd2e"></span>' +
                '<span class="vb-dot" style="background:#27c93f"></span>' +
                '<span class="vb-ide-title">' + esc(title) + '</span>' +
              '</div>' +
              '<div class="vb-ide-body">' + body + '</div>' +
            '</div>';
    } else if (name === 'bar-chart' || name === 'dataviz-countup' || name === 'bar-chart-race') {
        injectCss('vb-chart-css', [
            '.vb-chart{display:flex;flex-direction:column;justify-content:center;padding:8% 10%;gap:22px;}',
            '.vb-chart-title{font-size:36px;font-weight:800;}',
            '.vb-chart-row{display:grid;grid-template-columns:140px 1fr 72px;align-items:center;gap:16px;}',
            '.vb-chart-label{font-size:18px;font-weight:600;opacity:0.9;}',
            '.vb-chart-track{height:18px;background:rgba(255,255,255,0.08);border-radius:999px;overflow:hidden;}',
            '.vb-chart-fill{height:100%;width:0%;border-radius:999px;background:linear-gradient(90deg,#06b6d4,#8b5cf6);}',
            '.vb-chart-val{font-size:20px;font-weight:800;text-align:right;font-variant-numeric:tabular-nums;}'
        ].join(''));
        var items = Array.isArray(opts.items) ? opts.items : [
            { label: 'Alpha', value: 92 },
            { label: 'Beta', value: 74 },
            { label: 'Gamma', value: 58 }
        ];
        var max = opts.max || Math.max.apply(null, items.map(function(it) { return Number(it.value) || 0; })) || 100;
        var accent = opts.accent || '#8b5cf6';
        root.className += ' vb-chart';
        root.innerHTML =
            (opts.title ? '<div class="vb-chart-title">' + esc(opts.title) + '</div>' : '') +
            items.map(function(it, i) {
                var pct = Math.max(0, Math.min(100, ((Number(it.value) || 0) / max) * 100));
                return '<div class="vb-chart-row" data-i="' + i + '">' +
                    '<div class="vb-chart-label">' + esc(it.label || '') + '</div>' +
                    '<div class="vb-chart-track"><div class="vb-chart-fill" data-pct="' + pct + '" style="background:linear-gradient(90deg,' + accent + ',#06b6d4)"></div></div>' +
                    '<div class="vb-chart-val" data-target="' + esc(it.value) + '">0</div>' +
                '</div>';
            }).join('');
    } else if (name === 'device-showcase' || name === 'device-surface-showcase') {
        injectCss('vb-device-css', [
            '.vb-device{display:flex;align-items:center;justify-content:center;perspective:1400px;padding:6%;}',
            '.vb-phone{width:280px;height:560px;border-radius:36px;background:#111;border:10px solid #222;box-shadow:0 30px 80px rgba(0,0,0,0.5);transform:rotateY(-18deg) rotateX(6deg);overflow:hidden;position:relative;}',
            '.vb-laptop{width:720px;height:420px;position:relative;transform:rotateY(-12deg) rotateX(8deg);}',
            '.vb-laptop-screen{height:360px;border-radius:12px 12px 0 0;background:#0b0f19;border:8px solid #2a2a2a;overflow:hidden;}',
            '.vb-laptop-base{height:18px;background:#2a2a2a;border-radius:0 0 10px 10px;transform:perspective(600px) rotateX(18deg);transform-origin:top center;}',
            '.vb-device-screen{width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:12px;padding:24px;background:radial-gradient(circle at 30% 20%,rgba(139,92,246,0.35),transparent 55%),#0b0f19;color:#fff;}',
            '.vb-device-screen h3{font-size:28px;font-weight:800;} .vb-device-screen p{opacity:0.75;font-size:16px;}'
        ].join(''));
        var device = opts.device || 'phone';
        var headline = opts.headline || 'Product UI';
        var sub = opts.sub || 'Live preview';
        var screenHtml = opts.screenHtml || ('<h3>' + esc(headline) + '</h3><p>' + esc(sub) + '</p>');
        root.className += ' vb-device';
        if (device === 'laptop') {
            root.innerHTML = '<div class="vb-laptop"><div class="vb-laptop-screen"><div class="vb-device-screen">' + screenHtml + '</div></div><div class="vb-laptop-base"></div></div>';
        } else {
            root.innerHTML = '<div class="vb-phone"><div class="vb-device-screen">' + screenHtml + '</div></div>';
        }
    } else if (name === 'chat-exchange') {
        injectCss('vb-chat-css', [
            '.vb-chat{display:flex;flex-direction:column;justify-content:center;gap:14px;padding:8% 12%;}',
            '.vb-bubble{max-width:70%;padding:14px 18px;border-radius:18px;font-size:20px;line-height:1.35;opacity:0;transform:translateY(16px);}',
            '.vb-bubble.user{align-self:flex-end;background:#2563eb;color:#fff;border-bottom-right-radius:6px;}',
            '.vb-bubble.assistant{align-self:flex-start;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);border-bottom-left-radius:6px;}'
        ].join(''));
        var messages = Array.isArray(opts.messages) ? opts.messages : [
            { role: 'user', text: 'Làm sao tăng tốc video AI?' },
            { role: 'assistant', text: 'Dùng motion blocks sẵn thay vì tự sinh DOM.' }
        ];
        root.className += ' vb-chat';
        root.innerHTML = messages.map(function(m, i) {
            var role = m.role === 'user' ? 'user' : 'assistant';
            return '<div class="vb-bubble ' + role + '" data-i="' + i + '">' + esc(m.text || '') + '</div>';
        }).join('');
    } else {
        root.innerHTML = '<div style="padding:24px;opacity:0.7;">Unknown block: ' + esc(name) + '</div>';
    }

    el.appendChild(root);
    return root;
};

window.__block.animate = function(name, root, tl, opts) {
    opts = opts || {};
    if (!root || !tl || typeof gsap === 'undefined') return tl;
    var start = opts.at != null ? opts.at : 0.15;
    var dur = opts.duration != null ? opts.duration : 1.2;

    if (name === 'kinetic-type' || name === 'kinetic-type-beats') {
        var mode = (root.querySelector('.vb-line') || {}).getAttribute
            ? root.querySelector('.vb-line').getAttribute('data-mode')
            : 'stagger-words';
        if (mode === 'typewriter') {
            var line = root.querySelector('.vb-line');
            var full = line.getAttribute('data-full') || '';
            var tw = root.querySelector('.vb-tw');
            var proxy = { i: 0 };
            tl.to(proxy, {
                i: full.length,
                duration: dur,
                ease: 'none',
                onUpdate: function() { tw.textContent = full.slice(0, Math.floor(proxy.i)); }
            }, start);
            tl.to(root.querySelector('.vb-cursor'), { opacity: 0, duration: 0.35, yoyo: true, repeat: 3 }, start);
        } else if (mode === 'word-swap') {
            var words = root.querySelectorAll('.vb-word');
            words.forEach(function(w, i) {
                if (i === 0) {
                    tl.from(w, { y: 40, opacity: 0, duration: 0.5, ease: 'back.out(1.7)' }, start);
                } else {
                    tl.to(words[i - 1], { opacity: 0, y: -24, duration: 0.35 }, start + i * 0.55);
                    tl.fromTo(w, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' }, start + i * 0.55);
                }
            });
        } else {
            tl.from(root.querySelectorAll('.vb-word'), {
                y: 48, opacity: 0, rotateX: -40, stagger: 0.08,
                duration: 0.55, ease: 'back.out(1.6)'
            }, start);
        }
        if (root.querySelector('.vb-kicker')) {
            tl.from(root.querySelector('.vb-kicker'), { opacity: 0, y: 12, duration: 0.4 }, start);
        }
    } else if (name === 'code-diff' || name === 'terminal-typing') {
        tl.from(root.querySelector('.vb-ide'), { scale: 0.94, opacity: 0, duration: 0.5, ease: 'power3.out' }, start);
        tl.to(root.querySelectorAll('.vb-line-row'), {
            opacity: 1, y: 0, stagger: 0.12, duration: 0.45, ease: 'power2.out'
        }, start + 0.2);
    } else if (name === 'bar-chart' || name === 'dataviz-countup' || name === 'bar-chart-race') {
        var fills = root.querySelectorAll('.vb-chart-fill');
        var vals = root.querySelectorAll('.vb-chart-val');
        fills.forEach(function(f, i) {
            var pct = parseFloat(f.getAttribute('data-pct') || '0');
            tl.to(f, { width: pct + '%', duration: dur, ease: 'power2.out' }, start + i * 0.12);
            var target = parseFloat(vals[i].getAttribute('data-target') || '0');
            var counter = { v: 0 };
            tl.to(counter, {
                v: target,
                duration: dur,
                ease: 'power2.out',
                onUpdate: function() { vals[i].textContent = Math.round(counter.v) + (opts.suffix || ''); }
            }, start + i * 0.12);
        });
    } else if (name === 'device-showcase' || name === 'device-surface-showcase') {
        var frame = root.querySelector('.vb-phone, .vb-laptop');
        tl.from(frame, { opacity: 0, z: -80, rotateY: -40, duration: 0.8, ease: 'power3.out' }, start);
        tl.to(frame, { rotateY: 8, duration: Math.max(1, dur), ease: 'sine.inOut' }, start + 0.5);
    } else if (name === 'chat-exchange') {
        tl.to(root.querySelectorAll('.vb-bubble'), {
            opacity: 1, y: 0, stagger: 0.35, duration: 0.45, ease: 'power2.out'
        }, start);
    }
    return tl;
};

window.__block.CORE = ['kinetic-type','code-diff','bar-chart','device-showcase','chat-exchange'];
`;
