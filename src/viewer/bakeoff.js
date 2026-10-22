// Side-by-side PPTX renderer comparison. Loads one local .pptx and renders it through both
// renderers by pointing two viewer iframes at the same blob with a ?renderer= override, so the
// comparison uses the exact same code path the product uses.

const pick = document.getElementById('btn-pick');
const input = document.getElementById('file-input');
const frameAiden = document.getElementById('frame-aiden');
const frameOrdalie = document.getElementById('frame-ordalie');

let currentUrl = null;

pick.addEventListener('click', () => input.click());

input.addEventListener('change', () => {
  const file = input.files?.[0];
  if (!file) return;
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = URL.createObjectURL(file);

  const viewer = chrome.runtime.getURL('viewer/viewer.html');
  const name = encodeURIComponent(file.name);
  // `src` must come last — the viewer reads everything after `src=` as the raw URL.
  frameAiden.src = `${viewer}?renderer=aiden0z&name=${name}&src=${currentUrl}`;
  frameOrdalie.src = `${viewer}?renderer=ordalie&name=${name}&src=${currentUrl}`;
  input.value = '';
});
