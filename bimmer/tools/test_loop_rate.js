'use strict';
// node tools/test_loop_rate.js : la boucle des jauges (shared/hud.js _loopStart) tient 50 images par seconde même quand les minuteries
// arrivent en retard. Sur la voiture, setInterval(20) ne tournait qu'à 33 par seconde (onglet Signaux, 22 nov. 2026, 7,3 ms de travail par
// image) : ses minuteries arrivent au tic suivant du système et il ne rattrape jamais. Horloge simulée : minuteries arrondies au tic de 10 ms
// suivant, plus 7 ms de travail par image.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
// la méthode seule, tirée de hud.js (la classe entière demande le kit d'une appli installée)
const src = fs.readFileSync(path.join(__dirname, '..', 'shared', 'hud.js'), 'utf8');
const m = src.match(/\n    _loopStart\(\) \{[\s\S]*?\n    \}\n/);
if (!m) throw new Error('_loopStart introuvable dans hud.js');
const TICK_MS = Number(/const TICK_MS = (\d+);/.exec(src)[1]);
const HudApp = { prototype: new Function('TICK_MS', 'return class {' + m[0] + '}')(TICK_MS).prototype };

let n = 0, bad = 0;
function check(name, fn) { try { fn(); n++; } catch (e) { bad++; console.error('FAIL ' + name + ': ' + (e && e.stack || e)); } }

function simulate(workMs, granMs, seconds) {
    let now = 0;
    const timers = [];
    const realST = global.setTimeout, realCT = global.clearTimeout, realNow = Date.now;
    global.setTimeout = (fn, ms) => { const at = Math.ceil((now + Math.max(1, ms)) / granMs) * granMs; const t = { fn, at }; timers.push(t); return t; };
    global.clearTimeout = (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); };
    Date.now = () => now;
    let frames = 0;
    try {
        const o = { _guard: (w, fn) => fn(), _tick: () => { frames++; now += workMs; } };
        HudApp.prototype._loopStart.call(o);
        while (now < seconds * 1000 && timers.length) {
            timers.sort((a, b) => a.at - b.at);
            const t = timers.shift();
            if (t.at > now) now = t.at;
            t.fn();
        }
        o.loopStopped = true;
    } finally { global.setTimeout = realST; global.clearTimeout = realCT; Date.now = realNow; }
    return frames / seconds;
}

check('minuteries au tic de 10 ms, 7 ms de travail : environ 50 images par seconde (setInterval en faisait 33)', () => {
    const fps = simulate(7, 10, 20);
    assert(fps >= 48 && fps <= 51, fps + ' images/s');
});
check('voiture très chargée (25 ms par image) : pas de rafale pour rattraper, le rythme suit ce qui est possible', () => {
    const fps = simulate(25, 10, 20);
    assert(fps >= 25 && fps <= 41, fps + ' images/s');
});
check('voiture libre (1 ms par image, minuteries exactes) : 50 images par seconde, pas plus', () => {
    const fps = simulate(1, 1, 20);
    assert(fps >= 49 && fps <= 50.5, fps + ' images/s');
});
console.log(bad ? 'loop rate: FAILED' : 'loop rate: all ' + n + ' checks pass');
process.exit(bad ? 1 : 0);
