'use strict';
const crypto = require('crypto');
const os = require('os');

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function thumb(id) { return 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg'; }

function newToken() { return crypto.randomBytes(16).toString('base64url'); }

function constEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Trả về id video 11 ký tự hoặc null. Kiểm tra host chính xác. */
function parseVideoId(input) {
  const s = String(input || '').trim();
  if (ID_RE.test(s)) return s;
  let u;
  try { u = new URL(s.includes('://') ? s : 'https://' + s); } catch (e) { return null; }
  const host = u.hostname.toLowerCase();
  if (!(host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com'))) return null;
  const segs = u.pathname.split('/').filter(Boolean);
  const first = segs[0] || '';
  let cand;
  if (host === 'youtu.be') cand = segs[0];
  else if (first === 'watch') cand = u.searchParams.get('v');
  else if (['shorts', 'embed', 'live', 'v'].includes(first)) cand = segs[1];
  else cand = u.searchParams.get('v');
  return cand && ID_RE.test(cand) ? cand : null;
}

/** Bỏ ký tự điều khiển, gộp khoảng trắng, cắt độ dài. */
function clean(x, max) {
  return String(x == null ? '' : x)
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}

function norm(x) {
  return String(x || '').toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/đ/g, 'd');
}

/** IPv4 LAN ưu tiên Wi-Fi/Ethernet, bỏ qua card ảo (VMware, VirtualBox, WSL, Hyper-V...). */
function lanIp() {
  const nets = os.networkInterfaces();
  const bad = /virtual|vmware|vbox|hyper-v|vethernet|wsl|docker|loopback|bluetooth|tailscale|zerotier/i;
  let best = null;
  for (const name of Object.keys(nets)) {
    if (bad.test(name)) continue;
    for (const n of nets[name] || []) {
      if (n.family !== 'IPv4' || n.internal) continue;
      if (n.address.startsWith('169.254.')) continue;
      const score = /^192\.168\./.test(n.address) ? 3 : /^10\./.test(n.address) ? 2 : 1;
      if (!best || score > best.score) best = { ip: n.address, score, name };
    }
  }
  return best ? best.ip : null;
}

/** Loại mạng để hiện trên thanh trên cùng. */
function netInfo() {
  const nets = os.networkInterfaces();
  const ip = lanIp();
  if (!ip) return { ip: null, text: 'Offline', icon: 'wifi' };
  for (const name of Object.keys(nets)) {
    if ((nets[name] || []).some(n => n.family === 'IPv4' && n.address === ip)) {
      if (/wi-?fi|wlan|wireless/i.test(name)) return { ip, text: 'Wi-Fi', icon: 'wifi' };
      return { ip, text: 'Mạng LAN', icon: 'lan' };
    }
  }
  return { ip, text: 'Có mạng', icon: 'wifi' };
}

module.exports = { netInfo, ID_RE, ApiError, thumb, newToken, constEq, parseVideoId, clean, norm, lanIp };
