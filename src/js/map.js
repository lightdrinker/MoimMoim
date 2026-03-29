let mapInst = null, mapReady = false;
let markers = [], midMark = null;
let acSvc = null, geocoder = null, placesSvc = null;
let searchTimer = null;

const PIN_COLORS = ['#A878D8', '#C898E8', '#F4A8CC', '#D888B8'];

const MAP_STYLE = [
  {elementType:'geometry',stylers:[{color:'#f5f0eb'}]},
  {elementType:'labels.text.fill',stylers:[{color:'#7a6a5a'}]},
  {elementType:'labels.text.stroke',stylers:[{color:'#f5f0eb'}]},
  {featureType:'administrative',elementType:'geometry',stylers:[{color:'#d4c8bc'}]},
  {featureType:'road',elementType:'geometry',stylers:[{color:'#ece6de'}]},
  {featureType:'road.highway',elementType:'geometry',stylers:[{color:'#d8cfc4'}]},
  {featureType:'transit',elementType:'geometry',stylers:[{color:'#e8e0d8'}]},
  {featureType:'water',elementType:'geometry',stylers:[{color:'#b8d4e8'}]},
  {featureType:'poi',stylers:[{visibility:'off'}]},
  {featureType:'poi.park',elementType:'geometry',stylers:[{color:'#d4e8c8'},{visibility:'on'}]},
];

function initMap() {
  renderPinList(); updateGoBtn();
  if (mapReady) return;
  if (!window.google) {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GMAP_KEY}&libraries=places&language=ko&region=KR&callback=_mapCb`;
    s.async = true;
    document.head.appendChild(s);
  } else { _mapCb(); }
}

window._mapCb = function() {
  mapReady = true;
  mapInst = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 37.5665, lng: 126.9780 },
    zoom: 11,
    styles: MAP_STYLE,
    disableDefaultUI: true,
    zoomControl: true,
    gestureHandling: 'greedy',
  });
  acSvc = new google.maps.places.AutocompleteService();
  geocoder = new google.maps.Geocoder();
  placesSvc = new google.maps.places.PlacesService(mapInst);

  mapInst.addListener('click', e => {
    if (Store.getPins().length >= Store.getCount()) { toast('모든 출발지가 입력됐어요. 핀을 먼저 삭제해주세요.'); return; }
    const lat = e.latLng.lat(), lng = e.latLng.lng();
    revGeocode(lat, lng, label => addPin(lat, lng, label));
  });
};

function revGeocode(lat, lng, cb) {
  if (!geocoder) { cb(`${lat.toFixed(3)}, ${lng.toFixed(3)}`); return; }
  geocoder.geocode({ location: { lat, lng }, language: 'ko' }, (res, st) => {
    if (st === 'OK' && res[0]) {
      const comps = res[0].address_components;
      const sub = comps.find(c => c.types.includes('sublocality_level_2') || c.types.includes('sublocality_level_1'));
      cb(sub?.long_name || res[0].formatted_address.replace('대한민국 ', '').split(' ').slice(-2).join(' '));
    } else cb(`${lat.toFixed(3)}, ${lng.toFixed(3)}`);
  });
}

function addPin(lat, lng, label) {
  const currentPins = Store.getPins();
  if (currentPins.length >= Store.getCount()) return;
  const idx = currentPins.length;
  Store.addPin({ lat, lng, label, count: 1 });

  const m = new google.maps.Marker({
    position: { lat, lng }, map: mapInst,
    label: { text: String(idx + 1), color: '#0A0A0A', fontWeight: '700', fontSize: '12px' },
    icon: { path: google.maps.SymbolPath.CIRCLE, scale: 14, fillColor: PIN_COLORS[idx % 4], fillOpacity: 1, strokeWeight: 0 },
  });
  markers.push(m);

  document.getElementById('map-hint').style.opacity = Store.getPins().length >= Store.getCount() ? '0' : '1';
  renderPinList(); calcMidUI(); updateGoBtn();
}

function removePin(idx) {
  Store.removePin(idx);
  markers.forEach(m => m.setMap(null)); markers = [];
  if (midMark) { midMark.setMap(null); midMark = null; }
  document.getElementById('mid-banner').classList.remove('show');

  const pins = Store.getPins();
  pins.forEach((p, i) => {
    const m = new google.maps.Marker({
      position: { lat: p.lat, lng: p.lng }, map: mapInst,
      label: { text: String(i + 1), color: '#0A0A0A', fontWeight: '700', fontSize: '12px' },
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 14, fillColor: PIN_COLORS[i % 4], fillOpacity: 1, strokeWeight: 0 },
    });
    markers.push(m);
  });

  document.getElementById('map-hint').style.opacity = pins.length >= Store.getCount() ? '0' : '1';
  renderPinList();
  if (pins.length >= 2) calcMidUI();
  updateGoBtn();
}

function renderPinList() {
  const list = document.getElementById('pin-list'); list.innerHTML = '';
  const pins = Store.getPins();
  const countLimit = Store.getCount();
  const totalAssigned = pins.reduce((s,p) => s + (p.count||1), 0);
  
  pins.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'pin-item filled';
    el.innerHTML = `
      <div class="pin-dot filled">${i+1}</div>
      <span class="pin-label filled" style="flex:1">${p.label}</span>
      <div class="pin-count-wrap">
        <button class="pin-count-btn" onclick="changePinCount(${i},-1)" ${(p.count||1)<=1?'disabled':''}>−</button>
        <span class="pin-count-num">${p.count||1}명</span>
        <button class="pin-count-btn" onclick="changePinCount(${i},1)" ${totalAssigned>=countLimit?'disabled':''}>+</button>
      </div>
      <button class="pin-del" onclick="removePin(${i})">✕</button>`;
    list.appendChild(el);
  });
  
  const remaining = countLimit - pins.length;
  for (let i = 0; i < Math.min(remaining, countLimit - pins.length); i++) {
    if (pins.length < countLimit) {
      const el = document.createElement('div');
      el.className = 'pin-item';
      el.innerHTML = `<div class="pin-dot">${pins.length + i + 1}</div><span class="pin-label">지도를 탭하거나 검색하세요</span>`;
      list.appendChild(el);
    }
  }
}

function calcMidUI() {
  const pins = Store.getPins();
  if (pins.length < 2) return;
  const mid = weightedCentroid(pins);
  if (midMark) midMark.setMap(null);
  midMark = new google.maps.Marker({
    position: { lat: mid.lat, lng: mid.lng }, map: mapInst,
    icon: { path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: '#fff', fillOpacity: .9, strokeColor: '#C8F04A', strokeWeight: 3 },
    zIndex: 9,
  });

  const bounds = new google.maps.LatLngBounds();
  pins.forEach(p => bounds.extend({ lat: p.lat, lng: p.lng }));
  bounds.extend({ lat: mid.lat, lng: mid.lng });
  mapInst.fitBounds(bounds, { top: 40, bottom: 40, left: 30, right: 30 });

  document.getElementById('mid-banner').classList.add('show');
  const pinSummary = pins.map(p => `${p.label}(${p.count||1}명)`).join(' · ');
  document.getElementById('mid-text').textContent = `${pinSummary} → 가중 중간 지점 계산 완료`;
}

function changePinCount(idx, delta) {
  const pins = Store.getPins();
  const totalAssigned = pins.reduce((s,p) => s + (p.count||1), 0);
  const cur = pins[idx].count || 1;
  const next = cur + delta;
  if (next < 1) return;
  if (delta > 0 && totalAssigned >= Store.getCount()) return;
  
  Store.updatePinCount(idx, next);
  renderPinList(); updateGoBtn();
  if (Store.getPins().length >= 2) calcMidUI();
}

function updateGoBtn() {
  const pins = Store.getPins();
  const hasEnoughPins = pins.length >= 2;
  
  // [수정됨] 기존 UX 결함(allFilled 검증) 제거. 
  // 핀이 2개 이상 찍혔다면 잔여 인원수와 상관없이 무조건 버튼 활성화 허용
  document.getElementById('btn-go').disabled = !hasEnoughPins;
}

function changeCount(d) {
  const v = Store.getCount() + d;
  if (v < 2 || v > 8) return;
  Store.setCount(v);
  document.getElementById('count-disp').textContent = v;
  document.getElementById('btn-minus').disabled = v <= 2;
  document.getElementById('btn-plus').disabled = v >= 8;
  
  while (Store.getPins().length > Store.getCount()) {
    Store.removePin(Store.getPins().length - 1);
  }
  renderPinList(); updateGoBtn();
}

function minimax(pins) {
  const lats = pins.map(p => p.lat), lngs = pins.map(p => p.lng);
  const [minLa, maxLa] = [Math.min(...lats), Math.max(...lats)];
  const [minLn, maxLn] = [Math.min(...lngs), Math.max(...lngs)];
  let best = null, bestD = Infinity;
  for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
    const lat = minLa + (maxLa - minLa) * i / 20;
    const lng = minLn + (maxLn - minLn) * j / 20;
    const d = Math.max(...pins.map(p => haversine(lat, lng, p.lat, p.lng)));
    if (d < bestD) { bestD = d; best = { lat, lng }; }
  }
  return best;
}

function weightedCentroid(pins) {
  const total = pins.reduce((s, p) => s + (p.count || 1), 0);
  const lat = pins.reduce((s, p) => s + p.lat * (p.count || 1), 0) / total;
  const lng = pins.reduce((s, p) => s + p.lng * (p.count || 1), 0) / total;
  return { lat, lng };
}

function haversine(la1, ln1, la2, ln2) {
  const R = 6371, dLa = (la2-la1)*Math.PI/180, dLn = (ln2-ln1)*Math.PI/180;
  const a = Math.sin(dLa/2)**2 + Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLn/2)**2;
  return R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getMidDistrict(lat, lng) {
  return new Promise(resolve => {
    if (!geocoder) { resolve(''); return; }
    geocoder.geocode({ location: { lat, lng }, language: 'ko' }, (res, st) => {
      if (st === 'OK' && res[0]) {
        const comps = res[0].address_components;
        const gu  = comps.find(c => c.types.includes('sublocality_level_1'));
        const dong = comps.find(c => c.types.includes('sublocality_level_2'));
        resolve(gu?.long_name || dong?.long_name || '');
      } else resolve('');
    });
  });
}