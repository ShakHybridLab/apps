'use strict';
// node tools/test_signals_poll.js : kit/runtime/signals.js, la relecture (pollMs) ne demande jamais un champ deux fois à la fois.
// La vitesse est relue toutes les 50 ms depuis le 22 nov. 2026 (« optimise au max et que ce soit stable ») : une voiture lente à répondre
// (jusqu'à 3 s) ne doit pas recevoir des dizaines de lectures en attente.
const assert = require('assert');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

// un faux module someip : getValue répond quand le test le décide
const pending = [];
let asked = 0;
const fake = {
    buildProxy: () => Promise.resolve({
        init() { return Promise.resolve(this); },
        subscribeToAvailability() {},
        subscribe() { return Promise.resolve(); },
        isAvailable: () => true,
        getValue(f) { asked++; return new Promise((resolve) => pending.push(() => resolve({ v: asked }))); },
    }),
};
const load = Module._load;
Module._load = function (req, ...a) { return req === 'someip' ? fake : load.call(this, req, ...a); };
const signals = require('../kit/runtime/signals.js');
Module._load = load;

// la configuration de l'interface : un champ avec lecture
const dir = path.resolve(__dirname, '..', 'kit', 'runtime', '..', '..', '..', 'someipInterfaces');
const made = !fs.existsSync(dir);
const cfgFile = path.join(dir, 'test_Poll.json');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(cfgFile, JSON.stringify({ fields: { f: { getter: true } } }));

(async () => {
    let got = 0;
    const res = await signals.watch('test.Poll', '1', { f: () => { got++; } }, null, { pollMs: 50 });
    try {
        assert(res.available, String(res.error));
        await new Promise((r) => setTimeout(r, 600));            // une douzaine de relectures prévues, aucune réponse
        assert.strictEqual(asked, 1, 'sans réponse, une seule lecture doit attendre, pas ' + asked);
        pending.shift()();                                       // la voiture répond
        await new Promise((r) => setTimeout(r, 200));
        assert.strictEqual(got, 1, 'la réponse arrive au thème');
        assert.strictEqual(asked, 2, 'après la réponse, la relecture reprend : ' + asked);
        const answer = setInterval(() => { while (pending.length) pending.shift()(); }, 5);    // une voiture qui répond vite
        await new Promise((r) => setTimeout(r, 300));
        clearInterval(answer);
        assert(asked >= 4, 'les réponses rapides gardent le rythme : ' + asked);
        console.log('signals poll: all checks pass');
    } catch (e) {
        console.error('FAIL ' + (e && e.stack || e));
        process.exitCode = 1;
    } finally {
        fs.unlinkSync(cfgFile);
        if (made) fs.rmSync(dir, { recursive: true, force: true });
    }
    process.exit(process.exitCode || 0);
})();
