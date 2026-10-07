// Run in the mainnet local preview's browser console. State fixtures only: no wallet calls/signing.
(async () => {
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const wait = () => new Promise(resolve => setTimeout(resolve, 1000));
  const leaf = text => [...document.querySelectorAll('*')].find(e => !e.childElementCount && e.textContent === text && e.closest('[aria-modal="true"]'));
  const visible = el => {
    if (!el || el.closest('[aria-hidden="true"]')) return false;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.top < 0 || r.bottom > innerHeight) return false;
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit === el || el.contains(hit);
  };
  const click = label => {
    const el = [...document.querySelectorAll('[role="button"]')].find(e => e.getAttribute('aria-label') === label && e.closest('[aria-modal="true"]'));
    check(el, `Missing button: ${label}`); el.scrollIntoView({ block: 'center' }); el.click();
  };
  check(document.visibilityState === 'visible', 'Activate the isolated browser tab so native web animations run');
  check(window.__gali && window.__galiWorld, 'Run against the Gali local preview');
  const close = document.querySelector('[aria-modal="true"] [aria-label="Close"]');
  if (close) { close.click(); await wait(); }
  __gali.setState(s => ({ loaded: true, save: { ...s.save, onboarded: true }, liveNotice: false, walletPicker: null,
    wallet: { ...s.wallet, owner: null, busy: 'Audit pending wallet' }, toasts: [{ id: 999, text: 'Audit wallet connection failed', tone: 'bad' }] }));
  await wait();
  check(visible(leaf('Audit pending wallet')), 'Wallet busy must be visible inside the wallet modal, not behind it');
  __gali.setState(s => ({ wallet: { ...s.wallet, busy: null } }));
  await wait();
  check(visible(leaf('Audit wallet connection failed')), 'Connection failure must be visible inside the wallet modal');
  const connect = [...document.querySelectorAll('[role="button"]')].find(e => e.textContent === 'Connect wallet');
  check(connect && connect.getAttribute('aria-disabled') !== 'true', 'Connection can be retried');
  check(!Object.values(__galiWorld.getState().peers).some(p => p.bot), 'Mainnet guests must not simulate practice bots');
  check(!document.body.innerText.includes('expedition') && ![...document.querySelectorAll('[role="button"]')].some(e => /dig/i.test(e.getAttribute('aria-label') || '')), 'Dig game must not be offered before a wallet connects');
  __gali.setState(s => ({ wallet: { ...s.wallet, busy: null }, toasts: [] }));
  return 'PASS browser: modal busy/error visibility, retry, no guest bots, no dig game before wallet connect';
})()
