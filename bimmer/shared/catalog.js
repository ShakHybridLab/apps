'use strict';
/**
 * catalog.js - the car's own catalogue of signals (/etc/oap/someip/someip-interfaces.json, what the installer builds every app's signal
 * access from), cut into the groups on the Signals tab (the three the owner asked for, then what the app still needs), so that a photo of two pages names what the app can
 * read next. Only NAMES are listed here (no values: a value needs a declared signal, and the car refuses the whole installation when a
 * declared field is not in this catalogue, ShakTheme 0.21.12), and the names come from the car itself, never from memory.
 *   buttons  the steering wheel's and the stalks' buttons     media  what is playing     sign  the speed limit signs
 *   power  the electric motor, the battery, the power     road  the pedals, the steering angle, the road's slope     cam  speed cameras, hazards
 * Reading a catalogue is done once per run (cached in memory, and on disk for the next runs): it is a big JSON file. Same file and same way as eroobeeroo's signal_finder.js.
 */
const fs = require('fs');

const PATH = process.env.SOMEIP_CATALOG || '/etc/oap/someip/someip-interfaces.json';
const MAX_ROWS = 8;            // rows on a page of the Signals tab
const GROUPS = [
    { id: 'buttons', title: 'Steering wheel and stalk buttons (the car\'s catalog)', match: /taste|button|mfl|multifunction|lenkrad|lenkstock|steeringwheel|stalk|keypad|wheelkey|swc|paddle|thumbwheel/i },
    { id: 'media', title: 'Media: what is playing (the car\'s catalog)', match: /media|titel|title|artist|interpret|album|trackname|currenttrack|nowplaying|audiosource|playback|metadata|radiotext/i },
    { id: 'sign', title: 'Speed limit signs (the car\'s catalog)', match: /speedlimit|speed.?limit|tempolimit|geschwindigkeitsbegrenzung|verkehrszeichen|roadsign|trafficsign|limitspeed|nopassing|passingrestriction|overtak|\bsli\b/i },
    // what the app would still like to read (the owner asked for what it needs): the real power of the electric motor (the blue rev bar is only an
    // estimate), the pedals and the road's slope (to make it a better one), and the speed cameras (a position is not in the catalog). A name that matches
    // `first` (in the field's own name) comes before one that only sits in a matching interface, which comes before one that only has a matching member
    { id: 'power', title: 'Electric motor, battery and power (the car\'s catalog)', first: /power|leistung|current|strom|voltage|spannung|torque|moment|recuperat|rekuperat|regenerat|edrive|electricmotor/i,
        match: /electricmotor|electricengine|elektromotor|emachine|e-?motor|edrive|hvbatt|hv.?batt|highvolt|hochvolt|batterycurrent|batteryvoltage|batterypower|powerdrive|powermeter|powerflow|energyflow|energiefluss|electricpower|electricalpower|powerdistribution|recuperat|rekuperat|regenerat|motortorque|drivetorque|efficiencytainment|boostpower|xtraboost/i },
    { id: 'road', title: 'Pedals, steering and road slope (the car\'s catalog)', first: /pedal|accelerator|gradient|slope|incline|steigung|steering.?angle|lenkwinkel/i,
        match: /gradient|slope|incline|inclin|steigung|neigung|pitch|accelerator|pedal|fahrpedal|gaspedal|throttle|brake|bremse|steeringangle|steering.?angle|lenkwinkel|yawrate|gierrate/i },
    { id: 'cam', title: 'Speed cameras and road hazards (the car\'s catalog)', first: /speedcam|speed.?camera|blitzer|safetycam|speedtrap|enforcement/i,
        match: /speedcam|speed.?camera|blitzer|safetycam|speedtrap|radartrap|radarfalle|hazard|gefahr|danger|enforcement|trafficcam|redlight|speedwarning/i },
    // the car's own camera interfaces (ShakPark): EVERY entry of every section (fields, methods, broadcasts...) of CameraProxy and ICAM2Proxy, with what
    // goes in and out of it, over two pages of MAX_ROWS rows (`all`: not only fields; `skip`: the rows the page before already showed)
    { id: 'camera', all: true, skip: 0, title: 'Cameras: CameraProxy and ICAM2Proxy', match: /cameraproxy|icam2/i },
    { id: 'camera2', all: true, skip: MAX_ROWS, title: 'Cameras: next entries', match: /cameraproxy|icam2/i },
];

/** The member names of a field's data type (structs flattened, a parent's members first), at most two levels deep. */
function members(db, ref, depth) {
    const d = db.datatypes && db.datatypes[ref];
    if (!d || depth > 2) return [];
    if (d.type === 'typedef') return members(db, d.dataRef || d.baseType, depth);
    if (d.type === 'array') return members(db, d.elementDataRef, depth + 1);
    if (d.type !== 'struct') return [];
    let out = [], dd = d;
    for (let i = 0; i < 8; i++) {
        out = (dd.members || []).map((m) => m.name).concat(out);
        if (!dd.extends || !db.datatypes[dd.extends]) break;
        dd = db.datatypes[dd.extends];
    }
    return out;
}

/**
 * What an entry of the catalog holds, as short names, whatever its section (a method's arguments in and out, a broadcast's data): the
 * member names of its type, and for every list or object it has, the names inside it. The names are the car's; nothing is guessed.
 */
function describe(db, e) {
    const out = [];
    if (!e || typeof e !== 'object') return out;
    members(db, e.dataRef, 0).forEach((m) => out.push(m));
    Object.keys(e).forEach((k) => {
        const v = e[k];
        if (k === 'dataRef') return;
        if (Array.isArray(v)) {
            v.forEach((a) => {
                if (a && typeof a === 'object') { const m = members(db, a.dataRef, 0); out.push(k + ':' + (a.name || '?') + (m.length ? '{' + m.join('/') + '}' : '')); } else out.push(k + ':' + String(a));
            });
        } else if (v && typeof v === 'object') {
            if (v.id !== undefined) out.push(k + '#' + v.id);
            const m = members(db, v.dataRef, 0);
            if (m.length) out.push(k + '{' + m.join('/') + '}');
        } else out.push(k + '=' + v);
    });
    return out.slice(0, 40);
}

/** Every entry of every section of the interfaces `g.match` names (an interface's own plain values first, as one row). */
function allRows(db, g) {
    const rows = [];
    Object.keys(db.interfaces || {}).forEach((iface) => {
        if (!/^de\.bmw\./.test(iface) || !g.match.test(iface)) return;
        const it = db.interfaces[iface] || {}, plain = [];
        Object.keys(it).forEach((sec) => {
            const sv = it[sec];
            if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
                Object.keys(sv).forEach((name) => {
                    const f = sv[name] || {};
                    const flags = sec === 'fields' ? [f.getter && f.getter.id ? 'get' : '', f.notifier ? 'notify' : ''].filter(Boolean).join(' ') : sec;
                    rows.push({ iface, field: sec + '.' + name, own: true, rank: 1, flags, members: describe(db, f) });
                });
            } else if (!Array.isArray(sv)) plain.push(sec + '=' + sv);
        });
        if (plain.length) rows.push({ iface, field: '(interface)', own: true, rank: 2, flags: '', members: plain });
    });
    return rows;
}

/** { groups: [{ id, title, rows: [{ iface, field, flags, members }] }], error }: the best MAX_ROWS of each group (a name that matches first). */
function find(file) {
    let db;
    try { db = JSON.parse(fs.readFileSync(file || PATH, 'utf8')); } catch (e) { return { groups: GROUPS.map((g) => ({ id: g.id, title: g.title, rows: [] })), error: String(e && e.message || e) }; }
    const groups = GROUPS.map((g) => {
        const rows = g.all ? allRows(db, g) : [];
        if (!g.all) Object.keys(db.interfaces || {}).forEach((iface) => {
            if (!/^de\.bmw\./.test(iface)) return;
            const fields = db.interfaces[iface].fields || {};
            Object.keys(fields).forEach((name) => {
                const f = fields[name] || {}, mem = members(db, f.dataRef, 0);
                const own = g.match.test(name) || g.match.test(iface), inMem = mem.filter((m) => g.match.test(m));
                if (!own && !inMem.length) return;
                rows.push({ iface, field: name, own, rank: g.first && g.first.test(name) ? 2 : own ? 1 : 0, flags: [f.getter && f.getter.id ? 'get' : '', f.notifier ? 'notify' : ''].filter(Boolean).join(' '), members: own ? mem : inMem });
            });
        });
        rows.sort((a, b) => (b.rank - a.rank) || (a.iface + a.field).localeCompare(b.iface + b.field));
        return { id: g.id, title: g.title, rows: rows.slice(g.skip || 0, (g.skip || 0) + MAX_ROWS) };
    });
    return { groups, error: null };
}

let cached = null;
/** The catalogue's identity (size and date): the cache on disk is only good for the same file. */
function stamp(file) { try { const st = fs.statSync(file || PATH); return st.size + ':' + Math.round(st.mtimeMs); } catch (e) { return null; } }
/** What the cache is a cut of: when a group's name, title or pattern changes, the cache is no longer good. */
const SHAPE = GROUPS.map((g) => g.id + '|' + g.title + '|' + String(g.match) + '|' + String(g.first || '') + '|' + (g.all ? 'all' : '') + (g.skip || 0)).join('||') + '|' + MAX_ROWS;
function fromDisk(cacheFile, st) {
    try {
        const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (c && c.v === 1 && c.stamp === st && c.shape === SHAPE && Array.isArray(c.groups)) return { groups: c.groups, error: null };
    } catch (e) { /* no cache yet, or an old one */ }
    return null;
}
/** The catalogue if it was already read (this run), else null: the page asks for it later (load) instead of waiting for it. */
function peek() { return cached; }
/**
 * find() once per run. The car's file is big and parsing it stops the whole app for a while (the cluster's gauges too), so the three
 * small groups it yields are kept in cacheFile (the app's own data folder): the same file, the same answer, read in no time on the next run.
 */
function load(cacheFile) {
    if (cached) return cached;
    const st = stamp();
    if (cacheFile && st) { const c = fromDisk(cacheFile, st); if (c) return (cached = c); }
    cached = find();
    if (cacheFile && st && !cached.error) {
        try { fs.writeFileSync(cacheFile, JSON.stringify({ v: 1, stamp: st, shape: SHAPE, groups: cached.groups })); } catch (e) { /* read-only: read again next run */ }
    }
    return cached;
}

module.exports = { GROUPS, MAX_ROWS, find, load, peek, members, PATH, stamp };
