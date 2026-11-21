'use strict';
// node tools/test_shader_names.js : aucun dessin (shared/shaders.js) ni aucun envoi d'uniforme (shared/hud.js) n'utilise un nom que cluster-render
// garde pour ses matrices (PROTOCOL.md : u_mvp, u_mv, u_m, u_v, u_p, u_normal). Sur la voiture, RAMSES refuse alors tout l'effet
// (« effect did not compile », photo du 21 nov. 2026 : les vues BC sans leurs dessins) alors que le banc l'affiche.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const RESERVED = ['u_mvp', 'u_mv', 'u_m', 'u_v', 'u_p', 'u_normal'];
const shaders = require('../shared/shaders');
const bad = [];
Object.keys(shaders).forEach((k) => {
    if (typeof shaders[k] !== 'string') return;
    RESERVED.forEach((n) => { if (new RegExp('\\b' + n + '\\b').test(shaders[k])) bad.push(k + ' : ' + n); });
});
['hud.js', 'shaders.js'].forEach((f) => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'shared', f), 'utf8').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    RESERVED.forEach((n) => { if (new RegExp("['\"]" + n + "['\"]").test(src)) bad.push(f + " envoie '" + n + "'"); });
});
assert(!bad.length, 'noms gardés par cluster-render : ' + bad.join(' ; '));
console.log('shader names: ' + Object.keys(shaders).filter((k) => typeof shaders[k] === 'string').length + ' dessins, aucun nom réservé');
