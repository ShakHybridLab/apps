'use strict';
// kit/runtime/signals.js : the native steps go one at a time, so one that never ends holds back every interface behind it. busyWith() says
// which one it is (the page's Signals tab shows it instead of "Subscribing" for ever, owner's photos of Nov 15 2026: 9 lines of 11).
// A fake "someip" module: the first interface never finishes init(), the second would. node tools/test_signals_busy.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { stateOf } = require('../shared/probes');
const fr = require('../shared/fr');

let failed = 0;
async function check(name, fn) { try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message || e)); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// the module copied where it finds its files: <root>/a/b/runtime/signals.js, <root>/someipInterfaces/<iface>.json, <root>/node_modules/someip
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sigbusy-'));
const rt = path.join(tmp, 'a', 'b', 'runtime');       // signals.js looks for someipInterfaces three levels up (APP_ROOT)
fs.mkdirSync(rt, { recursive: true });
fs.mkdirSync(path.join(tmp, 'someipInterfaces'));
fs.mkdirSync(path.join(tmp, 'node_modules', 'someip'), { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', 'kit', 'runtime', 'signals.js'), path.join(rt, 'signals.js'));
['de.bmw.test.Stuck', 'de.bmw.test.Fine'].forEach((i) => fs.writeFileSync(path.join(tmp, 'someipInterfaces', i.replace(/\./g, '_') + '.json'), JSON.stringify({ stuck: /Stuck/.test(i), fields: { f: {} } })));
fs.writeFileSync(path.join(tmp, 'node_modules', 'someip', 'index.js'), `
exports.buildProxy = (cfg, inst) => Promise.resolve({
    init() { return cfg.stuck ? new Promise((r) => { global.__release = r; }) : Promise.resolve(); },
    subscribeToAvailability() {}, subscribe() { return Promise.resolve(); }, isAvailable() { return true; }, getValue() { return Promise.resolve({}); },
});
`);
const signals = require(path.join(rt, 'signals.js'));

(async () => {
    await check('nothing is running: busyWith() is null', () => assert.strictEqual(signals.busyWith(), null));

    const a = signals.watch('de.bmw.test.Stuck', '1', { f: () => {} });                 // its init() never answers
    let doneB = false;
    const b = signals.watch('de.bmw.test.Fine', '1', { f: () => {} }).then((s) => { doneB = true; return s; });
    await wait(150);
    await check('busyWith() names the interface and the step that does not end, and how long', () => {
        const w = signals.busyWith();
        assert(w, 'nothing is reported');
        assert.strictEqual(w.iface, 'Stuck');
        assert.strictEqual(w.step, 'open');
        assert(w.ms >= 100, 'ms ' + w.ms);
    });
    await check('the interface behind it stays unsubscribed while that step is stuck', () => assert.strictEqual(doneB, false));
    global.__release();                                                                          // the car answers at last
    const sa = await a, sb = await b;
    await check('once the step ends, both are subscribed and busyWith() is null again', async () => {
        assert(!sa.error && !sb.error, 'errors: ' + sa.error + ' / ' + sb.error);
        assert.strictEqual(doneB, true);
        await wait(20);
        assert.strictEqual(signals.busyWith(), null);
    });

    await check('stateOf: before 8 s it is still "Subscribing"; after, the stuck interface says so and the ones behind it wait for it', () => {
        const I = 'de.bmw.dass.driverassistanceapplications.TrafficSignDisplayControl';
        assert.strictEqual(stateOf(undefined, 'f', I, { iface: 'TrafficSignDisplayControl', step: 'open', ms: 3000 }), 'Subscribing');
        assert.strictEqual(stateOf(undefined, 'f', I, null), 'Subscribing');
        assert.strictEqual(stateOf(undefined, 'f', I, { iface: 'TrafficSignDisplayControl', step: 'open', ms: 12000 }), 'Stuck while opening (12 s)');
        assert.strictEqual(stateOf(undefined, 'f', I, { iface: 'TrafficSignDisplayControl', step: 'availability', ms: 9000 }), 'Stuck while waiting for the car (9 s)');
        assert.strictEqual(stateOf(undefined, 'f', I, { iface: 'TrafficSignDisplayControl', step: 'displaySpeedLimitAndNoPassingRestriction', ms: 9000 }),
            'Stuck while subscribing to displaySpeedLimitAndNoPassingRestriction (9 s)');
        assert.strictEqual(stateOf(undefined, 'f', 'de.bmw.infotainment.fasus.FASuS', { iface: 'TrafficSignDisplayControl', step: 'open', ms: 15000 }),
            'Waiting: TrafficSignDisplayControl is stuck (15 s)');
        // a subscription that exists keeps its own reasons
        assert.strictEqual(stateOf({ available: true, failed: {}, getFailed: {} }, 'f', I, { iface: 'X', step: 'open', ms: 20000 }), 'Subscribed, nothing received');
    });
    await check('French: the stuck states and the Maps on Cluster states of the Map tab', () => {
        assert.strictEqual(fr.tr('Stuck while opening (12 s)'), "Bloqué à l'ouverture (12 s)");
        assert.strictEqual(fr.tr('Stuck while waiting for the car (9 s)'), 'Bloqué : attend la voiture (9 s)');
        assert.strictEqual(fr.tr('Stuck while subscribing to displaySteeringWheel (9 s)'), "Bloqué à l'abonnement à displaySteeringWheel (9 s)");
        assert.strictEqual(fr.tr('Waiting: FASuS is stuck (15 s)'), 'En attente : FASuS est bloqué (15 s)');
        assert.strictEqual(fr.tr('Map showing in the theme'), 'Carte affichée dans le thème');
        const note = fr.tr("Closed (nothing asks for it). It is the same window the phone's map shows in (Sport, M, M Blade and Navi).");
        assert(/^Fermée \(personne ne la demande\)\. C'est la fenêtre de la carte du téléphone/.test(note), note);
    });
    await check('every text of shared/waze.js info() has a French version', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'shared', 'waze.js'), 'utf8');
        const body = /info\(\) \{([\s\S]*?)\n    \}/.exec(src)[1];
        const texts = [];
        body.replace(/text: ('(?:[^'\\]|\\.)*')/g, (m, q) => { texts.push(eval(q)); return m; });      // eslint-disable-line no-eval
        // info() dropped the "busy"/retry and "moving into the panel" texts on 20 Nov 2026: there is no mode to switch to or retry any more
        // (the real waze-on-cluster only ever has one target, "map"; re-read from its source after the car never actually moved the map)
        assert(texts.length >= 8, 'texts found: ' + texts.length);
        texts.filter((t) => !/\($/.test(t)).forEach((t) => assert.notStrictEqual(fr.tr(t), t, 'not translated: ' + t));      // the one that ends in "(" is cut at the problem: tested above
    });

    fs.rmSync && fs.rmSync(tmp, { recursive: true, force: true });
    console.log(failed ? failed + ' FAILED' : 'signals busy: all checks pass');
    process.exit(failed ? 1 : 0);
})();
