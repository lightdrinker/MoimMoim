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
    const enriched = top.map((r, i) => ({ ...r, display_name: r.name, rank: i + 1 }));

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

    const distStr = r.dist_m != null
      ? (r.dist_m >= 1000 ? `${(r.dist_m/1000).toFixed(1)}km` : `${r.dist_m}m`)
      : '';
    const meta = [
      r.rating ? `<span class="rest-rating">★ ${r.rating}</span><span class="rest-reviews">(${(r.user_ratings_total||0).toLocaleString()})</span>` : '',
      r.price_level ? `<span class="rest-price">${'₩'.repeat(r.price_level)}</span>` : '',
      distStr ? `<span class="rest-dist">🚶 ${distStr}</span>` : '',
      r.blog_count ? `<span class="rest-blog">📝 ${r.blog_count.toLocaleString()}</span>` : '',
    ].filter(Boolean).join('');

    const menus = r.menus || [];
    const category = r.category_label || '';

    const naverUrl = buildNaverUrl(r);
    card.innerHTML = `
      <div class="rank-bar ${RC[i]}"></div>
      <div class="photo-wrap" style="position:relative">
        ${photoHtml}
      </div>
      <div class="rest-body">
        <p class="rest-name">${r.display_name||r.name}</p>
        ${category ? `<p class="rest-category">${category}</p>` : ''}
        ${menus.length ? `<div class="rest-tags">${menus.map(t=>`<span class="rest-tag menu">${t}</span>`).join('')}</div>` : ''}
        ${meta ? `<div class="rest-meta">${meta}</div>` : ''}
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
      c: r.category_label || '',
      m: (r.menus || []).slice(0, 3),
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
    const menus = p.m || [];
    const category = p.c || '';
    const card = document.createElement('div');
    card.className = 'rest-card';
    card.innerHTML = `
      <div class="rank-bar ${rc}"></div>
      <div class="rest-body">
        <p style="font-size:12px;color:var(--accent);font-weight:700;margin-bottom:4px">${rankStr}</p>
        <p class="rest-name">${p.n}</p>
        ${category ? `<p class="rest-category">${category}</p>` : ''}
        ${menus.length ? `<div class="rest-tags">${menus.map(t=>`<span class="rest-tag menu">${t}</span>`).join('')}</div>` : ''}
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