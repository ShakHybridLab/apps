#!/usr/bin/env python3
"""Builds this fork's RideTube service from the published one, changing only ytd.js (no Docker, no BMW SDK).

  python3 ridetube-fork/tools/patch_service.py <jap-ridetube-d@0.3.9.tgz> [--out ridetube-fork]

Two changes. First: once the decoder (ytdec) has made its frame file /dev/shm/mgu-video-ridetube, the service gives the file to the
apps' group (tm_oap_app, the group that already may use the service's control socket) read-only: owner unchanged, group
tm_oap_app, mode 0640 instead of 0600. "RideTube on cluster" (bimmer/apps/ridetube_cluster) reads it to show the video on the
instrument cluster and the HUD while the car is parked. mgu-render checks the file's owner only, so the centre screen is
unaffected. Second: while a video plays or is paused the service writes /run/jap-ridetube-d/now.json once a second (state, title,
channel, position, length; 0644) for that app's "now playing" card, and removes it when nothing plays. Everything else, the
decoder binary included, is byte for byte the original's.

Writes <out>/jap-ridetube-d@<new version>.tgz and <out>/catalog.json (the app entry points at the original's unmodified
package). RideTube is JustAnotherPU's, GPL-3.0-or-later; this fork keeps that licence and its notices (files/LICENSE,
files/THIRD_PARTY_LICENSES in the package)."""
import argparse, gzip, hashlib, io, json, os, sys, tarfile

BASE = '0.3.9'
VERSION = '0.3.92'          # x.y.z, above the original's 0.3.9 (the app asks for at least that)
ORIG_SHA = '63dc4d7deb18849662d7d90efb41017483db5f835e6124fb90e6f5cd45300f5d'
UPSTREAM = 'https://github.com/JustAnotherPU/ridetube/releases/download/catalog/'

ANCHOR = """    } else if (m.ev === 'ready') {
        this.lastProgress = Date.now();
"""
ADDED = """    } else if (m.ev === 'ready') {
        this.lastProgress = Date.now();
        this.shareVideoFile();     // shakzer fork
"""
TIMER_ANCHOR = """    this.timers.push(setInterval(() => this.guard(() => this.watchdog()), 1000));
"""
TIMER = TIMER_ANCHOR + """    this.timers.push(setInterval(() => this.guard(() => this.shareNow()), 1000));     // shakzer fork
"""
FUNC_ANCHOR = "Daemon.prototype.toYtdec = function (line) {"
FUNC = """// shakzer fork (x3-hybride, ridetube-fork/): the decoder's frame file, read-only for the apps' group (the control socket's:
// tm_oap_app), so that "RideTube on cluster" can show the picture on the instrument cluster while the car is parked. The owner
// stays (mgu-render checks only that). ytdec makes the file 0600 again at every start, hence at every 'ready'.
Daemon.prototype.shareVideoFile = function () {
    const f = '/dev/shm/mgu-video-ridetube';
    try {
        const st = fs.lstatSync(f);
        if (!st.isFile()) return;
        fs.chownSync(f, st.uid, this.opts.sockGid);
        fs.chmodSync(f, 0o640);
    } catch (e) { this.log('share video file: ' + e.message); }
};
// shakzer fork: what plays, in words, once a second while a video plays or is paused: now.json beside the control socket (the
// service's own runtime folder, root's; 0644), for the "now playing" card of RideTube on cluster. Removed when nothing plays.
Daemon.prototype.shareNow = function () {
    const f = path.join(path.dirname(this.opts.sock), 'now.json'), c = this.cur;
    if (!c || (this.state !== 'playing' && this.state !== 'paused')) {
        if (this.nowShared) { this.nowShared = false; try { fs.unlinkSync(f); } catch (e) { /* gone */ } }
        return;
    }
    if (!this.nowMeta || this.nowMeta.id !== c.id || !this.nowMeta.channel) this.nowMeta = readMeta(c.dir, c.id);
    const o = { t: Date.now(), state: this.state, title: String(c.title || this.nowMeta.title || ''), channel: String(this.nowMeta.channel || ''),
        elapsed_ms: Math.max(0, Math.round(this.elapsed || 0)), total_ms: Math.max(0, Math.round(this.total || 0)) };
    try {
        fs.writeFileSync(f + '.tmp', JSON.stringify(o), { mode: 0o644 });
        fs.renameSync(f + '.tmp', f);
        this.nowShared = true;
    } catch (e) { if (!this.nowWarned) { this.nowWarned = true; this.log('now.json: ' + e.message); } }
};
"""


def sha(b):
    return hashlib.sha256(b).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('tgz')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
    a = ap.parse_args()
    raw = open(a.tgz, 'rb').read()
    if sha(raw) != ORIG_SHA:
        sys.exit('not the published jap-ridetube-d@%s.tgz (sha256 %s)' % (BASE, sha(raw)))
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as t:
        members = [(m, t.extractfile(m).read() if m.isfile() else None) for m in t.getmembers()]
    out, mtime = [], None
    for m, d in members:
        mtime = m.mtime if mtime is None else mtime
        if m.name == 'files/ytd.js':
            s = d.decode('utf8')
            if s.count(ANCHOR) != 1 or s.count(FUNC_ANCHOR) != 1 or s.count(TIMER_ANCHOR) != 1:
                sys.exit('ytd.js is not the one this patch was written for')
            s = s.replace(ANCHOR, ADDED).replace(FUNC_ANCHOR, FUNC + FUNC_ANCHOR).replace(TIMER_ANCHOR, TIMER)
            d = s.encode('utf8')
            ytd = d
        out.append((m, d))
    for i, (m, d) in enumerate(out):
        if m.name == 'component.json':
            c = json.loads(d.decode('utf8'))
            assert c['version'] == BASE
            c['version'] = VERSION
            c['title'] = 'RideTube service (shakzer fork)'
            c['description'] = ('JustAnotherPU\'s RideTube service %s with two changes for RideTube on cluster: the decoder\'s frame file is readable '
                                'by the apps\' group (video on the cluster and HUD, parked only) and what plays is written to now.json (title and progress). ' % BASE) + c['description']
            hit = [f for f in c['files'] if f['path'] == 'ytd.js']
            assert len(hit) == 1
            hit[0]['sha256'] = sha(ytd)
            d = (json.dumps(c, indent=2) + '\n').encode('utf8')
            out[i] = (m, d)
            comp = c
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w', format=tarfile.USTAR_FORMAT) as t:
        for m, d in sorted(out, key=lambda x: x[0].name):
            m.uid = m.gid = 0
            m.uname = m.gname = ''
            if d is not None:
                m.size = len(d)
            t.addfile(m, io.BytesIO(d) if d is not None else None)
    name = 'jap-ridetube-d@%s.tgz' % VERSION
    path = os.path.join(a.out, name)
    with open(path, 'wb') as f, gzip.GzipFile(fileobj=f, mode='wb', mtime=mtime, filename='') as g:
        g.write(buf.getvalue())
    packed = open(path, 'rb').read()
    catalog = {'schema': 2, 'components': [
        {'id': 'jap_ridetube', 'kind': 'app', 'title': 'RideTube',
         'description': 'JustAnotherPU\'s RideTube app, unmodified (downloaded from its own release). Video in the car: an unofficial client for YouTube; the picture only while parked.',
         'version': '0.3.8',
         'artifact': {'name': 'jap_ridetube@0.3.8.tgz', 'size': 1177582,
                      'sha256': '44bd9ee5f0d0f42cd606a36bbb674817beade431f9fcaf205aef590fff279fce', 'url': UPSTREAM + 'jap_ridetube@0.3.8.tgz'},
         'requires': {'jap-ridetube-d': BASE, 'mgu-render': '0.6.11', 'mgu-inputgate': '1.0.0'},
         'uninstallable': True, 'mguHmi': ['ID7']},
        {'id': 'jap-ridetube-d', 'kind': 'tool', 'title': comp['title'], 'description': comp['description'], 'version': VERSION,
         'artifact': {'name': name, 'size': len(packed), 'sha256': sha(packed), 'url': name},
         'requires': {'mgu-deploy': '0.7.0', 'mgu-python': '1.0.2', 'jap-node22': '22.23.4', 'mgu-render': '0.6.11'},
         'uninstallable': True, 'mguHmi': ['ID7']},
    ]}
    with open(os.path.join(a.out, 'catalog.json'), 'w') as f:
        json.dump(catalog, f, indent=2)
        f.write('\n')
    print('%s: %d bytes, sha256 %s' % (name, len(packed), sha(packed)))


if __name__ == '__main__':
    main()
