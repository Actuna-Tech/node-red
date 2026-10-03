/**
 * Records the flow layout demo video (design/flow-layout/node-red-flow-layout-demo.mp4).
 *
 * Developed by Actuna Sp. z o.o. (Wojciech Repiński), with AI-assisted development.
 *
 * Usage:
 *   mkdir -p /tmp/demo-ud && cp demo-flows.json /tmp/demo-ud/flows.json
 *   node packages/node_modules/node-red/red.js -u /tmp/demo-ud &
 *   node design/flow-layout/demo/record-demo.js /tmp/demo-video
 *   ffmpeg -i /tmp/demo-video/*.webm -c:v libx264 -crf 23 -pix_fmt yuv420p demo.mp4
 *
 * Requires Playwright (npm install --no-save playwright). Set NODE_RED_URL to use
 * a different editor address.
 */
const { chromium } = require('playwright');
const out = process.argv[2];
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: out, size: { width: 1280, height: 720 } } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      const c = document.createElement('div');
      c.id = 'demo-cursor';
      c.style.cssText = 'position:fixed;z-index:100000;width:18px;height:18px;border-radius:50%;background:rgba(220,40,40,.55);border:2px solid #fff;box-shadow:0 0 4px #000;pointer-events:none;left:-50px;top:-50px;transform:translate(-50%,-50%);transition:width .1s,height .1s';
      document.body.appendChild(c);
      document.addEventListener('mousemove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
      document.addEventListener('mousedown', () => { c.style.width = c.style.height = '26px'; }, true);
      document.addEventListener('mouseup', () => { c.style.width = c.style.height = '18px'; }, true);
      const cap = document.createElement('div');
      cap.id = 'demo-caption';
      cap.style.cssText = 'position:fixed;z-index:100001;left:50%;bottom:28px;transform:translateX(-50%);background:rgba(20,20,30,.85);color:#fff;font:600 20px sans-serif;padding:10px 22px;border-radius:8px;pointer-events:none;display:none;max-width:90%;text-align:center';
      document.body.appendChild(cap);
    });
  });
  const caption = async (text, ms = 2200) => {
    await p.evaluate(t => { const c = document.getElementById('demo-caption'); c.textContent = t; c.style.display = t ? 'block' : 'none'; }, text);
    if (ms) await p.waitForTimeout(ms);
  };
  const center = async sel => { const b = await (await p.$(sel)).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const moveTo = async (x, y, steps = 25) => { await p.mouse.move(x, y, { steps }); };
  const clickSel = async sel => { const [x, y] = await center(sel); await moveTo(x, y); await p.waitForTimeout(250); await p.mouse.click(x, y); };
  const editFlowLayout = async (layout, wire) => {
    const tab = await center('#red-ui-tab-d1 .red-ui-tab-label');
    await moveTo(tab[0], tab[1]);
    await p.mouse.dblclick(tab[0], tab[1]);
    await p.waitForSelector('#node-input-flow-layout', { state: 'visible' });
    await p.waitForTimeout(700);
    if (layout !== null) { await clickSel('#node-input-flow-layout'); await p.selectOption('#node-input-flow-layout', layout); await p.waitForTimeout(900); }
    if (wire !== null) { await clickSel('#node-input-flow-wire-style'); await p.selectOption('#node-input-flow-wire-style', wire); await p.waitForTimeout(900); }
    await clickSel('#node-dialog-ok');
    await p.waitForTimeout(600);
  };

  await p.goto(process.env.NODE_RED_URL || 'http://127.0.0.1:1880/');
  await p.waitForSelector('.red-ui-flow-node-group', { timeout: 30000 });
  await p.waitForTimeout(800);
  const no = await p.$('text=No, do not enable notifications'); if (no) await no.click();
  await p.evaluate(() => { RED.actions.invoke('core:toggle-sidebar', false); RED.actions.invoke('core:toggle-palette', false); });
  await p.waitForTimeout(500);

  await caption('Node-RED — nowe układy flow (Actuna Sp. z o.o.)', 2500);
  await caption('Dotychczasowy układ: lewo → prawo', 2500);

  await caption('Właściwości flow → Layout: Top to bottom', 0);
  await editFlowLayout('TB', null);
  await caption('Wejścia u góry, wyjścia u dołu, linie dopasowane do układu', 3000);

  await caption('Linia wstecz (wait → router) omija węzły', 2500);

  await caption('Styl linii: kąty proste (auto-routing)', 0);
  await editFlowLayout(null, 'orthogonal');
  await p.waitForTimeout(2500);

  await caption('Przeciąganie nowej linii w układzie góra → dół', 0);
  const from = await center('#a3 .red-ui-flow-port-output .red-ui-flow-port');
  const to = await center('#a2 .red-ui-flow-port-input .red-ui-flow-port');
  await moveTo(from[0], from[1]);
  await p.waitForTimeout(300);
  await p.mouse.down();
  await moveTo(from[0] - 60, from[1] + 80, 30);
  await moveTo(to[0] + 40, to[1] - 40, 30);
  await moveTo(to[0], to[1], 15);
  await p.mouse.up();
  await p.waitForTimeout(1800);

  await caption('Powrót do linii krzywych', 0);
  await editFlowLayout(null, 'curved');
  await p.waitForTimeout(1500);

  await caption('Orientację można ustawić też dla pojedynczego węzła (menu kontekstowe)', 0);
  const nodeC = await center('#a4 .red-ui-flow-node');
  await moveTo(nodeC[0], nodeC[1]);
  await p.mouse.click(nodeC[0], nodeC[1]);
  await p.waitForTimeout(300);
  await p.mouse.click(nodeC[0], nodeC[1], { button: 'right' });
  await p.waitForTimeout(700);
  const nodeMenu = p.locator('a:visible').filter({ hasText: /^Node$/ }).first();
  const nb = await nodeMenu.boundingBox();
  await moveTo(nb.x + 20, nb.y + nb.height / 2, 15);
  await p.waitForTimeout(700);
  const item = p.locator('a:visible').filter({ hasText: /^Ports: left to right$/ }).first();
  const ib = await item.boundingBox();
  await moveTo(nb.x + nb.width + 10, nb.y + nb.height / 2, 10);
  await moveTo(ib.x + 30, ib.y + ib.height / 2, 15);
  await p.waitForTimeout(500);
  await p.mouse.click(ib.x + 30, ib.y + ib.height / 2);
  await p.waitForTimeout(400);
  await p.mouse.click(1000, 600);
  await caption('„out C” ma teraz porty lewo → prawo, reszta flow góra → dół', 3000);

  await caption('Tryb automatyczny: orientacja wynika z położenia połączeń', 0);
  const t2 = await center('#red-ui-tab-d2 .red-ui-tab-label');
  await moveTo(t2[0], t2[1]);
  await p.mouse.click(t2[0], t2[1]);
  await p.waitForTimeout(2500);
  await caption('Przesuwam „out C” pod router — porty przełączają się na pionowe', 0);
  const n = await center('#b4 .red-ui-flow-node');
  const r = await center('#b1 .red-ui-flow-node');
  await moveTo(n[0], n[1]);
  await p.mouse.down();
  await moveTo(n[0] - 60, n[1] + 120, 30);
  await moveTo(r[0] + 150, r[1] + 300, 30);
  await p.mouse.up();
  await p.mouse.click(1000, 650);
  await p.waitForTimeout(2500);

  await caption('Domyślny układ dla edytora: Settings → View → Flow layout', 0);
  await p.evaluate(() => RED.actions.invoke('core:show-user-settings'));
  await p.waitForSelector('#user-settings-view-flow-layout', { state: 'visible' });
  await p.evaluate(() => document.getElementById('user-settings-view-flow-layout').scrollIntoView({ block: 'center' }));
  await p.waitForTimeout(400);
  const s = await center('#user-settings-view-flow-layout');
  await moveTo(s[0], s[1]);
  await p.waitForTimeout(3000);
  const closeBtn = p.locator('button:visible', { hasText: /^Close$/ }).first();
  const cb = await closeBtn.boundingBox();
  await moveTo(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await p.waitForTimeout(300);
  await closeBtn.click();
  await p.waitForTimeout(800);
  await caption('Developed by Actuna Sp. z o.o. — Wojciech Repiński, z użyciem AI', 3000);

  console.log('errors', JSON.stringify(errors));
  await ctx.close();
  await browser.close();
})();
