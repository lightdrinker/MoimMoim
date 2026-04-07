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

      let radiusUsed = 2.0;

      // ── 1단계: Google Text Search — 관련도순 (인기도 반영)
      const doTextSearch = async (radiusM) => {
        const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(keyword)}&location=${midLat},${midLng}&radius=${radiusM}&language=ko&region=kr&key=${GKEY}`;
        const r = await fetch(url);
        const d = await r.json();
        return (d.results || []).filter(p => {
          const loc = p.geometry?.location;
          return loc ? distKm(midLat, midLng, loc.lat, loc.lng) <= radiusM / 1000 : false;
        });
      };

      let rawPlaces = [];
      for (const radiusM of [2000, 3500, 5000]) {
        rawPlaces = await doTextSearch(radiusM);
        radiusUsed = radiusM / 1000;
        if (rawPlaces.length >= 3) break;
      }

      if (!rawPlaces.length) return res.status(200).json({ results: [] });

      const enriched = rawPlaces.slice(0, 20).map(p => ({
        place_id: p.place_id,
        name: p.name || '',
        formatted_address: p.formatted_address || '',
        rating: p.rating || null,
        user_ratings_total: p.user_ratings_total || 0,
        photos: (p.photos || []).slice(0, 3).map(ph => ({ photo_reference: ph.photo_reference })),
        price_level: p.price_level || null,
        types: p.types || [],
        _lat: p.geometry?.location?.lat,
        _lng: p.geometry?.location?.lng,
      }));

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

        const fetchImageQuery = async (q) => {
          try {
            const imgUrl = `https://openapi.naver.com/v1/search/image.json?query=${encodeURIComponent(q)}&display=3`;
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

        // 영문 제거한 이름 (e.g. "버누드 BurnWood" → "버누드")
        const koreanOnly = (name) => name.replace(/[A-Za-z0-9\s]+/g, '').replace(/\s+/g, ' ').trim();

        const fetchImage = async (name, dong, keyword) => {
          // 1차: 이름 + 동 + 맛집
          let imgs = await fetchImageQuery(dong ? `${name} ${dong} 맛집` : `${name} 맛집`);
          if (imgs.length) return imgs;

          // 2차: 이름 단독
          imgs = await fetchImageQuery(name);
          if (imgs.length) return imgs;

          // 3차: 영문 제거한 이름 (영문 혼합 장소명 대응)
          const koName = koreanOnly(name);
          if (koName && koName !== name) {
            imgs = await fetchImageQuery(koName);
            if (imgs.length) return imgs;
          }

          // 4차: 키워드 + 동 (최후 수단)
          if (keyword && dong) {
            imgs = await fetchImageQuery(`${keyword} ${dong} 음식`);
          }
          return imgs;
        };

        await Promise.all(enriched.map(async place => {
          const dong = extractDong(place.formatted_address);
          const queryWithLoc = dong ? `${dong} ${place.name}` : place.name;

          // 위치 블로그 · 메뉴 블로그 · 이미지 동시 요청
          const [snippetsWithLoc, menuSnippets, naverImages] = await Promise.all([
            fetchBlog(queryWithLoc),
            fetchBlog(`${place.name} 메뉴`),
            fetchImage(place.name, dong, keyword),
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

      // 평점 3.5↑ 우선, 나머지 후순위 (Google 결과라 전체 place_id 있음)
      const tier1 = enrichedFiltered.filter(r => r.rating >= 3.5);
      const tier2 = enrichedFiltered.filter(r => !r.rating || r.rating < 3.5);
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