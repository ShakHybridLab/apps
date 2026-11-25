'use strict';
// node tools/test_settings_copy.js : les réglages gardent une copie en RAM et reviennent quand la voiture a effacé settings.json après un
// plantage (kit/runtime/mgu.js Settings). Le propriétaire, 24 nov. 2026 : « j'ai l'impression que ça change alors que je n'ai pas changé ».
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const app = fs.mkdtempSync(path.join(os.tmpdir(), 'setapp-')), copy = fs.mkdtempSync(path.join(os.tmpdir(), 'setcopy-'));
fs.mkdirSync(path.join(app, 'data'));
const mgu = path.join(__dirname, '..', 'kit', 'runtime', 'mgu.js');
const src = fs.readFileSync(mgu, 'utf8');
assert(/MGU_SETTINGS_COPY_DIR/.test(src) && /this\.restored = true/.test(src), 'la copie et la remise sont dans mgu.js');
// la logique, isolée : écrire, effacer, relire
// la classe prise seule, comme le banc (kit/tools/hu-stub.js) : rien d'autre de mgu.js n'est à portée (0.23.0 plantait au banc)
process.env.MGU_SETTINGS_COPY_DIR = copy;
const m = src.match(/class Settings[\s\S]*?\n}\n/);
const S = new Function('fs', 'path', 'DATA_DIR', 'log', m[0] + '\nreturn Settings;')(fs, path, path.join(app, 'data'), { warn() {}, info() {} });
const schema = [{ key: 'hudLayout', type: 'choice', default: 'off', options: [['off', 'x'], ['m', 'M']] }];
let s = new S(schema);
s.set('hudLayout', 'm');
fs.unlinkSync(path.join(app, 'data', 'settings.json'));            // la voiture efface les données de l'appli
s = new S(schema);
assert.strictEqual(s.get('hudLayout'), 'm', 'le réglage revient de la copie');
assert.strictEqual(s.restored, true);
assert(fs.existsSync(path.join(app, 'data', 'settings.json')), 'settings.json est réécrit');
console.log('copie des réglages : tout passe');
