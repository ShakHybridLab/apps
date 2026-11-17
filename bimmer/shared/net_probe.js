'use strict';
/**
 * Sonde réseau : une appli d'essai qui dit, SUR LA VOITURE, ce qu'une appli peut faire côté réseau : trouver un nom (DNS), parler en HTTP
 * puis en HTTPS (sans et avec Spotify), ouvrir un port pour qu'un téléphone s'y connecte, et quelles adresses la voiture a.
 *
 * Pourquoi : RideTube (ridetube/) fait tout son réseau dans un service à part (jap-ridetube-d) et son appli ne parle qu'à ce service par un
 * socket : rien ne dit qu'une appli ordinaire (comme ShakTheme) peut joindre internet elle-même. Un lecteur Spotify (api.spotify.com) en
 * dépend : on le sait avant d'écrire une ligne de plus.
 *
 * Le propriétaire ne peut pas lire de journal : tout est à l'écran, pour une photo, et le dernier essai est gardé (<dataDir>/net.json).
 * Rien n'est envoyé : des requêtes GET sans identifiant, sans jeton, vers des adresses publiques. L'essai HTTPS « sans vérifier le
 * certificat » ne sert qu'au diagnostic (savoir si le réseau passe alors que les certificats de la voiture manquent) : il ne porte rien.
 *
 *   require('./net_probe').start(ctx, { title: 'ShakReseau' })
 *
 * Written for ShakTheme (MIT, as the rest of shared/).
 */
const fs = require('fs');
const path = require('path');

const TIMEOUT_MS = 8000;
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** What is tried, in this order (the first failures explain the later ones). */
const TESTS = [
    { id: 'dns', name: 'Nom api.spotify.com (DNS)', kind: 'dns', host: 'api.spotify.com' },
    { id: 'http', name: 'HTTP simple, sans TLS', kind: 'http', url: 'http://connectivitycheck.gstatic.com/generate_204' },
    { id: 'https', name: 'HTTPS neutre (gstatic)', kind: 'https', url: 'https://www.gstatic.com/generate_204' },
    { id: 'accounts', name: 'HTTPS accounts.spotify.com', kind: 'https', url: 'https://accounts.spotify.com/' },
    { id: 'api', name: 'HTTPS api.spotify.com', kind: 'https', url: 'https://api.spotify.com/v1/me/player/currently-playing' },
    { id: 'cover', name: 'HTTPS i.scdn.co (pochettes)', kind: 'https', url: 'https://i.scdn.co/' },
    { id: 'listen', name: 'Ouvrir un port pour le téléphone', kind: 'listen' },
];

/** The real network, behind one small object so the tests can put a fake one in its place. */
function realIO() {
    const dns = require('dns'), http = require('http'), https = require('https'), net = require('net'), os = require('os');
    return {
        lookup(host, cb) { dns.lookup(host, (e, addr) => cb(e ? { code: e.code || 'ERR', message: e.message } : null, addr)); },
        request(url, opts, cb) {
            let done = false;
            const fin = (e, r) => { if (!done) { done = true; cb(e, r); } };
            const lib = /^https:/.test(url) ? https : http;
            const o = Object.assign(require('url').parse(url), { method: 'GET', headers: { 'User-Agent': 'ShakReseau/0.1 (diagnostic)' } });
            if (opts && opts.insecure) o.rejectUnauthorized = false;
            const req = lib.request(o, (res) => { res.resume(); fin(null, { status: res.statusCode }); });
            req.setTimeout(TIMEOUT_MS, () => { fin({ code: 'ETIMEDOUT', message: 'pas de réponse en ' + TIMEOUT_MS / 1000 + ' s' }); req.abort(); });
            req.on('error', (e) => fin({ code: e.code || 'ERR', message: e.message }));
            req.end();
        },
        listen(cb) {
            const srv = net.createServer();
            srv.on('error', (e) => cb({ code: e.code || 'ERR', message: e.message }));
            srv.listen(0, '0.0.0.0', () => { const p = srv.address().port; srv.close(); cb(null, p); });
        },
        interfaces() {
            const out = [], all = os.networkInterfaces();
            Object.keys(all).forEach((n) => all[n].forEach((a) => { if (a.family === 'IPv4' && !a.internal) out.push(n + ' ' + a.address); }));
            return out;
        },
        env() {
            const e = { node: process.version, uid: typeof process.getuid === 'function' ? process.getuid() : '?' };
            try { e.dns = (fs.readFileSync('/etc/resolv.conf', 'utf8').match(/^nameserver\s+(\S+)/m) || [])[1] || 'aucun'; } catch (x) { e.dns = 'illisible'; }
            return e;
        },
    };
}

/** One test, to a result { ok, text, ms }. */
function runOne(t, io, done) {
    const t0 = Date.now();
    const ms = () => Date.now() - t0;
    if (t.kind === 'dns') {
        io.lookup(t.host, (e, addr) => done(e ? { ok: false, text: e.code + ' : ' + e.message, ms: ms() } : { ok: true, text: addr, ms: ms() }));
    } else if (t.kind === 'listen') {
        io.listen((e, port) => done(e ? { ok: false, text: e.code + ' : ' + e.message, ms: ms() } : { ok: true, text: 'port ' + port + ' ouvert', ms: ms() }));
    } else {
        io.request(t.url, null, (e, r) => {
            if (!e) return done({ ok: true, text: 'réponse ' + r.status, ms: ms() });
            // a certificate error: does the network pass once the certificate is not checked? (diagnosis only)
            if (t.kind === 'https' && /CERT|SSL|TLS|SIGNATURE|ISSUER|EXPIRED/i.test(e.code + ' ' + e.message)) {
                return io.request(t.url, { insecure: true }, (e2, r2) => done(e2
                    ? { ok: false, text: e.code + ' : ' + e.message, ms: ms() }
                    : { ok: false, text: 'CERTIFICAT NON RECONNU (' + e.code + ') ; le réseau passe : réponse ' + r2.status, ms: ms(), certOnly: true }));
            }
            done({ ok: false, text: e.code + ' : ' + e.message, ms: ms() });
        });
    }
}

/** Run every test one after the other (no load on the car), calling `step(results)` after each and `end(results)` at the end. */
function runAll(io, step, end, tests) {
    const list = tests || TESTS, results = [];
    const next = (i) => {
        if (i >= list.length) return end(results);
        runOne(list[i], io, (r) => { results.push(Object.assign({ id: list[i].id, name: list[i].name }, r)); step(results); next(i + 1); });
    };
    next(0);
}

/** What the car can do, in a few words, from the results. */
function verdict(results) {
    const by = {}; results.forEach((r) => { by[r.id] = r; });
    if (!by.dns) return { ok: null, text: 'essai en cours…' };
    if (!by.dns.ok) return { ok: false, text: 'La voiture n\'a pas d\'internet pour une appli (le nom ne se résout pas) : il faudrait un service comme celui de RideTube.' };
    if (by.https && by.https.certOnly) return { ok: false, text: 'Internet passe mais les certificats de la voiture ne sont pas reconnus : il faudrait les fournir avec l\'appli.' };
    if (by.api && by.api.ok && by.accounts && by.accounts.ok) return { ok: true, text: 'Une appli peut joindre Spotify.' + (by.listen && by.listen.ok ? ' Elle peut aussi ouvrir un port.' : '') };
    if (by.https && !by.https.ok) return { ok: false, text: 'Le DNS répond mais pas HTTPS : réseau partiel ou bloqué pour les applis.' };
    return { ok: null, text: 'essai en cours…' };
}

/** Open the screen and run the tests (once at the start, and again with the button). */
function start(ctx, spec) {
    const io = spec && spec.io || realIO();
    const file = ctx.dataDir ? path.join(ctx.dataDir, 'net.json') : null;
    const st = { results: [], running: true, at: null, last: null, info: null, ifaces: [] };
    try { if (file) st.last = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* the first time */ }
    let loop = null;
    const kick = () => { try { if (loop && loop.kick) loop.kick(); } catch (e) { /* next time */ } };
    const go = () => {
        st.running = true; st.results = []; st.ifaces = io.interfaces(); st.info = io.env();
        runAll(io, () => kick(), (results) => {
            st.running = false; st.at = Date.now();
            st.last = { at: st.at, results, ifaces: st.ifaces, info: st.info };
            try { if (file) fs.writeFileSync(file, JSON.stringify(st.last)); } catch (e) { /* read-only: the screen has it */ }
            kick();
        });
        kick();
    };
    const render = () => {
        const cv = ctx.canvas(1600, 520);
        cv.clear('#090c12');
        cv.text((spec && spec.title || 'ShakReseau').toUpperCase(), 40, 50, 28, '#ffffff', { font: 'bold' });
        cv.text('Une appli peut-elle joindre internet (Spotify) depuis la voiture ? Photographie l\'écran quand "essai terminé" est affiché.', 40, 78, 16, '#91a0b4');
        const shown = st.results.length ? st.results : st.last ? st.last.results : [];
        const v = verdict(st.results.length === TESTS.length ? st.results : shown.length === TESTS.length ? shown : []);
        cv.text(st.running ? 'essai en cours… (' + st.results.length + ' / ' + TESTS.length + ')' : 'essai terminé à ' + new Date(st.at).toTimeString().slice(0, 8), 40, 106, 16, st.running ? '#ffd166' : '#7fd4a0');
        shown.slice(0, TESTS.length).forEach((r, k) => {
            const y = 146 + k * 44;
            cv.text((r.ok ? 'OK    ' : 'ÉCHEC ') + r.name + '   (' + r.ms + ' ms)', 40, y, 16, r.ok ? '#7fd4a0' : '#ff6b6b', { font: 'bold' });
            cv.text(clip(r.text, 118), 40, y + 20, 14, '#dce4ef');
        });
        const base = 146 + TESTS.length * 44 + 10;
        cv.text(v.text, 40, base, 17, v.ok === true ? '#7fd4a0' : v.ok === false ? '#ff6b6b' : '#91a0b4', { font: 'bold' });
        const info = (st.info || (st.last && st.last.info)) || {}, ifs = (st.ifaces.length ? st.ifaces : st.last && st.last.ifaces) || [];
        cv.text('adresses : ' + (ifs.length ? ifs.join(' · ') : 'aucune') + '   ·   DNS ' + (info.dns || '?') + '   ·   node ' + (info.node || '?') + '   ·   uid ' + (info.uid === undefined ? '?' : info.uid), 40, base + 26, 14, '#91a0b4');
        if (cv.target) {
            cv.roundRect && cv.roundRect(1440, 40, 130, 36, 8, '#ffffff1f');
            cv.text('Relancer', 1466, 64, 16, '#dce4ef');
            cv.target(1440, 40, 130, 36, () => { if (!st.running) go(); }, 'rerun', 8);
        }
        return ctx.ui.image('MAIN_GFX', cv);
    };
    loop = ctx.loop('MAIN', 10, render);
    render();
    go();
    return st;
}

module.exports = { TESTS, runOne, runAll, verdict, realIO, start };
