// ── 구글맵 API 키
const GMAP_KEY = 'AIzaSyCXZh8Z8tLzBoAACSQyCLVYU6JK-T-OdUM';

// ── STATE
const S = {
  type: '', typeIcon: '',
  condition: {},
  count: 2,
  pins: [],
  rec: null,
};

// ── CONDITIONS
const COND = {
  '술자리': { title: '어떤 술자리예요?', sub: '주종에 따라 어울리는 분위기가 달라져요', type: 'single',
    opts: ['소주 / 한식 안주', '맥주 / 호프', '와인 / 양식', '막걸리 / 전통주', '사케 / 이자카야', '상관없음'] },
  '회식': { title: '음식 종류를 골라주세요', sub: '', type: 'single',
    opts: ['한식 (고기/구이)', '중식', '일식', '양식', '상관없음'] },
  '가족': { title: '필요한 조건을 모두 골라주세요', sub: '해당되는 항목 모두 선택 가능해요', type: 'multi',
    opts: ['독립 공간 필요', '유아의자 가능', '주차 가능', '조용한 분위기'] },
  '식사': { title: '음식 종류를 골라주세요', sub: '', type: 'single',
    opts: ['한식', '중식', '일식', '양식', '동남아', '상관없음'] },
  '카페': { title: '어떤 카페를 원해요?', sub: '', type: 'single',
    opts: ['빵 / 베이커리', '음료 / 커피', '디저트 전문', '상관없음'] },
  '청첩': { title: '어떤 분위기를 원해요?', sub: '우선순위 하나만 골라주세요', type: 'single',
    opts: ['맛집 위주', '분위기 위주', '조용한 곳'] },
};

// ── NAV
function go(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
  if (id === 's-condition') renderCond();
  if (id === 's-locations') initMap();
}

function resetAll() {
  Object.assign(S, { type: '', typeIcon: '', condition: {}, count: 2, pins: [], rec: null });
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('sel'));
  document.getElementById('btn-type-next').disabled = true;
  mapReady = false; mapInst = null;
  go('s-home');
}

// ── STEP 1
function selType(name, icon) {
  S.type = name; S.typeIcon = icon;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('sel'));
  document.getElementById('type-' + name).classList.add('sel');
  document.getElementById('btn-type-next').disabled = false;
}

// ── STEP 2
function renderCond() {
  const cfg = COND[S.type]; if (!cfg) return;
  document.getElementById('cond-title').textContent = cfg.title;
  document.getElementById('cond-sub').textContent = cfg.sub;
  const body = document.getElementById('cond-body');
  body.innerHTML = ''; S.condition = {};
  const btn = document.getElementById('btn-cond-next');

  if (cfg.type === 'single') {
    btn.disabled = true;
    const list = document.createElement('div'); list.className = 'opt-list';
    cfg.opts.forEach(opt => {
      const el = document.createElement('div'); el.className = 'opt-item';
      el.innerHTML = `<div class="opt-radio"></div><span>${opt}</span>`;
      el.onclick = () => {
        list.querySelectorAll('.opt-item').forEach(i => i.classList.remove('sel'));
        el.classList.add('sel'); S.condition.main = opt; btn.disabled = false;
      };
      list.appendChild(el);
    });
    body.appendChild(list);
  } else if (cfg.type === 'multi') {
    btn.disabled = false; S.condition.selected = [];
    const list = document.createElement('div'); list.className = 'opt-list';
    cfg.opts.forEach(opt => {
      const el = document.createElement('div'); el.className = 'opt-item';
      el.innerHTML = `<div class="opt-radio"></div><span>${opt}</span>`;
      el.onclick = () => {
        el.classList.toggle('sel');
        const idx = S.condition.selected.indexOf(opt);
        if (idx === -1) S.condition.selected.push(opt); else S.condition.selected.splice(idx, 1);
      };
      list.appendChild(el);
    });
    body.appendChild(list);
  }
}

// ── UTILS
function step(n) {
  for (let i = 0; i <= 4; i++) {
    const el = document.getElementById('lstep-'+i);
    el.classList.remove('active','done');
    if (i < n) el.classList.add('done');
    else if (i === n) el.classList.add('active');
  }
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}