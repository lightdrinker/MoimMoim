async function getRecommend() {
  S.recPage = 0;
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

    // 사진 있는 곳 우선 정렬 (Top 3 안에 사진 없는 곳 배치 방지)
    const photosFirst = [
      ...withPhotos.filter(r => r.photo_urls?.length > 0),
      ...withPhotos.filter(r => !r.photo_urls?.length),
    ];

    const radiusUsed = nd.radiusUsed || 2.0;
    const snappedStation = nd.snappedStation || null;
    S.rec = { restaurants: photosFirst, mid, radiusUsed, snappedStation };
    renderResult(photosFirst, mid, radiusUsed, snappedStation);
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
              c.main?.includes('사케') ? '이자카야 사케' :
              c.main?.includes('막걸리') ? '막걸리 전통주' :
              c.main?.includes('맥주') ? '호프집 생맥주' :
              c.main?.includes('상관') ? '술집 주점' :
              '소주 안주 술집',
    '회식': c.main?.includes('중식') ? '중식당 중국집' :
            c.main?.includes('일식') ? '일식당' :
            c.main?.includes('양식') ? '양식 레스토랑' :
            c.main?.includes('상관') ? '단체 식당 맛집' :
            '한식 고기집 구이',
    '가족': (() => {
      const sel = c.selected || [];
      const parts = [
        sel.some(s => s.includes('독립')) && '단체룸 독립공간',
        sel.some(s => s.includes('유아')) && '유아의자 키즈',
        sel.some(s => s.includes('주차')) && '주차',
        sel.some(s => s.includes('조용')) && '조용한',
      ].filter(Boolean);
      return (parts.slice(0, 2).join(' ') || '가족') + ' 식당';
    })(),
    '식사': c.main === '상관없음' || !c.main ? '맛집' :
            c.main === '한식' ? '한식당' :
            c.main === '중식' ? '중식당 중국집' :
            c.main === '일식' ? '일식당' :
            c.main === '양식' ? '양식 레스토랑' :
            c.main === '동남아' ? '동남아 음식 아시안' : '맛집',
    '카페': c.main?.includes('빵') ? '베이커리 빵집' :
            c.main?.includes('디저트') ? '디저트 카페' :
            c.main?.includes('음료') ? '카페 커피' :
            '카페',
    '청첩': c.main?.includes('맛집') ? '모임 맛집 레스토랑' :
            c.main?.includes('분위기') ? '분위기 좋은 레스토랑' :
            '조용한 레스토랑 모임',
  };
  const kw = map[S.type] || '맛집';
  return [kw, 'restaurant', kw];
}

async function runGemini(restaurants) {
  const list = restaurants.map((r, i) => {
    const menuText = (r.menu_snippets || []).join(' | ').slice(0, 200);
    const blogText = (r.blog_snippets || []).join(' | ').slice(0, 300);
    const ratingStr = r.rating ? `${r.rating}점 (리뷰 ${(r.user_ratings_total||0).toLocaleString()}개)` : '없음';
    return `${i+1}. ${r.name}
   주소: ${r.formatted_address || ''}
   평점: ${ratingStr}
   메뉴 블로그: ${menuText || '없음'}
   후기 블로그: ${blogText || '없음'}`;
  }).join('\n\n');

  const cstr = S.condition.main || S.condition.selected?.join(', ') || '상관없음';
  const prompt = `당신은 한국 맛집 큐레이터입니다.

[지시사항]
아래 식당 목록에서 "${S.type}" 모임 (조건: ${cstr})에 잘 맞는 TOP 10을 순위대로 선정하세요.
블로그 후기가 있는 식당을 우선 순위로 배치하고, 평점도 순위 결정에 반영하세요.
각 식당의 description과 tags는 반드시 블로그 후기에 실제로 존재하는 내용만 기반으로 작성하세요.

[description template - 블로그 후기가 있는 경우]
 대표메뉴: (메뉴 블로그에서 언급된 음식·음료명 최대 3개, 없으면 후기 블로그에서 추출, 적절한 이모티콘 삽입)
 분위기·특징을 15자 이내로 요약해서 딱 보면 어떤 곳인지 알 수 있게 작성 (이모티콘 활용 권장)

[description template - 블로그 후기가 없는 경우]
 후기 정보 없음

[tags 형식]
블로그 후기에서 추출한 음식/분위기/특징 키워드 3개 (후기 없으면 빈 배열 [])

[주의사항]
- 블로그 원문 문장을 절대 그대로 복사하지 마세요
- 한줄요약은 반드시 15자 이내
- 대표메뉴는 블로그에서 언급된 음식·음료·메뉴 관련 단어를 추출하세요. 블로그에 아무 음식 관련 언급이 없을 때만 공란으로 두세요
- 블로그에 전혀 근거 없는 메뉴나 분위기는 지어내지 마세요
- 블로그 후기가 없는 식당은 description을 "후기 정보 없음"으로만 표시하세요
- 반드시 10개 모두 선정하세요 (식당이 10개 미만이면 있는 만큼만)

식당 목록:
${list}

반드시 아래 JSON 배열 형식으로만 응답하세요. 다른 텍스트 없이 JSON만:
[{"rank":1,"name":"식당명","description":"🍽 대표메뉴: 메뉴1, 메뉴2\n✨ 한줄요약: 15자이내요약","tags":["태그1","태그2","태그3"]},{"rank":2,"name":"식당명","description":"🍽 대표메뉴: 메뉴1, 메뉴2\n✨ 한줄요약: 15자이내요약","tags":["태그1","태그2","태그3"]}]`;

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
  return restaurants.slice(0, 10).map((r, i) => {
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
    if (!refs.length) {
      return { ...r, photo_urls: r.naver_image_urls?.length ? r.naver_image_urls : [] };
    }
    try {
      const res = await fetch(`/api/places?action=photo&photo_references=${refs.join(',')}&maxwidth=600`);
      const d = await res.json();
      const urls = d.photo_urls?.length ? d.photo_urls : (r.naver_image_urls || []);
      return { ...r, photo_urls: urls };
    } catch {
      return { ...r, photo_urls: r.naver_image_urls?.length ? r.naver_image_urls : [] };
    }
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

function renderResult(rests, mid, radiusUsed, snappedStation) {
  const condStr = S.condition.main || (S.condition.selected || []).join('·') || '';
  const titleText = condStr ? `${S.typeIcon} ${condStr} ${S.type}` : `${S.typeIcon} ${S.type}`;
  document.getElementById('res-title').textContent = titleText;

  const pinNames = (S.pins || []).map(p => {
    const lbl = p.label || '';
    const m = lbl.match(/([가-힣]+(?:역|동|읍|면|리))/);
    return m ? m[1] : lbl.split(' ')[0];
  }).filter(Boolean);

  function renderAreaBadge(names, areaName) {
    const chips = names.map((n, i) => {
      const isOddLast = names.length % 2 !== 0 && i === names.length - 1;
      return `<div class="rba-chip${isOddLast ? ' full' : ''}">${n}</div>`;
    }).join('');
    const midLine = areaName
      ? `<hr class="rba-divider"><span class="rba-mid">📍 ${areaName}</span>`
      : '';
    document.getElementById('res-area').innerHTML = `
      <p class="rba-label">출발지들의 딱 중간</p>
      <div class="rba-grid">${chips}</div>
      ${midLine}
    `;
  }

  if (geocoder) {
    geocoder.geocode({ location: { lat: mid.lat, lng: mid.lng }, language: 'ko' }, (res, st) => {
      let areaName = '';
      if (st === 'OK' && res[0]) {
        const comps = res[0].address_components;
        const sub = comps.find(c => c.types.includes('sublocality_level_2') || c.types.includes('sublocality_level_1'));
        areaName = sub?.long_name || '';
      }
      renderAreaBadge(pinNames, areaName);
    });
  } else {
    renderAreaBadge(pinNames, '');
  }

  const condLabel = S.condition.main || (S.condition.selected || []).join('·') || S.type;
  const locationLabel = snappedStation ? `${snappedStation}역 근처` : `${radiusUsed}km 이내`;
  document.getElementById('res-subtitle') && (
    document.getElementById('res-subtitle').textContent = `[ ${locationLabel}의 ${condLabel} 추천 ]`
  );

  // 페이지 기반 슬라이싱
  const startIdx = S.recPage * 3;
  const pageRests = rests.slice(startIdx, startIdx + 3);

  const container = document.getElementById('rest-cards'); container.innerHTML = '';
  const RC = ['r1', 'r2', 'r3'];
  const MEDALS = ['🥇', '🥈', '🥉'];

  pageRests.forEach((r, i) => {
    const globalRank = startIdx + i + 1;
    const rankLabel = globalRank <= 3
      ? `${MEDALS[globalRank - 1]} ${globalRank}위`
      : `${globalRank}위`;

    const card = document.createElement('div'); card.className = 'rest-card';
    const urls = r.photo_urls || [];
    let photoHtml = '';
    if (urls.length >= 2) {
      photoHtml = `
        <div class="rank-badge ${RC[i]}" style="position:absolute;top:10px;left:10px;z-index:2">${rankLabel}</div>
        <div class="photo-stack">
          <img class="photo-stack-img" src="${urls[0]}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <div class="photo-stack-ph" style="display:none">🏠</div>
          <img class="photo-stack-img" src="${urls[1]}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <div class="photo-stack-ph" style="display:none">🍽️</div>
        </div>`;
    } else if (urls.length === 1) {
      photoHtml = `
        <div class="rank-badge ${RC[i]}" style="position:absolute;top:10px;left:10px;z-index:2">${rankLabel}</div>
        <img class="rest-photo" src="${urls[0]}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="photo-placeholder" style="display:none">🍽️</div>`;
    } else {
      photoHtml = `
        <div class="rank-badge ${RC[i]}" style="position:absolute;top:10px;left:10px;z-index:2">${rankLabel}</div>
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
        <p class="rest-desc">${(r.description||'').replace(/\n/g, '<br>')}</p>
        ${meta ? `<div class="rest-meta">${meta}</div>` : ''}
        ${(r.tags||[]).length ? `<div class="rest-tags">${r.tags.map(t=>`<span class="rest-tag">${t}</span>`).join('')}</div>` : ''}
        <div class="card-action-row">
          <a href="${naverUrl}" target="_blank" class="btn-naver">🗺 네이버맵으로 보기</a>
          <button class="btn-share-single" onclick="shareCard(${globalRank})" title="공유">↗</button>
        </div>
      </div>`;
    container.appendChild(card);
  });

  // Next 버튼 표시/숨김 (3개 초과 결과가 있을 때만)
  const btnNext = document.getElementById('btn-next-rec');
  if (btnNext) {
    btnNext.style.display = rests.length > 3 ? '' : 'none';
  }
}

function nextRecommend() {
  const rests = S.rec?.restaurants || [];
  const totalPages = Math.ceil(rests.length / 3);
  S.recPage = (S.recPage + 1) % totalPages;
  renderResult(rests, S.rec.mid, S.rec.radiusUsed, S.rec.snappedStation);
  window.scrollTo(0, 0);
}

async function shareResultUrl() {
  const rests = S.rec?.restaurants || [];
  const startIdx = S.recPage * 3;
  const pageRests = rests.slice(startIdx, startIdx + 3);

  const data = {
    t: document.getElementById('res-title')?.textContent || '',
    a: document.getElementById('res-area')?.textContent || '',
    p: pageRests.map((r, i) => ({
      n: r.display_name || r.name,
      u: buildNaverUrl(r),
      d: (r.description || '').slice(0, 100),
      r: startIdx + i + 1,
    }))
  };

  const encoded = encodeURIComponent(JSON.stringify(data));
  const url = `https://moim-moim-tau.vercel.app/#share=${encoded}`;

  try {
    if (navigator.share) {
      await navigator.share({ title: data.t, text: `${data.a} ${data.t}`, url });
    } else {
      await navigator.clipboard.writeText(url);
      toast('🔗 링크 복사됐어요!');
    }
  } catch {
    try { await navigator.clipboard.writeText(url); toast('🔗 링크 복사됐어요!'); } catch { toast('공유 실패'); }
  }
}

function showSharedResult(data) {
  document.getElementById('shared-title').textContent = data.t || '';
  document.getElementById('shared-area').textContent = data.a || '';

  const container = document.getElementById('shared-cards');
  container.innerHTML = '';
  const MEDALS = ['🥇', '🥈', '🥉'];
  const RC = ['r1', 'r2', 'r3'];

  (data.p || []).forEach(p => {
    const rank = p.r || 1;
    const rankStr = rank <= 3 ? `${MEDALS[rank - 1]} ${rank}위` : `${rank}위`;
    const rc = RC[(rank - 1) % 3];
    const card = document.createElement('div');
    card.className = 'rest-card';
    card.innerHTML = `
      <div class="rank-bar ${rc}"></div>
      <div class="rest-body">
        <p style="font-size:12px;color:var(--accent);font-weight:700;margin-bottom:4px">${rankStr}</p>
        <p class="rest-name">${p.n}</p>
        <p class="rest-desc">${(p.d || '').replace(/\n/g, '<br>')}</p>
        <a href="${p.u}" target="_blank" class="btn-naver">🗺 네이버맵으로 보기</a>
      </div>`;
    container.appendChild(card);
  });

  go('s-shared');
}

async function shareCard(globalRank) {
  const rests = S.rec?.restaurants || [];
  const r = rests[globalRank - 1];
  if (!r) return;
  const name = r.display_name || r.name;
  const url = buildNaverUrl(r);
  const rankStr = globalRank <= 3 ? ['🥇','🥈','🥉'][globalRank-1] : `${globalRank}위`;
  const text = `${rankStr} ${name}\n🗺 ${url}\n\n🚩 모임 Moim ; Meet in the Middle\n👉 https://moim-moim-tau.vercel.app`;
  try {
    if (navigator.share) {
      await navigator.share({ title: name, text, url });
    } else {
      await navigator.clipboard.writeText(text);
      toast('📋 복사됐어요!');
    }
  } catch {
    try { await navigator.clipboard.writeText(text); toast('📋 복사됐어요!'); } catch { toast('공유 실패'); }
  }
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
  const startIdx = S.recPage * 3;
  const pageRests = rests.slice(startIdx, startIdx + 3);

  const pinPart = pinNames.join(' & ');
  const midPart = midArea ? ` = ${midArea}` : '';
  const header = `📍 ${pinPart} 중간${midPart} (${condStr} ${S.type})`;

  const restLines = pageRests.map((r, i) => {
    const rank = startIdx + i + 1;
    const rankStr = rank <= 3 ? RANK[rank - 1] : `${rank}위`;
    return `${rankStr} ${r.display_name || r.name} ${buildNaverUrl(r)}`;
  }).join('\n');

  const text = `${header}\n\n${restLines}\n\n🚩 모임 Moim ; Meet in the Middle\n👉 https://moim-moim-tau.vercel.app`;

  try {
    await navigator.clipboard.writeText(text);
    toast('📋 복사됐어요! 카톡에 붙여넣기 하세요');
  } catch {
    toast('복사 실패. 직접 선택해서 복사해주세요');
  }
}

async function shareFinalAnnouncement() {
  const confirmedDate = localStorage.getItem('moim-confirmed-date');
  const condStr = S.condition.main || (S.condition.selected || []).join('·') || S.type || '';

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
  const top3 = rests.slice(0, 3);

  const dateLine = confirmedDate
    ? `📅 날짜: ${formatConfirmedDate(confirmedDate)}`
    : '';
  const placeLine = midArea
    ? `📍 장소: ${midArea} 근처${condStr ? ` (${condStr})` : ''}`
    : '';
  const restLines = top3.map((r, i) =>
    `${RANK[i]} ${r.display_name || r.name}  ${buildNaverUrl(r)}`
  ).join('\n');

  const lines = [
    `🎉 모임 날짜·장소 확정됐어요!`,
    ``,
    ...(dateLine ? [dateLine] : []),
    ...(placeLine ? [placeLine] : []),
    ``,
    `🍽 추천 맛집`,
    restLines,
    ``,
    `──────────────────`,
    `🧭 MoiM — 모두의 딱 중간 지점`,
    `https://moim-moim-tau.vercel.app`,
  ].join('\n');

  if (navigator.share) {
    try { await navigator.share({ text: lines }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(lines);
    toast('📢 안내 메시지가 복사됐어요! 카톡에 붙여넣기 하세요');
  } catch {
    toast('복사 실패. 직접 선택해서 복사해주세요');
  }
}

function formatConfirmedDate(dateStr) {
  const DAY = ['일', '월', '화', '수', '목', '금', '토'];
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAY[d.getDay()]})`;
}