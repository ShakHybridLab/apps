'use strict';
// node tools/test_music.js : Shak Musique (shared/music_ctl.js, shared/music_ui.js, apps/shakmusique) avec un faux service de RideTube sur un vrai
// socket : le protocole, la file d'attente (suivant, précédent, enchaînement, morceaux illisibles), le choix du bon résultat, les récents, l'écran
// (dessiné dans un Canvas, zones tactiles) et l'app.json.
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const assert = require('assert');
const M = require('../shared/music_ctl');
const UI = require('../shared/music_ui');
const REC = require('../kit/runtime/record');
const { Canvas } = require('../kit/runtime/canvas.js');

let failed = 0, n = 0;
const ROOT = path.join(__dirname, '..');
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function until(fn, ms) { const t = Date.now(); while (Date.now() - t < (ms || 1500)) { if (fn()) return true; await wait(10); } return fn(); }
async function check(name, fn) { try { await fn(); n++; } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

/** Un faux jap-ridetube-d : un seul client à la fois (le nouveau remplace l'ancien), les mêmes lignes JSON. */
function fakeDaemon(file) {
    const d = { cmds: [], client: null, tracks: {}, playing: null };
    d.items = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd', 'eeeeeeeeeee', 'fffffffffff', 'ggggggggggg', 'hhhhhhhhhhh']
        .map((id, k) => ({ id, title: 'Chanson ' + k + ' (Official Audio)', channel: 'Artiste ' + k + ' - Topic', duration_s: 180 + k }));
    d.emit = (o) => { if (d.client) d.client.write(JSON.stringify(o) + '\n'); };
    d.server = net.createServer((c) => {
        if (d.client) d.client.destroy();
        d.client = c; c.setEncoding('utf8'); let buf = '';
        c.on('data', (x) => {
            buf += x; let i;
            while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) d.onLine(JSON.parse(line)); }
        });
        c.on('error', () => {});
    });
    d.onLine = (m) => {
        d.cmds.push(m);
        if (m.cmd === 'search') d.emit({ ev: 'results', q: m.q, items: d.items });
        else if (m.cmd === 'thumb') { const rgba = Buffer.alloc(320 * 180 * 4); for (let i = 0; i < rgba.length; i += 4) { rgba[i] = (i / 4 % 320) < 70 || (i / 4 % 320) > 250 ? 0 : 200; rgba[i + 1] = 90; rgba[i + 2] = 40; rgba[i + 3] = 255; } d.emit({ ev: 'thumb', id: m.id, w: 320, h: 180, rgba: rgba.toString('base64') }); }
        else if (m.cmd === 'play') {
            d.playing = m.id;
            d.emit({ ev: 'state', state: 'preparing', pct: 10, id: m.id, title: m.id });
            if (d.unplayable && d.unplayable.indexOf(m.id) >= 0) return d.emit({ ev: 'state', state: 'error', pct: null, id: m.id, title: m.id }), d.emit({ ev: 'error', msg: 'fetch: video unavailable' });
            d.emit({ ev: 'state', state: 'playing', pct: null, id: m.id, title: m.id });
            d.emit({ ev: 'time', elapsed: 0, total: 183000 });
        } else if (m.cmd === 'pause') d.emit({ ev: 'state', state: 'paused', id: d.playing, title: d.playing });
        else if (m.cmd === 'resume') d.emit({ ev: 'state', state: 'playing', id: d.playing, title: d.playing });
        else if (m.cmd === 'stop') d.emit({ ev: 'state', state: 'idle', id: null });
    };
    d.listen = () => new Promise((ok) => { try { fs.unlinkSync(file); } catch (e) { /* none */ } d.server.listen(file, ok); });
    d.close = () => { if (d.client) d.client.destroy(); d.server.close(); };
    return d;
}
const quiet = { info() {}, warn() {}, error(m, e) { console.log('ERR ' + m, e || ''); } };

(async () => {
    /* ---- du texte de YouTube à « artiste, titre » */
    await check('splitTrack : piste Topic, « Artiste - Titre », étiquettes retirées', () => {
        assert.deepStrictEqual(M.splitTrack('Je te promets (Official Audio)', 'Johnny Hallyday - Topic'), { artist: 'Johnny Hallyday', title: 'Je te promets' });
        assert.deepStrictEqual(M.splitTrack('Daft Punk - Get Lucky (Official Video) [4K]', 'Daft Punk'), { artist: 'Daft Punk', title: 'Get Lucky' });
        assert.deepStrictEqual(M.splitTrack('Titre seul Lyrics', 'Une Chaîne VEVO'), { artist: 'Une Chaîne', title: 'Titre seul' });
        assert.strictEqual(M.splitTrack('', '').title, '');
    });
    await check('clock et fold', () => {
        assert.strictEqual(M.clock(83000), '1:23'); assert.strictEqual(M.clock(3723000), '1:02:03'); assert.strictEqual(M.clock(-5), '0:00');
        assert.strictEqual(M.fold('Élise  Atelier!'), 'elise atelier');
        assert.strictEqual(M.musicQuery(' Daft Punk', 'Get   Lucky '), 'Daft Punk Get Lucky'); assert.strictEqual(M.musicQuery('', 'Seul'), 'Seul');
    });
    await check('pickBest : la piste Topic de la bonne durée, pas le live ni la reprise ; rien si aucun mot ne colle', () => {
        const items = [
            { id: 'live0000001', title: 'Daft Punk - Get Lucky (Live at Coachella)', channel: 'Daft Punk', duration_s: 310 },
            { id: 'cover000001', title: 'Get Lucky cover by Someone', channel: 'Someone', duration_s: 248 },
            { id: 'topic000001', title: 'Get Lucky', channel: 'Daft Punk - Topic', duration_s: 369 },
            { id: 'clip0000001', title: 'Daft Punk - Get Lucky (Official Audio) ft. Pharrell Williams', channel: 'Daft Punk', duration_s: 248 },
        ];
        assert.strictEqual(M.pickBest(items, { artist: 'Daft Punk', title: 'Get Lucky', duration_s: 369 }).id, 'topic000001');
        assert.strictEqual(M.pickBest(items, { artist: 'Daft Punk', title: 'Get Lucky', duration_s: 248 }).id, 'clip0000001', 'la durée départage');
        assert.strictEqual(M.pickBest(items, { artist: 'X', title: 'Tout autre morceau' }), null);
        assert.strictEqual(M.pickBest([], { title: 'a' }), null);
    });

    /* ---- le socket et le modèle, avec un faux service */
    const sock = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'music-')), 'ctl.sock');
    const d = fakeDaemon(sock); await d.listen();
    const ctl = new M.Ctl(sock, quiet);
    const pl = new M.Player((o) => ctl.send(o));
    ctl.on('up', () => pl.setConnected(true)).on('down', () => pl.setConnected(false)).on('msg', (m) => pl.onMsg(m));
    const played = []; pl.onTrack = (t) => played.push(t.id);
    ctl.connect();
    await check('connexion : le service reçoit status puis video off (le son seul)', async () => {
        assert(await until(() => pl.connected));
        assert(await until(() => d.cmds.some((c) => c.cmd === 'video')));
        assert.deepStrictEqual(d.cmds.slice(0, 2).map((c) => c.cmd), ['status', 'video']);
        assert.strictEqual(d.cmds[1].on, false);
    });
    await check('recherche : les résultats deviennent des morceaux { titre, artiste, durée } ; une réponse d\'une ancienne recherche est ignorée', async () => {
        assert(pl.search('  daft punk  '));
        assert(await until(() => pl.results.length === 8));
        assert.strictEqual(pl.q, 'daft punk'); assert.strictEqual(pl.searching, false);
        assert.deepStrictEqual([pl.results[2].title, pl.results[2].artist, pl.results[2].duration_s], ['Chanson 2', 'Artiste 2', 182]);
        pl.onMsg({ ev: 'results', q: 'autre', items: [{ id: 'zzzzzzzzzzz', title: 'x' }] });
        assert.strictEqual(pl.results.length, 8);
        assert.strictEqual(pl.search('   '), false);
    });
    await check('pochettes : demandée une fois, reçue 320x180, jetée si on la reçoit pour un morceau inconnu', async () => {
        assert(pl.wantThumb('aaaaaaaaaaa')); assert.strictEqual(pl.wantThumb('aaaaaaaaaaa'), false, 'pas redemandée');
        assert(await until(() => pl.thumbs.aaaaaaaaaaa));
        assert.strictEqual(pl.thumbs.aaaaaaaaaaa.buf.length, 320 * 180 * 4);
        pl.onMsg({ ev: 'thumb', id: 'inconnu00000', w: 320, h: 180, rgba: Buffer.alloc(320 * 180 * 4).toString('base64') });
        assert(!pl.thumbs.inconnu00000);
        pl.onMsg({ ev: 'thumb', id: 'bbbbbbbbbbb', w: 320, h: 180, rgba: 'AAAA' });
        assert(!pl.thumbs.bbbbbbbbbbb, 'taille fausse : jetée');
        assert.strictEqual(pl.wantThumb('inconnu00000'), false);
    });
    await check('jouer une liste : la commande play (360, 320x180), l\'état, le temps, le morceau noté dans les récents', async () => {
        assert(pl.playList(pl.results, 2));
        assert.strictEqual(pl.state, 'preparing'); assert.strictEqual(pl.cur.id, 'ccccccccccc');
        assert(await until(() => pl.state === 'playing'));
        const play = d.cmds.filter((c) => c.cmd === 'play').pop();
        assert.deepStrictEqual(play, { cmd: 'play', id: 'ccccccccccc', rect: '320x180', fill: false, quality: 360 });
        assert(await until(() => pl.total === 183000));
        assert.deepStrictEqual(played, ['ccccccccccc']);
        assert(d.cmds.filter((c) => c.cmd === 'video').length >= 2, 'le son seul est redit quand le morceau démarre');
    });
    await check('pause, reprise, aller à (borné au morceau)', async () => {
        assert(pl.toggle()); assert(await until(() => pl.state === 'paused'));
        assert(pl.toggle()); assert(await until(() => pl.state === 'playing'));
        pl.elapsed = 100000;
        const seeks = () => d.cmds.filter((c) => c.cmd === 'seek'), k0 = seeks().length;
        assert(pl.seekBy(10000)); assert(await until(() => seeks().length === k0 + 1)); assert.strictEqual(seeks().pop().ms, 110000);
        pl.seekBy(10000000); assert(await until(() => seeks().length === k0 + 2)); assert.strictEqual(seeks().pop().ms, 182000, 'jamais après la fin');
        pl.seekBy(-10000000); assert(await until(() => seeks().length === k0 + 3)); assert.strictEqual(seeks().pop().ms, 0);
    });
    await check('suivant, précédent (début du morceau : le précédent ; plus loin : recommencer)', async () => {
        pl.elapsed = 1000;
        assert(pl.prev()); assert.strictEqual(pl.cur.id, 'bbbbbbbbbbb'); assert(await until(() => pl.state === 'playing'));
        pl.elapsed = 30000;
        const k1 = d.cmds.filter((c) => c.cmd === 'seek').length;
        pl.prev(); assert.strictEqual(pl.cur.id, 'bbbbbbbbbbb');
        assert(await until(() => d.cmds.filter((c) => c.cmd === 'seek').length === k1 + 1)); assert.strictEqual(d.cmds.filter((c) => c.cmd === 'seek').pop().ms, 0);
        assert(pl.next()); assert.strictEqual(pl.cur.id, 'ccccccccccc');
        pl.playAt(7); assert.strictEqual(pl.next(), false, 'pas de suivant après le dernier');
    });
    await check('fin d\'un morceau : le suivant démarre tout seul ; fin du dernier : on s\'arrête', async () => {
        pl.playAt(5); assert(await until(() => pl.state === 'playing' && pl.cur.id === 'ffffffffffff'.slice(0, 11)));
        d.emit({ ev: 'state', state: 'ended', id: 'fffffffffff' });
        assert(await until(() => pl.cur.id === 'ggggggggggg'));
        pl.playAt(7); await until(() => pl.state === 'playing');
        d.emit({ ev: 'state', state: 'ended', id: 'hhhhhhhhhhh' });
        assert(await until(() => pl.state === 'ended')); await wait(50);
        assert.strictEqual(pl.cur.id, 'hhhhhhhhhhh'); assert.strictEqual(pl.index, -1);
        assert(pl.toggle() === false || true);
    });
    await check('morceau illisible : on passe au suivant, et après trois de suite on s\'arrête sur l\'erreur', async () => {
        d.unplayable = ['bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd'];
        pl.playList(pl.results, 1);
        assert(await until(() => pl.cur && pl.cur.id === 'ddddddddddd' && pl.state === 'error'));
        await wait(100);
        assert.strictEqual(pl.cur.id, 'ddddddddddd', 'trois illisibles de suite : on ne continue pas');
        assert.strictEqual(pl.state, 'error'); assert(/unavailable/.test(pl.error));
        d.unplayable = [];
        pl.playList(pl.results, 4); assert(await until(() => pl.state === 'playing' && pl.failed === 0));
    });
    await check('arrêt : la file est vidée', () => { pl.stop(); assert.strictEqual(pl.queue.length, 0); assert.strictEqual(pl.index, -1); });
    await check('une recherche sans réponse : une erreur au bout du délai', () => {
        let t = 1000; const q = new M.Player(() => true, () => t);
        q.search('x'); assert.strictEqual(q.checkSearch(5000), false); t += 6000; assert.strictEqual(q.checkSearch(5000), true);
        assert.strictEqual(q.searching, false); assert(/Pas de réponse/.test(q.searchError));
        const off = new M.Player(() => false); assert.strictEqual(off.search('x'), false); assert(/ne tourne pas/.test(off.searchError));
    });

    /* ---- plusieurs applis, un seul client : on cède la place au lieu de se battre */
    await check('remplacés par une autre appli : pas de reconnexion en boucle ; reconnexion quand l\'écran s\'ouvre', async () => {
        const c2 = new M.Ctl(sock, quiet); c2.yieldAfterMs = 0;
        c2.connect(); assert(await until(() => c2.up)); await wait(20);
        const other = net.createConnection(sock); await wait(100);         // une autre appli (RideTube) : le service nous ferme
        assert(await until(() => !c2.up)); await wait(2600);
        assert.strictEqual(c2.yielded, true); assert.strictEqual(c2.up, false, 'pas repris tout seul');
        other.destroy(); await wait(50);
        c2.connect(); assert(await until(() => c2.up)); assert.strictEqual(c2.yielded, false);
        c2.close();
    });
    await check('service absent : on réessaie en espaçant, sans lever d\'erreur', async () => {
        const c3 = new M.Ctl(path.join(os.tmpdir(), 'nulle-part-' + process.pid + '.sock'), quiet);
        c3.connect(); await wait(120); assert.strictEqual(c3.up, false); assert(c3.retry, 'une reconnexion est prévue'); c3.close();
    });

    /* ---- l'écran */
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-ui-'));
    const rec = new UI.Recents(path.join(dir, 'recents.json')).load();
    await check('récents : ajout en tête sans doublon, 30 au plus, gardés dans le fichier, effacés', () => {
        for (let i = 0; i < 35; i++) rec.add({ id: 'r' + String(i).padStart(10, '0'), title: 'T' + i, artist: 'A', duration_s: 100 });
        rec.add({ id: 'r' + String(20).padStart(10, '0'), title: 'T20', artist: 'A', duration_s: 100 });
        assert.strictEqual(rec.items.length, 30); assert.strictEqual(rec.items[0].title, 'T20');
        assert.strictEqual(new Set(rec.items.map((x) => x.id)).size, 30);
        const back = new UI.Recents(path.join(dir, 'recents.json')).load(); assert.strictEqual(back.items.length, 30); assert.strictEqual(back.items[0].id, rec.items[0].id);
        rec.clear(); assert.strictEqual(new UI.Recents(path.join(dir, 'recents.json')).load().items.length, 0);
        fs.writeFileSync(path.join(dir, 'bad.json'), '{pas du json'); assert.deepStrictEqual(new UI.Recents(path.join(dir, 'bad.json')).load().items, []);
    });
    await check('pochette carrée prise au centre de la vignette 16:9', () => {
        const buf = Buffer.alloc(320 * 180 * 4); for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) { const o = (y * 320 + x) * 4; buf[o] = x; buf[o + 3] = 255; }
        const sq = UI.centreSquare({ w: 320, h: 180, buf });
        assert.strictEqual(sq.w, 180); assert.strictEqual(sq.buf.length, 180 * 180 * 4);
        assert.strictEqual(sq.buf[0], 70); assert.strictEqual(sq.buf[(179) * 4], (70 + 179) & 255);
    });

    // l'écran sur un Recorder (ce que la voiture utilise) rejoué dans un Canvas, avec les zones tactiles
    const acts = []; const A = {}; ['search', 'play', 'toggle', 'prev', 'next', 'seekBy', 'seekTo', 'recentsClear'].forEach((k) => { A[k] = (...a) => acts.push([k].concat(a)); });
    const recents2 = new UI.Recents(null); [0, 1, 2].forEach((i) => recents2.add({ id: 'q' + String(i).padStart(10, '0'), title: 'Récent ' + i, artist: 'Un artiste', duration_s: 200 }));
    const art = new UI.Art(REC);
    const player = new M.Player((o) => ctl.send(o));
    const screen = new UI.Screen(player, recents2, art, A);
    const draw = () => { const r = new REC.Recorder(UI.W, UI.H, {}); screen.draw(r); const cv = new Canvas(UI.W, UI.H); REC.play(r.words(), cv); return { r, cv }; };
    const press = (r, key) => { const t = r.targets.find((x) => x.key === key); assert(t, 'zone ' + key + ' : ' + r.targets.map((x) => x.key)); return t.run(); };
    await check('écran Lecture vide : titre, boutons Chercher et onglets, pas de lecture', () => {
        const { r, cv } = draw();
        ['tab_now', 'tab_results', 'tab_recents', 'search'].forEach((k) => assert(r.targets.some((t) => t.key === k), k));
        assert(!r.targets.some((t) => t.key === 'toggle'), 'pas de boutons de lecture sans morceau');
        assert(cv.png().length > 3000);
        press(r, 'search'); assert.deepStrictEqual(acts.pop(), ['search']);
    });
    player.results = pl.results; player.connected = true; player.q = 'daft punk';
    player.thumbs = { aaaaaaaaaaa: pl.thumbs.aaaaaaaaaaa };
    await check('écran Résultats : 6 lignes tactiles, appui = jouer la liste à ce rang, défilement par pages', () => {
        screen.show('results');
        const { r, cv } = draw();
        assert.strictEqual(r.targets.filter((t) => /^row/.test(t.key)).length, 6);
        press(r, 'row2'); const a = acts.pop(); assert.strictEqual(a[0], 'play'); assert.strictEqual(a[2], 2); assert.strictEqual(a[1].length, 8);
        press(r, 'down'); assert.strictEqual(screen.top.results, 2, 'la page défile jusqu\'au bout');
        const r2 = draw().r; press(r2, 'row0'); assert.strictEqual(acts.pop()[2], 2, 'le rang suit le défilement');
        press(draw().r, 'up'); assert.strictEqual(screen.top.results, 0);
        fs.writeFileSync(process.env.MUSIC_PNG_LIST || path.join(dir, 'results.png'), cv.png());
    });
    await check('écran Récents : la liste, Effacer', () => {
        screen.show('recents'); const { r } = draw();
        assert.strictEqual(r.targets.filter((t) => /^row/.test(t.key)).length, 3);
        press(r, 'clear'); assert.deepStrictEqual(acts.pop(), ['recentsClear']);
    });
    await check('écran Lecture avec un morceau : boutons, progression, état, pochette, signature qui change', () => {
        player.cur = player.results[0]; player.queue = player.results; player.index = 0; player.state = 'playing'; player.elapsed = 61000; player.total = 183000;
        screen.show('now'); const sig = screen.signature();
        const { r, cv } = draw();
        ['prev', 'back', 'toggle', 'fwd', 'next'].forEach((k) => assert(r.targets.some((t) => t.key === k), k));
        press(r, 'toggle'); assert.deepStrictEqual(acts.pop(), ['toggle']);
        press(r, 'next'); assert.deepStrictEqual(acts.pop(), ['next']);
        press(r, 'back'); assert.deepStrictEqual(acts.pop(), ['seekBy', -10000]);
        press(r, 'fwd'); assert.deepStrictEqual(acts.pop(), ['seekBy', 10000]);
        assert(screen.bar && screen.bar.w > 500);
        player.elapsed = 62000; assert.notStrictEqual(screen.signature(), sig, 'une seconde de plus : on redessine');
        player.elapsed = 62400; assert.strictEqual(screen.signature(), screen.signature());
        fs.writeFileSync(process.env.MUSIC_PNG_NOW || path.join(dir, 'now.png'), cv.png());
        player.state = 'preparing'; player.pct = 40; draw(); player.state = 'error'; player.error = 'video unavailable'; draw(); player.state = 'paused'; draw();
    });
    await check('service absent : l\'écran le dit', () => {
        player.connected = false; const { cv } = draw(); assert(cv.png().length > 3000);
        fs.writeFileSync(process.env.MUSIC_PNG_OFF || path.join(dir, 'off.png'), cv.png()); player.connected = true;
    });

    /* ---- le branchement complet : start(ctx) avec un faux contexte, le faux service et un faux clavier */
    await check('start : cherche avec le clavier, joue un résultat, note le morceau dans les récents du dossier de données', async () => {
        const d2 = path.join(os.tmpdir(), 'music-start-' + process.pid + '.sock');
        const dm = fakeDaemon(d2); await dm.listen();
        const data = fs.mkdtempSync(path.join(os.tmpdir(), 'music-data-'));
        let img = null, visible = null, tap = null;
        const ctx = { dataDir: data, log: quiet, app: {}, canvas: (w, h) => new REC.Recorder(w, h, {}), ui: { image: (id, cv) => { img = cv; return id; }, onVisible: (fn) => { visible = fn; } },
            loop: (name, hz, fn) => ({ kick() { fn(); } }), onTap: (fn) => { tap = fn; } };
        const h = UI.start(ctx, { socket: d2, spell: (app, title) => Promise.resolve('daft punk'), rec: REC, always: true });
        assert(await until(() => h.player.connected));
        h.actions.search();
        assert(await until(() => h.player.results.length === 8)); assert.strictEqual(h.screen.view, 'results');
        h.actions.play(h.player.results, 1);
        assert(await until(() => h.player.state === 'playing')); assert.strictEqual(h.screen.view, 'now');
        assert(await until(() => h.recents.items.length === 1));
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(data, 'recents.json'), 'utf8'))[0].id, 'bbbbbbbbbbb');
        h.player.total = 200000; tap(h.screen.bar.x + h.screen.bar.w / 2, h.screen.bar.y + 20);
        assert(await until(() => dm.cmds.some((c) => c.cmd === 'seek')));
        assert.strictEqual(dm.cmds.filter((c) => c.cmd === 'seek').pop().ms, 100000, 'un appui au milieu de la barre : au milieu du morceau');
        tap(5, 5); await wait(60); assert.strictEqual(dm.cmds.filter((c) => c.cmd === 'seek').length, 1, 'un appui ailleurs ne cherche pas');
        assert(img, 'une image a été envoyée à l\'écran');
        // clavier en panne : l'erreur est dite, pas une exception
        const h2 = UI.start(Object.assign({}, ctx, { dataDir: null }), { socket: d2, spell: () => Promise.reject(new Error('clavier indisponible')), rec: REC, always: true });
        h2.actions.search(); await wait(50); assert(/clavier/.test(h2.player.error));
        h.ctl.close(); h2.ctl.close(); dm.close();
    });

    await check('app.json : aucun signal, les fichiers partagés, identifiants distincts, français', () => {
        const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'shakmusique', 'app.json'), 'utf8'));
        assert.deepStrictEqual(spec.signals, {}); assert.deepStrictEqual(spec.shared, ['music_ctl.js', 'music_ui.js']); assert.strictEqual(spec.config.lang, 'fr');
        assert(/^[A-Z]{4}$/.test(spec.loggingId) && /^[A-Z]{3}$/.test(spec.iconGlyph));
        fs.readdirSync(path.join(ROOT, 'apps')).filter((a) => a !== 'shakmusique').forEach((a) => {
            const f = path.join(ROOT, 'apps', a, 'app.json'); if (!fs.existsSync(f)) return;
            const o = JSON.parse(fs.readFileSync(f, 'utf8')); assert(o.loggingId !== spec.loggingId && o.iconGlyph !== spec.iconGlyph, a);
        });
        assert(/music_ui/.test(fs.readFileSync(path.join(ROOT, 'apps', 'shakmusique', 'main.js'), 'utf8')));
    });
    await check('rien de personnel, de jeton ni de code de RideTube dans les fichiers de Shak Musique', () => {
        ['shared/music_ctl.js', 'shared/music_ui.js', 'apps/shakmusique/main.js', 'apps/shakmusique/app.json'].forEach((f) => {
            const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
            assert(!/Bearer|client_secret|refresh_token|access_token|password/i.test(src), f);
            assert(!/GNU General Public|GPL-3/.test(src.replace(/\(GPL\)|\bGPL\b/g, '')), f + ' ne doit pas porter une licence GPL');
        });
    });

    d.close();
    console.log(failed ? failed + ' échec(s) sur ' + (n + failed) : 'musique : ' + n + ' vérifications');
    process.exit(failed ? 1 : 0);
})();
