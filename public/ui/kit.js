const root = document.documentElement;
document.querySelector('#theme').addEventListener('change', (event) => {
  if (event.target.value === 'system') delete root.dataset.theme;
  else root.dataset.theme = event.target.value;
});
document.querySelector('#contrast').addEventListener('click', (event) => {
  const enabled = event.currentTarget.getAttribute('aria-pressed') !== 'true';
  event.currentTarget.setAttribute('aria-pressed', String(enabled));
  if (enabled) root.dataset.contrast = 'high';
  else delete root.dataset.contrast;
});
document.querySelector('#density').addEventListener('change', (event) => {
  const [height, padding, font] = { default: [40, 16, 15], compact: [32, 12, 13], marketing: [50, 22, 16] }[event.target.value];
  const style = document.querySelector('#component-preview').style;
  style.setProperty('--ui-control-height', `${height}px`);
  style.setProperty('--ui-control-padding', `${padding}px`);
  style.setProperty('--ui-control-font', `${font}px`);
});
document.querySelector('#copy').addEventListener('click', async () => {
  const code = document.querySelector('.code-block code').textContent;
  try {
    await navigator.clipboard.writeText(code);
    document.querySelector('#copy-status').textContent = 'Copied to clipboard.';
  } catch {
    document.querySelector('#copy-status').textContent = 'Select the example code to copy it manually.';
  }
});
