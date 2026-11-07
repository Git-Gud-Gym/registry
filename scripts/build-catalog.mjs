#!/usr/bin/env node
// Builds catalog.json: the game library the launcher and the website read.
//
//   node scripts/build-catalog.mjs --out public/catalog.json
//
// Inputs: modules.json (the reviewed list of module repos), planned.json (games we intend to
// support), and each repo's latest GitHub release. Every downloadable file gets a SHA-256 that the
// launcher verifies before installing. Set GH_TOKEN (or GITHUB_TOKEN) to avoid API rate limits.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORG = 'Git-Gud-Gym';
// The launcher runs as administrator and loads modules into games, so only org-owned repos qualify.
const isOrgRepo = (repo) => repo.split('/')[0] === ORG;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outArg = process.argv.indexOf('--out');
const out = resolve(outArg > 0 ? process.argv[outArg + 1] : 'catalog.json');
const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
const headers = { 'User-Agent': 'git-gud-gym-registry', Accept: 'application/vnd.github+json' };

const api = async (path) => {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`GitHub API ${path}: HTTP ${res.status}`);
  return res.json();
};

const download = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': headers['User-Agent'] } });
  if (!res.ok) throw new Error(`Download ${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
};

const semver = (tag) => /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag)?.slice(1).map(Number) ?? null;
const newer = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};

// Newest published (non-draft, non-prerelease) vX.Y.Z release of a repo that passes `accept`.
async function latestRelease(repo, accept = () => true) {
  let best = null;
  for (const r of await api(`/repos/${repo}/releases?per_page=100`)) {
    const v = semver(r.tag_name);
    if (!v || r.draft || r.prerelease || !accept(r)) continue;
    if (!best || newer(v, best.v)) best = { v, release: r };
  }
  return best && { version: best.v.join('.'), release: best.release };
}

const describeFile = async (asset) => {
  const sha256 = asset.digest?.startsWith('sha256:')
    ? asset.digest.slice(7)
    : createHash('sha256').update(await download(asset.browser_download_url)).digest('hex');
  return { name: asset.name, url: asset.browser_download_url, size: asset.size, sha256 };
};

async function launcherEntry(repo) {
  const isZip = (a) => /^GitGudGym-v.*\.zip$/.test(a.name);
  const found = await latestRelease(repo, (r) => r.assets.some(isZip));
  if (!found) return null;
  return {
    version: found.version,
    releaseUrl: found.release.html_url,
    download: await describeFile(found.release.assets.find(isZip)),
  };
}

async function moduleEntry({ id, repo }) {
  // The release's own module.json says which files make up the module.
  const found = await latestRelease(repo, (r) => r.assets.some((a) => a.name === 'module.json'));
  if (!found) throw new Error(`${repo} has no release with a module.json yet`);
  const assets = found.release.assets;
  const manifest = JSON.parse((await download(assets.find((a) => a.name === 'module.json').browser_download_url)).toString());
  if (manifest.id !== id) throw new Error(`${repo}: module.json id "${manifest.id}" != registry id "${id}"`);
  if (manifest.version !== found.version) {
    throw new Error(`${repo}: release ${found.release.tag_name} ships module.json version ${manifest.version}`);
  }
  const files = await Promise.all(
    manifest.files.map((name) => {
      const asset = assets.find((a) => a.name === name);
      if (!asset) throw new Error(`${repo} ${found.release.tag_name} is missing ${name}`);
      return describeFile(asset);
    }),
  );
  return {
    id,
    name: manifest.name,
    status: 'available',
    tagline: manifest.tagline ?? '',
    features: manifest.features ?? [],
    version: found.version,
    releaseUrl: found.release.html_url,
    publishedAt: found.release.published_at,
    repo,
    game: {
      exe: manifest.game.exe,
      steamAppId: manifest.game.steamAppId ?? null,
      testedPatches: (manifest.game.versions ?? []).filter((v) => v.tested).map((v) => v.patch),
    },
    files,
  };
}

async function main() {
  const registry = JSON.parse(await readFile(join(root, 'modules.json'), 'utf8'));
  const planned = JSON.parse(await readFile(join(root, 'planned.json'), 'utf8'));
  for (const repo of [registry.launcher, ...registry.modules.map((m) => m.repo)]) {
    if (!isOrgRepo(repo)) throw new Error(`${repo} is outside ${ORG}; only org repos can be listed`);
  }

  const modules = [];
  for (const entry of registry.modules) {
    try {
      modules.push(await moduleEntry(entry));
    } catch (err) {
      // One broken module must not take the whole library down.
      console.warn(`::warning::${err.message}`);
    }
  }
  for (const p of planned) {
    if (modules.some((m) => m.id === p.id)) continue;
    modules.push({
      id: p.id, name: p.name, status: 'planned', tagline: p.tagline ?? '', features: [],
      version: null, releaseUrl: null, publishedAt: null, repo: null, game: null, files: [],
    });
  }

  const catalog = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    repo: `${ORG}/registry`,
    app: await launcherEntry(registry.launcher).catch((err) => {
      console.warn(`::warning::${err.message}`);
      return null;
    }),
    modules,
  };
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Wrote ${out}: launcher ${catalog.app?.version ?? '(unreleased)'}, ` +
    modules.map((m) => `${m.id} ${m.version ?? m.status}`).join(', '));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
