'use strict';
// node tools/test_radar_zones.js: the danger zone lookup (shared/radar_zones.js) and the list it reads (data/radars_fr_zones.json).
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { RadarZones } = require('../shared/radar_zones');

const M_LAT = 110574;       // metres per degree of latitude, as the module uses

// a small list: a zone near Saint-Etienne (limit 70), a motorway zone near Lyon (limit 130, wide), one with no known limit
const z = new RadarZones({
    cell: 0.01, radius: 2000, radiusWide: 4000, version: 'test',
    zones: [[4536, 425, 70, 0], [4570, 485, 130, 1], [4800, 200, 0, 0]],
});

// on the centre: inside, the limit is known
let r = z.nearest(45.36, 4.25);
assert(r && r.inside && r.edgeM < 0 && r.centreM < 1);
assert.strictEqual(r.limit, 70); assert.strictEqual(r.wide, false);
assert(Math.abs(r.edgeM + 2000) < 1, 'on the centre, the edge is one radius away');

// north of the centre: the edge is the distance minus the radius, 1.5 km from the centre is still inside
r = z.nearest(45.36 + 1500 / M_LAT, 4.25);
assert(r.inside && Math.abs(r.edgeM + 500) < 5, 'edgeM ' + r.edgeM);
// 2.8 km north: 800 m before the zone
r = z.nearest(45.36 + 2800 / M_LAT, 4.25);
assert(!r.inside && Math.abs(r.edgeM - 800) < 5, 'edgeM ' + r.edgeM);
// 4.5 km north: not within the default 2 km, but within 3 km
assert.strictEqual(z.nearest(45.36 + 4500 / M_LAT, 4.25), null);
assert(Math.abs(z.nearest(45.36 + 4500 / M_LAT, 4.25, 3000).edgeM - 2500) < 5);
// east: a degree of longitude is shorter at this latitude (cos 45.36 deg), 2.8 km east is 0.0357 degrees
const dLon = 2800 / (111320 * Math.cos(45.36 * Math.PI / 180));
assert(Math.abs(z.nearest(45.36, 4.25 + dLon).edgeM - 800) < 8);

// the wide zone is 4 km
r = z.nearest(45.70 + 3000 / M_LAT, 4.85);
assert(r.inside && r.wide && r.limit === 130 && Math.abs(r.edgeM + 1000) < 5);
// no known limit -> null, not 0
assert.strictEqual(z.nearest(48.0, 2.0).limit, null);

// the nearest edge wins when two are near, and the deeper one when inside both
const two = new RadarZones({ zones: [[4500, 400, 50, 0], [4500, 404, 90, 0]] });     // 0.04 degree apart, about 3.1 km
r = two.nearest(45.0, 4.0 + 0.01);
assert.strictEqual(r.limit, 50, 'the one it is deeper in');
r = two.nearest(45.0, 4.0 + 0.03);
assert.strictEqual(r.limit, 90);

// far from everything, and not a position
assert.strictEqual(z.nearest(0, 0), null);
assert.strictEqual(z.nearest(NaN, 4), null);
assert.strictEqual(z.nearest(95, 4), null);
assert.strictEqual(z.nearest(45, 200), null);
assert.strictEqual(new RadarZones({}).nearest(45, 4), null);
// a bad entry in the list is skipped
assert.strictEqual(new RadarZones({ zones: [[1], 'x', null, [4536, 425, 70, 0]] }).zones.length, 1);

// the real list
const file = path.join(__dirname, '..', 'data', 'radars_fr_zones.json');
const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
assert(/Licence Ouverte/.test(doc.licence) && /Intérieur/.test(doc.source) && doc.version, 'source, licence and version are written in it');
assert(doc.zones.length > 2500 && doc.zones.length < 3600, 'about three thousand zones: ' + doc.zones.length);
// (the list of Nov 2026 on: a 0.002 degree grid, the road's direction and flags after the four first numbers)
assert(doc.zones.every((q) => (q.length === 4 || q.length === 6) && q.every(Number.isInteger)), 'whole numbers only: a centre is on the grid, never an exact position');
assert(doc.cell >= 0.002, 'the grid is not finer than 0.002 degree: a zone, not a place');
assert(doc.zones.every((q) => q.length === 4 || (q[4] >= -1 && q[4] < 360 && q[4] % 10 === 0 || q[4] === -1) && q[5] >= 0 && q[5] <= 3), 'direction in tens of degrees, flags 0..3');
assert(doc.zones.every((q) => (q[3] === 1) === (q[2] >= 110)), 'a wide zone is a limit of 110 or more');
assert(doc.zones.every((q) => q[2] === 0 || (q[2] >= 20 && q[2] <= 130)), 'limits are 0 or 20..130');
assert(!/"type"|ETF|ETT|ETD|ETU|ETVM|ETFR|ETPN/.test(JSON.stringify(doc)), 'no camera type in it');
const real = RadarZones.load(file);
assert.strictEqual(real.zones.length, doc.zones.length);
// metropolitan France is dotted with them: a point in the Atlantic is not
assert.strictEqual(real.nearest(45.0, -20.0, 10000), null);
// every real zone finds itself, and quickly: the whole list in well under a second
const t0 = Date.now();
real.zones.forEach((q) => { const n = real.nearest(q.lat, q.lon); assert(n && n.inside, 'a zone is inside itself'); });
assert(Date.now() - t0 < 2000, 'the lookup of every zone took ' + (Date.now() - t0) + ' ms');
// the maker (tools/make_radar_zones.py) on a small list and two roads: zones in town are short, the road's direction is kept, and the lookup
// leaves out the other carriageway and a crossing road
{
    const os = require('os'), { execFileSync } = require('child_process');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rz-'));
    const rows = ['Numéro de radar;Type de radar;Date de mise en service;VMA ;Latitude; Longitude'];
    for (let i = 0; i < 1200; i++) rows.push(i + ';ETF;01/01/2020;80;' + (44 + i * 0.003).toFixed(5) + ';' + (1 + i * 0.002).toFixed(5));
    rows.push('9001;ETF;01/01/2020;130;48.90010;2.37000');        // on a motorway going east (one way)...
    rows.push('9005;ETF;01/01/2020;130;48.90030;2.37400');        // ...with its twin 300 m away for the other carriageway
    rows.push('9002;ETU;01/01/2020;50;48.80003;2.30001');         // in town, on a street going north (two ways)
    rows.push('9003;ETF;01/01/2020;NA;48.70000;2.20000');         // no road near it
    rows.push('9006;ETFR;01/01/2020;NA;48.50000;2.10000');        // a red light camera: no speed in the list, a short zone like a town's
    rows.push('9004;ETT;01/01/2020;110;48.60005;2.50000');        // alone on a divided road (no other camera within 500 m): it covers both sides
    fs.writeFileSync(path.join(tmp, 'r.csv'), Buffer.from(rows.join('\n'), 'latin1'));
    const line = (tags, pts) => JSON.stringify({ type: 'Feature', properties: tags, geometry: { type: 'LineString', coordinates: pts } });
    fs.writeFileSync(path.join(tmp, 'roads.geojsonseq'), [
        line({ highway: 'motorway' }, [[2.36, 48.9], [2.38, 48.9]]),
        line({ highway: 'motorway' }, [[2.38, 48.9003], [2.36, 48.9003]]),
        line({ highway: 'residential' }, [[2.3, 48.79], [2.3, 48.81]]),
        line({ highway: 'trunk', oneway: 'yes' }, [[2.49, 48.6], [2.51, 48.6]]),
        line({ highway: 'trunk', oneway: 'yes' }, [[2.51, 48.60018], [2.49, 48.60018]]),
    ].join('\n'));
    const out = path.join(tmp, 'z.json');
    const said = execFileSync('python3', [path.join(__dirname, 'make_radar_zones.py'), path.join(tmp, 'r.csv'), path.join(tmp, 'roads.geojsonseq'), '--out', out]).toString();
    assert(/1206 radars/.test(said), said);
    const d2 = JSON.parse(fs.readFileSync(out, 'utf8')), z2 = new RadarZones(d2);
    assert.strictEqual(d2.cell, 0.002); assert.strictEqual(d2.radiusTown, 300);
    const mw = z2.zones.find((q) => q.limit === 130 && q.dir === 90), mw2 = z2.zones.find((q) => q.limit === 130 && q.dir === 270), tw = z2.zones.find((q) => q.limit === 50), none = z2.zones.find((q) => Math.abs(q.lat - 48.7) < 0.002 && Math.abs(q.lon - 2.2) < 0.002);
    assert(mw && mw.wide && mw.dir === 90 && mw.oneway && !mw.town, JSON.stringify(mw));
    assert(mw2 && mw2.oneway, 'the twin: the other carriageway, one way too');
    assert(tw && tw.town && tw.dir === 0 && !tw.oneway, JSON.stringify(tw));
    assert(none && none.dir === null && none.limit === null, JSON.stringify(none));
    const red = z2.zones.find((q) => Math.abs(q.lat - 48.5) < 0.002 && Math.abs(q.lon - 2.1) < 0.002);
    assert(red && red.town && red.limit === null && !none.town, 'a red light camera has a short zone, a speed camera without a limit keeps the usual one');
    assert(!/ETFR/.test(JSON.stringify(d2)));
    assert(!/48\.9001|2\.30001|48\.80003/.test(JSON.stringify(d2)), 'no exact position in the list');
    // a camera alone within 500 m covers both sides (the owner's rule; the list does not say): both directions are warned, a crossing road still is not
    const both = z2.zones.find((q) => q.limit === 110);
    assert(both && both.dir === 90 && !both.oneway, JSON.stringify(both));
    assert(z2.nearest(48.6, 2.47, 2000, 90) && z2.nearest(48.6, 2.53, 2000, 270), 'both carriageways'); assert.strictEqual(z2.nearest(48.6, 2.47, 2000, 0), null);
    // the motorway: the car going east is warned, the other carriageway (west) and a road crossing it (north) are not; unknown heading: warned
    // (each carriageway is warned by its own camera: going west the zone found is the twin's, not the eastbound one)
    const east = z2.nearest(48.9, 2.33, 2000, 90), west = z2.nearest(48.9003, 2.41, 2000, 270);
    assert(east && west && Math.abs(east.lon - 2.37) < 0.002 && Math.abs(west.lon - 2.374) < 0.002, JSON.stringify([east, west]));
    assert.strictEqual(z2.nearest(48.9, 2.33, 2000, 0), null);
    assert(z2.nearest(48.9, 2.33, 2000, null) && z2.nearest(48.9, 2.33, 2000));
    // in town: 300 m around, and warned from 300 m before that only, in either direction of the street, not from the street across
    const M = 1 / 110540;
    assert.strictEqual(z2.nearest(48.8 - 900 * M, 2.3, 2000, 0), null, '900 m away in town: too soon');
    const near = z2.nearest(48.8 - 500 * M, 2.3, 2000, 0);
    assert(near && near.town && near.edgeM > 100 && near.edgeM < 300, JSON.stringify(near));
    assert(z2.nearest(48.8 + 500 * M, 2.3, 2000, 180), 'the street is two ways');
    assert.strictEqual(z2.nearest(48.8 - 100 * M, 2.3, 2000, 90), null, 'crossing the street');
    fs.rmSync ? fs.rmSync(tmp, { recursive: true, force: true }) : null;
}
console.log('radar zones: ok (' + doc.zones.length + ' zones, version ' + doc.version + ')');
