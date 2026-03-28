async function getRecommend() {
  go('s-loading'); step(0);
  try {
    step(1);
    const mid = weightedCentroid(S.pins);

    step(2);
    const [kw, type, blogKw] = buildKw();
    const district = await getMidDistrict(mid.lat, mid.lng);
    const nr = await fetch(`/api/places?action=nearby&lat=${mid.lat}&lng=${mid.lng}&keyword=${encodeURIComponent(kw)}&type=${type}&blogKw=${encodeURIComponent(blogKw)}&district=${encodeURIComponent(district)}`);
    const nd = await nr.json();
    if (!nd.results?.length) throw new Error('주변에 식당을 찾지 못했어요. 출발지를 다시 설정해보세요.');

    const top = nd.results.slice(0, 10);

    step(3);
    const enriched = await runGemini(top);

    step(4);
    const withPhotos = await loadPhotos(enriched);

    S.rec = { restaurants: withPhotos, mid };
    renderResult(withPhotos, mid, nd.radiusUsed || 2.0);
    go('s-result');
  } catch(e) {
    document.getElementById('loc-error').textContent = e.message || '오류가 발생했어요. 다시 시도해주세요.';
    document.getElementById('loc-error').classList.add('show');
    go('s-locations');
  }
}

function buildKw() {
  const c = S.condition;
  const map = {
    '술자리': c.main?.includes('와인') ? '와인바' :
              c.main?.includes('사케') ? '이자카야' :
              c.main?.includes('막걸리') ? '막걸리집' :
              c.main?.includes('맥주') ? '맥주 호프' :
              c.main?.includes('상관') ? '술집' :
              '소주 맛집',
    '회식': c.main?.includes('중식') ? '중식 중식당' :
            c.main?.includes('일식') ? '일식 일식집' :
            c.main?.includes('양식') ? '양식' :
            c.main?.includes('상관') ? '맛집' :
            '한식 고기집',
    '가족': '가족 식사',
    '식사': c.main === '상관없음' || !c.main ? '맛집' :
            c.main === '한식' ? '한식 한식당' :
            c.main === '중식' ? '중식 중식당' :
            c.main === '일식' ? '일식 일식집' :
            c.main === '양식' ? '양식' :
            c.main === '동남아' ? '동남아음식점' : '맛집',
    '카페': c.main?.includes('빵') ? '빵 베이커리 맛집' :
            c.main?.includes('디저트') ? '디저트 카페' :
            c.main?.includes('음료') ? '카페 커피 맛집' :
            '카페',
    '청첩': c.main?.includes('맛집') ? '청첩모임 맛집' :
            c.main?.includes('분위기') ? '청첩모임 분위기' :
            '청첩모임 조용한',
  };
  const kw = map[S.type] || '맛집';
  return [kw, 'restaurant', kw];
}

async function runGemini(restaurants) {
  const list = restaurants.map((r,i) => {
    const typeLabel = (r.types || [])
      .filter(t => !['point_of_interest','establishment','premise'].includes(t))
      .slice(0, 2).join(', ');
    const summary = r.editorial_summary?.overview || '';
    return `${i+1}. ${r.name} (평점:${r.rating||'없음'}, 리뷰:${r.user_ratings_total||0}개, 주소:${r.formatted_address||''}, 업종:${typeLabel||'식당'}${summary ? ', 설명:'+summary : ''})`;
  }).join('\n');
  const cstr = S.condition.main || S.condition.selected?.join(', ') || '상관없음';
  const prompt = `당신은 한국 맛집 큐레이터입니다.

[지시사항]
- 아래 식당 목록에서 "${S.type}" 모임 (조건: ${cstr})에 가장 잘 맞는 TOP 3를 선정하세요.
- 각 식당의 description은 그 식당의 대표 음식과 분위기를 포함한 자연스러운 추천 문장 1-2개로 작성하세요.
- 블로그 후기 문장을 그대로 복사하거나 인용하지 마세요. 반드시 새로 작성하세요.
- tags는 분위기/음식/특징을 나타내는 짧은 한국어 태그로 작성하세요.

식당 목록:
${list}

반드시 아래 JSON 배열 형식으로만 응답하세요. 다른 텍스트 없이 JSON만:
[{"rank":1,"name":"식당명","description":"이 식당 추천 이유 1-2문장","tags":["태그1","태그2","태그3"]},{"rank":2,"name":"식당명","description":"이 식당 추천 이유 1-2문장","tags":["태그1","태그2","태그3"]},{"rank":3,"name":"식당명","description":"이 식당 추천 이유 1-2문장","tags":["태그1","태그2","태그3"]}]`;

  try {
    const res = await fetch('/api/places?action=gemini', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const d = await res.json();
    const text = (d.text || '').trim();

    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    if (!Array.isArray(parsed)) {
      const m = text.match(/\[[\s\S]*\]/);
      if (m) try { parsed = JSON.parse(m[0]); } catch {}
    }
    if (!Array.isArray(parsed)) {
      const clean = text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'').trim();
      try { parsed = JSON.parse(clean); } catch {}
    }

    if (Array.isArray(parsed) && parsed.length) {
      return parsed.map(item => {
        const orig = restaurants.find(r => r.name === item.name)
          || restaurants.find(r => r.name && item.name && r.name.includes(item.name))
          || restaurants.find(r => r.name && item.name && item.name.includes(r.name))
          || restaurants[(item.rank || 1) - 1]
          || restaurants[0];
        return { ...orig, display_name: item.name || orig.name, description: item.description || '', tags: item.tags || [], rank: item.rank };
      });
    }
  } catch(e) { /* Gemini 호출 실패 시 fallback */ }

  const typeMap = {
    restaurant: '음식점', bar: '바', cafe: '카페', bakery: '베이커리',
    meal_takeaway: '포장가능', meal_delivery: '배달', night_club: '나이트클럽',
    liquor_store: '주류', food: '식당',
  };
  return restaurants.slice(0,3).map((r,i) => {
    const desc = (r.blog_snippets || []).find(s => s && s.trim()) || '';
    const rawTags = (r.types || [])
      .filter(t => !['point_of_interest','establishment','food','premise'].includes(t))
      .slice(0, 3)
      .map(t => typeMap[t] || t.replace(/_/g, ' '));
    return { ...r, display_name: r.name, description: desc.slice(0, 100), tags: rawTags, rank: i+1 };
  });
}

async function loadPhotos(rests) {
  return Promise.all(rests.map(async r => {
    const refs = (r.photos || []).slice(0, 2).map(p => p.photo_reference).filter(Boolean);
    if (!refs.length) return { ...r, photo_urls: [] };
    try {
      const res = await fetch(`/api/places?action=photo&photo_references=${refs.join(',')}&maxwidth=600`);
      const d = await res.json();
      return { ...r, photo_urls: d.photo_urls || [] };
    } catch { return { ...r, photo_urls: [] }; }
  }));
}

function buildNaverUrl(r) {
  const addr = r.formatted_address || '';
  const cleaned = addr
    .replace(/^대한민국\s*/, '')
    .replace(/^(서울특별시|경기도|부산광역시|인천광역시|대구광역시|대전광역시|광주광역시|울산광역시|세종특별자치시)\s*/, '');
  const guMatch = cleaned.match(/([가-힣]+[구군])/);
  const gu = guMatch ? guMatch[1] : '';
  const dongMatch = cleaned.match(/[가-힣]+[구군]\s*([가-힣0-9]+(?:동|가|읍|면|리))\b/);
  const dong = dongMatch ? dongMatch[1] : '';
  const shortAddr = [gu, dong].filter(Boolean).join(' ');
  const name = r.display_name || r.name || '';
  return `https://map.naver.com/p/search/${encodeURIComponent([shortAddr, name].filter(Boolean).join(' '))}`;
}

function renderResult(rests, mid, radiusUsed) {
  const condStr = S.condition.main || (S.condition.selected || []).join('·') || '';
  const titleText = condStr ? `${S.typeIcon} ${condStr} ${S.type}` : `${S.typeIcon} ${S.type}`;
  document.getElementById('res-title').textContent = titleText;

  const pinNames = (S.pins || []).map(p => {
    const lbl = p.label || '';
    const m = lbl.match(/([가-힣]+(?:역|동|읍|면|리))/);
    return m ? m[1] : lbl.split(' ')[0];
  }).filter(Boolean);

  if (geocoder) {
    geocoder.geocode({ location: { lat: mid.lat, lng: mid.lng }, language: 'ko' }, (res, st) => {
      let areaName = '';
      if (st === 'OK' && res[0]) {
        const comps = res[0].address_components;
        const sub = comps.find(c => c.types.includes('sublocality_level_2') || c.types.includes('sublocality_level_1'));
        areaName = sub?.long_name || '';
      }
      const pinPart = pinNames.join(' & ');
      const midPart = areaName ? `중간 위치는 ${areaName} 입니다` : '';
      const badge = pinPart && midPart
        ? `📍 ${pinPart}  ▶  ${midPart}`
        : pinPart ? `📍 ${pinPart} 중간` : areaName ? `📍 ${areaName} 근처` : '📍 —';
      document.getElementById('res-area').textContent = badge;
    });
  } else {
    const pinPart = pinNames.join(' & ');
    document.getElementById('res-area').textContent = pinPart ? `📍 ${pinPart} 중간` : '📍 —';
  }

  const condLabel = S.condition.main || (S.condition.selected || []).join('·') || S.type;
  const radiusLabel = `${radiusUsed}`;
  document.getElementById('res-subtitle') && (
    document.getElementById('res-subtitle').textContent = `${radiusLabel}km 이내의 ${condLabel} 추천`
  );

  const container = document.getElementById('rest-cards'); container.innerHTML = '';
  const RANK_LBL = ['🥇 1위', '🥈 2위', '🥉 3위'];
  const RC = ['r1', 'r2', 'r3'];

  rests.slice(0,3).forEach((r,i) => {
    const card = document.createElement('div'); card.className = 'rest-card';
    const urls = r.photo_urls || [];
    let photoHtml = '';
    if (urls.length >= 2) {
      photoHtml = `
        <div class="rank-badge ${RC[i]}" style="position:absolute;top:10px;left:10px;z-index:2">${RANK_LBL[i]}</div>
        <div class="photo-stack">
          <img class="photo-stack-img" src="${urls[0]}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <div class="photo-stack-ph" style="display:none">🏠</div>
          <img class="photo-stack-img" src="${urls[1]}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <div class="photo-stack-ph" style="display:none">🍽️</div>
        </div>`;
    } else if (urls.length === 1) {
      photoHtml = `
        <div class="rank-badge ${RC[i]}" style="position:absolute;top:10px;left:10px;z-index:2">${RANK_LBL[i]}</div>
        <img class="rest-photo" src="${urls[0]}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="photo-placeholder" style="display:none">🍽️</div>`;
    } else {
      photoHtml = `
        <div class="rank-badge ${RC[i]}" style="position:absolute;top:10px;left:10px;z-index:2">${RANK_LBL[i]}</div>
        <div class="photo-placeholder">🍽️</div>`;
    }

    const meta = [
      r.rating ? `<span class="rest-rating">★ ${r.rating}</span><span class="rest-reviews">(${(r.user_ratings_total||0).toLocaleString()})</span>` : '',
      r.price_level ? `<span class="rest-price">${'₩'.repeat(r.price_level)}</span>` : '',
    ].filter(Boolean).join('');

    const naverUrl = buildNaverUrl(r);
    card.innerHTML = `
      <div class="rank-bar ${RC[i]}"></div>
      <div class="photo-wrap" style="position:relative">
        ${photoHtml}
      </div>
      <div class="rest-body">
        <p class="rest-name">${r.display_name||r.name}</p>
        <p class="rest-desc">${r.description||''}</p>
        ${meta ? `<div class="rest-meta">${meta}</div>` : ''}
        ${(r.tags||[]).length ? `<div class="rest-tags">${r.tags.map(t=>`<span class="rest-tag">${t}</span>`).join('')}</div>` : ''}
        <a href="${naverUrl}" target="_blank" class="btn-naver">🗺 네이버맵으로 보기</a>
      </div>`;
    container.appendChild(card);
  });
}

function retryRecommend() {
  S.pins = [];
  markers.forEach(m => m.setMap(null)); markers = [];
  if (midMark) { midMark.setMap(null); midMark = null; }
  document.getElementById('mid-banner').classList.remove('show');
  document.getElementById('loc-error').classList.remove('show');
  go('s-locations');
}

function changeCondition() {
  go('s-condition');
}


 async function shareText() {
  const condStr = S.condition.main || (S.condition.selected || []).join('·') || '';
  const pinNames = S.pins.map(p => {
    const m = (p.label || '').match(/([가-힣]+(?:역|동|읍|면|리))/);
    return m ? m[1] : (p.label || '').split(' ')[0];
  }).filter(Boolean);

  const midArea = await new Promise(resolve => {
    if (!geocoder || !S.rec?.mid) { resolve(''); return; }
    geocoder.geocode({ location: { lat: S.rec.mid.lat, lng: S.rec.mid.lng }, language: 'ko' }, (res, st) => {
      if (st === 'OK' && res[0]) {
        const comps = res[0].address_components;
        const sub = comps.find(c => c.types.includes('sublocality_level_2') || c.types.includes('sublocality_level_1'));
        resolve(sub?.long_name || '');
      } else resolve('');
    });
  });

  const rests = S.rec?.restaurants || [];
  const RANK = ['🥇', '🥈', '🥉'];

  const pinPart = pinNames.join(' & ');
  const midPart = midArea ? ` = ${midArea}` : '';
  const header = `📍 ${pinPart} 중간${midPart} (${condStr} ${S.type})`;

  const restLines = rests.slice(0, 3).map((r, i) =>
    `${RANK[i]} ${r.display_name || r.name} ${buildNaverUrl(r)}`
  ).join('\n');

  const text = `${header}\n\n${restLines}\n\n🚩 모임 Moim ; Meet in the Middle\n👉 https://moim-moim-tau.vercel.app`;

  try {
    await navigator.clipboard.writeText(text);
    toast('📋 복사됐어요! 카톡에 붙여넣기 하세요');
  } catch {
    toast('복사 실패. 직접 선택해서 복사해주세요');
  }
}