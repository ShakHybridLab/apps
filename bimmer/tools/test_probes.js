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
const FLAGS = { rpm: 'rs', engt: 'rs', speed: 'rs', sign: 's', next: 'rs', fas: 'rs', fasx: 'rs', wheel: 's', rel: 'rs', pdrive: 's', pdrive2: 's', pdist: 'rs', erange: 'rs', cc: 'rs' };

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
// and its electric range (the plug-in hybrid's own figure, KombiIF displayRangeElectricVehicle, which ShakHUD's widgets read already)
const HUD_ASKS = OWN.concat(['rel', 'pdrive', 'pdrive2', 'erange']);
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
    assert(theme.shared.indexOf('catalog.js') >= 0 && hud.shared.indexOf('catalog.js') >= 0, 'catalog.js (required by page.js) is not in a "shared" list: the app would not start on the car');
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
    p.feed('fasx', null, 3000); assert.strictEqual(p.heard(), 1, 'a null reading is not a value'); p.feed('fasx', {}, 3000); assert.deepStrictEqual(p.get('fasx').vals, ['(empty)']); p.by.fasx = undefined;
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
    const cut = (name, args) => {
        const m = new RegExp('    ' + name + '\\(' + args + '\\) \\{[\\s\\S]*?\\n    \\}\\n').exec(page);
        assert(m, 'no ' + name);
        return m[0].replace(new RegExp('^    ' + name + '\\(' + args + '\\) \\{'), '').replace(/\n    \}\n$/, '');
    };
    const bodies = { signalsTab: cut('signalsTab', 'cv, bottom'), sigChips: cut('sigChips', 'cv, pg, np'), catalogPage: cut('catalogPage', 'cv, bottom, pg, np') };
    const ARGS = { signalsTab: ['cv', 'bottom'], sigChips: ['cv', 'pg', 'np'], catalogPage: ['cv', 'bottom', 'pg', 'np'] };
    const C = { text: '#fff', dim: '#aaa', label: '#888', blue: '#00f', blueHi: '#0af', live: '#0f0', off: '#ccc' };
    const catalog = require('../shared/catalog');
    const run = (pg, feed, cat) => {
        const calls = { text: [], glass: [], chips: [], logs: [] };
        const cv = { circle() {}, text(t, x, y, size, col) { calls.text.push({ t, x, y, size, col }); }, textWidth: (t, sz) => String(t).length * sz * 0.55, target() {} };
        const hud = { probes: new Probes(null), ctx: {}, car: { subs: [] }, log: { info: (t) => calls.logs.push(t) }, _estPower: () => ({ kw: 23.4, old: false }), _relPower: () => run.rel || null };
        if (feed) PROBES.concat([GUIDE]).forEach((p) => hud.probes.feed(p.id, feed[p.id] === undefined ? { a: 1, b: 'x'.repeat(80) } : feed[p.id], Date.now()));
        const self = { sigPage: pg, hud, kick() {} };
        const deps = [(c, x, y, t) => {}, (c, x, y, t) => { calls.chips.push(t); return 50; }, (c, x, y, w, h) => { calls.glass.push({ y, h }); }, (c, x, y, lines) => { calls.note = { y, n: lines.length }; }, C, 300, 1584, 1284, require('../shared/probes'), cat ? { GROUPS: catalog.GROUPS, MAX_ROWS: catalog.MAX_ROWS, load: () => cat, peek: () => (cat === 'READING' ? null : cat) } : catalog, Date, require('path')];
        const names = ['label', 'miniChip', 'glass', 'note', 'C', 'CX', 'CR', 'CW', 'probes', 'catalog', 'Date', 'path'];
        Object.keys(bodies).forEach((k) => { self[k] = function () { return new Function(...ARGS[k], ...names, bodies[k]).apply(this, Array.prototype.slice.call(arguments).concat(deps)); }; });
        self.signalsTab(cv, 512);
        return calls;
    };
    const NPAGES = PAGES.length + catalog.GROUPS.length;
    {   // the power meter's row says what the speed and its slope give next to the car's share: one photo calibrates the scale
        const c = run(0, { pdrive: { quotaImmediateElectricEngineDriveRecuperation: 100 } });
        assert(c.text.some((t) => t.t === '→ share 100 (scale to confirm) · estimate 23 kW'), 'no estimate beside the share: ' + c.text.map((t) => t.t).filter((t) => /share/.test(t)).join('|'));
        assert.strictEqual(require('../shared/fr').tr('→ share 100 (scale to confirm) · estimate 23 kW'), '→ part 100 (échelle à confirmer) · estimée 23 kW');
        assert.strictEqual(require('../shared/fr').tr('→ share 100 (scale to confirm) · estimate -12 kW'), '→ part 100 (échelle à confirmer) · estimée -12 kW');
    }
    {   // the cluster's own power meter: its row says what the app read, and whether the rev bar draws from it
        assert.strictEqual(meaningOf('rel', { displayActualValuePowerRelativeDrivingElectric: 40, displayActualValuePowerRelativeRecuperation: 0 }), '→ drive 40 % · recup 0 %');
        assert.strictEqual(meaningOf('rel', { displayActualValuePowerRelativeRecuperation: 25 }), '→ drive - % · recup 25 %');
        assert.strictEqual(meaningOf('rel', { displayActualValuePowerRelativeDrivingElectric: 300 }), '→ above 100 %: scale to confirm');
        assert.strictEqual(meaningOf('rel', { displayActualValuePowerRelativeDrivingElectric: 255 }), '→ not understood');
        assert.strictEqual(meaningOf('rel', 7), '→ not understood');
        assert.strictEqual(require('../shared/fr').tr('→ drive 40 % · recup 0 %'), '→ propulsion 40 % · récup 0 %');
        assert.strictEqual(require('../shared/fr').tr('→ drive 40 % · recup 0 % · bar 32 kW'), '→ propulsion 40 % · récup 0 % · barre 32 kW');
        assert.strictEqual(require('../shared/fr').tr('→ drive - % · recup 25 % · bar -15 kW'), '→ propulsion - % · récup 25 % · barre -15 kW');
        assert.strictEqual(require('../shared/fr').tr('→ drive 0 % · recup 0 % · not used'), '→ propulsion 0 % · récup 0 % · pas utilisé');
        assert.strictEqual(require('../shared/fr').tr('→ above 100 %: scale to confirm'), '→ au-dessus de 100 % : échelle à confirmer');
        assert.strictEqual(require('../shared/fr').tr('Power meter: cluster (drive and recuperation, %)'), 'Puissance : compteur du tableau de bord (propulsion et récup., %)');
        const live = { rel: { displayActualValuePowerRelativeDrivingElectric: 50, displayActualValuePowerRelativeRecuperation: 0 } };
        const rows = (c) => c.text.filter((t) => /^→ drive 50 % · recup 0 %/.test(t.t)).map((t) => t.t);
        run.rel = null; assert.deepStrictEqual(rows(run(0, live)), ['→ drive 50 % · recup 0 % · not used'], 'not used while the bar does not draw from it');
        run.rel = { kw: 32.4, old: false }; assert.deepStrictEqual(rows(run(0, live)), ['→ drive 50 % · recup 0 % · bar 32 kW'], 'the bar\'s kW beside the reading');
        run.rel = null;
        const odd = run(0, { rel: { displayActualValuePowerRelativeDrivingElectric: 300 } }).text.map((t) => t.t);
        assert(odd.indexOf('→ above 100 %: scale to confirm') >= 0 && !odd.some((t) => /not used|· bar/.test(t)), 'an unknown scale shows alone: ' + odd.join('|'));
    }
    [0, 1].forEach((pg) => [false, true].forEach((fed) => {
        const c = run(pg, fed ? { rpm: 2500, speed: 62, sign: 70, guide: true, cc: { numberDisplayControlCheckControlMessage: 3 } } : null);
        assert.strictEqual(c.chips.join(), Array.from({ length: NPAGES }, (_, i) => (i + 1) + '/' + NPAGES).join());
        const last = c.glass[c.glass.length - 1];
        assert.strictEqual(c.glass.length, PAGES[pg].length, 'rows on page ' + pg);
        assert(last.y + last.h <= 512, 'page ' + pg + ' rows end at ' + (last.y + last.h) + ', past 512');
        c.text.forEach((t) => assert(t.y <= 512, 'text below the page: ' + t.t));
        assert(c.note && c.note.y + (c.note.n - 1) * 26 + 6 <= 512, 'the note runs past 512: ' + JSON.stringify(c.note));
        if (fed && pg === 0) assert(c.text.some((t) => /^→ 2500 rpm$/.test(t.t)) && c.text.some((t) => t.t === '→ route: yes'), 'no meaning line');
    }));
    // the pages of the car's catalogue: a fixture catalogue in the file's shape (interfaces -> fields -> getter / notifier / dataRef, datatypes)
    {
        const os = require('os');
        const file = path.join(os.tmpdir(), 'catalog_fixture_' + process.pid + '.json');
        const fields = (o) => { const r = {}; Object.keys(o).forEach((k) => { r[k] = { dataRef: 'S_' + k, getter: o[k].indexOf('r') >= 0 ? { id: 1 } : undefined, notifier: o[k].indexOf('s') >= 0 ? { id: 2 } : undefined }; }); return r; };
        const db = { interfaces: {
            'de.bmw.infotainment.controlelements.SteeringWheelButtons': { fields: fields({ statusMFLButtons: 'rs', otherField: 'r' }) },
            'de.bmw.infotainment.vehicle.Misc': { fields: fields({ unrelated: 'r' }) },
            'de.bmw.infotainment.mediaplayer.MediaPlayer': { fields: fields({ statusCurrentTrack: 'rs', statusPlayState: 'rs' }) },
            'de.bmw.infotainment.vehicle.TrafficSignDisplayControl': { fields: fields({ displaySpeedLimitAndNoPassingRestriction: 'rs' }) },
            'de.bmw.infotainment.drivingexcitement.Efficiencytainment3': { fields: fields({ otherThing: 'r', displayPowerFlow: 's' }) },
            'de.bmw.infotainment.vehicle.Dynamics': { fields: fields({ statusSteeringAngle: 'rs', statusAcceleratorPedal: 'rs', plain: 'r' }) },
            'de.bmw.infotainment.navigation.SpeedCameraWarning': { fields: fields({ statusWarning: 'rs' }) },
            'com.other.Thing': { fields: fields({ statusButton: 'rs', statusBatteryCurrent: 'r' }) },
        }, datatypes: { S_statusMFLButtons: { type: 'struct', members: [{ name: 'buttonPlus' }, { name: 'buttonMinus' }] }, S_unrelated: { type: 'struct', members: [{ name: 'x' }] }, S_statusCurrentTrack: { type: 'struct', members: [{ name: 'titleName' }, { name: 'artistName' }] } } };
        fs.writeFileSync(file, JSON.stringify(db));
        try {
            const cat = catalog.find(file);
            assert.strictEqual(cat.error, null);
            const by = (id) => cat.groups.find((g) => g.id === id).rows.map((r) => r.field);
            assert.deepStrictEqual(by('buttons'), ['otherField', 'statusMFLButtons'], 'buttons: every field of an interface whose name matches, no field of another, no interface outside de.bmw');
            assert.deepStrictEqual(by('media'), ['statusCurrentTrack', 'statusPlayState']);
            assert.deepStrictEqual(by('sign'), ['displaySpeedLimitAndNoPassingRestriction']);
            assert.deepStrictEqual(by('power'), ['displayPowerFlow', 'otherThing'], 'power: a name that matches comes before one that only sits in a matching interface; no interface outside de.bmw');
            assert.deepStrictEqual(by('road'), ['statusAcceleratorPedal', 'statusSteeringAngle'], 'road: the pedals and the steering angle, not a field of an interface that does not match');
            assert.deepStrictEqual(by('cam'), ['statusWarning'], 'cam: every field of a speed camera interface');
            const mfl = cat.groups[0].rows.find((r) => r.field === 'statusMFLButtons');
            assert.strictEqual(mfl.flags, 'get notify'); assert.deepStrictEqual(mfl.members, ['buttonPlus', 'buttonMinus']);
            assert(catalog.find('/nonexistent/catalog.json').error, 'a missing catalogue is an error, not a crash');
            Array.from({ length: catalog.GROUPS.length }, (_, i) => i + 2).forEach((pg) => {
                const c = run(pg, null, cat);
                assert.strictEqual(c.chips.length, NPAGES);
                assert.strictEqual(c.glass.length, Math.max(1, cat.groups[pg - 2].rows.length), 'rows on catalogue page ' + pg);
                const last = c.glass[c.glass.length - 1];
                assert(last.y + last.h <= 512 && c.note.y + (c.note.n - 1) * 26 + 6 <= 512, 'catalogue page ' + pg + ' runs past 512');
                c.text.forEach((t) => assert(t.y <= 512, 'text below the page: ' + t.t));
                assert(c.logs.length === 1 && /^catalogue: /.test(c.logs[0]), 'the catalogue is logged once');
            });
            assert(run(2, null, cat).text.some((t) => /SteeringWheelButtons · statusMFLButtons$/.test(t.t)));
            // not read yet (the car's file is big: it is read a moment after the frame, the page says so meanwhile, then it is drawn again)
            const wait = run(3, null, 'READING');
            assert(wait.text.some((t) => t.t === "Reading the car's catalog (once, a few seconds)..."), 'the page does not say the catalogue is being read');
            assert.strictEqual(wait.chips.length, NPAGES, 'the page chips stay while it reads'); assert.strictEqual(wait.logs.length, 0, 'nothing is logged before it is read');
            const bad = run(3, null, { groups: catalog.GROUPS.map((g) => ({ id: g.id, title: g.title, rows: [] })), error: 'ENOENT' });
            assert(bad.text.some((t) => t.t === 'Catalog not readable') && bad.glass.length === 1);
        } finally { try { fs.unlinkSync(file); } catch (e) { /* gone */ } }
        const real = ['Catalog not readable', "Nothing found in the car's catalog", "Reading the car's catalog (once, a few seconds)...", ...catalog.GROUPS.map((g) => g.title)];
        real.forEach((k) => assert(fr.tr(k) !== k, 'not in French: ' + k));
    }
    const FR = { '→ 2500 rpm': '→ 2500 tr/min', '→ limit 70': '→ limite 70', '→ next limit 90': '→ limite suivante 90', '→ no limit read': '→ aucune limite lue', '→ no next limit': '→ aucune limite suivante', '→ not understood': '→ non compris', '→ alert: yes': '→ alerte : oui', '→ route: no': '→ itinéraire : non',
        '→ share 100 (scale to confirm)': '→ part 100 (échelle à confirmer)', '→ coolant 77 C · oil 76 C': '→ liquide 77 °C · huile 76 °C', '→ oil 76 C': '→ huile 76 °C', '→ wheel on, green': '→ volant allumé, vert', '→ wheel on, yellow, warning': '→ volant allumé, jaune, alerte', '→ wheel off': '→ volant éteint' };
    Object.keys(FR).forEach((k) => assert.strictEqual(fr.tr(k), FR[k], k));
    // the readings: a value that is not clear is never taken for one
    assert.strictEqual(meaningOf('rpm', 65535), '→ not understood'); assert.strictEqual(meaningOf('rpm', 2499.6), '→ 2500 rpm');
    // the car's own values, as the owner's Signals tab showed them on 16 Nov 2026 (structs of raw numbers, the scales of kit/runtime/car.js)
    assert.strictEqual(meaningOf('rpm', { actualValueRPMEngineCrankshaft: 0 }), '→ 0 rpm'); assert.strictEqual(meaningOf('rpm', { actualValueRPMEngineCrankshaft: 8000 }), '→ 2000 rpm');
    assert.strictEqual(meaningOf('rpm', { actualValueRPMEngineCrankshaft: 65535 }), '→ not understood'); assert.strictEqual(meaningOf('rpm', { other: 1 }), '→ not understood');
    assert.strictEqual(meaningOf('speed', { speedVehicleCentreOfGravity: 130 }), '→ 2 km/h'); assert.strictEqual(meaningOf('speed', { speedVehicleCentreOfGravity: 65535 }), '→ not understood');
    assert.strictEqual(meaningOf('engt', { temperatureEngineDrive: 125, temperatureEngineOilDrive: 124 }), '→ coolant 77 C · oil 76 C');
    assert.strictEqual(meaningOf('engt', { temperatureEngineDrive: 255, temperatureEngineOilDrive: 124 }), '→ oil 76 C'); assert.strictEqual(meaningOf('engt', { temperatureEngineDrive: 255 }), '→ not understood');
    assert.strictEqual(meaningOf('pdrive', { quota: 255 }), '→ not understood');
    assert.strictEqual(meaningOf('pdrive', { degradedRecuperationPower: 0, quotaImmediateElectricEngineDriveRecuperation: 100 }), '→ share 100 (scale to confirm)');
    // the same scales as the car's own reader (kit/runtime/car.js), fed the same raw numbers
    {
        const Car = require('../kit/runtime/car');
        const seen = {};
        const ctx = { log: { info() {}, warn() {} }, spec: { config: {} }, settings: { get: () => 'off' }, signals: { watch: (iface, v, handlers) => { seen[iface] = handlers; return Promise.resolve({ iface, available: true }); } } };
        const car = new Car(ctx, ['rpm', 'speed', 'temps'], {});
        seen['de.bmw.infotainment.vehicle.CDS'].statusEngineSpeed2({ actualValueRPMEngineCrankshaft: 8000 });
        seen['de.bmw.infotainment.vehicle.Vehicle2'].statusCarSpeed2({ speedVehicleCentreOfGravity: 130 });
        seen['de.bmw.infotainment.vehicle.CDS'].statusEngineTemperature({ temperatureEngineDrive: 125, temperatureEngineOilDrive: 124 });
        const d = car.data();
        assert.strictEqual('→ ' + Math.round(d.rpm) + ' rpm', meaningOf('rpm', { actualValueRPMEngineCrankshaft: 8000 }));
        assert.strictEqual('→ ' + Math.round(d.speed) + ' km/h', meaningOf('speed', { speedVehicleCentreOfGravity: 130 }));
        assert.strictEqual('→ coolant ' + Math.round(d.coolant) + ' C · oil ' + Math.round(d.oil) + ' C', meaningOf('engt', { temperatureEngineDrive: 125, temperatureEngineOilDrive: 124 }));
        car.subs.length = 0;
    }
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
check('the guidance signal is NOT declared by either app (the car refused 0.21.12 over it), the app does not subscribe to it and says so; it is not in PROBES', () => {
    const { declaredIn } = require('../shared/probes');
    assert(!theme.signals[GUIDE.iface], 'declared again: only after a test install on the car has shown it accepted (0.21.12 was refused with it: UPDATE_FAILED)');
    assert(!(hud.signals && hud.signals[GUIDE.iface]), 'ShakHUD asks for a signal it does not use');
    assert(!declaredIn({ signals: theme.signals }, GUIDE) && declaredIn({ signals: { [GUIDE.iface]: { [GUIDE.field]: 'rs' } } }, GUIDE), 'declaredIn');
    assert(!declaredIn(null, GUIDE) && !declaredIn({}, GUIDE) && !declaredIn({ signals: { [GUIDE.iface]: {} } }, GUIDE));
    assert(PROBES.every((p) => p.id !== GUIDE.id), 'the guidance probe is in the PROBES list');
    assert(/^de\.bmw\.infotainment\.a4a\.carplay\.CarPlayManager$/.test(GUIDE.iface));
    assert.strictEqual(fr.tr('Not read in this version'), 'Non lu dans cette version');
    // every probe the Signals tab lists and the app declares is declared with the flags the car's catalog accepted before (a probe never declared before would block the install)
    PROBES.forEach((p) => { if (theme.signals[p.iface] && theme.signals[p.iface][p.field]) assert(/^(rs|s)$/.test(theme.signals[p.iface][p.field]), p.id + ': flags'); });
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
check('signals nobody needs are gone: the services due and the risk class (nothing showed them but the Signals tab), the sport display % (no theme shows it); no declared signal is left that no code reads', () => {
    const sig = theme.signals, FES = 'de.bmw.infotainment.drivingexcitement.FES';
    assert(!sig['de.bmw.infotainment.KombiInterface_2'], 'KombiInterface_2 is declared again');
    assert(!sig[FES].statusVehicleDynamicEngine && !hud.signals[FES].statusVehicleDynamicEngine, 'statusVehicleDynamicEngine is declared');
    assert(!PROBES.some((p) => p.id === 'cbs' || p.id === 'ccrisk'), 'the probes are back');
    const hudJs = fs.readFileSync(path.join(__dirname, '..', 'shared', 'hud.js'), 'utf8');
    assert(/delete extra\[FES\]\.statusVehicleDynamicEngine/.test(hudJs), 'hud.js asks the car for it undeclared');
    // every field an app declares is read by the code it ships (the kit, hud.js and its handlers, the probes, main.js): a declared field nobody reads only costs the car
    const files = ['shared', 'kit/runtime'].map((d) => path.join(__dirname, '..', d)).reduce((a, d) => a.concat(fs.readdirSync(d).filter((f) => /\.js$/.test(f)).map((f) => path.join(d, f))), [])
        .concat(['shaktheme', 'shakhud', 'shakcamdiag'].map((n) => path.join(__dirname, '..', 'apps', n, 'main.js')));
    const code = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    [['shaktheme', theme], ['shakhud', hud], ['shakcamdiag', app('shakcamdiag')]].forEach(([n, a]) => Object.keys(a.signals).forEach((iface) => Object.keys(a.signals[iface]).forEach((f) => {
        if (f[0] !== '_') assert(code.indexOf(f) >= 0, n + ' declares ' + iface + '.' + f + ' and no code reads it');
    })));
});
console.log(failed ? failed + ' FAILED' : 'probes: all checks pass');
process.exit(failed ? 1 : 0);
