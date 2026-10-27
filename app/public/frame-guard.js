// Gali never runs inside another site's frame: a framed copy could trick a player into approving wallet prompts.
if (window.top !== window.self) {
  try {
    window.top.location.replace(window.self.location.href);
  } catch (e) {
    document.documentElement.style.display = 'none';
  }
}
