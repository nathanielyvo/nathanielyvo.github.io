#!/usr/bin/env node
// Publish the current commit to GitHub through api.github.com alone.
//
// Why this exists: from this network github.com:443 and ssh.github.com:443 are both unreachable, so `git push`
// times out, while api.github.com answers normally. This walks the Git Data API instead — upload every blob,
// build the tree, create the commit, move refs/heads/main — which needs nothing but the API host.
//
// Usage:  node _tools/push.mjs            (pushes HEAD to refs/heads/main)
//         node _tools/push.mjs --branch x
//
// It verifies that the tree GitHub assembled matches the local tree exactly before touching the ref, so a
// partial upload can never move the branch. Re-running is safe: blobs that already exist are deduplicated.
// Requires `gh auth login` (the token is read from `gh auth token`).
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const branch = argv.includes('--branch') ? argv[argv.indexOf('--branch') + 1] : 'main';

const git = (...a) => execFileSync('git', a, { cwd: ROOT, maxBuffer: 1 << 28 });
const gitStr = (...a) => git(...a).toString().trim();
const TOKEN = execFileSync('gh', ['auth', 'token']).toString().trim();

// owner/repo from the origin remote
const REPO = (gitStr('remote', 'get-url', 'origin').match(/github\.com[:/](.+?)(?:\.git)?$/) || [])[1];
if (!REPO) throw new Error('could not read owner/repo from the origin remote');

async function api(path, method = 'GET', body) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(`https://api.github.com${path}`, {
        method,
        headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const t = await r.text();
      if (!r.ok) throw new Error(`${r.status} ${method} ${path}\n${t.slice(0, 400)}`);
      return t ? JSON.parse(t) : {};
    } catch (e) {
      // the link drops often enough that a blind retry is worth more than a clean error
      if (attempt >= 4) throw e;
      await new Promise((s) => setTimeout(s, 1500 * attempt));
    }
  }
}

const head = gitStr('rev-parse', 'HEAD');
const localTree = gitStr('rev-parse', 'HEAD^{tree}');
const entries = gitStr('ls-tree', '-r', 'HEAD').split('\n').map((l) => {
  const [meta, path] = l.split('\t');
  const [mode, , sha] = meta.split(/\s+/);
  return { mode, sha, path };
});
console.log(`${REPO}  ${head.slice(0, 8)}  ${entries.length} files`);

// ── blobs. A handful at a time: more parallelism just multiplies the timeouts on a flaky link.
const queue = [...entries];
const tree = [];
let done = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const f = queue.shift();
    const content = git('cat-file', 'blob', f.sha);
    const blob = await api(`/repos/${REPO}/git/blobs`, 'POST', { content: content.toString('base64'), encoding: 'base64' });
    // Git hashes content, so an upload that round-trips to a different sha means the bytes changed in flight.
    if (blob.sha !== f.sha) throw new Error(`blob sha mismatch for ${f.path}: ${blob.sha} != ${f.sha}`);
    tree.push({ path: f.path, mode: f.mode, type: 'blob', sha: blob.sha });
    process.stdout.write(`\r  blobs ${++done}/${entries.length}`);
  }
}));
console.log();

// ── tree, then the same check again on the whole snapshot
const t = await api(`/repos/${REPO}/git/trees`, 'POST', { tree });
if (t.sha !== localTree) throw new Error(`tree mismatch: remote ${t.sha} != local ${localTree}`);
console.log(`  tree ${t.sha.slice(0, 8)} matches local`);

// ── commit, reproducing the local author/committer. GitHub normalises dates to UTC, so the commit sha will
//    differ from the local one even though the tree is identical; the tree is what gets served. The new commit
//    is chained onto whatever the branch points at now, so the remote history stays linear.
const raw = git('cat-file', 'commit', 'HEAD').toString();
const message = raw.slice(raw.indexOf('\n\n') + 2);
const who = (k) => {
  const [, name, email, ts, tz] = raw.match(new RegExp(`^${k} (.+) <(.+)> (\\d+) ([+-]\\d{4})$`, 'm'));
  const d = new Date(Number(ts) * 1000).toISOString().replace('.000Z', '');
  return { name, email, date: `${d}${tz.slice(0, 3)}:${tz.slice(3)}` };
};
const remoteHead = await api(`/repos/${REPO}/git/ref/heads/${branch}`).catch(() => null);
const c = await api(`/repos/${REPO}/git/commits`, 'POST', {
  message, tree: t.sha, parents: remoteHead ? [remoteHead.object.sha] : [],
  author: who('author'), committer: who('committer'),
});
console.log(`  commit ${c.sha.slice(0, 8)}`);

await api(`/repos/${REPO}/git/refs`, 'POST', { ref: `refs/heads/${branch}`, sha: c.sha })
  .catch(() => api(`/repos/${REPO}/git/refs/heads/${branch}`, 'PATCH', { sha: c.sha, force: true }));
console.log(`  refs/heads/${branch} → ${c.sha.slice(0, 8)}`);
console.log(`\npublished. give Pages a minute, then: curl -sI https://${REPO.split('/')[0]}.github.io/`);
