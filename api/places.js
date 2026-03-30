export const config = {
  api: { bodyParser: true },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, photo_references, maxwidth = 600 } = req.query;

  if (action === 'gemini') {
    const KEY = process.env.GEMINI_API_KEY;
    if (!KEY) return res.status(500).json({ error: 'Gemini API key not configured' });
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const prompt = body?.prompt || '';
    if (!prompt) return res.status(400).json({ error: 'No prompt' });
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
          }),
        }
      );
      const d = await r.json();
      console.log('Gemini raw response:', JSON.stringify(d));
      const text = d?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return res.status(200).json({ text });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (action === 'naver-image') {
    const imageUrl = decodeURIComponent(req.query.url || '');
    if (!imageUrl || !imageUrl.startsWith('http')) return res.status(400).end();
    try {
      const r = await fetch(imageUrl, {
        headers: {
          'Referer': 'https://www.naver.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      if (!r.ok) return res.status(r.status).end();
      const buffer = await r.arrayBuffer();
      const contentType = r.headers.get('content-type') || 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.end(Buffer.from(buffer));
    } catch {
      return res.status(500).end();
    }
  }

  const GKEY = process.env.GOOGLE_PLACES_API_KEY;
  if (!GKEY) return res.status(500).json({ error: 'Google API key not configured' });

  try {
    if (action === 'nearby') {
      const { lat, lng, keyword, district } = req.query;
      const midLat = parseFloat(lat), midLng = parseFloat(lng);

      const NAVER_ID = process.env.NAVER_CLIENT_ID;
      const NAVER_SECRET = process.env.NAVER_CLIENT_SECRET;
      const GEMINI_KEY = process.env.GEMINI_API_KEY;

      const toRad = d => d * Math.PI / 180;
      const distKm = (la1, ln1, la2, ln2) => {
        const R = 6371, dLa = toRad(la2-la1), dLn = toRad(ln2-ln1);
        const a = Math.sin(dLa/2)**2 + Math.cos(toRad(la1))*Math.cos(toRad(la2))*Math.sin(dLn/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      };

      // 주소에서 구/동 추출 헬퍼
      const extractDong = (addr) => {
        if (!addr) return '';
        const cleaned = addr
          .replace(/^대한민국\s*/, '')
          .replace(/^(서울특별시|경기도|부산광역시|인천광역시|대구광역시|대전광역시|광주광역시|울산광역시|세종특별자치시)\s*/, '');
        const dongM = cleaned.match(/[가-힣]+[구군]\s*([가-힣0-9]+(?:동|가|읍|면|리))\b/);
        const guM = cleaned.match(/([가-힣]+[구군])/);
        return dongM?.[1] || guM?.[1] || '';
      };

      let finalResults = [];
      let radiusUsed = 2.0;

      // 네이버 카테고리 필터: 음식점/카페가 아닌 업종 제거
      const NAVER_ALLOWED_CAT = ['음식점', '카페', '베이커리'];
      const NAVER_BLOCKED_CAT = ['쇼핑', '서비스업', '여행', '숙박', '교육', '의료', '금융', '공공기관', '스포츠', '문화'];
      const isNaverFoodPlace = (item) => {
        const cat = item.category || '';
        if (!cat) return true; // 카테고리 없으면 통과 (Google로 검증)
        if (NAVER_BLOCKED_CAT.some(b => cat.includes(b))) return false;
        return true; // 음식점 카테고리 없어도 차단 카테고리 아니면 통과
      };

      // ── 1단계: 네이버 로컬 검색
      if (NAVER_ID && NAVER_SECRET) {
        const regionPrefix = district || '서울';
        const naverQuery = `${regionPrefix} ${keyword}`;
        const naverUrl = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(naverQuery)}&display=40&sort=sim`;
        try {
          const naverRes = await fetch(naverUrl, {
            headers: {
              'X-Naver-Client-Id': NAVER_ID,
              'X-Naver-Client-Secret': NAVER_SECRET,
            },
          });
          const naverData = await naverRes.json();
          const naverItems = (naverData.items || []).filter(isNaverFoodPlace);
          const withCoords = naverItems.map(item => ({
            ...item,
            _lat: parseInt(item.mapy) * 1e-7,
            _lng: parseInt(item.mapx) * 1e-7,
          }));
          let nearby = [];
          for (const radius of [2.0, 3.5, 5.0]) {
            nearby = withCoords.filter(item =>
              distKm(midLat, midLng, item._lat, item._lng) <= radius
            );
            radiusUsed = radius;
            if (nearby.length >= 3) break;
          }
          finalResults = nearby;
        } catch { /* 네이버 실패 시 Google fallback */ }
      }

      // ── 2단계: Google Text Search로 사진/평점 보완
      const fields = 'name,rating,user_ratings_total,formatted_address,photos,price_level,opening_hours,place_id,types';
      const enriched = await Promise.all(finalResults.slice(0, 10).map(async item => {
        const placeName = item.title
          ? item.title.replace(/<[^>]+>/g, '')
          : (item.name || '');
        const placeAddr = item.roadAddress || item.address || '';

        try {
          const addrShort = (() => {
            const guM = placeAddr.match(/([가-힣]+[구군])/);
            const dongM = placeAddr.match(/[가-힣]+[구군]\s*([가-힣0-9]+(?:동|가|읍|면|리))\b/);
            return [guM?.[1], dongM?.[1]].filter(Boolean).join(' ');
          })();

          const q = addrShort ? `${placeName} ${addrShort}` : placeName;
          const tsUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&language=ko&key=${GKEY}`;
          const tsRes = await fetch(tsUrl);
          const tsData = await tsRes.json();
          const candidates = (tsData.results || []).slice(0, 3);

          const normalize = s => s.replace(/\s/g, '').toLowerCase();
          const nName = normalize(placeName);

          const gResult = candidates.find(c => {
            if (!c.place_id) return false;
            const gLat = c.geometry?.location?.lat;
            const gLng = c.geometry?.location?.lng;
            if (!gLat || !gLng) return false;
            if (distKm(item._lat, item._lng, gLat, gLng) > 5.0) return false;
            const gName = normalize(c.name || '');
            if (nName === gName) return true;
            // 짧은 이름(3자 이하)은 정확히 일치해야만 매칭
            if (nName.length <= 3 || gName.length <= 3) return nName === gName;
            // 4자 이상: 최소 4자 prefix가 서로 포함되어야 매칭
            const matchLen = Math.min(4, Math.min(nName.length, gName.length));
            return gName.includes(nName.slice(0, matchLen)) || nName.includes(gName.slice(0, matchLen));
          }) || null;

          if (gResult?.place_id) {
            const dr = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${gResult.place_id}&fields=${fields}&language=ko&key=${GKEY}`);
            const dd = await dr.json();
            const detail = dd.result || gResult;
            return {
              ...detail,
              name: placeName,
              formatted_address: placeAddr || detail.formatted_address || '',
            };
          }
        } catch { /* Google 실패 시 네이버 데이터만 사용 */ }

        return {
          name: placeName,
          formatted_address: placeAddr,
          rating: null,
          user_ratings_total: 0,
          photos: [],
          place_id: null,
        };
      }));

      // Google fallback: 네이버 결과가 없을 경우
      if (!enriched.length) {
        const textUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent((district || '') + ' ' + keyword)}&location=${lat},${lng}&radius=2000&language=ko&region=kr&key=${GKEY}`;
        const textRes = await fetch(textUrl);
        const textData = await textRes.json();
        const gResults = (textData.results || []).filter(r => {
          const rl = r.geometry?.location;
          return rl ? distKm(midLat, midLng, rl.lat, rl.lng) <= 2.0 : false;
        });
        if (!gResults.length) return res.status(200).json({ results: [] });
        const fallbackDetails = await Promise.all(gResults.slice(0, 10).map(async r => {
          try {
            const dr = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${r.place_id}&fields=${fields}&language=ko&key=${GKEY}`);
            const dd = await dr.json();
            return dd.result || r;
          } catch { return r; }
        }));
        enriched.push(...fallbackDetails);
      }

      if (!enriched.length) return res.status(200).json({ results: [] });

      // ── 3단계: 블로그 snippet + 네이버 이미지 수집 (장소당 병렬 처리)
      if (NAVER_ID && NAVER_SECRET) {
        const fetchBlog = async (q) => {
          try {
            const blogUrl = `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(q)}&display=3&sort=sim`;
            const blogRes = await fetch(blogUrl, {
              headers: { 'X-Naver-Client-Id': NAVER_ID, 'X-Naver-Client-Secret': NAVER_SECRET },
            });
            const blogData = await blogRes.json();
            return (blogData.items || []).slice(0, 3).map(item =>
              (item.title + ' ' + item.description)
                .replace(/<[^>]+>/g, '')
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&')
                .replace(/&#\d+;/g, '')
                .slice(0, 200)
            );
          } catch { return []; }
        };

        const fetchImage = async (name, dong) => {
          try {
            const imgQ = dong ? `${name} ${dong} 맛집` : `${name} 음식`;
            const imgUrl = `https://openapi.naver.com/v1/search/image.json?query=${encodeURIComponent(imgQ)}&display=3`;
            const imgRes = await fetch(imgUrl, {
              headers: { 'X-Naver-Client-Id': NAVER_ID, 'X-Naver-Client-Secret': NAVER_SECRET },
            });
            const imgData = await imgRes.json();
            return (imgData.items || [])
              .slice(0, 2)
              .map(item => item.thumbnail ? `/api/places?action=naver-image&url=${encodeURIComponent(item.thumbnail)}` : null)
              .filter(Boolean);
          } catch { return []; }
        };

        await Promise.all(enriched.map(async place => {
          const dong = extractDong(place.formatted_address);
          const queryWithLoc = dong ? `${dong} ${place.name}` : place.name;

          // 위치 블로그 · 메뉴 블로그 · 이미지 동시 요청
          const [snippetsWithLoc, menuSnippets, naverImages] = await Promise.all([
            fetchBlog(queryWithLoc),
            fetchBlog(`${place.name} 메뉴`),
            fetchImage(place.name, dong),
          ]);

          // 위치 결과가 부족할 때만 이름 단독 재시도 (1회만)
          let snippets = snippetsWithLoc;
          if (snippets.length < 2 && dong) {
            snippets = await fetchBlog(place.name);
          }

          place.blog_snippets = snippets;
          place.menu_snippets = menuSnippets;
          place.naver_image_urls = naverImages;
        }));
      }

      // ── 4단계: 블로그 snippet 없는 식당 → Gemini Grounding으로 보완 (5초 타임아웃)
      if (GEMINI_KEY) {
        await Promise.all(enriched.map(async place => {
          if (place.blog_snippets && place.blog_snippets.length > 0) return;
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 5000);
            const dong = extractDong(place.formatted_address);
            const locStr = dong ? `(위치: ${dong})` : '';
            const groundingPrompt = `${place.name} ${locStr} 식당에 대해 검색해서 실제로 확인된 대표 메뉴와 분위기만 100자 이내로 알려주세요. 검색 결과에서 확인된 정보가 없거나 불확실하면 반드시 "정보없음"이라고만 답하세요. 추측하거나 일반적인 내용을 작성하지 마세요.`;
            const gr = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: groundingPrompt }] }],
                  tools: [{ googleSearch: {} }],
                  generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
                }),
                signal: controller.signal,
              }
            );
            clearTimeout(timer);
            const gd = await gr.json();
            const groundingText = (gd?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
            if (groundingText && !groundingText.includes('정보없음') && groundingText.length > 15) {
              place.blog_snippets = [groundingText.slice(0, 300)];
            }
          } catch {
            // Grounding 실패/타임아웃 시 무시
          }
        }));
      }

      // Google types 필터: 음식점/카페가 아닌 업종 제거
      const GOOGLE_BLOCKED_TYPES = [
        'grocery_or_supermarket', 'supermarket', 'convenience_store',
        'department_store', 'shopping_mall', 'store', 'clothing_store',
        'liquor_store', 'wholesale_store', 'gas_station', 'car_dealer',
        'insurance_agency', 'real_estate_agency', 'bank', 'atm',
        'hospital', 'pharmacy', 'doctor', 'school', 'university',
        'lodging', 'hotel',
      ];
      const isGoogleFoodPlace = (r) => {
        if (!r.types || !r.types.length) return true; // types 없으면(Naver only) 통과
        return !r.types.some(t => GOOGLE_BLOCKED_TYPES.includes(t));
      };
      const enrichedFiltered = enriched.filter(isGoogleFoodPlace);

      // 1순위: Google 매칭 성공 + 평점 3.5↑
      const tier1 = enrichedFiltered.filter(r => r.place_id && r.rating >= 3.5);
      // 2순위: 나머지
      const tier2 = enrichedFiltered.filter(r => !r.place_id || !r.rating);
      const finalFiltered = [...tier1, ...tier2].slice(0, 10);

      return res.status(200).json({ results: finalFiltered, radiusUsed });
    }

    // ── 사진 URL 반환
    if (action === 'photo') {
      const refs = (photo_references || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 2);
      const urls = await Promise.all(refs.map(async ref => {
        try {
          const r = await fetch(
            `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxwidth}&photo_reference=${ref}&key=${GKEY}`,
            { redirect: 'follow' }
          );
          return r.url || null;
        } catch { return null; }
      }));
      return res.status(200).json({ photo_urls: urls.filter(Boolean) });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}