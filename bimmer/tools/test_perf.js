'use strict';
// node tools/test_perf.js : les corrections de fluidité de ShakTheme (16 novembre 2026)
//  1. la page du centre n'est redessinée que sur un changement (ou une fois par seconde) : elle l'était à chaque image, jusqu'à 60 fois par seconde,
//     ce qui occupait le processeur de la voiture (jauges du cluster et écran tactile en retard) ;
//  2. la boucle du kit sait qu'une image n'a rien dessiné (« idle ») : ni image comptée, ni ramasse-miettes forcé ;
//  3. le catalogue des signaux de la voiture (gros fichier) est gardé sur le disque : lu une fois, pas à chaque lancement ;
//  4. la vitesse des barres est adoucie (les barres glissent), pas celle des chiffres.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
let n = 0;
function check(name, fn) { try { fn(); n++; } catch (e) { console.error('FAIL ' + name + ': ' + (e && e.stack || e)); process.exitCode = 1; } }

// ---- 1. page.js (le dossier kit/ n'y est qu'à la construction : ses requires sont redirigés vers kit/runtime)
const shared = path.join(ROOT, 'shared'), kit = path.join(ROOT, 'kit', 'runtime');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, parent, ...a) {
    if (/^\.\/kit\//.test(req) && parent && parent.filename && parent.filename.startsWith(shared)) req = path.join(kit, req.slice(6));
    return resolve.call(this, req, parent, ...a);
};
const Page = require(path.join(shared, 'page.js'));
const realNow = Date.now;
function page() {
    const kicks = [];
    const ctx = { spec: { config: { lang: 'fr' } }, canvas() { throw new Error('DRAWN'); }, settings: {}, ui: {}, theme() { return {}; } };
    const hud = { activeName: 'sport', car: { data: () => ({}) } };
    const p = new Page(ctx, hud, { tabs: ['look', 'signals'], what: 'cluster' });
    p.loop = { kick: () => kicks.push(1) };
    return { p, kicks };
}
const drew = (p) => { try { return p.render() !== 'idle' ? 'returned' : 'idle'; } catch (e) { if (e.message === 'DRAWN') return 'drawn'; throw e; } };

check('page : la première image est dessinée', () => {
    const { p } = page();
    assert.strictEqual(drew(p), 'drawn');
});
check('page : sans changement, pas de dessin (idle), et le même résultat à chaque image', () => {
    const { p } = page();
    let t = realNow(); Date.now = () => t;
    try {
        assert.strictEqual(drew(p), 'drawn'); t += 16;
        for (let i = 0; i < 20; i++) { assert.strictEqual(drew(p), 'idle', 'image ' + i); t += 16; }       // 320 ms de plus
    } finally { Date.now = realNow; }
});
check('page : un changement (kick) redessine tout de suite et prévient la boucle', () => {
    const { p, kicks } = page();
    let t = realNow(); Date.now = () => t;
    try {
        drew(p); t += 20; assert.strictEqual(drew(p), 'idle');
        p.kick(); assert.strictEqual(kicks.length, 1, 'la boucle est prévenue');
        assert.strictEqual(drew(p), 'drawn'); t += 20;
        assert.strictEqual(drew(p), 'idle', 'puis de nouveau au repos');
    } finally { Date.now = realNow; }
});
check('page : ce qui bouge tout seul (Waze, données) est redessiné au plus tard après une seconde', () => {
    const { p } = page();
    let t = realNow(); Date.now = () => t;
    try {
        drew(p); t += 999; assert.strictEqual(drew(p), 'idle');
        t += 2; assert.strictEqual(drew(p), 'drawn');
    } finally { Date.now = realNow; }
});

// ---- 2. la boucle du kit et celle de la maquette
check('kit : la boucle accepte « idle » (mgu.js et la maquette hu-stub.js)', () => {
    ['kit/runtime/mgu.js', 'kit/tools/hu-stub.js'].forEach((f) => {
        const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
        assert(/idle = \(await fn\(\)\) === 'idle'/.test(s), f + ' : le résultat « idle » n\'est pas lu');
        assert(/if \(idle\) \{ schedule\(dt, true\); return; \}/.test(s), f + ' : une image « idle » est comptée comme une image');
        assert(/const schedule = \(dt, idle\)/.test(s), f + ' : schedule ne connaît pas « idle »');
    });
    const mgu = fs.readFileSync(path.join(ROOT, 'kit/runtime/mgu.js'), 'utf8');
    assert(mgu.indexOf("if (idle) { schedule(dt, true); return; }") < mgu.indexOf("!gpuOn() && frames % 3 === 0 && typeof global.gc"), 'une image « idle » passe par le ramasse-miettes forcé (le retour « idle » doit venir avant)');
});

// ---- 3. le catalogue sur disque
function fixture(dir) {
    const file = path.join(dir, 'someip-interfaces.json');
    const db = { interfaces: { 'de.bmw.test.Signs': { fields: { speedLimitDisplay: { dataRef: 'T', getter: { id: 1 }, notifier: { id: 2 } }, other: { dataRef: 'T' } } } },
        datatypes: { T: { type: 'struct', members: [{ name: 'displaySpeedLimit' }] } } };
    fs.writeFileSync(file, JSON.stringify(db));
    return file;
}
check('catalogue : lu une fois, puis sur le disque (la deuxième exécution ne rouvre pas le gros fichier)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-'));
    const file = fixture(dir), cache = path.join(dir, 'catalog-cache.json');
    process.env.SOMEIP_CATALOG = file;
    const fresh = () => { delete require.cache[require.resolve(path.join(shared, 'catalog.js'))]; return require(path.join(shared, 'catalog.js')); };
    const reads = [], rfs = fs.readFileSync;
    fs.readFileSync = function (p, ...a) { reads.push(String(p)); return rfs.call(this, p, ...a); };
    try {
        let c = fresh();
        assert.strictEqual(c.peek(), null, 'rien en mémoire avant la lecture');
        const first = c.load(cache);
        assert(first.groups.find((g) => g.id === 'sign').rows.length >= 1, 'le panneau de limite est trouvé');
        assert(fs.existsSync(cache), 'le cache est écrit');
        assert.strictEqual(reads.filter((p) => p === file).length, 1, 'le fichier de la voiture est lu une fois');
        reads.length = 0;
        c = fresh();
        const second = c.load(cache);
        assert.deepStrictEqual(second, first, 'même réponse depuis le cache');
        assert.strictEqual(reads.filter((p) => p === file).length, 0, 'le gros fichier n\'est pas relu');
        // le fichier de la voiture change (une mise à jour) : le cache n'est plus bon
        const db = JSON.parse(rfs(file, 'utf8')); db.interfaces['de.bmw.test.Signs'].fields.roadSign = { dataRef: 'T' };
        fs.writeFileSync(file, JSON.stringify(db)); reads.length = 0;
        c = fresh();
        const third = c.load(cache);
        assert.strictEqual(reads.filter((p) => p === file).length, 1, 'un autre fichier : relu');
        assert(third.groups.find((g) => g.id === 'sign').rows.length > first.groups.find((g) => g.id === 'sign').rows.length, 'et la réponse suit');
        // un cache abîmé ne casse rien
        fs.writeFileSync(cache, '{not json'); c = fresh();
        assert(c.load(cache).groups.length === c.GROUPS.length, 'cache abîmé : on relit');
    } finally { fs.readFileSync = rfs; delete process.env.SOMEIP_CATALOG; }
});
check('catalogue : une erreur de lecture n\'est pas écrite dans le cache', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-'));
    process.env.SOMEIP_CATALOG = path.join(dir, 'absent.json');
    delete require.cache[require.resolve(path.join(shared, 'catalog.js'))];
    const c = require(path.join(shared, 'catalog.js')), cache = path.join(dir, 'catalog-cache.json');
    const r = c.load(cache);
    assert(r.error, 'l\'erreur est dite'); assert(!fs.existsSync(cache), 'rien d\'écrit');
    delete process.env.SOMEIP_CATALOG;
});

// ---- 4. la vitesse des barres (hud.js ne se charge pas ici : les méthodes sont compilées depuis le source)
const hudSrc = fs.readFileSync(path.join(shared, 'hud.js'), 'utf8');
const cut = (sig) => { const i = hudSrc.indexOf(sig), j = hudSrc.indexOf('\n    }\n', i); assert(i > 0 && j > i, sig + ' introuvable'); return hudSrc.slice(i, j + 7); };
const isNum = (x) => typeof x === 'number' && isFinite(x);
const Hud = new Function('isNum', 'SPEED_FILTER_MS', 'return class { ' + cut('    _smoothSpeed(now) {') + cut('    _barRaw(name) {') + ' }')(isNum, 90);
function hud(speed) {
    const h = Object.create(Hud.prototype);
    h.car = { data: () => ({ speed }) };
    h._raw = (k) => (k === 'speed' ? speed : k === 'rpm' ? 3000 : null);
    h._sweepF = () => 0;
    return { h, set: (v) => { speed = v; } };
}
check('vitesse des barres : elle glisse vers la vitesse de la voiture, sans la dépasser', () => {
    const { h, set } = hud(50);
    h._smoothSpeed(1000); assert.strictEqual(h._barRaw('speed'), 50, 'au départ : la valeur de la voiture');
    set(60); let prev = 50;
    for (let t = 1025; t <= 1500; t += 25) {
        h._smoothSpeed(t);
        const v = h._barRaw('speed');
        assert(v > prev && v <= 60, 'monte sans dépasser (' + prev + ' -> ' + v + ')');
        prev = v;
    }
    assert(Math.abs(prev - 60) < 0.1, 'arrive : ' + prev);
    const mid = hud(50); mid.h._smoothSpeed(1000); mid.set(60); mid.h._smoothSpeed(1025);
    assert(mid.h._barRaw('speed') > 50 && mid.h._barRaw('speed') < 54, 'un seul pas (25 ms) ne fait faire qu\'un quart du chemin : ' + mid.h._barRaw('speed'));
});
check('vitesse des barres : un saut de 40 km/h ou plus et l\'absence de vitesse ne sont pas adoucis', () => {
    const { h, set } = hud(10);
    h._smoothSpeed(1000); set(120); h._smoothSpeed(1025);
    assert.strictEqual(h._barRaw('speed'), 120, 'un saut : direct');
    set(null); h._smoothSpeed(1050);
    assert.strictEqual(h._barRaw('speed'), null, 'pas de vitesse : null (la barre ne garde pas une vieille valeur)');
});
check('vitesse des barres : le balayage de démarrage garde la main, le régime n\'est pas touché', () => {
    const { h } = hud(0);
    h._smoothSpeed(1000);
    h._sweepF = () => 0.5;
    assert.strictEqual(h._barRaw('speed'), 165, 'le balayage : la moitié de 330');
    h._sweepF = () => 0;
    assert.strictEqual(h._barRaw('rpm'), 3000);
});
check('hud.js : la boucle des jauges est à 40 Hz', () => {
    const m = /const TICK_MS = (\d+);/.exec(hudSrc);
    assert(m && Number(m[1]) <= 25, 'TICK_MS : ' + (m && m[1]));
    assert(/this\._smoothSpeed\(now\);/.test(hudSrc), '_smoothSpeed n\'est pas appelé dans _tick');
});

console.log('test_perf : ' + n + ' vérifications' + (process.exitCode ? ' (des échecs)' : ' ok'));
