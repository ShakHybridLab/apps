'use strict';
/**
 * Sonde de signaux : une appli d'essai qui s'abonne aux signaux qu'on lui déclare dans son app.json et montre, en direct, ce que la voiture
 * répond (valeur brute, nombre de messages, les derniers changements). Sert à trouver, SUR LA VOITURE, quel nom répond quand on appuie sur un
 * bouton (volant, ordinateur de bord, manette), ou ce que contient un signal de consommation, de média...
 *
 * Pourquoi des applis à part : la voiture refuse l'installation ENTIÈRE si un seul signal déclaré ne lui convient pas (docs/car_catalog_notes.md).
 * Ces applis ne portent donc que des essais, jamais les thèmes : si l'une est refusée, rien d'autre n'est touché. Les noms essayés ici ne
 * passent dans tools/car_accepted_signals.json (et dans ShakTheme) qu'après avoir été vus acceptés ET répondre.
 *
 * Le propriétaire ne peut pas lire de journal : tout est à l'écran, pour une photo. Ce qui a bougé est GARDÉ (« trouvailles », fichier
 * <dataDir>/found.json) : il reste après un redémarrage de l'appli ou de la voiture, une seule photo à la fin suffit, plus besoin de
 * viser le bon moment. Un bouton « Effacer » repart de zéro.
 *
 *   require('./signal_probe').start(ctx, { title: 'ShakBouton 1', note: '...', signals: { 'de.bmw....Iface': ['champ1', 'champ2'] }, pollMs: 1000 })
 *
 * Written for ShakTheme (MIT, as the rest of shared/).
 */

const MAX_EVENTS = 6;           // the live list on the screen (the kept findings are below it)
const MAX_VALUES = 5;           // distinct values kept per field
const NOISY = 60;               // this many changes and a field is "varying all the time", not a button
const BASE_MS = 4000;           // messages in the first seconds are the state the car reports at the start: they are not findings
const SAVE_MS = 2000;
const fs = require('fs');
const path = require('path');
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

const WIDE_CHARS = 130;          // a line of a wide row (spec.wide) on the left half of the screen
const WIDE_LINES = 3;
/** `text` cut into at most `lines` lines of `n` characters (the last one ends with an ellipsis when there is more). */
function wrap(text, n, lines) {
    const out = [];
    for (let i = 0; i < lines; i++) {
        const part = text.slice(i * n, (i + 1) * n);
        if (!part) break;
        out.push(i === lines - 1 && text.length > lines * n ? part.slice(0, n - 1) + '…' : part);
    }
    return out.length ? out : [''];
}

/** A value as text, short, for the screen. */
function show(v) {
    let s;
    try { s = JSON.stringify(v); } catch (e) { s = String(v); }
    return s === undefined ? 'undefined' : s;
}

/** Whether two values are the same for the log (the car re-sends unchanged values: only changes are logged). */
const same = (a, b) => show(a) === show(b);

/**
 * The state the screen shows, apart from the drawing: one row per declared field ({ iface, short, field, n, last, since, note }) and the
 * latest changes. `now` is injectable for the tests.
 */
class Probe {
    /** `file`: where the findings are kept (null: not kept, the tests). `clock`: wall time, injectable. */
    constructor(signals, now, file, clock) {
        this.now = now || Date.now;
        this.clock = clock || Date.now;
        this.t0 = this.now();
        this.file = file || null;
        this.found = {};                 // "Iface.field" -> { n: changes, msgs, vals: [text], at: wall ms of the last one, first: wall ms of the first }
        this.saveT = null;
        this.rows = [];
        this.events = [];
        this.total = 0;
        this.ifaces = {};
        Object.keys(signals).forEach((iface) => {
            this.ifaces[iface] = { short: iface.split('.').pop(), state: 'ouverture…', error: null, failed: {}, getFailed: {}, available: false };
            signals[iface].forEach((field) => this.rows.push({ iface, field, n: 0, last: undefined, seen: false, at: null }));
        });
    }

    row(iface, field) { return this.rows.find((r) => r.iface === iface && r.field === field); }

    /** Read the kept findings (a missing or unreadable file is no findings). */
    load() {
        if (!this.file) return;
        try {
            const o = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            if (o && o.v === 1 && o.found && typeof o.found === 'object') this.found = o.found;
        } catch (e) { /* none yet */ }
    }

    /** Write them now (atomic: a power cut leaves the old file). */
    flush() {
        clearTimeout(this.saveT); this.saveT = null;
        if (!this.file) return;
        const tmp = this.file + '.tmp';
        try { fs.writeFileSync(tmp, JSON.stringify({ v: 1, found: this.found })); fs.renameSync(tmp, this.file); } catch (e) { /* read-only: they stay on the screen till the restart */ }
    }

    /** Write them in a moment (a button pressed ten times is one write). */
    saveSoon() {
        if (!this.file || this.saveT) return;
        this.saveT = setTimeout(() => this.flush(), SAVE_MS);
        if (this.saveT.unref) this.saveT.unref();
    }

    /** Forget every finding (the screen's "Effacer"). */
    clear() { this.found = {}; this.flush(); }

    /** One finding: this field moved (a new value, or its first message after the start). */
    note(iface, field, value) {
        const key = this.ifaces[iface].short + '.' + field, t = this.clock(), text = show(value);
        const f = this.found[key] || (this.found[key] = { n: 0, vals: [], at: t, first: t });
        f.n++; f.at = t; f.field = field;
        if (f.vals.indexOf(text) < 0) { f.vals.push(text); if (f.vals.length > MAX_VALUES) f.vals.shift(); }
        this.saveSoon();
    }

    /** The kept findings, the latest first: [{ name, n, vals, at, noisy }]. */
    foundList() {
        return Object.keys(this.found).map((k) => ({ name: k, field: this.found[k].field || k.split('.').pop(), n: this.found[k].n, vals: this.found[k].vals, at: this.found[k].at, noisy: this.found[k].n >= NOISY }))
            .sort((a, b) => b.at - a.at);
    }

    /** A message from the car for iface.field. */
    receive(iface, field, value) {
        const r = this.row(iface, field);
        if (!r) return;
        const t = this.now();
        this.total++;
        r.n++;
        if (!r.seen || !same(r.last, value)) {
            this.events.unshift({ t: t - this.t0, name: field, value: show(value) });
            if (this.events.length > MAX_EVENTS) this.events.pop();
            r.at = t;
            // a finding: it changed, or it spoke for the first time well after the start (a button: the car says nothing till it is pressed)
            if (r.seen || t - this.t0 > BASE_MS) this.note(iface, field, value);
        }
        r.seen = true;
        r.last = value;
    }

    /** What watch() returned for an interface (error, failed, getFailed, available). */
    result(iface, res) {
        const i = this.ifaces[iface];
        if (!i || !res) return;
        i.error = res.error || null;
        i.failed = res.failed || {};
        i.getFailed = res.getFailed || {};
        i.available = !!res.available;
        i.state = i.error ? 'REFUSÉE' : i.available ? 'disponible' : 'indisponible';
        i.res = res;
    }

    /** Refresh the interface states from the live watch results (the car's availability changes after the start). */
    refresh() {
        Object.keys(this.ifaces).forEach((iface) => {
            const i = this.ifaces[iface];
            if (i.res) this.result(iface, i.res);
        });
    }

    /** The text of one field's row: its state first, then what it holds. */
    line(r) {
        const i = this.ifaces[r.iface];
        let st;
        if (i.error) st = 'interface refusée';
        else if (i.failed[r.field]) st = 'abonnement refusé : ' + i.failed[r.field];
        else if (i.getFailed[r.field] && !r.seen) st = 'lecture refusée : ' + i.getFailed[r.field];
        else if (!r.seen) st = i.available ? 'rien reçu' : 'voiture indisponible';
        else st = r.n + ' msg · ' + show(r.last);
        return { name: i.short + '.' + r.field, text: st, ok: r.seen, bad: !!(i.error || i.failed[r.field]) };
    }

    snapshot() {
        this.refresh();
        return {
            rows: this.rows.map((r) => this.line(r)),
            events: this.events.map((e) => ({ at: (e.t / 1000).toFixed(1) + ' s', name: e.name, value: clip(e.value, 70) })),
            found: this.foundList().map((f) => ({ name: f.name, field: f.field, n: f.n, noisy: f.noisy, vals: clip(f.vals.join(' · '), 46), at: new Date(f.at).toTimeString().slice(0, 8) })),
            total: this.total,
            ifaces: Object.keys(this.ifaces).map((k) => ({ name: this.ifaces[k].short, state: this.ifaces[k].state, error: this.ifaces[k].error })),
            uptime: Math.round((this.now() - this.t0) / 1000),
        };
    }
}

/** Open the subscriptions and draw the screen. ctx is the kit's app context (mgu.run start()). */
function start(ctx, spec) {
    const probe = new Probe(spec.signals, null, ctx.dataDir ? path.join(ctx.dataDir, 'found.json') : null);
    probe.load();
    Object.keys(spec.signals).forEach((iface) => {
        const handlers = {};
        spec.signals[iface].forEach((field) => { handlers[field] = (v) => { probe.receive(iface, field, v); if (loop && loop.kick) loop.kick(); }; });
        ctx.signals.watch(iface, '1', handlers, ctx.log, { pollMs: spec.pollMs || 1000 })
            .then((res) => { probe.result(iface, res); ctx.log.info(spec.title + ' ' + iface + ': ' + (res && res.error ? res.error : 'abonné')); })
            .catch((e) => { probe.result(iface, { error: String(e && e.message || e) }); });
    });
    let loop = null;
    const render = () => {
        const s = probe.snapshot();
        const cv = ctx.canvas(1600, 520);
        cv.clear('#090c12');
        cv.text(spec.title.toUpperCase(), 40, 50, 28, '#ffffff', { font: 'bold' });
        cv.text(spec.note || '', 40, 78, 16, '#91a0b4');
        cv.text(s.ifaces.map((i) => i.name + ' : ' + i.state).join('   ·   '), 40, 106, 16, s.ifaces.some((i) => i.error) ? '#ff6b6b' : '#7fd4a0');
        // spec.wide: the values are long structures (a GPS position): each row's text runs over up to three lines of WIDE_CHARS
        const lines = spec.wide ? WIDE_LINES : 1, chars = spec.wide ? WIDE_CHARS : 64, pitch = 31 + (lines - 1) * 15;
        s.rows.slice(0, Math.floor(350 / pitch)).forEach((r, k) => {
            const y = 150 + k * pitch, col = r.bad ? '#ff6b6b' : r.ok ? '#ffffff' : '#91a0b4';
            cv.text(r.name, 40, y, 16, col, { font: 'bold' });
            wrap(r.text, chars, lines).forEach((t, j) => cv.text(t, 40, y + 16 + j * 15, 14, r.bad ? '#ff6b6b' : r.ok ? '#dce4ef' : '#91a0b4'));
        });
        cv.text(spec.live || 'EN DIRECT : appuie sur les boutons', 900, 150, 16, '#91a0b4');
        s.events.forEach((e, k) => cv.text(e.at + '  ' + clip(e.name + ' = ' + e.value, 76), 900, 178 + k * 24, 15, k === 0 ? '#ffd166' : '#dce4ef'));
        if (!s.events.length) cv.text('aucun pour le moment', 900, 178, 15, '#91a0b4');
        // what has moved, kept (it stays after a restart): the button is the one that changes a few times, not the one that varies all the time
        cv.text('GARDÉ (reste après un redémarrage) : ' + s.found.length + (s.found.length > 1 ? ' signaux' : ' signal'), 900, 340, 16, '#7fd4a0', { font: 'bold' });
        s.found.slice(0, 6).forEach((f, k) => cv.text(clip(f.at + '  ' + f.field + ' x' + f.n + (f.noisy ? ' (varie sans cesse)' : ' : ' + f.vals), 80), 900, 366 + k * 24, 14, f.noisy ? '#91a0b4' : '#dce4ef'));
        if (!s.found.length) cv.text('rien pour le moment', 900, 366, 14, '#91a0b4');
        if (cv.target) {
            cv.roundRect && cv.roundRect(1450, 80, 120, 36, 8, '#ffffff1f');
            cv.text('Effacer', 1478, 104, 16, '#dce4ef');
            cv.target(1450, 80, 120, 36, () => { probe.clear(); if (loop && loop.kick) loop.kick(); }, 'clear', 8);
        }
        cv.text('Ce qui a bougé est gardé en bas à droite, même après un redémarrage : une photo à la fin suffit.', 40, 500, 14, '#91a0b4');
        cv.text(s.total + ' messages · ' + s.uptime + ' s', 1340, 50, 16, '#91a0b4');
        return ctx.ui.image('MAIN_GFX', cv);
    };
    loop = ctx.loop('MAIN', 10, render);
    render();
    const timer = setInterval(() => { try { if (loop && loop.kick) loop.kick(); } catch (e) { /* drawing again next time */ } }, 1000);
    if (timer.unref) timer.unref();
    return probe;
}

module.exports = { Probe, start, show, clip, wrap };
