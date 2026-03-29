async function getRecommend() {
  go('s-loading'); step(0);
  try {
    step(1);
    const pins = Store.getPins();
    const mid = weightedCentroid(pins);

    step(2);
    const [kw, type, blogKw] = buildKw();
    const district = await getMidDistrict(mid.lat, mid.lng);
    const nr = await fetch(`/api/places?action=nearby&lat=${mid.lat}&lng=${mid.lng}&keyword=${encodeURIComponent(kw)}&type=${type}&blogKw=${encodeURIComponent(blogKw)}&district=${encodeURIComponent(district)}`);
    const nd = await nr.json();
    if (!nd.results?.length) throw new Error('주변에 식당을 찾지 못했어요. 출발지를 다시 설정해보세요.');

    const top = nd.results.slice(0, 10);
    const radiusUsed = nd.radiusUsed || 2.0;

    // 1. 구글 기본 검색 결과만으로 즉시 화면 렌더링 (체감 대기시간 대폭 단축)
    Store.setRecommendation({ restaurants: top, mid });
    renderResult(top, mid, radiusUsed);
    go('s-result'); // 사용자는 여기서부터 화면을 바로 봄

    // 2. 비동기로 사진과 AI 데이터를 병렬로 가져와 화면을 조용히 갱신 (에러 방어 포함)
    enrichDataAsync(top, mid, radiusUsed);

  } catch(e) {
    document.getElementById('loc-error').textContent = e.message || '오류가 발생했어요. 다시 시도해주세요.';
    document.getElementById('loc-error').classList.add('show');
    go('s-locations');
  }
}

// [신규] 백그라운드 병렬 처리 및 점진적 렌더링
async function enrichDataAsync(places, mid, radiusUsed) {
  // [사진 로딩] 완료되면 기존 상태에 덮어쓰고 렌더링
  loadPhotos(places).then(withPhotos => {
    const currentRec = Store.getRec()?.restaurants || [];
    const merged = withPhotos.map(p => {
      const existing = currentRec.find(r => r.name === p.name) || {};
      return { ...existing, ...p };
    });
    Store.setRecommendation({ restaurants: merged, mid });
    if (document.getElementById('s-result').classList.contains('active')) {
      renderResult(merged, mid, radiusUsed);
    }
  }).catch(err => console.warn('사진 로딩 실패:', err));

  // [AI 텍스트 분석] 완료되면 기존 상태에 덮어쓰고 렌더링 (에러가 나도 화면은 유지)
  runGemini(places).then(enriched => {
    const currentRec = Store.getRec()?.restaurants || [];
    const merged = currentRec.map(r => {
      const aiData = enriched.find(e => e.name === r.name) || {};
      return { ...r, description: aiData.description || r.description, tags: aiData.tags || r.tags };
    });
    Store.setRecommendation({ restaurants: merged, mid });
    if (document.getElementById('s-result').classList.contains('active')) {
      renderResult(merged, mid, radiusUsed);
    }
  }).catch(err => console.warn('AI 분석 실패. 기본 텍스트를 유지합니다.', err));
}

function buildKw() {
  const c = Store.getCondition();
  const t = Store.getType();
  const map = {
    '술자리': c.main?.includes('와인') ? '와인바' :
              c.main?.includes('사케') ? '이자카야' :
              c.main?.includes('막걸리') ? '막걸리집' :
              c.main?.includes('맥주') ? '맥주 호프' :
              c.main?.includes('상관') ? '술집' : '소주 맛집',
    '회식': c.main?.includes('중식') ? '중식 중식당' :
            c.main?.includes('일식') ? '일식 일식집' :
            c.main?.includes('양식') ? '양식' :
            c.main?.includes('상관') ? '맛집' : '한식 고기집',
    '가족': '가족 식사',
    '식사': c.main === '상관없음' || !c.main ? '맛집' :
            c.main === '한식' ? '한식 한식당' :
            c.main === '중식' ? '중식 중식당' :
            c.main === '일식' ? '일식 일식집' :
            c.main === '양식' ? '양식' :
            c.main === '동남아' ? '동남아음식점' : '맛집',
    '카페': c.main?.includes('빵') ? '빵 베이커리 맛집' :
            c.main?.includes('디저트') ? '디저트 카페' :
            c.main?.includes('음료') ? '카페 커피 맛집' : '카페',
    '청첩': c.main?.includes('맛집') ? '청첩모임 맛집' :
            c.main?.includes('분위기') ? '청첩모임 분위기' : '청첩모임 조용한',
  };
  const kw = map[t] || '맛집';
  return [kw, 'restaurant', kw];
}

async function runGemini(restaurants) {
  const list = restaurants.map((r, i) => {
    const blogText = (r.blog_snippets || []).join(' | ').slice(0, 300);
    return `${i+1}. ${r.name}
   주소: ${r.formatted_address || ''}
   블로그 후기: ${blogText || '없음'}`;
  }).join('\n\n');

  const cond = Store.getCondition();
  const cstr = cond.main || cond.selected?.join(', ') || '상관없음';
  const prompt = `당신은 한국 맛집 큐레이터입니다.

[지시사항]
아래 식당 목록에서 "${Store.getType()}" 모임 (조건: ${cstr})에 가장 잘 맞는 TOP 3를 선정하세요.
각 식당의 description과 tags는 반드시 블로그 후기 내용을 기반으로 아래 형식에 맞게 작성하세요.

[description template]
 대표메뉴: (블로그에서 언급된 음식/음료명 최대 3개를 적절한 음식 이모티콘 삽입해서 넣기)
 분위기·특징을 15자 이내로 요약해서 딱 보면 어떤 곳인지 알 수 있게 작성 (이모티콘 활용 권장)

[tags 형식]
블로그 후기에서 추출한 음식/분위기/특징 키워드 3개

[주의사항]
- 블로그 원문 문장을 절대 그대로 복사하지 마세요
- 한줄요약은 반드시 15자 이내
- 블로그 내용이 없으면 식당명과 주소로 유추해서 작성

식당 목록:
${list}

반드시 아래 JSON 배열 형식으로만 응답하세요. 다른 텍스트 없이 JSON만:
[{"rank":1,"name":"식당명","description":"🍽 대표메뉴: 메뉴1, 메뉴2\n✨ 한줄요약: 15자이내요약","tags":["태그1","태그2","태그3"]},{"rank":2,"name":"식당명","description":"🍽 대표메뉴: 메뉴1, 메뉴2\n✨ 한줄요약: 15자이내요약","tags":["태그1","태그2","태그3"]},{"rank":3,"name":"식당명","description":"🍽 대표메뉴: 메뉴1, 메뉴2\n✨ 한줄요약: 15자이내요약","tags":["태그1","태그2","태그3"]}]`;

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
      const clean = text.replace(/^
http://googleusercontent.com/immersive_entry_chip/0

이제 전역 상태 객체(`S`)로 인한 예측 불가능한 버그를 완벽하게 차단했으며, 서비스 이용 시 식당 정보를 하염없이 기다리게 만들었던 치명적인 사용성 이슈도 백그라운드 병렬 처리로 해결되었습니다. 적용해 보시고 예상치 못한 화면 깨짐이 발생한다면 즉시 피드백 부탁드립니다.