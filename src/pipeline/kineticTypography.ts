/**
 * Kinetic Typography & Screen FX Presets (Issue #31)
 * Port từ 852wa/JIZURA sang hệ sinh thái DOM/GSAP của LIME.
 */

export const KINETIC_TYPOGRAPHY_JS = `
(function() {
    if (typeof window.__motionPresets !== 'undefined') return;
    const presets = {};
    function createTimeline() { return gsap.timeline({ paused: true }); }
    
    presets.marquee = function(el, opts) {
        opts = opts || {};
        const duration = opts.duration || 10;
        const text = el.textContent;
        el.innerHTML = '';
        const track = document.createElement('div');
        track.style.display = 'inline-flex';
        track.style.whiteSpace = 'nowrap';
        for (let i = 0; i < 4; i++) {
            const span = document.createElement('span');
            span.textContent = text + '  ';
            track.appendChild(span);
        }
        el.appendChild(track);
        el.style.overflow = 'hidden';
        const tl = createTimeline();
        tl.fromTo(track, { x: '0%' }, { x: '-50%', duration: duration, ease: 'none', repeat: -1 });
        return tl;
    };
    
    presets.diagonalBanner = function(el, opts) {
        opts = opts || {};
        el.style.transform = 'rotate(' + (opts.angle || -15) + 'deg)';
        el.style.background = opts.bgColor || '#B9E72B';
        el.style.color = opts.textColor || '#1a1a1a';
        el.style.padding = '12px 48px';
        el.style.whiteSpace = 'nowrap';
        el.style.fontWeight = 'bold';
        const tl = createTimeline();
        tl.from(el, { x: '-100%', duration: 0.6, ease: 'power3.out' });
        return tl;
    };
    
    presets.stickerLabel = function(el, opts) {
        opts = opts || {};
        el.style.display = 'inline-block';
        el.style.background = '#fff';
        el.style.padding = '8px 16px';
        el.style.borderRadius = '4px';
        el.style.transform = 'rotate(' + (opts.rotation || -5) + 'deg)';
        el.style.fontWeight = 'bold';
        const tl = createTimeline();
        tl.from(el, { scale: 0, duration: 0.5, ease: 'back.out(2)' });
        return tl;
    };
    
    presets.explodeAssemble = function(el, opts) {
        opts = opts || {};
        const text = el.textContent;
        el.innerHTML = '';
        el.style.display = 'inline-flex';
        const chars = [];
        let seed = 42;
        function rand() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
        for (const ch of text) {
            const span = document.createElement('span');
            span.textContent = ch;
            span.style.display = 'inline-block';
            el.appendChild(span);
            chars.push(span);
        }
        const tl = createTimeline();
        tl.from(chars, {
            x: function() { return (rand() - 0.5) * 400; },
            y: function() { return (rand() - 0.5) * 400; },
            opacity: 0,
            duration: opts.duration || 1,
            stagger: 0.02,
            ease: 'power3.out'
        });
        return tl;
    };
    
    presets.domino = function(el, opts) {
        const text = el.textContent;
        el.innerHTML = '';
        el.style.display = 'inline-flex';
        const chars = [];
        for (const ch of text) {
            const span = document.createElement('span');
            span.textContent = ch;
            span.style.display = 'inline-block';
            el.appendChild(span);
            chars.push(span);
        }
        const tl = createTimeline();
        tl.from(chars, { rotationX: -90, opacity: 0, duration: 0.6, stagger: 0.05, ease: 'power2.out' });
        return tl;
    };
    
    presets.crtTurnOn = function(el, opts) {
        const tl = createTimeline();
        tl.fromTo(el, { scaleY: 0.01, opacity: 0 }, { scaleY: 1, opacity: 1, duration: 0.5, ease: 'power2.out' });
        return tl;
    };
    
    presets.rgbSplit = function(el, opts) {
        opts = opts || {};
        const intensity = opts.intensity || 3;
        el.style.position = 'relative';
        const text = el.textContent;
        const red = document.createElement('span');
        red.textContent = text;
        red.setAttribute('style', 'position:absolute;top:0;left:-' + intensity + 'px;color:#f00;opacity:0.7;');
        el.appendChild(red);
        const tl = createTimeline();
        tl.from(red, { opacity: 0, duration: 0.3 });
        return tl;
    };
    
    window.__motionPresets = presets;
})();

`;
