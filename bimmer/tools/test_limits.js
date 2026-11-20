'use strict';
// node tools/test_limits.js : ShakLimites, la limitation de vitesse d'après une carte (tools/build_limits.py, shared/limits_map.js,
// shared/limits_app.js). Une petite carte d'essai est fabriquée par le vrai fabricant : une autoroute est-ouest à 130 (sens unique vers l'est),
// une route secondaire parallèle 60 m au nord à 80, une route principale nord-sud à 50 qui les croise, et une route sans limitation.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
let n = 0, failed = 0;
function check(name, fn) { try { fn(); n++; } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'limits-'));
const LAT = 48.9, LON = 2.37, M_LAT = 1 / 110540, M_LON = 1 / (111320 * Math.cos(LAT * Math.PI / 180));
const line = (tags, pts) => JSON.stringify({ type: 'Feature', properties: tags, geometry: { type: 'LineString', coordinates: pts } });
const ew = (dyM, n2) => { const a = []; for (let i = -n2; i <= n2; i++) a.push([LON + i * 50 * M_LON, LAT + dyM * M_LAT + (i % 2) * 1e-7]); return a; };
const ns = (dxM) => { const a = []; for (let i = -20; i <= 20; i++) a.push([LON + dxM * M_LON, LAT + i * 50 * M_LAT]); return a; };
const src = path.join(tmp, 'routes.geojsonseq');
fs.writeFileSync(src, [
    '\x1e' + line({ highway: 'motorway', maxspeed: '130' }, ew(0, 40)),
    line({ highway: 'secondary', maxspeed: '80' }, ew(60, 40)),
    line({ highway: 'primary', maxspeed: 'FR:urban' }, ns(500)),
    line({ highway: 'primary' }, ns(900)),
    line({ highway: 'secondary', maxspeed: '30 mph' }, ns(1200)),
    line({ highway: 'residential', maxspeed: '30' }, ns(1500)),
    'pas du json',
].join('\n'));
const out = path.join(tmp, 'limits');
const index = JSON.parse(execFileSync('python3', [path.join(root, 'tools', 'build_limits.py'), src, out]).toString());
const { LimitsMap, bearing } = require('../shared/limits_map');
const { LimitsApp, FILE } = require('../shared/limits_app');
const db = { json: (f) => JSON.parse(fs.readFileSync(path.join(out, f), 'utf8')) };
const at = (dxM, dyM) => [LAT + dyM * M_LAT, LON + dxM * M_LON];

check('fabricant : seules les grandes routes qui portent une limitation sont gardées (km/h, FR:urban), simplifiées, en carreaux', () => {
    assert.strictEqual(index.ways, 4, 'autoroute, secondaire, principale en ville, et la rue (gardée quand la fabrication la donne : Île-de-France) : ' + index.ways);
    assert.strictEqual(index.noLimit, 2, 'sans maxspeed ou en mph : ' + index.noLimit);
    assert(index.tiles >= 1 && index.km >= 11 && index.km <= 13, JSON.stringify(index));
    assert(index.points < 60, 'les points alignés sont retirés : ' + index.points);
    assert(fs.existsSync(path.join(out, 't_97_4.json')), 'le carreau de 48,9 N 2,37 E');
});
const map = new LimitsMap(db);
check('carte : sur l\'autoroute vers l\'est, 130 ; à contresens rien (sens unique) ; sur la parallèle, 80', () => {
    assert(map.ready());
    const m = map.match(...at(-300, 2), 90);
    assert(m && m.limit === 130 && m.cls === 0 && m.oneway && m.dist < 4, JSON.stringify(m));
    assert.strictEqual(map.match(...at(-300, 2), 270), null, 'vers l\'ouest sur une autoroute qui va vers l\'est');
    const s = map.match(...at(-300, 58), 270);
    assert(s && s.limit === 80 && !s.oneway, JSON.stringify(s));
});
check('carte : entre deux routes de limites différentes aussi proches l\'une que l\'autre, rien n\'est dit ; loin de tout, rien', () => {
    assert.strictEqual(map.match(...at(-300, 30), 90), null, 'à mi-chemin de l\'autoroute et de la parallèle');
    assert.strictEqual(map.match(...at(-300, 400), 90), null);
    assert.strictEqual(map.match(10, 10, 90), null, 'pas de carreau');
});
check('carte : le cap départage un croisement (la route nord-sud à 50 sous l\'autoroute)', () => {
    const a = map.match(...at(500, 1), 0), b = map.match(...at(500, 1), 90);
    assert(a && a.limit === 50, JSON.stringify(a));
    assert(b && b.limit === 130, JSON.stringify(b));
    assert.strictEqual(map.match(...at(500, 1), null), null, 'sans cap, au croisement : deux routes, pas de réponse');
    assert(Math.abs(bearing(48, 2, 48.001, 2).deg) < 0.01 && Math.abs(bearing(48, 2, 48, 2.001).deg - 90) < 0.01);
});
check('carte : une rue (classe 5) se retrouve comme une autre route', () => {
    const r = map.match(...at(1500, 300), 0);
    assert(r && r.limit === 30 && r.cls === 5, JSON.stringify(r));
});
check('carte : deux carreaux gardés en mémoire, pas plus ; une carte absente ou vide ne donne rien', () => {
    map.match(48.9, 2.37, 90); map.match(10, 10, 0); map.match(20, 20, 0);
    assert(map.tiles.length <= 2);
    assert.strictEqual(new LimitsMap({ json: () => ({}) }).ready(), false);
    assert.strictEqual(new LimitsMap({ json: () => { throw new Error('x'); } }).match(48.9, 2.37, 90), null);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shaklimites', 'limits', 'index.json'), 'utf8')).v, 1);
});

// l'appli : des positions comme la voiture les envoie (millisecondes d'arc autour de 2^31)
const rawPos = (lat, lon) => ({ statusGPSLatitudeCAN: Math.round(lat * 3600000) + 2147483648, statusGPSLongitudeCAN: Math.round(lon * 3600000) + 2147483648 });
function drive(app, clock, from, step, count) {
    for (let i = 0; i < count; i++) { clock.t += 1000; const p = at(from[0] + step[0] * i, from[1] + step[1] * i); app.position(rawPos(p[0], p[1])); app.tick(); }
}
check('appli : en roulant sur l\'autoroute la limite est dite après deux positions d\'accord, écrite pour le thème, puis retirée loin de toute route', () => {
    const clock = { t: 1000000 }, dir = path.join(tmp, 'themes');
    const app = new LimitsApp({ map: new LimitsMap(db), now: () => clock.t, dir });
    drive(app, clock, [-900, 1], [25, 0], 1);
    assert.strictEqual(app.limit, null, 'une seule position : pas encore');
    drive(app, clock, [-850, 1], [25, 0], 3);
    assert.strictEqual(app.limit, 130);
    const j = JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8'));
    assert.deepStrictEqual([j.app, j.limit, j.t], ['ShakLimites', 130, clock.t]);
    drive(app, clock, [-700, 300], [25, 0], 5);
    assert.strictEqual(app.limit, null); assert(!fs.existsSync(path.join(dir, FILE)), 'le fichier est retiré');
});
check('appli : sans route connue, 50 par défaut si demandé (marqué « guess ») ; la limite de la carte reprend la main ; sans position, plus rien', () => {
    const clock = { t: 3000000 }, dir = path.join(tmp, 'themesF');
    const app = new LimitsApp({ map: new LimitsMap(db), now: () => clock.t, dir, fallback: () => 50 });
    drive(app, clock, [-900, 300], [25, 0], 3);
    assert(!fs.existsSync(path.join(dir, FILE)), 'pas avant quatre positions sans route');
    drive(app, clock, [-800, 300], [25, 0], 2);
    let j = JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8'));
    assert.deepStrictEqual([j.limit, j.guess], [50, true]); assert.strictEqual(app.limit, null);
    drive(app, clock, [-700, 1], [25, 0], 3);
    j = JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8'));
    assert.deepStrictEqual([j.limit, j.guess], [130, undefined]);
    clock.t += 6000; app.tick();
    assert(!fs.existsSync(path.join(dir, FILE)));
});
check('appli : à l\'arrêt la limite reste ; une lecture isolée d\'une autre limite (un croisement) ne la change pas ; sans position 5 s, plus rien', () => {
    const clock = { t: 5000000 }, dir = path.join(tmp, 'themes2');
    const app = new LimitsApp({ map: new LimitsMap(db), now: () => clock.t, dir });
    drive(app, clock, [-900, 1], [25, 0], 5);
    assert.strictEqual(app.limit, 130);
    drive(app, clock, [-775, 1], [0, 0], 6);
    assert.strictEqual(app.limit, 130, 'arrêté sur la route');
    app.cand = null; app._step.call(Object.assign(app, { heading: 0, pos: { lat: at(500, 1)[0], lon: at(500, 1)[1], at: clock.t } }));
    assert.strictEqual(app.limit, 130, 'une seule lecture à 50 : pas de changement'); assert.deepStrictEqual(app.cand, { limit: 50, n: 1 });
    clock.t += 6000; app.tick();
    assert.strictEqual(app.limit, null); assert.strictEqual(app.why, 'position too old');
});
check('thème : le panneau lu par la caméra passe devant la carte ; ShakLimites embarque ses modules et lit le GPS en option', () => {
    const { SpeedLimit } = require('../shared/speedlimit');
    const dir = path.join(tmp, 'themes3'); fs.mkdirSync(dir);
    let now = 9000000;
    const sl = new SpeedLimit({ dir, now: () => now }, { info() {}, warn() {} }, () => {});
    fs.writeFileSync(path.join(dir, FILE), JSON.stringify({ t: now, app: 'ShakLimites', limit: 80 }));
    sl.scan(); assert.strictEqual(sl.limit(), 80, 'la carte seule');
    sl.car = { limit: 70, app: 'car', t: now - 60000 };
    sl.scan(); assert.strictEqual(sl.limit(), 70, 'la caméra a lu 70 il y a une minute : elle passe devant');
    const spec = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shaklimites', 'app.json'), 'utf8'));
    assert(typeof spec.signals['de.bmw.infotainment.GPSData']._optional === 'string' && spec.config.lang === 'fr');
    ['gps_pos.js', 'limits_map.js', 'limits_app.js', 'survive.js'].forEach((f) => assert(spec.shared.indexOf(f) >= 0, f));
});
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* tmp */ }
console.log(failed ? failed + ' FAILED' : 'limits: ' + n + ' checks pass');
if (failed) process.exitCode = 1;
