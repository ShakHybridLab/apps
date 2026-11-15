'use strict';
// node tools/test_speedlimit.js : la limite de vitesse lue par la caméra de la voiture (shared/speedlimit.js, shared/hud.js _carSign) :
// le décodage de TrafficSignDisplayControl.displaySpeedLimitAndNoPassingRestriction (le nom du champ de vitesse est coupé sur la photo du
// propriétaire : « displaySpee… »), la source « voiture » de la bague, et la déclaration des signaux dans l'appli.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { SpeedLimit, decodeSign, limitOf, CAR_TTL_MS } = require('../shared/speedlimit');

let n = 0, bad = 0;
function check(name, fn) { try { fn(); n++; } catch (e) { bad++; console.error('FAIL ' + name + ': ' + e.message); process.exitCode = 1; } }
const quiet = { info() {}, warn() {}, error() {} };

check('limitOf : un nombre entier de 5 de 20 à 200, ou un nom qui porte la vitesse ; « pas de panneau » donne null', () => {
    assert.strictEqual(limitOf(50), 50);
    assert.strictEqual(limitOf(130), 130);
    assert.strictEqual(limitOf({ name: 'SPEED_LIMIT_90', value: 9 }), 90);
    assert.strictEqual(limitOf('LIMIT_30KMH'), 30);
    assert.strictEqual(limitOf(0), null);
    assert.strictEqual(limitOf(255), null);
    assert.strictEqual(limitOf(7), null, 'un petit nombre est un code, pas une vitesse');
    assert.strictEqual(limitOf('NO_SIGN'), null);
    assert.strictEqual(limitOf({ name: 'NO_SPEED_LIMIT', value: 0 }), null);
    assert.strictEqual(limitOf(null), null);
    assert.strictEqual(limitOf(undefined), null);
    assert.strictEqual(limitOf(52), null, 'pas un multiple de 5');
});

check('decodeSign : le champ de vitesse est trouvé par son nom (displaySpee…), pas le panneau complémentaire, le style, l\'interdiction de dépasser', () => {
    const v = { invalidFlag: false, displaySymbolStyle: 2, displayNoPassingRestriction: 0, displayRemainingDistanceNoPassingRestriction: 0, displaySpeedLimitSupplemental: 70, displaySpeedLimit: 50 };
    const d = decodeSign(v);
    assert.deepStrictEqual([d.found, d.limit, d.invalid, d.key], [true, 50, false, 'displaySpeedLimit']);
    assert.strictEqual(decodeSign({ displaySpeedLimitSupplemental: 70 }).found, false, 'le panneau complémentaire seul n\'est pas la limite');
    assert.strictEqual(decodeSign({ displaySpeedLimit: { name: 'SPEED_LIMIT_NONE', value: 0 } }).limit, null, 'pas de panneau : la limite s\'efface');
    assert.strictEqual(decodeSign({ displaySpeedLimit: { name: 'SPEED_LIMIT_NONE', value: 0 } }).found, true);
    assert.strictEqual(decodeSign({ invalidFlag: true, displaySpeedLimit: 50 }).invalid, true);
    assert.strictEqual(decodeSign({ invalidFlag: { name: 'INVALID', value: 1 }, displaySpeedLimit: 50 }).invalid, true);
    assert.strictEqual(decodeSign({ foo: 1 }).found, false);
    assert.strictEqual(decodeSign(null).found, false);
    assert.strictEqual(decodeSign('x').found, false);
});

check('SpeedLimit : la voiture donne la limite, elle s\'efface avec « pas de panneau », et après CAR_TTL_MS', () => {
    let t = 1000000;
    const seen = [];
    const sl = new SpeedLimit({ dir: '/nonexistent-dir', now: () => t }, quiet, (l) => seen.push(l));
    assert.strictEqual(sl.limit(), null);
    sl.feed(50, 'car');
    assert.strictEqual(sl.limit(), 50);
    sl.feed(80, 'car');
    assert.strictEqual(sl.limit(), 80);
    t += 60000; sl.scan();
    assert.strictEqual(sl.limit(), 80, 'le panneau reste tant que la voiture n\'en envoie pas un autre');
    sl.feed(null);
    assert.strictEqual(sl.limit(), null, 'la voiture dit : pas de panneau');
    sl.feed(30, 'car');
    t += CAR_TTL_MS + 1; sl.scan();
    assert.strictEqual(sl.limit(), null, 'trop vieux');
    assert.deepStrictEqual(seen, [50, 80, null, 30, null]);
});

check('SpeedLimit : un fichier d\'une autre appli plus récent passe devant la voiture, et le plus ancien non', () => {
    const fsx = require('fs'), os = require('os');
    const dir = fsx.mkdtempSync(path.join(os.tmpdir(), 'sl-'));
    let t = 5000000;
    const sl = new SpeedLimit({ dir, now: () => t }, quiet, () => {});
    sl.feed(50, 'car');
    t += 1000;
    fsx.writeFileSync(path.join(dir, 'speedlimit-test.json'), JSON.stringify({ t, app: 'test', limit: 70 }));
    sl.scan();
    assert.strictEqual(sl.limit(), 70, 'le fichier est plus récent');
    t += 2000; sl.feed(90, 'car');
    assert.strictEqual(sl.limit(), 90, 'la voiture est plus récente');
    fsx.rmSync ? fsx.rmSync(dir, { recursive: true, force: true }) : null;
});

check('hud.js lit le signal de la voiture seulement si l\'appli le déclare, et ShakTheme le déclare', () => {
    const hud = fs.readFileSync(path.join(__dirname, '..', 'shared', 'hud.js'), 'utf8');
    const probes = fs.readFileSync(path.join(__dirname, '..', 'shared', 'probes.js'), 'utf8');       // les noms des signaux sont dans la table de probes.js (depuis la 0.21.0)
    ['TrafficSignDisplayControl', 'displaySpeedLimitAndNoPassingRestriction', 'de.bmw.infotainment.fasus.FASuS', 'statusNextSpeedLimitRecognition'].forEach((s) => assert(probes.includes(s), 'probes.js : ' + s));
    ["this._carSign(p.id, v)", 'this.speedLimit.feed(d.limit'].forEach((s) => assert(hud.includes(s), 'hud.js : ' + s));
    assert(/const decl = \(this\.ctx\.spec && this\.ctx\.spec\.signals\) \|\| \{\};/.test(hud), 'garde : seulement si l\'appli déclare les signaux (HUD Widgets ne les a pas)');
    const app = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'apps', 'shaktheme', 'app.json'), 'utf8'));
    assert.strictEqual(app.signals['de.bmw.dass.driverassistanceapplications.TrafficSignDisplayControl'].displaySpeedLimitAndNoPassingRestriction, 's');
    assert.strictEqual(app.signals['de.bmw.infotainment.fasus.FASuS'].statusNextSpeedLimitRecognition, 'rs');
    const hudApp = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'apps', 'shakhud', 'app.json'), 'utf8'));
    assert(!(hudApp.signals && hudApp.signals['de.bmw.dass.driverassistanceapplications.TrafficSignDisplayControl']), 'ShakHUD n\'a pas de bague de limitation : pas besoin du signal');
});

console.log(bad ? bad + ' FAILED' : 'speedlimit: ' + n + ' checks pass');
