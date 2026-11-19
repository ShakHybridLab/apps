'use strict';
// node tools/test_radar_app.js : ShakRadar (essai) sans voiture. La position GPS lue sans connaître encore son écriture (shared/gps_pos.js :
// noms des champs, échelle trouvée parce qu'elle tombe en France), puis l'alerte « zone de danger » écrite pour ShakTheme (shared/radar_app.js,
// le fichier que lit shared/danger.js) : devant une zone, dedans, derrière, sans position.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const gps = require('../shared/gps_pos');
const { RadarApp } = require('../shared/radar_app');
const { RadarZones } = require('../shared/radar_zones');
const { Danger } = require('../shared/danger');

const ROOT = path.join(__dirname, '..');
let n = 0;
function check(name, fn) { try { fn(); n++; } catch (e) { console.error('FAIL ' + name + ': ' + (e && e.stack || e)); process.exitCode = 1; } }
const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-5);

// Saint-Étienne, en degrés
const LAT = 45.4397, LON = 4.3872;
check('position : en degrés, en millionièmes, en dix-millionièmes, en millisecondes d\'arc, sur 2^31, avec décalage', () => {
    let p = gps.position({ latitude: LAT, longitude: LON });
    assert(p && near(p.lat, LAT) && near(p.lon, LON) && p.how === 'degrees', JSON.stringify(p));
    p = gps.position({ latitudeGPS: Math.round(LAT * 1e6), longitudeGPS: Math.round(LON * 1e6) });
    assert(p && near(p.lat, LAT) && p.how === '1e-6 degree', JSON.stringify(p));
    p = gps.position({ lat: Math.round(LAT * 1e7), lon: Math.round(LON * 1e7) });
    assert(p && near(p.lat, LAT) && p.how === '1e-7 degree', JSON.stringify(p));
    p = gps.position({ positionLatitude: Math.round(LAT * 3600000), positionLongitude: Math.round(LON * 3600000) });
    assert(p && near(p.lat, LAT, 1e-6) && p.how === 'milliarcsecond', JSON.stringify(p));
    p = gps.position({ latitude: Math.round(LAT / 180 * 2147483648), longitude: Math.round(LON / 180 * 2147483648) });
    assert(p && near(p.lat, LAT, 1e-6) && p.how === 'turn / 2^31', JSON.stringify(p));
    p = gps.position({ latitude: Math.round((LAT + 90) * 1e6), longitude: Math.round((LON + 180) * 1e6) });
    assert(p && near(p.lat, LAT) && /from -90/.test(p.how), JSON.stringify(p));
});
check('position : dans une structure, une énumération { value }, du texte ; pas « lateral » ni « longitudinal »', () => {
    let p = gps.position({ gps: { latitudeValue: { value: LAT }, longitudeValue: String(LON) } });
    assert(p && near(p.lat, LAT) && near(p.lon, LON), JSON.stringify(p));
    assert.strictEqual(gps.position({ lateralOffset: 45, longitudinalOffset: 4 }), null);
    assert.strictEqual(gps.position({ accelerationLateral: 45, latitude: LAT, longitudinalSpeed: 1, longitude: LON }).lat, LAT);
});
check('position : rien, « pas de valeur », 0 / 0, hors de France ou échelle inconnue : null', () => {
    assert.strictEqual(gps.position(null), null);
    assert.strictEqual(gps.position({ latitude: 0x7FFFFFFF, longitude: 0x7FFFFFFF }), null);
    assert.strictEqual(gps.position({ latitude: 0, longitude: 0 }), null);
    assert.strictEqual(gps.position({ latitude: 40.7, longitude: -74.0 }), null, 'New York');
    assert.strictEqual(gps.position({ latitude: 123456, longitude: 654321 }), null);
    assert.strictEqual(gps.position({ speed: 3 }), null);
});
check('extended : cap, altitude, qualité, vitesse par leurs noms ; le cap en centièmes de degré', () => {
    const e = gps.extended({ headingGPS: 18750, altitudeGPS: 512, qualityGPS: 3, speedGPS: 88 });
    assert.strictEqual(e.heading, 187.5); assert.strictEqual(e.altitude, 512); assert.strictEqual(e.quality, 3); assert.strictEqual(e.speed, 88);
    assert.strictEqual(gps.extended({}).heading, null);
});

// l'appli
const M_LAT = 110574;
const ZONES = new RadarZones({ cell: 0.01, radius: 2000, radiusWide: 4000, version: 'test', zones: [[4544, 439, 70, 0]] });
function rig() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-'));
    let t = 1000000;
    const app = new RadarApp({ zones: ZONES, dir, now: () => t, log: { warn() {}, info() {} } });
    const file = path.join(dir, 'danger-shakradar.json');
    const at = (northM) => { app.position({ latitude: 45.44 + northM / M_LAT, longitude: 4.39 }); app.tick(); };
    return { app, dir, file, step: (ms) => { t += ms; }, at, read: () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null), now: () => t };
}
check('en approchant d\'une zone : le fichier de l\'alerte dit la distance au bord et la limite ; dedans : 0 m', () => {
    const R = rig();
    R.at(3300); assert.strictEqual(R.read(), null, '1,3 km du bord : pas encore (alerte à 500 m du bord depuis le 19 nov. 2026)');
    R.step(1000); R.at(2400); let f = R.read();
    assert(f && f.app === 'ShakRadar' && Math.abs(f.distance - 400) < 10 && f.limit === 70, JSON.stringify(f));
    R.step(1000); R.at(2600); R.step(1000); R.at(1500);
    f = R.read(); assert(f && f.distance === 0, 'dedans : ' + JSON.stringify(f));
    assert.strictEqual(R.app.state().why, 'in a zone');
});
check('en s\'éloignant d\'une zone (dehors) : pas d\'alerte, le fichier est retiré', () => {
    const R = rig();
    R.at(1500); R.step(1000); R.at(2100); assert(R.read(), 'sorti de 100 m : encore là (pas assez de positions pour dire)');
    R.step(1000); R.at(2300); R.step(1000); R.at(2500);
    assert.strictEqual(R.read(), null, 'la zone est derrière');
    assert.strictEqual(R.app.state().why, 'zone behind');
});
check('sans position depuis plus de 5 s : plus d\'alerte ; une position pas comprise ne compte pas', () => {
    const R = rig();
    R.at(2300); assert(R.read());
    R.step(6000); R.app.tick();
    assert.strictEqual(R.read(), null); assert.strictEqual(R.app.state().why, 'position too old');
    R.app.position({ latitude: 0x7FFFFFFF, longitude: 1 }); R.app.tick();
    assert.strictEqual(R.read(), null);
});
check('le fichier écrit est celui que lit l\'alerte du thème (danger.js), avec la limite', () => {
    const R = rig();
    R.at(2300);
    const d = new Danger({ dir: R.dir, now: R.now }, { info() {}, warn() {} }, () => {});
    d.scan ? d.scan() : d._scan();
    const s = d.state();
    assert(s && s.on && Math.abs(s.distM - 300) < 10 && s.limit === 70 && s.app === 'ShakRadar', JSON.stringify(s));
    R.app.stop(); assert.strictEqual(R.read(), null, 'arrêtée : le fichier part');
});
check('l\'appli : GPSData seul (déclaré à part, comme ShakGPS), ses fichiers partagés existent, la liste des zones est celle de data/', () => {
    const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'shakradar', 'app.json'), 'utf8'));
    assert.deepStrictEqual(Object.keys(spec.signals), ['de.bmw.infotainment.GPSData']);
    assert.strictEqual(spec.signals['de.bmw.infotainment.GPSData'].GPSPositionCAN, 's');
    spec.shared.forEach((f) => assert(fs.existsSync(path.join(ROOT, 'shared', f)), f));
    assert.strictEqual(fs.readFileSync(path.join(ROOT, 'apps', 'shakradar', 'zones', 'radars_fr_zones.json'), 'utf8'), fs.readFileSync(path.join(ROOT, 'data', 'radars_fr_zones.json'), 'utf8'));
    assert(spec.config.lang === 'fr' && spec.config.readOnly);
    ['shaktheme', 'shakhud', 'shakpark', 'shakgps', 'shakmusique', 'shakreseau'].forEach((a) => {
        const o = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', a, 'app.json'), 'utf8'));
        assert(o.loggingId !== spec.loggingId && o.iconGlyph !== spec.iconGlyph, a);
    });
});
// la photo de ShakGPS du 19 nov. 2026 : la voiture écrit sa position en millisecondes d'arc autour de 2^31, l'altitude et la vitesse autour de 32768
{
    const assert2 = require('assert'), g = require('../shared/gps_pos');
    const p = g.position({ statusGPSLongitudeCAN: 2156016555, statusGPSLatitudeCAN: 2323529010 });
    assert2(p && Math.abs(p.lat - 48.9015) < 0.001 && Math.abs(p.lon - 2.3703) < 0.001 && p.how === 'milliarcsecond around 2^31', 'position de la photo : ' + JSON.stringify(p));
    const e = g.extended({ statusHeadingGPSCAN: 6, statusHeightGPSCAN: 32814, statusQualityPositionGPSCAN: 416, speedGPSCAN: 32768 });
    assert2.deepStrictEqual([e.heading, e.altitude, e.quality, e.speed], [6, 46, 416, 0]);
    assert2.strictEqual(g.position({ statusGPSLongitudeCAN: 2147483648, statusGPSLatitudeCAN: 2147483648 }), null, '0 N 0 E : pas en France');
}
console.log(process.exitCode ? 'radar app: FAILED' : 'radar app: all ' + n + ' checks pass');
