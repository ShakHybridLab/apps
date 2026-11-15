'use strict';
// The signals the app only reads (shared/probes.js, the page's Signals tab): declared with the flags the owner's catalog lists, kept and logged
// without flooding, translated, shipped by both apps. node tools/test_probes.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { PROBES, GUIDE, Probes, rawOf, guidanceOf, SHOWN, stateOf } = require('../shared/probes');
const fr = require('../shared/fr');
let failed = 0;
function check(name, fn) { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message || e)); } }
const app = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'apps', n, 'app.json'), 'utf8'));
const theme = app('shaktheme'), hud = app('shakhud');

// "get notify" in the catalog photos is "rs", "notify" alone "s" (a notifier without getter)
const FLAGS = { rpm: 'rs', engt: 'rs', speed: 'rs', sign: 's', next: 'rs', fas: 'rs', fasx: 'rs', wheel: 's', pdrive: 's', pdrive2: 's', pdist: 'rs', cc: 'rs', cbs: 'rs', ccrisk: 'rs' };

check('every probe is declared in ShakTheme\'s app.json with the flags the catalog lists (a signal the car does not have breaks the installation)', () => {
    assert.deepStrictEqual(PROBES.map((p) => p.id).sort(), Object.keys(FLAGS).sort(), 'the probes are not the ones listed here');
    PROBES.forEach((p) => {
        assert(theme.signals[p.iface], p.id + ': interface not declared: ' + p.iface);
        assert.strictEqual(theme.signals[p.iface][p.field], FLAGS[p.id], p.id + ': flags of ' + p.field);
        assert(/^de\.bmw\./.test(p.iface), p.id + ': the interface name starts with de.bmw.');
    });
});
// the three the app draws from itself (régime, températures, vitesse): ShakHUD declares them too, since its rev counter needs them
const OWN = ['rpm', 'engt', 'speed'];
// and the cluster's power meter (the electric motor's share, for the hybrid rev counter without eDrive Live: setting carPower, car_extras.js)
const HUD_ASKS = OWN.concat(['pdrive', 'pdrive2']);
check('ShakHUD declares only what the app draws from (it asks for no signal it does not use)', () => {
    PROBES.forEach((p) => {
        const has = !!(hud.signals && hud.signals[p.iface] && hud.signals[p.iface][p.field]);
        assert.strictEqual(has, HUD_ASKS.indexOf(p.id) >= 0, p.id + (has ? ' is declared by ShakHUD' : ' is missing from ShakHUD'));
        if (has) assert.strictEqual(hud.signals[p.iface][p.field], FLAGS[p.id], p.id + ': flags in ShakHUD');
    });
});
check('the three the app draws from come first in the list, so they are the first rows of the Signals tab', () => {
    assert.deepStrictEqual(PROBES.slice(0, 3).map((p) => p.id), OWN);
});
check('a handler added for a field the car reads itself runs after the car\'s own: the rev counter keeps its value (kit/runtime/car.js)', () => {
    const Car = require('../kit/runtime/car');
    const seen = {}, got = [];
    const ctx = {
        log: { info() {}, warn() {} }, spec: { config: {} }, settings: { get: () => 'off' },
        signals: { watch: (iface, v, handlers) => { seen[iface] = handlers; return Promise.resolve({ iface, available: true }); } },
    };
    const CDS = 'de.bmw.infotainment.vehicle.CDS';
    const car = new Car(ctx, ['rpm', 'speed'], { [CDS]: { statusEngineSpeed2: (v) => got.push(v), other: () => {} } });
    seen[CDS].statusEngineSpeed2({ actualValueRPMEngineCrankshaft: 8000 });          // 8000 x 0.25 = 2000 rpm
    assert.strictEqual(car.data().rpm, 2000, 'the car lost its own rpm handler');
    assert.strictEqual(got.length, 1, 'the added handler did not run');
    assert.strictEqual(got[0].actualValueRPMEngineCrankshaft, 8000);
    seen[CDS].statusEngineSpeed2({ actualValueRPMEngineCrankshaft: 65535 });         // the car's "no value": the rpm stays, the added handler still hears it
    assert.strictEqual(car.data().rpm, 2000);
    assert.strictEqual(got.length, 2);
    assert.strictEqual(typeof seen[CDS].other, 'function', 'a field only the added handler knows is lost');
    car.subs.length = 0;
});
check('the build gives the app its declared signals (ctx.spec.signals): without them none of the probes, nor the camera\'s road signs, was ever read on the car', () => {
    const build = fs.readFileSync(path.join(__dirname, '..', 'kit', 'tools', 'build.py'), 'utf8');
    assert(/rt_spec = \{k: spec\.get\(k\) for k in \([^)]*'signals'\)/.test(build), 'build.py leaves signals out of app-spec.json');
    const hudJs = fs.readFileSync(path.join(__dirname, '..', 'shared', 'hud.js'), 'utf8');
    assert(/const decl = \(this\.ctx\.spec && this\.ctx\.spec\.signals\) \|\| \{\};/.test(hudJs), 'hud.js no longer reads ctx.spec.signals');
});
check('both apps ship probes.js, and ShakTheme has the Signals tab', () => {
    assert(theme.shared.indexOf('probes.js') >= 0 && hud.shared.indexOf('probes.js') >= 0, 'probes.js is not in a "shared" list');
    assert(/tabs: \[[^\]]*'signals'/.test(fs.readFileSync(path.join(__dirname, '..', 'apps', 'shaktheme', 'main.js'), 'utf8')), 'no signals tab in main.js');
});
check('the page texts are in French, with their accents', () => {
    PROBES.forEach((p) => { assert.notStrictEqual(fr.tr(p.name), p.name, p.name + ': no French'); });
    ['Car signals', 'Signals of the car, read only', 'Not heard yet', 'Photograph this page after a drive: it shows the last values the car sent.',
        'Read only: nothing here changes the car.', '(empty)'].forEach((s) => assert.notStrictEqual(fr.tr(s), s, s + ': no French'));
    assert.strictEqual(fr.tr('3 of 11 read'), '3 sur 11 lus');
});
check('a value is kept newest first, three at most, a repeat changes nothing, and `heard` counts the probes heard', () => {
    const p = new Probes(null);
    assert.strictEqual(p.get('cc'), null); assert.strictEqual(p.heard(), 0);
    assert.strictEqual(p.feed('cc', { a: 1, b: 'x' }, 1000), true);
    assert.strictEqual(p.feed('cc', { a: 1, b: 'x' }, 1100), false);
    ['2', '3', '4'].forEach((a, i) => p.feed('cc', { a }, 2000 + i));
    const d = p.get('cc');
    assert.deepStrictEqual(d.vals, ['a=4', 'a=3', 'a=2']); assert.strictEqual(d.n, 5); assert.strictEqual(d.at, 2002);
    p.feed('cbs', null, 3000); assert.strictEqual(p.heard(), 1, 'a null reading is not a value'); p.feed('cbs', {}, 3000); assert.deepStrictEqual(p.get('cbs').vals, ['(empty)']); p.by.cbs = undefined;
    p.feed('pdist', { x: 1 }, 3000); assert.strictEqual(p.heard(), 2);
    assert.strictEqual(SHOWN.length, PROBES.length);
});
check('the log gets the first 12 distinct values, then one a minute, and never more than two a second', () => {
    const lines = [], p = new Probes({ info: (s) => lines.push(s) });
    for (let i = 0; i < 40; i++) p.feed('pdrive', { q: i }, 1000 + i * 600);          // a new value each 0.6 s
    assert.strictEqual(lines.length, 12, 'the first 12 only: ' + lines.length);
    assert(/^signal pdrive: q=0$/.test(lines[0]), lines[0]);
    p.feed('pdrive', { q: 99 }, 1000 + 40 * 600 + 30000); assert.strictEqual(lines.length, 12, 'a minute not up');
    p.feed('pdrive', { q: 100 }, 1000 + 12 * 600 + 61000); assert.strictEqual(lines.length, 13, 'one after a minute');
    const f = new Probes({ info: (s) => lines.push(s) }); const n = lines.length;
    for (let i = 0; i < 10; i++) f.feed('cc', { z: i }, 5000 + i * 100);                // ten changes in a second: two lines at most
    assert(lines.length - n <= 2, 'flooded: ' + (lines.length - n));
});
check('a value is one line of key=value, long ones cut', () => {
    assert.strictEqual(rawOf({ a: 1.123456789, b: 'x' }), 'a=1.12346 b=x');
    assert(rawOf({ k: 'y'.repeat(100) }).length < 60, 'a long value is not cut');
    assert.strictEqual(rawOf([1, 2]), '[1,2]'); assert.strictEqual(rawOf(null), '');
    assert(rawOf(JSON.parse('[' + '1,'.repeat(400) + '1]')).length <= 500, 'an array is not cut');
});
check('the Signals tab: two pages that hold every probe once, each row fits above the app\'s mark, and what the app understood is shown', () => {
    const { PAGES, meaningOf } = require('../shared/probes');
    assert.deepStrictEqual(PAGES.reduce((a, b) => a.concat(b), []).sort(), PROBES.map((p) => p.id).concat([GUIDE.id]).sort(), 'the pages do not hold every probe once');
    const page = fs.readFileSync(path.join(__dirname, '..', 'shared', 'page.js'), 'utf8');
    const m = /    signalsTab\(cv, bottom\) \{[\s\S]*?\n    \}\n/.exec(page);
    assert(m, 'no signalsTab');
    const body = m[0].replace(/^    signalsTab\(cv, bottom\) \{/, '').replace(/\n    \}\n$/, '');
    const C = { text: '#fff', dim: '#aaa', label: '#888', blue: '#00f', blueHi: '#0af', live: '#0f0', off: '#ccc' };
    const run = (pg, feed) => {
        const calls = { text: [], glass: [], chips: [] };
        const cv = { circle() {}, text(t, x, y, size, col) { calls.text.push({ t, x, y, size, col }); }, textWidth: (t, sz) => String(t).length * sz * 0.55, target() {} };
        const hud = { probes: new Probes(null), ctx: {}, car: { subs: [] } };
        if (feed) PROBES.concat([GUIDE]).forEach((p) => hud.probes.feed(p.id, feed[p.id] === undefined ? { a: 1, b: 'x'.repeat(80) } : feed[p.id], Date.now()));
        const self = { sigPage: pg, hud, kick() {} };
        new Function('cv', 'bottom', 'label', 'miniChip', 'glass', 'note', 'C', 'CX', 'CR', 'CW', 'probes', 'Date', body)
            .call(self, cv, 512, () => {}, (c, x, y, t) => { calls.chips.push(t); return 50; }, (c, x, y, w, h) => { calls.glass.push({ y, h }); }, (c, x, y, lines) => { calls.note = { y, n: lines.length }; }, C, 300, 1584, 1284, require('../shared/probes'), Date);
        return calls;
    };
    [0, 1].forEach((pg) => [false, true].forEach((fed) => {
        const c = run(pg, fed ? { rpm: 2500, speed: 62, sign: 70, guide: true, cc: { numberDisplayControlCheckControlMessage: 3 } } : null);
        assert.strictEqual(c.chips.join(), '1/2,2/2');
        const last = c.glass[c.glass.length - 1];
        assert.strictEqual(c.glass.length, PAGES[pg].length, 'rows on page ' + pg);
        assert(last.y + last.h <= 512, 'page ' + pg + ' rows end at ' + (last.y + last.h) + ', past 512');
        c.text.forEach((t) => assert(t.y <= 512, 'text below the page: ' + t.t));
        assert(c.note && c.note.y + (c.note.n - 1) * 26 + 6 <= 512, 'the note runs past 512: ' + JSON.stringify(c.note));
        if (fed && pg === 0) assert(c.text.some((t) => /^→ 2500 rpm$/.test(t.t)) && c.text.some((t) => t.t === '→ route: yes'), 'no meaning line');
    }));
    const FR = { '→ 2500 rpm': '→ 2500 tr/min', '→ limit 70': '→ limite 70', '→ next limit 90': '→ limite suivante 90', '→ no limit read': '→ aucune limite lue', '→ no next limit': '→ aucune limite suivante', '→ not understood': '→ non compris', '→ alert: yes': '→ alerte : oui', '→ route: no': '→ itinéraire : non',
        '→ motor 40 % · 32 kW': '→ moteur 40 % · 32 kW', '→ recuperation 25 % · 20 kW': '→ récupération 25 % · 20 kW', '→ motor at rest': '→ moteur au repos', '→ wheel on, green': '→ volant allumé, vert', '→ wheel on, yellow, warning': '→ volant allumé, jaune, alerte', '→ wheel off': '→ volant éteint' };
    Object.keys(FR).forEach((k) => assert.strictEqual(fr.tr(k), FR[k], k));
    // the readings: a value that is not clear is never taken for one
    assert.strictEqual(meaningOf('rpm', 65535), '→ not understood'); assert.strictEqual(meaningOf('rpm', 2499.6), '→ 2500 rpm');
    assert.strictEqual(meaningOf('pdrive', { quota: 255 }), '→ not understood'); assert.strictEqual(meaningOf('pdrive', { quota: 40 }), '→ motor 40 % · 32 kW');
    assert.strictEqual(meaningOf('fas', 3), ''); assert.strictEqual(meaningOf('rpm', null), ''); assert.strictEqual(meaningOf('guide', 'weird'), '→ not understood');
    assert.strictEqual(meaningOf('wheel', { steeringWheelDisplay: 1, steeringWheelColor: 'YELLOW', displayLateralWarning: 'LEFT' }), '→ wheel on, yellow, warning');
});
check('the page redraws the Signals tab by itself (a timer, on that tab only) and the tab list has seven entries that fit above the app\'s mark', () => {
    const page = fs.readFileSync(path.join(__dirname, '..', 'shared', 'page.js'), 'utf8');
    assert(/this\.sigTimer = setInterval\(\(\) => \{ if \(this\.tab === 'signals'\) this\.kick\(\); \}, 2000\)/.test(page), 'no redraw timer');
    const m = page.match(/const RAIL8 = \{ x: 16, y: 54, w: 252, h: (\d+), gap: (\d+) \}/);
    assert(m, 'no RAIL8');
    const tabs = JSON.parse('[' + /tabs: \[([^\]]*)\]/.exec(fs.readFileSync(path.join(__dirname, '..', 'apps', 'shaktheme', 'main.js'), 'utf8'))[1].replace(/'/g, '"') + ']');
    assert.strictEqual(tabs.length, 7);
    const last = 54 + 6 * (Number(m[1]) + Number(m[2])) + Number(m[1]);          // the bottom of the seventh tab
    assert(last <= 520 - 62 - 6, 'the tabs reach the mark: ' + last);
});
check('a silent probe says why: no subscription yet, refused, error, provider not answering, or subscribed and silent (French too)', () => {
    assert.strictEqual(stateOf(undefined, 'f'), 'Subscribing');
    assert.strictEqual(stateOf({ error: 'no SOME/IP config for x' }, 'f'), 'Error: no SOME/IP config for x');
    assert.strictEqual(stateOf({ failed: { f: 'nope' }, available: true }, 'f'), 'Refused: nope');
    assert.strictEqual(stateOf({ getFailed: { f: 'timeout' }, available: true }, 'f'), 'Read refused: timeout');
    assert.strictEqual(stateOf({ available: false, failed: {}, getFailed: {} }, 'f'), 'The car does not answer');
    assert.strictEqual(stateOf({ available: true, failed: {}, getFailed: { g: 'x' } }, 'f'), 'Subscribed, nothing received');
    assert.strictEqual(fr.tr('Subscribing'), 'Abonnement en cours');
    assert.strictEqual(fr.tr('The car does not answer'), 'La voiture ne répond pas');
    assert.strictEqual(fr.tr('Subscribed, nothing received'), 'Abonné, rien reçu');
    assert.strictEqual(fr.tr('Error: no SOME/IP config for x'), 'Erreur : no SOME/IP config for x');
    assert.strictEqual(fr.tr('Refused: nope'), 'Refusé : nope');
    assert.strictEqual(fr.tr('Read refused: timeout'), 'Lecture refusée : timeout');
});
check('signals.js keeps why a field was refused (failed / getFailed), for the Signals tab', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'kit', 'runtime', 'signals.js'), 'utf8');
    assert(/failed: \{\}, getFailed: \{\}/.test(src) && /res\.failed\[f\] =/.test(src) && /res\.getFailed\[f\] =/.test(src), 'signals.js does not record the refusals');
});

// ---- the route: CarPlayManager.projectedGuidanceActive (the Waze map in the theme only with a route) ----
check('the guidance signal is declared (optional, "rs") by ShakTheme only, and is not a line of the Signals tab (no room left)', () => {
    assert(theme.signals[GUIDE.iface] && theme.signals[GUIDE.iface][GUIDE.field] === 'rs', 'ShakTheme does not declare ' + GUIDE.field);
    assert(typeof theme.signals[GUIDE.iface]._optional === 'string' && theme.signals[GUIDE.iface]._optional.length > 20, 'a wrong name would block the installation: it must be optional');
    assert(!(hud.signals && hud.signals[GUIDE.iface]), 'ShakHUD asks for a signal it does not use');
    assert(PROBES.every((p) => p.id !== GUIDE.id), 'the guidance probe is in the Signals tab list');
    assert(/^de\.bmw\.infotainment\.a4a\.carplay\.CarPlayManager$/.test(GUIDE.iface));
});
check('guidanceOf: a boolean, 0 / 1, a word or a struct holding one; nothing clear is null', () => {
    assert.strictEqual(guidanceOf(true), true); assert.strictEqual(guidanceOf(false), false);
    assert.strictEqual(guidanceOf(1), true); assert.strictEqual(guidanceOf(0), false); assert.strictEqual(guidanceOf(7), null);
    assert.strictEqual(guidanceOf('ACTIVE'), true); assert.strictEqual(guidanceOf('inactive'), false); assert.strictEqual(guidanceOf('NOT_ACTIVE'), false);
    assert.strictEqual(guidanceOf('true'), true); assert.strictEqual(guidanceOf('false'), false); assert.strictEqual(guidanceOf('NONE'), false);
    assert.strictEqual(guidanceOf({ value: true }), true); assert.strictEqual(guidanceOf({ projectedGuidanceActive: false }), false);
    assert.strictEqual(guidanceOf({ x: 1 }), true, 'a struct with one field');
    assert.strictEqual(guidanceOf({ a: 1, b: 2 }), null); assert.strictEqual(guidanceOf([true]), null);
    assert.strictEqual(guidanceOf(null), null); assert.strictEqual(guidanceOf(undefined), null); assert.strictEqual(guidanceOf(''), null); assert.strictEqual(guidanceOf('maybe'), null);
});
check('the map shows in the theme with a route, or when the car says nothing; not when it says there is none (setting mapOnlyWithRoute)', () => {
    // hud.js needs the kit around it (it is only built into dist), so the three methods are cut out of its source and run on a stand-in
    const hudSrc = fs.readFileSync(path.join(__dirname, '..', 'shared', 'hud.js'), 'utf8');
    const grab = (name) => { const m = hudSrc.match(new RegExp('\\n    ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n    \\}\\n')); assert(m, 'hud.js has no ' + name); return m[0]; };
    const Hud = { prototype: new Function('guidanceOf', 'return class {' + grab('_routeOk') + grab('_wazeMapOn') + grab('_guidance') + '}')(guidanceOf).prototype };
    assert(/if \(key === 'mapUp'\) return !!\(this\._wazeMapOn\(\) \|\| this\.windowOpen === true\);/.test(hudSrc), "setting('mapUp') no longer goes through _wazeMapOn");
    const mk = (opts) => {
        const set = Object.assign({ mapInTheme: true, mapOnlyWithRoute: true }, opts.set || {});
        const o = { routeActive: opts.route === undefined ? null : opts.route, windowOpen: !!opts.window, waze: { up: opts.up !== false },
            ctx: { settings: { item: (k) => (set[k] !== undefined ? { key: k } : undefined), get: (k) => set[k] } }, mapShown: false, mapLayout: true, rebuilt: 0, statused: 0, logs: [],
            log: { info: (m) => o.logs.push(m) }, _rebuild() { o.rebuilt++; }, _status() { o.statused++; } };
        ['_routeOk', '_wazeMapOn', '_guidance'].forEach((m) => { o[m] = Hud.prototype[m]; });
        o.setting = (k) => (k === 'mapUp' ? !!(o._wazeMapOn() || o.windowOpen === true) : set[k]);       // the line checked above
        return o;
    };
    assert.strictEqual(mk({ route: true })._wazeMapOn(), true);
    assert.strictEqual(mk({ route: null })._wazeMapOn(), true, 'nothing read yet: as before');
    assert.strictEqual(mk({ route: false })._wazeMapOn(), false, 'no route: no map');
    assert.strictEqual(mk({ route: false, set: { mapOnlyWithRoute: false } })._wazeMapOn(), true, 'setting off: as before');
    assert.strictEqual(mk({ route: false, up: false })._wazeMapOn(), false, 'waze is not up');
    assert.strictEqual(mk({ route: false, set: { mapOnlyWithRoute: undefined } })._wazeMapOn(), true, 'ShakHUD has no such setting');
    assert.strictEqual(mk({ route: false })._routeOk(), false);
    assert.strictEqual(mk({ route: false, window: true }).setting('mapUp'), true, 'the centre window for Cluster Centre still opens');
    assert.strictEqual(mk({ route: false }).setting('mapUp'), false);
    // a route starting or ending rebuilds the layout once; the same value again does nothing
    const o = mk({ route: null });
    o._guidance(false); assert.strictEqual(o.routeActive, false); assert.strictEqual(o.rebuilt, 0, 'map was not shown: nothing to rebuild'); assert.strictEqual(o.statused, 1);
    o._guidance(false); assert.strictEqual(o.statused, 1, 'same value again');
    o._guidance(true); assert.strictEqual(o.routeActive, true); assert.strictEqual(o.rebuilt, 1, 'the route starts, the layout was built closed: the map window opens');
    o.mapShown = true; o._guidance(true); assert.strictEqual(o.rebuilt, 1, 'same value again');
    o._guidance(false); assert.strictEqual(o.rebuilt, 2, 'the route ends, the layout was built open: the window closes');
    o._guidance(undefined); o._guidance(null); assert.strictEqual(o.routeActive, false, 'no value keeps the last one');
    assert(o.logs.some((l) => /CarPlay guidance active/.test(l)) && o.logs.some((l) => /inactive: no route/.test(l)));
});
check('hud.js wires the guidance probe (GUIDE joins the probes of the app) and the Map tab shows it', () => {
    const hudJs = fs.readFileSync(path.join(__dirname, '..', 'shared', 'hud.js'), 'utf8'), pageJs = fs.readFileSync(path.join(__dirname, '..', 'shared', 'page.js'), 'utf8');
    assert(/PROBES\.concat\(\[GUIDE\]\)\.forEach/.test(hudJs) && /p\.id === 'guide'\) this\._guard\('guidance'/.test(hudJs), 'hud.js does not feed the guidance');
    assert(/this\.ctx\.settings\.get\('mapOnlyWithRoute'\)/.test(hudJs));
    assert(/'mapOnlyWithRoute'/.test(pageJs) && /probes\.GUIDE/.test(pageJs), 'the Map tab does not show the setting and the state');
    const item = theme.settings.find((x) => x.key === 'mapOnlyWithRoute');
    assert(item && item.type === 'bool' && item.default === true && /itinéraire/.test(item.label), 'the setting is missing or not in French');
    assert(!hud.settings.some((x) => x.key === 'mapOnlyWithRoute'), 'ShakHUD has the setting');
});
check('the Map tab texts are in French', () => {
    assert.strictEqual(fr.tr('Show the map only with a route'), 'Carte seulement avec un itinéraire');
    assert.strictEqual(fr.tr('Route on · true'), 'Itinéraire en cours · true');
    assert.strictEqual(fr.tr('No route · false'), "Pas d'itinéraire · false");
    assert.strictEqual(fr.tr('Value not understood · x'), 'Valeur non comprise · x');
    assert.strictEqual(fr.tr(GUIDE.name), 'Guidage CarPlay actif (itinéraire)');
});
console.log(failed ? failed + ' FAILED' : 'probes: all checks pass');
process.exit(failed ? 1 : 0);
