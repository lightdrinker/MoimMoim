function onSearch(val) {
  clearTimeout(searchTimer);
  const list = document.getElementById('ac-list');
  if (!val.trim() || !acSvc) { list.classList.remove('show'); return; }
  searchTimer = setTimeout(() => {
    acSvc.getPlacePredictions(
      { input: val, componentRestrictions: { country: 'kr' }, language: 'ko' },
      (preds, st) => {
        list.innerHTML = '';
        if (st !== 'OK' || !preds) { list.classList.remove('show'); return; }
        preds.slice(0, 5).forEach(p => {
          const el = document.createElement('div'); el.className = 'ac-item';
          const isStation = p.description.includes('역');
          el.innerHTML = `<span class="ac-ico">${isStation ? '🚇' : '📍'}</span>
            <div><div class="ac-main">${p.structured_formatting?.main_text || p.description}</div>
            <div class="ac-sub">${p.structured_formatting?.secondary_text || ''}</div></div>`;
          el.onclick = () => pickPlace(p.place_id, p.structured_formatting?.main_text || p.description);
          list.appendChild(el);
        });
        list.classList.add('show');
      }
    );
  }, 250);
}

function pickPlace(placeId, name) {
  document.getElementById('ac-list').classList.remove('show');
  document.getElementById('search-inp').value = '';
  if (S.pins.length >= S.count) { toast('모든 출발지가 입력됐어요.'); return; }
  placesSvc.getDetails({ placeId, fields: ['geometry', 'name'] }, (place, st) => {
    if (st !== 'OK' || !place?.geometry?.location) return;
    addPin(place.geometry.location.lat(), place.geometry.location.lng(), name);
  });
}

function clearSearch() {
  document.getElementById('search-inp').value = '';
  document.getElementById('ac-list').classList.remove('show');
}