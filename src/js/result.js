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
  } catch(e) { /* Gemini 호출 실패 시 fallback 처리 */ }

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
    if (!refs.length) {
      return { ...r, photo_urls: r.naver_image_urls?.length ? r.naver_image_urls : [] };
    }
    try {
      const res = await fetch(`/api/places?action=photo&photo_references=${refs.join(',')}&maxwidth=600`);
      const d = await res.json();
      return { ...r, photo_urls: d.photo_urls || [] };
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

function renderResult(rests, mid, radiusUsed) {
  const cond = Store.getCondition();
  const condStr = cond.main || (cond.selected || []).join('·') || '';
  const typeStr = Store.getType();
  const iconStr = Store.getTypeIcon();
  const titleText = condStr ? `${iconStr} ${condStr} ${typeStr}` : `${iconStr} ${typeStr}`;
  document.getElementById('res-title').textContent = titleText;

  const pinNames = (Store.getPins() || []).map(p => {
    const lbl = p.label || '';
    const m = lbl.match(/([가-힣]+(?:역|동|읍|면|리))/);
    return m ? m[1] : lbl.split(' ')[0];
  }).filter(Boolean);

  if (geocoder && mid) {
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

  const condLabel = cond.main || (cond.selected || []).join('·') || typeStr;
  const radiusLabel = `${radiusUsed}`;
  if (document.getElementById('res-subtitle')) {
    document.getElementById('res-subtitle').textContent = `${radiusLabel}km 이내의 ${condLabel} 추천`;
  }

  const container = document.getElementById('rest-cards'); 
  container.innerHTML = '';
  const RANK_LBL = ['🥇 1위', '🥈 2위', '🥉 3위'];
  const RC = ['r1', 'r2', 'r3'];

  // 로딩 화면이 끝났으므로 기존 로딩 스텝 UI 가리기 (안전장치)
  document.getElementById('s-loading').classList.remove('active');

  rests.slice(0,3).forEach((r,i) => {
    const card = document.createElement('div'); card.className = 'rest-card';
    const urls = r.photo_urls || [];
    let photoHtml = '';
    
    // 로딩 중 UI를 보여주기 위해 스켈레톤이나 대체 텍스트 삽입 가능
    const isLoadingPhoto = urls.length === 0 && !r.description; 
    
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
        <div class="photo-placeholder">${isLoadingPhoto ? '사진 로딩 중... ⏳' : '🍽️'}</div>`;
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
        <p class="rest-desc">${(r.description || 'AI가 식당 특징을 분석 중입니다... 🤖').replace(/\n/g, '<br>')}</p>
        ${meta ? `<div class="rest-meta">${meta}</div>` : ''}
        ${(r.tags||[]).length ? `<div class="rest-tags">${r.tags.map(t=>`<span class="rest-tag">${t}</span>`).join('')}</div>` : ''}
        <a href="${naverUrl}" target="_blank" class="btn-naver">🗺 네이버맵으로 보기</a>
      </div>`;
    container.appendChild(card);
  });
}

function retryRecommend() {
  Store.clearPins(); // 안전한 초기화
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
  const cond = Store.getCondition();
  const condStr = cond.main || (cond.selected || []).join('·') || '';
  const pinNames = Store.getPins().map(p => {
    const m = (p.label || '').match(/([가-힣]+(?:역|동|읍|면|리))/);
    return m ? m[1] : (p.label || '').split(' ')[0];
  }).filter(Boolean);

  const recData = Store.getRec();
  const midArea = await new Promise(resolve => {
    if (!geocoder || !recData?.mid) { resolve(''); return; }
    geocoder.geocode({ location: { lat: recData.mid.lat, lng: recData.mid.lng }, language: 'ko' }, (res, st) => {
      if (st === 'OK' && res[0]) {
        const comps = res[0].address_components;
        const sub = comps.find(c => c.types.includes('sublocality_level_2') || c.types.includes('sublocality_level_1'));
        resolve(sub?.long_name || '');
      } else resolve('');
    });
  });

  const rests = recData?.restaurants || [];
  const RANK = ['🥇', '🥈', '🥉'];

  const pinPart = pinNames.join(' & ');
  const midPart = midArea ? ` = ${midArea}` : '';
  const header = `📍 ${pinPart} 중간${midPart} (${condStr} ${Store.getType()})`;

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