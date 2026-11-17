'use strict';
// node tools/test_net_probe.js : la sonde réseau (shared/net_probe.js, apps/shakreseau) : les essais, le verdict, l'écran dessiné avec un faux réseau,
// la trace gardée, et l'app.json (aucun signal, aucun thème touché).
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const NP = require('../shared/net_probe');

let failed = 0, n = 0;
function check(name, fn) { try { fn(); n++; } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const ROOT = path.join(__dirname, '..');

/** A fake network: `fail` maps a test url/host to an error, `certFail` to a certificate error that passes once not checked. */
function fakeIO(o) {
    o = o || {};
    return {
        lookup(host, cb) { setImmediate(() => cb(o.dnsFail ? { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND ' + host } : null, '23.45.67.89')); },
        request(url, opts, cb) {
            setImmediate(() => {
                if (o.certFail && /^https/.test(url) && !(opts && opts.insecure)) return cb({ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', message: 'unable to verify the first certificate' });
                if (o.httpsFail && /^https/.test(url)) return cb({ code: 'ETIMEDOUT', message: 'pas de réponse' });
                cb(null, { status: /api\.spotify/.test(url) ? 401 : 200 });
            });
        },
        listen(cb) { setImmediate(() => cb(o.noListen ? { code: 'EACCES', message: 'permission denied' } : null, 41234)); },
        interfaces() { return ['wlan0 192.168.1.20']; },
        env() { return { node: 'v8.17.0', uid: 1000, dns: '192.168.1.1' }; },
    };
}
const run = (io, cb) => NP.runAll(io, () => {}, cb);

check('la table des essais : des identifiants uniques, DNS d\'abord, Spotify et pochettes présents', () => {
    const ids = NP.TESTS.map((t) => t.id);
    assert.strictEqual(new Set(ids).size, ids.length);
    assert.strictEqual(ids[0], 'dns');
    ['http', 'https', 'accounts', 'api', 'cover', 'listen'].forEach((i) => assert(ids.includes(i), i));
    NP.TESTS.forEach((t) => assert(t.kind !== 'https' || /^https:\/\//.test(t.url) && !/[?&](token|key|secret)=/i.test(t.url), t.id + ' : une adresse HTTPS sans identifiant'));
});
check('aucun jeton, identifiant ni secret dans la sonde', () => {
    const src = fs.readFileSync(path.join(ROOT, 'shared', 'net_probe.js'), 'utf8');
    assert(!/Authorization|Bearer|client_secret|refresh_token/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), 'rien d\'autorisé dans le code');
});

(async () => {
    const wait = (io) => new Promise((ok) => run(io, ok));
    let r = await wait(fakeIO());
    check('tout passe : 7 essais, verdict vert', () => {
        assert.strictEqual(r.length, NP.TESTS.length);
        assert(r.every((x) => x.ok), JSON.stringify(r.filter((x) => !x.ok)));
        const v = NP.verdict(r); assert.strictEqual(v.ok, true); assert(/Spotify/.test(v.text) && /port/.test(v.text));
        assert.strictEqual(r.find((x) => x.id === 'api').text, 'réponse 401', '401 sans jeton = le serveur a répondu : bon signe');
    });
    r = await wait(fakeIO({ dnsFail: true }));
    check('pas de DNS : verdict rouge qui parle d\'un service comme RideTube', () => {
        const v = NP.verdict(r); assert.strictEqual(v.ok, false); assert(/RideTube/.test(v.text), v.text);
        assert(/ENOTFOUND/.test(r[0].text));
    });
    r = await wait(fakeIO({ certFail: true }));
    check('certificats non reconnus : détecté, et distinct d\'un réseau coupé', () => {
        const h = r.find((x) => x.id === 'https');
        assert.strictEqual(h.ok, false); assert.strictEqual(h.certOnly, true); assert(/CERTIFICAT/.test(h.text));
        const v = NP.verdict(r); assert.strictEqual(v.ok, false); assert(/certificats/.test(v.text), v.text);
    });
    r = await wait(fakeIO({ httpsFail: true }));
    check('DNS bon mais HTTPS bloqué : « réseau partiel »', () => {
        const v = NP.verdict(r); assert.strictEqual(v.ok, false); assert(/partiel|bloqué/.test(v.text), v.text);
    });
    r = await wait(fakeIO({ noListen: true }));
    check('port impossible : noté, mais Spotify reste joignable', () => {
        assert.strictEqual(r.find((x) => x.id === 'listen').ok, false);
        const v = NP.verdict(r); assert.strictEqual(v.ok, true); assert(!/port/.test(v.text), v.text);
    });
    check('verdict sans résultat : « en cours »', () => assert.strictEqual(NP.verdict([]).ok, null));

    // the screen, with a fake kit context
    const { Canvas } = require('../kit/runtime/canvas.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'net-probe-'));
    let last = null, errors = [], looped = 0;
    const ctx = {
        dataDir: dir, log: { info() {}, warn() {}, error(m) { errors.push(m); } },
        canvas: (w, h) => { const c = new Canvas(w, h); c.target = () => {}; return c; },
        loop: (name, hz, fn) => ({ kick() { looped++; fn(); } }),
        ui: { image: (id, cv) => { last = cv; return id; } },
    };
    const st = NP.start(ctx, { title: 'ShakReseau', io: fakeIO() });
    await new Promise((ok) => setTimeout(ok, 300));
    check('l\'écran se dessine et la trace est gardée', () => {
        assert.deepStrictEqual(errors, []);
        assert(last && last.png().length > 2000);
        assert(looped > 1, 'l\'écran est redessiné à chaque essai');
        assert.strictEqual(st.running, false);
        const kept = JSON.parse(fs.readFileSync(path.join(dir, 'net.json'), 'utf8'));
        assert.strictEqual(kept.results.length, NP.TESTS.length); assert.deepStrictEqual(kept.ifaces, ['wlan0 192.168.1.20']);
        assert(!/token|secret|Bearer/i.test(JSON.stringify(kept)));
    });
    fs.writeFileSync(process.env.NET_PROBE_PNG || path.join(dir, 'screen.png'), last.png());
    const st2 = NP.start(Object.assign({}, ctx, { dataDir: dir }), { title: 'ShakReseau', io: fakeIO({ dnsFail: true }) });
    check('au redémarrage, la dernière trace est relue avant le nouvel essai', () => {
        assert(st2.last && st2.last.results.length === NP.TESTS.length);
    });
    await new Promise((ok) => setTimeout(ok, 200));

    check('app.json : aucun signal, aucun thème touché, identifiants à part', () => {
        const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'shakreseau', 'app.json'), 'utf8'));
        assert.deepStrictEqual(spec.signals, {});
        assert.deepStrictEqual(spec.shared, ['net_probe.js']);
        assert(spec.config.lang === 'fr' && spec.config.readOnly);
        const SETS = require('../shared/probe_sets');
        Object.keys(SETS).concat(['shaktheme', 'shakhud', 'shakcamdiag']).forEach((a) => {
            const o = a in SETS ? { loggingId: SETS[a].logId, iconGlyph: SETS[a].glyph } : JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', a, 'app.json'), 'utf8'));
            assert(o.loggingId !== spec.loggingId && o.iconGlyph !== spec.iconGlyph, a);
        });
        assert(/^[A-Z]{4}$/.test(spec.loggingId) && /^[A-Z]{3}$/.test(spec.iconGlyph));
        assert(/net_probe/.test(fs.readFileSync(path.join(ROOT, 'apps', 'shakreseau', 'main.js'), 'utf8')));
    });
    console.log(failed ? failed + ' échec(s) sur ' + (n + failed) : 'ok : ' + n + ' vérifications');
    process.exit(failed ? 1 : 0);
})();
