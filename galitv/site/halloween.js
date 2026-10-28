// Halloween patch for gali.lol and tv.gali.lol. Self-contained: it adds its own styles and pixel art.
// On from 15 Oct to 2 Nov (visitor's local date). ?halloween=1 forces it on, ?halloween=0 off.
// Decorations never take clicks except the pumpkins, which cackle and let bats out.
(() => {
  const q = new URLSearchParams(location.search).get('halloween');
  const now = new Date(), m = now.getMonth(), d = now.getDate();
  const season = (m === 9 && d >= 15) || (m === 10 && d <= 2);
  if (q === '0' || (!season && q !== '1')) return;

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = matchMedia('(max-width: 720px)').matches;
  const tv = Boolean(document.querySelector('.wordmark')); // tv.gali.lol; otherwise the waitlist page

  /* ---------- pixel sprites: one character per pixel ---------- */
  const PAL = {
    o: '#ff8a1f', d: '#c95a0c', g: '#4f9a3a', y: '#ffe36b', k: '#1b1020', r: '#ff5a2a', w: '#f4ecff', s: '#c9b5ff', b: '#2a1a33',
  };
  function sprite(rows, px = 1) {
    const h = rows.length, w = rows[0].length;
    let rects = '';
    rows.forEach((row, y) => [...row].forEach((c, x) => { if (PAL[c]) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${PAL[c]}"/>`; }));
    return `<svg viewBox="0 0 ${w} ${h}" width="${w * px}" height="${h * px}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
  }
  const PUMPKIN = [
    '......gg......',
    '.....gg.......',
    '..odoooooodo..',
    '.ooodoooodooo.',
    'oooyyoooyyoooo',
    'ooyyyoooyyyooo',
    'ooooooyooooooo',
    'oyooooooooooyo',
    'ooyyyyyyyyyyoo',
    'oooyyoyyoyyooo',
    '.ooodoooodooo.',
    '..oooooooooo..',
  ];
  const BAT_UP = [
    'bb...b.b...bb',
    'bbb..bbb..bbb',
    '.bbbbrbrbbbb.',
    '..bbbbbbbbb..',
    '......b......',
    '.............',
  ];
  const BAT_DOWN = [
    '.....b.b.....',
    '.....bbb.....',
    '..bbbrbrbbb..',
    '.bbbbbbbbbbb.',
    'bbb.......bbb',
    'bb.........bb',
  ];
  const GHOST = [
    '...wwwww...',
    '..wwwwwww..',
    '.wwwwwwwww.',
    '.wwkwwwkww.',
    '.wwkwwwkww.',
    '.wwwwwwwww.',
    '.wwwwkkwww.',
    '.wwwwkkwww.',
    '.wwwwwwwww.',
    '.wswwswwsw.',
    '.w..w..w.w.',
  ];
  const SPIDER = [
    '.b...b.',
    'b.bbb.b',
    '.bbrbb.',
    'b.bbb.b',
    '.b...b.',
  ];

  /** A quarter cobweb from the top-left corner; the right one is mirrored. */
  function web(size) {
    const spokes = [0, 18, 36, 54, 72, 90].map((a) => (a * Math.PI) / 180);
    const pt = (r, a) => [Math.cos(a) * r, Math.sin(a) * r];
    let path = spokes.map((a) => { const [x, y] = pt(size, a); return `M0 0L${x.toFixed(1)} ${y.toFixed(1)}`; }).join('');
    for (const r of [size * 0.24, size * 0.46, size * 0.7, size * 0.94]) {
      for (let i = 0; i < spokes.length - 1; i++) {
        const [x1, y1] = pt(r, spokes[i]), [x2, y2] = pt(r, spokes[i + 1]), [cx, cy] = pt(r * 0.86, (spokes[i] + spokes[i + 1]) / 2);
        path += `M${x1.toFixed(1)} ${y1.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
      }
    }
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><path d="${path}" fill="none" stroke="rgba(244,236,255,.5)" stroke-width="1.2"/></svg>`;
  }

  /* ---------- styles ---------- */
  const css = `
.hw-layer{position:fixed;inset:0;pointer-events:none;z-index:40;overflow:hidden}
.hw-web{position:absolute;pointer-events:none;z-index:2;opacity:.75}
.hw-web.r{right:0;transform:scaleX(-1)}
.hw-web.l{left:0}
.hw-spider{position:absolute;right:${small ? 34 : 52}px;z-index:2;pointer-events:none;display:flex;flex-direction:column;align-items:center;animation:hw-drop 7s ease-in-out infinite}
.hw-spider i{width:1px;height:var(--thread,70px);background:rgba(244,236,255,.55)}
.hw-fog{position:fixed;left:-10%;right:-10%;bottom:-20px;height:${small ? 90 : 140}px;pointer-events:none;z-index:39;opacity:.55;
  background:radial-gradient(40% 70% at 20% 100%,rgba(140,90,200,.55),transparent 70%),radial-gradient(35% 60% at 60% 100%,rgba(255,138,31,.25),transparent 70%),radial-gradient(40% 70% at 90% 100%,rgba(140,90,200,.5),transparent 70%);
  animation:hw-fog 18s ease-in-out infinite alternate}
.hw-bat{position:absolute;left:0;top:0;animation:hw-fly var(--t,9s) linear forwards}
.hw-bat>div{animation:hw-bob 1.1s ease-in-out infinite alternate}
.hw-bat svg{display:block;filter:drop-shadow(0 0 3px rgba(255,138,31,.55))}
.hw-bat svg+svg{position:absolute;inset:0}
.hw-bat svg:first-child{animation:hw-flap .28s steps(1) infinite}
.hw-bat svg+svg{animation:hw-flap .28s steps(1) infinite reverse}
.hw-ghost{position:absolute;left:0;top:0;opacity:0;animation:hw-ghost 14s ease-in-out forwards}
.hw-ghost svg{display:block;filter:drop-shadow(0 0 10px rgba(201,181,255,.7))}
.hw-pumpkin{position:absolute;z-index:6;pointer-events:auto;cursor:pointer;border:0;padding:0;background:none;line-height:0;animation:hw-candle 2.4s steps(6) infinite}
.hw-pumpkin:hover{transform:translateY(-2px) rotate(-4deg)}
.hw-pumpkin.cackle{animation:hw-cackle .5s steps(4) 2}
.hw-pumpkin:focus-visible{outline:3px solid #ffc83d;outline-offset:3px}
.hw-chip{display:inline-flex;align-items:center;gap:8px;padding:6px 10px 5px;background:#2a1530;color:#ffb347;font:400 12px/1 "Silkscreen",ui-monospace,monospace;letter-spacing:1px;
  box-shadow:inset 0 0 0 2px #ff8a1f,0 0 14px rgba(255,138,31,.35);vertical-align:middle}
.hw-chip svg{flex:none}
${tv ? `.moon{box-shadow:16px -6px 0 0 #ffb347!important;filter:drop-shadow(0 0 26px rgba(255,138,31,.55))!important}
.set.phone .hw-pumpkin.b{display:none}` : `.herologo{position:relative}`}
@keyframes hw-flap{50%{opacity:0}}
@keyframes hw-bob{to{transform:translateY(14px)}}
@keyframes hw-fly{from{transform:translate(var(--x0),var(--y0))}to{transform:translate(var(--x1),var(--y1))}}
@keyframes hw-ghost{0%{transform:translate(var(--x0),var(--y0));opacity:0}12%{opacity:.85}50%{transform:translate(calc((var(--x0) + var(--x1)) / 2),calc(var(--y0) - 40px))}88%{opacity:.85}100%{transform:translate(var(--x1),var(--y0));opacity:0}}
@keyframes hw-fog{to{transform:translateX(6%)}}
@keyframes hw-drop{0%,100%{--thread:40px}50%{--thread:110px}}
@property --thread{syntax:'<length>';inherits:true;initial-value:70px}
@keyframes hw-candle{0%,100%{filter:drop-shadow(0 0 6px rgba(255,180,60,.75))}33%{filter:drop-shadow(0 0 11px rgba(255,150,40,.95))}66%{filter:drop-shadow(0 0 4px rgba(255,180,60,.6))}}
@keyframes hw-cackle{0%,100%{transform:rotate(0)}25%{transform:rotate(-10deg) scale(1.15);filter:drop-shadow(0 0 18px #ffe36b) brightness(1.3)}75%{transform:rotate(10deg) scale(1.15)}}
@media (prefers-reduced-motion:reduce){.hw-pumpkin,.hw-spider,.hw-fog,.hw-bat>div{animation:none}}
`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);

  /* ---------- fixed layer: fog, bats, ghost ---------- */
  const layer = document.createElement('div');
  layer.className = 'hw-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.append(layer);
  const fog = document.createElement('div');
  fog.className = 'hw-fog';
  fog.setAttribute('aria-hidden', 'true');
  document.body.append(fog);

  /* ---------- cobwebs and a spider, hung just under the header ---------- */
  const head = document.querySelector('header.topbar, header.top');
  const headBottom = head ? Math.round(head.getBoundingClientRect().bottom + scrollY) + 6 : 0;
  const webSize = small ? 72 : 112;
  for (const side of ['l', 'r']) {
    const w = document.createElement('div');
    w.className = `hw-web ${side}`;
    w.style.top = `${headBottom}px`;
    w.style.position = 'absolute';
    w.innerHTML = web(webSize);
    document.body.append(w);
  }
  const spider = document.createElement('div');
  spider.className = 'hw-spider';
  spider.style.top = `${headBottom + 2}px`;
  spider.innerHTML = `<i></i>${sprite(SPIDER, small ? 3 : 4)}`;
  document.body.append(spider);
  if (getComputedStyle(document.body).position === 'static') document.body.style.position = 'relative';

  /* ---------- bats and ghosts ---------- */
  const rnd = (a, b) => a + Math.random() * (b - a);
  function flock(n = small ? 2 : 3) {
    if (still) return;
    const ltr = Math.random() < 0.5, W = innerWidth, H = innerHeight;
    for (let i = 0; i < n; i++) {
      const b = document.createElement('div');
      b.className = 'hw-bat';
      const y = rnd(H * 0.08, H * 0.5);
      const px = small ? 3 : rnd(3, 5) | 0;
      b.style.cssText = `--t:${rnd(7, 11).toFixed(1)}s;--x0:${ltr ? -80 : W + 20}px;--x1:${ltr ? W + 40 : -120}px;--y0:${y}px;--y1:${y + rnd(-90, 90)}px;animation-delay:${(i * rnd(0.3, 0.9)).toFixed(2)}s`;
      b.innerHTML = `<div style="position:relative;transform:${ltr ? 'none' : 'scaleX(-1)'}">${sprite(BAT_UP, px)}${sprite(BAT_DOWN, px)}</div>`;
      layer.append(b);
      b.addEventListener('animationend', (e) => { if (e.target === b) b.remove(); });
    }
  }
  function ghost() {
    if (still) return;
    const g = document.createElement('div');
    g.className = 'hw-ghost';
    const ltr = Math.random() < 0.5, W = innerWidth;
    g.style.cssText = `--x0:${ltr ? -60 : W + 10}px;--x1:${ltr ? W + 20 : -80}px;--y0:${rnd(innerHeight * 0.2, innerHeight * 0.6)}px`;
    g.innerHTML = sprite(GHOST, small ? 4 : 6);
    layer.append(g);
    g.addEventListener('animationend', () => g.remove());
  }
  const loop = (fn, a, b) => { const tick = () => { if (!document.hidden) fn(); setTimeout(tick, rnd(a, b)); }; setTimeout(tick, rnd(a / 3, a)); };
  loop(flock, 9000, 18000);
  loop(ghost, 22000, 40000);

  /* ---------- jack-o'-lanterns: click one and it cackles ---------- */
  function pumpkin(where, cls, px, label) {
    const p = document.createElement('button');
    p.type = 'button';
    p.className = `hw-pumpkin ${cls}`;
    p.setAttribute('aria-label', label);
    p.innerHTML = sprite(PUMPKIN, px);
    p.addEventListener('click', (e) => {
      e.stopPropagation();
      p.classList.remove('cackle');
      void p.offsetWidth;
      p.classList.add('cackle');
      flock(small ? 3 : 5);
    });
    where.append(p);
    return p;
  }

  /* ---------- a spooky-season tag ---------- */
  function chip(text) {
    const c = document.createElement('span');
    c.className = 'hw-chip';
    c.innerHTML = `${sprite(PUMPKIN, 1.5)}${text}`;
    return c;
  }

  if (tv) {
    const set = document.getElementById('set');
    if (set) {
      const a = pumpkin(set, 'a', small ? 3 : 4, 'Jack-o-lantern on the TV');
      a.style.cssText = `top:${small ? -34 : -46}px;left:${small ? 10 : 26}px`;
      const b = pumpkin(set, 'b', small ? 2 : 3, 'Little jack-o-lantern on the TV');
      b.style.cssText = `top:${small ? -24 : -34}px;right:${small ? 14 : 32}px`;
    }
    document.querySelector('.wordmark')?.append(chip('SPOOKY SEASON'));
  } else {
    const logo = document.querySelector('.herologo');
    if (logo) {
      const p = pumpkin(logo, 'a', small ? 4 : 6, 'Jack-o-lantern on the Gali logo');
      p.style.cssText = 'top:-4%;right:-1%';
    }
    const tag = document.querySelector('.hero .tag');
    if (tag) {
      const c = chip('SPOOKY SEASON ON GALI ISLAND');
      c.style.margin = '10px 0 4px';
      tag.after(c);
    }
  }
})();
