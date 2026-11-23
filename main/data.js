'use strict';
const { clean, ID_RE } = require('./util');

const DEFAULT_CATS = [
  { name: 'Acoustic & Hòa Tấu', q: 'nhạc acoustic hòa tấu', custom: false },
  { name: 'Saxophone Jazz', q: 'saxophone jazz thư giãn', custom: false },
  { name: 'Chill & Lofi Beats', q: 'chill lofi beats', custom: false },
  { name: 'Nhạc Trẻ & EDM', q: 'nhạc trẻ edm remix', custom: false },
  { name: 'Trữ Tình Quê Hương', q: 'nhạc trữ tình quê hương', custom: false }
];

const Cats = {
  defaults() { return DEFAULT_CATS.map(c => ({ ...c })); },
  load(store) {
    const raw = store.get('cats2', null);
    if (Array.isArray(raw)) {
      return raw.filter(o => o && o.name && o.q).map(o => ({ name: String(o.name), q: String(o.q), custom: o.custom !== false }));
    }
    return Cats.defaults();
  },
  save(store, list) { store.set('cats2', list); },
  toJson(list) { return list.map((c, i) => ({ index: i, name: c.name, q: c.q, custom: c.custom })); }
};

const Favs = {
  MAX: 300,
  load(store) {
    const raw = store.get('favs', []);
    const out = [];
    if (Array.isArray(raw)) {
      for (const o of raw) {
        if (o && o.videoId && !out.some(x => x.videoId === o.videoId)) {
          out.push({ videoId: o.videoId, title: o.title || '', channel: o.channel || '', durationSec: o.durationSec | 0 });
        }
      }
    }
    return out;
  },
  save(store, list) { store.set('favs', list.slice(0, Favs.MAX)); }
};

module.exports = { Cats, Favs, clean, ID_RE };
