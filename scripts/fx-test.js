'use strict';
// Kiểm thử hiệu ứng cổ vũ: bắn đủ 76 id trong Chromium, kiểm tra lỗi JS và pixel được vẽ.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const ids = [...require('../main/react-ids.js')];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.setContent('<html><body style="margin:0;background:#000"><div id="c" style="position:relative;width:1920px;height:1080px"></div></body></html>');
  await page.addScriptTag({ path: path.join(root, 'renderer/reactions.js') });
  await page.evaluate(() => { window.fx = window.createReactions(document.getElementById('c')); });

  const have = await page.evaluate(() => window.fx.ids);
  const missing = ids.filter(i => !have.includes(i));
  const extra = have.filter(i => !ids.includes(i));
  console.log('ids trong react-ids:', ids.length, '| trong reactions.js:', have.length, '| thiếu:', missing.join(',') || '-', '| thừa:', extra.join(',') || '-');

  const shots = new Set(['heart', 'party', 'rocket', 'firework', 'dance', 'whale']);
  const bad = [];
  for (const id of ids) {
    await page.evaluate(i => window.fx.fire(i), id);
    await page.waitForTimeout(shots.has(id) ? 1100 : 450);
    const n = await page.evaluate(() => {
      const c = document.querySelector('canvas'), g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let k = 0;
      for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) k++;
      return k;
    });
    if (shots.has(id)) await page.screenshot({ path: '/tmp/fx-' + id + '.png' });
    if (n < 3) bad.push(id);
    await page.evaluate(() => window.fx.fire('nope')); // id lạ phải bị bỏ qua
    // dọn: chờ ngắn để các hiệu ứng không chồng quá nhiều
    await page.waitForTimeout(150);
  }
  const ok = ids.length - bad.length;
  console.log('có pixel:', ok + '/' + ids.length, bad.length ? '| rỗng: ' + bad.join(',') : '');

  // chờ vòng lặp dừng
  let stopped = false;
  for (let i = 0; i < 60 && !stopped; i++) {
    await page.waitForTimeout(500);
    stopped = !(await page.evaluate(() => window.fx.running));
  }
  console.log('vòng lặp dừng:', stopped);
  const left = await page.evaluate(() => window.fx.count);
  console.log('hạt còn lại:', left);
  console.log('lỗi JS:', errors.length ? errors.join('\n') : 'không');

  await browser.close();
  const pass = errors.length === 0 && ok / ids.length >= 0.9 && stopped && !missing.length;
  console.log(pass ? 'PASS' : 'FAIL');
  process.exit(pass ? 0 : 1);
})();
