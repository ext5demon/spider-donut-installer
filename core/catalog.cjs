const fs = require('node:fs/promises');
const path = require('node:path');
const config = require('../config.json');

async function github(endpoint) {
  const response = await fetch('https://api.github.com/repos/' + config.repository + endpoint, {
    headers: { 'User-Agent': 'Spider-Donut-Installer', Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(response.status === 403 ? 'GitHub is limiting requests. Please try again later.' : `GitHub could not be reached (${response.status}).`);
  return response.json();
}

class Catalog {
  constructor(cache) { this.cache = cache; }
  async list(refresh = false) {
    try {
      const releases = (await github('/releases?per_page=100')).filter(r => !r.draft && /^v\d+\.\d+(?:\.\d+)?$/.test(r.tag_name));
      if (!releases.length) throw new Error('No supported beta source releases are available.');
      const result = { releases: releases.map(r => ({ tag: r.tag_name, name: r.name || r.tag_name, date: r.published_at, notes: r.body || '' })), checkedAt: new Date().toISOString(), cached: false };
      await fs.mkdir(path.dirname(this.cache), { recursive: true });
      await fs.writeFile(this.cache, JSON.stringify(result));
      return result;
    } catch (error) {
      if (!refresh) {
        try { const saved = JSON.parse(await fs.readFile(this.cache, 'utf8')); return { ...saved, cached: true }; } catch {}
      }
      throw error;
    }
  }
  async resolve(ref) {
    if (typeof ref !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/.test(ref) || ref.includes('..')) throw new Error('Invalid source revision.');
    const commit = await github('/commits/' + encodeURIComponent(ref));
    if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw new Error('GitHub returned an invalid source commit.');
    return { commit: commit.sha, date: commit.commit.committer.date.slice(0, 10), url: `https://codeload.github.com/${config.repository}/tar.gz/${commit.sha}` };
  }
}
module.exports = { Catalog };
