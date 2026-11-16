'use strict';
const DEFAULT_PATHS = [
    '/dev/shm/mgu-video-ridetube',
    '/run/dasvideo', '/var/run/dasvideo', '/dev/shm/dasvideo',
    '/run/mgu-camera', '/dev/shm/mgu-camera',
    '/sys/class/video4linux'
];
const CAMERA_WORDS = /camera|cam|video|media|avb|dasvideo|mgu/i;

function stageOf(x) {
    const map = { P: 'P', R: 'R', N: 'N', D: 'D', 1: 'P', 2: 'R', 3: 'N', 4: 'D' };
    return map[x];
}
function selectionOf(x) {
    const n = typeof x === 'number' ? x : ({ N: 1, R: 2, P: 3, NP: 4 })[x];
    if (n === 1) return { stage: 'N' };
    if (n === 2) return { stage: 'R' };
    if (n === 3) return { stage: 'P' };
    if (n >= 5 && n <= 13) return { stage: 'D' };
    return null;
}
function classifyEvidence(paths) {
    const names = paths.join(' ').toLowerCase();
    const videoNode = /\/dev\/video\d+/.test(names) || /video4linux/.test(names);
    const service = /dasvideo|mgu-camera/.test(names);
    const sharedFrame = /mgu-video-ridetube/.test(names);
    return { videoNode, service, sharedFrame };
}
class ShakCamDiag {
    constructor(deps) {
        this.fs = deps.fs; this.path = deps.path; this.log = deps.log;
        this.speedKmh = null; this.speedAt = 0; this.gearValue = null; this.gearAt = 0;
        this.paths = []; this.lastScan = 0; this.timer = null; this.onChange = null;
    }
    speed(v) { this.speedKmh = typeof v === 'number' && isFinite(v) && v >= 0 && v < 400 ? v : null; this.speedAt = Date.now(); this.changed(); }
    gear(v) { this.gearValue = v || null; this.gearAt = Date.now(); this.changed(); }
    changed() { if (this.onChange) this.onChange(); }
    exists(p) { try { return this.fs.statSync(p); } catch (e) { return null; } }
    scan() {
        const found = [];
        const add = (p) => { if (found.indexOf(p) < 0) found.push(p); };
        DEFAULT_PATHS.forEach((p) => { if (this.exists(p)) add(p); });
        ['/dev', '/sys/class/video4linux', '/sys/class/net'].forEach((dir) => {
            try {
                this.fs.readdirSync(dir).forEach((n) => {
                    if (CAMERA_WORDS.test(n) || (/^video\d+$/.test(n) && dir === '/dev')) add(this.path.join(dir, n));
                });
            } catch (e) { /* not exposed by this app sandbox */ }
        });
        this.paths = found; this.lastScan = Date.now(); this.changed();
        if (this.log) this.log.info('ShakCamDiag read-only scan: ' + (found.length ? found.join(', ') : 'no camera-related paths visible'));
        return found;
    }
    snapshot() {
        const e = classifyEvidence(this.paths);
        const freshSpeed = this.speedAt && Date.now() - this.speedAt < 3000;
        const freshGear = this.gearAt && Date.now() - this.gearAt < 5000;
        const unknown = { label: 'NON VERIFIEE', color: '#e4b45e' };
        // Discovery of a generic node cannot identify which physical camera it carries.
        const front = Object.assign({}, unknown), rear = Object.assign({}, unknown);
        if (!e.videoNode && !e.service && !e.sharedFrame) {
            front.label = 'AUCUNE INTERFACE DETECTEE'; rear.label = 'AUCUNE INTERFACE DETECTEE';
        } else {
            front.label = 'INTERFACE PRESENTE · FLUX NON PROUVE';
            rear.label = 'INTERFACE PRESENTE · FLUX NON PROUVE';
        }
        const summary = this.paths.length ? this.paths.slice(0, 4).join(' · ') : 'Aucun chemin caméra visible dans le sandbox';
        return {
            speedText: freshSpeed ? this.speedKmh.toFixed(1) + ' km/h' : 'INCONNUE',
            gear: freshGear ? this.gearValue : null,
            front, rear, summary,
            evidence: e,
            verdict: 'No stream validation: no device opened, no frame decoded'
        };
    }
    stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
ShakCamDiag.stageOf = stageOf;
ShakCamDiag.selectionOf = selectionOf;
ShakCamDiag.classifyEvidence = classifyEvidence;
module.exports = ShakCamDiag;
