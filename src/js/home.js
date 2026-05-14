// ── HOME v2 (Brand Book) ──
// 시안 4개 카테고리 → 기존 6개 매핑
const HV2_CAT_MAP = {
  '술자리': { type: '술자리', icon: '🍺', cond: { main: '상관없음' } },
  '밥집':   { type: '식사',   icon: '🥗', cond: { main: '한식' } },
  '카페':   { type: '카페',   icon: '☕', cond: { main: '음료 / 커피' } },
  '디저트': { type: '카페',   icon: '🍰', cond: { main: '디저트 전문' } },
};

const HV2_MAX = 6;

const HV2 = {
  selectedCats: [],
  pendingPlace: null,  // { lat, lng, label }
  mapInitTriggered: false,
};

function hv2Escape(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

function hv2EnsureMap() {
  if (HV2.mapInitTriggered) return;
  HV2.mapInitTriggered = true;
  if (typeof initMap === 'function') initMap();
}

function hv2UpdateCount() {
  const el = document.getElementById('hv2-count');
  if (el) el.textContent = S.pins.length;
}

function hv2UpdateAddBtn() {
  const btn = document.getElementById('hv2-add-btn');
  if (!btn) return;
  const max = S.pins.length >= HV2_MAX;
  btn.disabled = !(HV2.pendingPlace && !max);
}

function hv2UpdateCta() {
  const okPins = S.pins.length >= 2;
  const okCat = HV2.selectedCats.length >= 1;
  const cta = document.getElementById('hv2-cta');
  if (cta) cta.disabled = !(okPins && okCat);
}

function hv2RenderPinList() {
  const list = document.getElementById('hv2-pin-list');
  if (!list) return;
  list.innerHTML = '';
  S.pins.forEach((p, i) => {
    const initial = (p.name || p.label || '?').trim().charAt(0) || '?';
    const el = document.createElement('div');
    el.className = 'hv2-pin-item';
    el.innerHTML = `
      <span class="hv2-pin-avatar">${hv2Escape(initial)}</span>
      <div class="hv2-pin-text">
        <span class="hv2-pin-name">${hv2Escape(p.name || '참가자')}</span>
        <span class="hv2-pin-place">📍 ${hv2Escape(p.label)}</span>
      </div>
      <button class="hv2-pin-del" onclick="hv2Remove(${i})" aria-label="삭제">✕</button>
    `;
    list.appendChild(el);
  });
  hv2UpdateCount();
}

// ── 검색 (Google Places Autocomplete 재사용)
function homeSearch(val) {
  clearTimeout(searchTimer);
  const list = document.getElementById('hv2-ac-list');
  if (!list) return;
  if (!val.trim()) { list.classList.remove('show'); HV2.pendingPlace = null; hv2UpdateAddBtn(); return; }

  if (!acSvc) {
    hv2EnsureMap();
    setTimeout(() => homeSearch(val), 700);
    return;
  }

  searchTimer = setTimeout(() => {
    acSvc.getPlacePredictions(
      { input: val, componentRestrictions: { country: 'kr' }, language: 'ko' },
      (preds, st) => {
        list.innerHTML = '';
        if (st !== 'OK' || !preds) { list.classList.remove('show'); return; }
        preds.slice(0, 5).forEach(p => {
          const el = document.createElement('div');
          el.className = 'hv2-ac-item';
          const main = p.structured_formatting?.main_text || p.description;
          const sub = p.structured_formatting?.secondary_text || '';
          const isStation = main.includes('역');
          el.innerHTML = `<span class="hv2-ac-ico">${isStation ? '🚇' : '📍'}</span>
            <div><div class="hv2-ac-main">${hv2Escape(main)}</div>
            <div class="hv2-ac-sub">${hv2Escape(sub)}</div></div>`;
          el.onclick = () => hv2PickPlace(p.place_id, main);
          list.appendChild(el);
        });
        list.classList.add('show');
      }
    );
  }, 250);
}

function hv2PickPlace(placeId, name) {
  if (S.pins.length >= HV2_MAX) {
    if (typeof toast === 'function') toast('최대 6명까지 가능해요.');
    return;
  }
  placesSvc.getDetails({ placeId, fields: ['geometry'] }, (place, st) => {
    if (st !== 'OK' || !place?.geometry?.location) return;
    HV2.pendingPlace = {
      lat: place.geometry.location.lat(),
      lng: place.geometry.location.lng(),
      label: name,
    };
    const inp = document.getElementById('hv2-place-inp');
    if (inp) inp.value = name;
    document.getElementById('hv2-ac-list').classList.remove('show');
    hv2UpdateAddBtn();
  });
}

function homeAdd() {
  if (!HV2.pendingPlace || S.pins.length >= HV2_MAX) return;
  const nameInp = document.getElementById('hv2-name-inp');
  const name = (nameInp.value || '').trim() || `참가자${S.pins.length + 1}`;
  const { lat, lng, label } = HV2.pendingPlace;
  S.pins.push({ lat, lng, label, count: 1, name });
  HV2.pendingPlace = null;
  nameInp.value = '';
  document.getElementById('hv2-place-inp').value = '';
  hv2RenderPinList();
  hv2UpdateAddBtn();
  hv2UpdateCta();
}

function hv2Remove(i) {
  S.pins.splice(i, 1);
  hv2RenderPinList();
  hv2UpdateCta();
}

function hv2BindChips() {
  document.querySelectorAll('.hv2-chip').forEach(chip => {
    chip.onclick = () => {
      const cat = chip.dataset.cat;
      const idx = HV2.selectedCats.indexOf(cat);
      if (idx >= 0) { HV2.selectedCats.splice(idx, 1); chip.classList.remove('sel'); }
      else { HV2.selectedCats.push(cat); chip.classList.add('sel'); }
      hv2UpdateCta();
    };
  });
}

function homeStart() {
  if (S.pins.length < 2 || HV2.selectedCats.length === 0) return;
  const primary = HV2.selectedCats[0];
  const m = HV2_CAT_MAP[primary] || HV2_CAT_MAP['밥집'];
  S.type = m.type;
  S.typeIcon = m.icon;
  S.condition = m.cond;
  S.count = S.pins.reduce((s, p) => s + (p.count || 1), 0);
  if (typeof getRecommend === 'function') getRecommend();
}

window.addEventListener('DOMContentLoaded', () => {
  hv2BindChips();
  hv2RenderPinList();
  hv2UpdateAddBtn();
  hv2UpdateCta();
});
