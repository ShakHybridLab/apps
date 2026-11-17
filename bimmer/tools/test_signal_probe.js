'use strict';
// node tools/test_signal_probe.js : les applis d'essai de signaux (shared/signal_probe.js, shared/probe_sets.js, apps/shak{volant,manette,conso,media}) :
// l'état que la sonde montre (changements, refus), l'écran dessiné sans erreur avec une fausse voiture, et que chaque app.json déclare exactement
// les noms de la table (tools/make_probe_apps.py) en « s », sans rien d'un thème.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { Probe, start } = require('../shared/signal_probe');
const SETS = require('../shared/probe_sets');

let failed = 0, n = 0;
function check(name, fn) { try { fn(); n++; } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const ROOT = path.join(__dirname, '..');

Object.keys(SETS).forEach((id) => {
    check(id + ' : app.json déclare les noms de la table, en "s", et rien d\'autre ; main.js et shared sont livrés', () => {
        const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', id, 'app.json'), 'utf8'));
        const want = {};
        Object.keys(SETS[id].signals).forEach((i) => { want[i] = {}; SETS[id].signals[i].forEach((f) => { want[i][f] = 's'; }); });
        assert.deepStrictEqual(spec.signals, want);
        assert.deepStrictEqual(spec.shared.slice().sort(), ['probe_sets.js', 'signal_probe.js']);
        assert(/readOnly/.test(JSON.stringify(spec.config)) && spec.config.lang === 'fr');
        const main = fs.readFileSync(path.join(ROOT, 'apps', id, 'main.js'), 'utf8');
        assert(main.includes("require('./probe_sets')." + id), 'main.js lit sa ligne de la table');
        assert(/^[A-Z]{4}$/.test(spec.loggingId) && /^[A-Z]{3}$/.test(spec.iconGlyph));
    });
});
check('les applis d\'essai ont chacune leur identifiant, leur journal et leur glyphe', () => {
    ['logId', 'glyph', 'title'].forEach((k) => assert.strictEqual(new Set(Object.keys(SETS).map((i) => SETS[i][k])).size, Object.keys(SETS).length, k));
    ['shaktheme', 'shakhud', 'shakcamdiag'].forEach((a) => {
        const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', a, 'app.json'), 'utf8'));
        Object.keys(SETS).forEach((i) => assert(SETS[i].logId !== spec.loggingId && SETS[i].glyph !== spec.iconGlyph, i + ' ressemble à ' + a));
    });
});
check('aucun thème ne déclare un nom d\'essai (la voiture refuserait tout)', () => {
    ['shaktheme', 'shakhud'].forEach((a) => {
        const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', a, 'app.json'), 'utf8'));
        Object.keys(SETS).forEach((i) => Object.keys(SETS[i].signals).forEach((iface) => SETS[i].signals[iface].forEach((f) => {
            const have = spec.signals[iface] && spec.signals[iface][f];
            const accepted = JSON.parse(fs.readFileSync(path.join(__dirname, 'car_accepted_signals.json'), 'utf8')).signals;
            assert(!have || (accepted[iface] && accepted[iface][f]), a + ' déclare ' + iface + '.' + f + ' sans qu\'il soit accepté');
        })));
    });
});

check('Probe : un changement est noté, une valeur qui ne bouge pas compte un message mais pas un changement', () => {
    let t = 1000;
    const p = new Probe({ 'a.b.Iface': ['x', 'y'] }, () => t);
    p.receive('a.b.Iface', 'x', { v: 1 }); t = 3500;
    p.receive('a.b.Iface', 'x', { v: 1 });
    p.receive('a.b.Iface', 'x', { v: 2 });
    const s = p.snapshot();
    assert.strictEqual(s.total, 3);
    assert.strictEqual(s.events.length, 2);
    assert.strictEqual(s.events[0].value, '{"v":2}'); assert.strictEqual(s.events[0].at, '2.5 s');
    assert.strictEqual(s.rows[0].ok, true); assert.strictEqual(s.rows[1].ok, false);
    assert(/3 msg/.test(s.rows[0].text), s.rows[0].text);
    assert(/rien reçu|indisponible/.test(s.rows[1].text), s.rows[1].text);
});
check('Probe : une interface refusée, un abonnement refusé et une voiture indisponible se lisent à l\'écran', () => {
    const p = new Probe({ 'a.Iface': ['x', 'y'], 'b.Other': ['z'] }, () => 0);
    p.result('a.Iface', { error: null, failed: { y: 'no such field' }, getFailed: {}, available: true });
    p.result('b.Other', { error: 'no SOME/IP config', failed: {}, getFailed: {}, available: false });
    const s = p.snapshot();
    assert(/rien reçu/.test(s.rows[0].text) && !s.rows[0].bad);
    assert(/abonnement refusé : no such field/.test(s.rows[1].text) && s.rows[1].bad);
    assert(/interface refusée/.test(s.rows[2].text) && s.rows[2].bad);
    assert.deepStrictEqual(s.ifaces.map((i) => i.state), ['disponible', 'REFUSÉE']);
    p.result('b.Other', { error: null, failed: {}, getFailed: {}, available: false });
    assert(/voiture indisponible/.test(p.snapshot().rows[2].text));
});
check('Probe : le journal ne garde que les derniers changements', () => {
    const p = new Probe({ 'a.Iface': ['x'] }, () => 0);
    for (let i = 0; i < 40; i++) p.receive('a.Iface', 'x', i);
    const s = p.snapshot();
    assert(s.events.length <= 12 && s.events[0].value === '39');
});

check('Probe : ce qui a bougé est gardé ; l\'état de départ de la voiture n\'en fait pas partie ; un bouton qui parle pour la première fois bien après le départ si', () => {
    let t = 0, wall = Date.UTC(2026, 10, 17, 12, 0, 0);
    const p = new Probe({ 'a.b.Iface': ['x', 'y', 'z'] }, () => t, null, () => wall);
    p.receive('a.b.Iface', 'x', 1); t = 1000;           // l'état de départ
    p.receive('a.b.Iface', 'x', 1);
    assert.deepStrictEqual(p.foundList(), [], 'rien n\'a bougé');
    t = 9000; wall += 9000;
    p.receive('a.b.Iface', 'x', 2);                      // x change : une trouvaille
    p.receive('a.b.Iface', 'y', true);                   // y parle pour la première fois à 9 s : un bouton
    p.receive('a.b.Iface', 'y', false);
    p.receive('a.b.Iface', 'y', true);
    const f = p.foundList();
    assert.deepStrictEqual(f.map((e) => e.name).sort(), ['Iface.x', 'Iface.y']);
    const y = f.find((e) => e.name === 'Iface.y');
    assert.strictEqual(y.n, 3); assert.deepStrictEqual(y.vals, ['true', 'false']);
    assert.strictEqual(f.find((e) => e.name === 'Iface.x').n, 1);
    const sn = p.snapshot();
    assert(/^\d\d:\d\d:\d\d$/.test(sn.found[0].at), sn.found[0].at);
    assert.strictEqual(sn.found.find((e) => e.name === 'Iface.y').vals, 'true · false');
});
check('Probe : les trouvailles restent après un redémarrage (fichier), « Effacer » les retire, un fichier absent ou abîmé n\'est pas une erreur', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));
    const file = path.join(dir, 'found.json');
    let t = 0;
    const a = new Probe({ 'a.Iface': ['x'] }, () => t, file); a.load();                        // pas de fichier : rien
    assert.deepStrictEqual(a.foundList(), []);
    t = 9000; a.receive('a.Iface', 'x', 5); a.receive('a.Iface', 'x', 6);
    a.flush();
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(raw.v, 1); assert.strictEqual(raw.found['Iface.x'].n, 2);
    assert(!fs.existsSync(file + '.tmp'), 'pas de fichier temporaire laissé');
    const b = new Probe({ 'a.Iface': ['x'] }, () => 0, file); b.load();                       // « le lendemain »
    assert.strictEqual(b.foundList().length, 1); assert.deepStrictEqual(b.foundList()[0].vals, ['5', '6']);
    t = 0; b.receive('a.Iface', 'x', 7);                                                        // le premier message d'une nouvelle séance est l'état de départ
    assert.strictEqual(b.foundList()[0].n, 2, 'l\'état de départ n\'est pas une trouvaille');
    b.clear();
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).found, {});
    fs.writeFileSync(file, '{ pas du json');
    const c = new Probe({ 'a.Iface': ['x'] }, () => 0, file); c.load();
    assert.deepStrictEqual(c.foundList(), []);
    const d = new Probe({ 'a.Iface': ['x'] }, () => 9000, path.join(dir, 'absent', 'found.json')); d.load();
    d.receive('a.Iface', 'x', 1); d.receive('a.Iface', 'x', 2); d.flush();                      // dossier absent : pas d'erreur, ça reste à l'écran
    assert.strictEqual(d.foundList().length, 1);
    fs.rmSync && fs.rmSync(dir, { recursive: true, force: true });
});
check('Probe : une valeur qui varie sans cesse est marquée, cinq valeurs au plus par signal', () => {
    let t = 9000;
    const p = new Probe({ 'a.Iface': ['x', 'y'] }, () => t);
    for (let i = 0; i < 80; i++) p.receive('a.Iface', 'x', i);
    for (let i = 0; i < 9; i++) p.receive('a.Iface', 'y', 'v' + i);
    const f = p.foundList();
    assert.strictEqual(f.find((e) => e.name === 'Iface.x').noisy, true);
    const y = f.find((e) => e.name === 'Iface.y');
    assert.strictEqual(y.noisy, false); assert.deepStrictEqual(y.vals, ['"v4"', '"v5"', '"v6"', '"v7"', '"v8"']);
});

check('start : s\'abonne à chaque interface, dessine sans erreur, et les messages arrivent à l\'écran', () => {
    const texts = [], watched = [];
    let kicks = 0, handlers = {};
    const ctx = {
        log: { info() {}, warn() {}, error(m) { throw new Error(m); } },
        signals: { watch: (iface, inst, h, log, opts) => { watched.push([iface, inst, Object.keys(h), opts]); handlers[iface] = h; return Promise.resolve({ error: null, failed: {}, getFailed: {}, available: true }); } },
        canvas: () => ({ clear() {}, text(...a) { texts.push(a[0]); } }),
        loop: (name, hz, fn) => ({ kick() { kicks++; fn(); } }),
        ui: { image: (id) => id },
    };
    const set = SETS.shakvolant;
    const probe = start(ctx, set);
    assert.deepStrictEqual(watched.map((w) => w[0]), Object.keys(set.signals));
    assert.deepStrictEqual(watched[0][2], set.signals[watched[0][0]]);
    assert.strictEqual(watched[0][1], '1');
    const iface = watched[0][0];
    handlers[iface].statusPTTButton1({ operationPushButtonPTTSteeringWheel: 1 });
    assert(kicks >= 1, 'un message redessine');
    assert(texts.some((t) => /statusPTTButton1/.test(t)), 'le nom du champ est à l\'écran');
    assert(texts.some((t) => /operationPushButtonPTTSteeringWheel/.test(t)), 'la valeur reçue est à l\'écran');
    assert.strictEqual(probe.total, 1);
});
check('start : les trouvailles vont dans <dataDir>/found.json et le bouton « Effacer » les retire', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));
    let handlers = {}, clear = null, drawn = 0;
    const ctx = {
        dataDir: dir,
        log: { info() {}, warn() {}, error(m) { throw new Error(m); } },
        signals: { watch: (iface, inst, h) => { handlers[iface] = h; return Promise.resolve({ error: null, failed: {}, getFailed: {}, available: true }); } },
        canvas: () => ({ clear() {}, text() { drawn++; }, roundRect() {}, target(x, y, w, h, fn, id) { if (id === 'clear') clear = fn; } }),
        loop: (name, hz, fn) => ({ kick() { fn(); } }),
        ui: { image: (id) => id },
    };
    const probe = start(ctx, SETS.shakvolant);
    probe.t0 -= 60000;                                   // la séance dure depuis une minute : un bouton qui parle maintenant est une trouvaille
    const iface = Object.keys(SETS.shakvolant.signals)[0];
    handlers[iface].statusPTTButton1({ k: 1 });
    probe.flush();
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'found.json'), 'utf8')).found['SteeringWheelPushButton.statusPTTButton1'].n, 1);
    assert(drawn > 0 && typeof clear === 'function', 'le bouton Effacer est tendu');
    clear();
    assert.deepStrictEqual(probe.foundList(), []);
    probe.flush();
    fs.rmSync && fs.rmSync(dir, { recursive: true, force: true });
});

check('wrap : une longue valeur passe sur trois lignes au plus, la dernière finit par des points de suite', () => {
    const { wrap } = require('../shared/signal_probe');
    assert.deepStrictEqual(wrap('abc', 10, 3), ['abc']);
    assert.deepStrictEqual(wrap('', 10, 3), ['']);
    assert.deepStrictEqual(wrap('a'.repeat(25), 10, 3), ['a'.repeat(10), 'a'.repeat(10), 'a'.repeat(5)]);
    const w = wrap('b'.repeat(40), 10, 3);
    assert.strictEqual(w.length, 3); assert(w[2].length === 10 && w[2].endsWith('…'), w[2]);
});
check('ShakGPS : la position est à l\'écran en entier (structure longue sur plusieurs lignes), le nom est celui du dossier KombiIF', () => {
    const set = SETS.shakgps;
    assert.deepStrictEqual(Object.keys(set.signals), ['de.bmw.infotainment.GPSData']);
    assert.deepStrictEqual(set.signals['de.bmw.infotainment.GPSData'], ['GPSPositionCAN', 'GPSPositionExtendedCAN']);
    const texts = [], handlers = {};
    const ctx = {
        log: { info() {}, warn() {}, error(m) { throw new Error(m); } },
        signals: { watch: (iface, inst, h) => { handlers[iface] = h; return Promise.resolve({ error: null, failed: {}, getFailed: {}, available: true }); } },
        canvas: () => ({ clear() {}, text(...a) { texts.push(a[0]); } }),
        loop: (name, hz, fn) => ({ kick() { fn(); } }),
        ui: { image: (id) => id },
    };
    start(ctx, set);
    handlers['de.bmw.infotainment.GPSData'].GPSPositionCAN({ latitude: 48.8566, longitude: 2.3522, extra: 'x'.repeat(100) });
    const all = texts.join('\n');
    assert(/GPSPositionCAN/.test(all) && /48\.8566/.test(all) && /2\.3522/.test(all), 'latitude et longitude à l\'écran');
    assert(texts.some((t) => /GPSPositionExtendedCAN/.test(t)), 'la deuxième ligne est là, vide');
});

console.log(failed ? failed + ' FAILED' : 'signal probes: ' + n + ' checks pass');
if (failed) process.exitCode = 1;
