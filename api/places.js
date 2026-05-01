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

      // ── 지하철역 스냅: 수도권 주요역 좌표 목록 [name, lat, lng]
      const STATIONS = [
        // 2호선
        ['홍대입구',37.5573,126.9248],['신촌',37.5549,126.9365],['이대',37.5568,126.9464],
        ['합정',37.5497,126.9147],['당산',37.5336,126.9005],['문래',37.5176,126.8965],
        ['영등포구청',37.5261,126.8961],['신도림',37.5086,126.8912],['구로디지털단지',37.4854,126.9014],
        ['대림',37.4920,126.8964],['신대방',37.4887,126.9181],['신림',37.4851,126.9296],
        ['봉천',37.4838,126.9400],['서울대입구',37.4812,126.9527],['낙성대',37.4771,126.9647],
        ['사당',37.4760,126.9812],['방배',37.4813,126.9973],['서초',37.4913,127.0072],
        ['교대',37.4935,127.0142],['강남',37.4979,127.0276],['역삼',37.5002,127.0366],
        ['선릉',37.5045,127.0492],['삼성',37.5087,127.0635],['종합운동장',37.5108,127.0730],
        ['잠실새내',37.5085,127.0935],['잠실',37.5133,127.1001],['잠실나루',37.5165,127.0997],
        ['강변',37.5340,127.0940],['구의',37.5373,127.0868],['건대입구',37.5402,127.0698],
        ['성수',37.5443,127.0559],['뚝섬',37.5472,127.0481],['한양대',37.5547,127.0444],
        ['왕십리',37.5613,127.0375],['상왕십리',37.5613,127.0276],['신당',37.5659,127.0179],
        ['동대문역사문화공원',37.5651,127.0079],['을지로4가',37.5672,126.9980],
        ['을지로3가',37.5664,126.9908],['을지로입구',37.5660,126.9825],
        ['시청',37.5638,126.9773],['충정로',37.5594,126.9612],['아현',37.5556,126.9557],
        // 1호선
        ['서울역',37.5547,126.9706],['종각',37.5700,126.9817],['종로3가',37.5714,126.9914],
        ['종로5가',37.5707,127.0012],['동대문',37.5712,127.0097],['신설동',37.5762,127.0197],
        ['청량리',37.5806,127.0474],['남영',37.5432,126.9712],['용산',37.5298,126.9647],
        ['노량진',37.5138,126.9426],['신길',37.5165,126.9048],['영등포',37.5162,126.9077],
        ['구로',37.5014,126.8815],['온수',37.4999,126.8247],['부천',37.5037,126.7869],
        ['부평',37.4913,126.7195],['인천',37.4801,126.6236],
        ['창동',37.6529,127.0477],['도봉산',37.6890,127.0462],['의정부',37.7381,127.0435],
        ['양주',37.7855,127.0469],['동두천',37.9099,127.0290],
        // 3호선
        ['대화',37.6722,126.7715],['일산',37.6773,126.7689],['구파발',37.6338,126.9182],
        ['연신내',37.6191,126.9201],['불광',37.6107,126.9278],['홍제',37.5929,126.9443],
        ['경복궁',37.5784,126.9747],['안국',37.5769,126.9853],['충무로',37.5619,126.9939],
        ['동대입구',37.5584,126.9990],['약수',37.5557,127.0096],['옥수',37.5487,127.0189],
        ['압구정',37.5271,127.0278],['신사',37.5198,127.0199],['잠원',37.5142,127.0118],
        ['고속터미널',37.5047,127.0047],['남부터미널',37.4852,127.0147],
        ['양재',37.4845,127.0345],['도곡',37.4869,127.0454],['대치',37.4925,127.0614],
        ['수서',37.4878,127.1031],['가락시장',37.4922,127.1200],['오금',37.5009,127.1333],
        // 4호선
        ['당고개',37.6742,127.0686],['노원',37.6558,127.0563],['수유',37.6378,127.0253],
        ['미아사거리',37.6199,127.0306],['길음',37.6032,127.0258],
        ['성신여대입구',37.5927,127.0163],['혜화',37.5822,127.0013],
        ['명동',37.5637,126.9853],['회현',37.5577,126.9786],['숙대입구',37.5467,126.9718],
        ['삼각지',37.5352,126.9689],['이촌',37.5219,126.9614],['동작',37.5104,126.9793],
        ['총신대입구',37.4976,126.9835],['인덕원',37.3953,126.9637],['평촌',37.3924,126.9519],
        ['범계',37.3876,126.9534],['금정',37.3722,126.9282],['안산',37.2696,126.8185],
        ['오이도',37.2344,126.8213],
        // 5호선
        ['방화',37.5710,126.8010],['김포공항',37.5623,126.8012],['여의도',37.5213,126.9244],
        ['공덕',37.5439,126.9516],['광화문',37.5716,126.9768],['군자',37.5567,127.0790],
        ['아차산',37.5560,127.0905],['천호',37.5387,127.1240],['강동',37.5300,127.1342],
        ['마천',37.4820,127.1545],['하남검단산',37.5346,127.2258],
        // 6호선
        ['디지털미디어시티',37.5766,126.8964],['월드컵경기장',37.5583,126.9171],
        ['마포구청',37.5565,126.9077],['상수',37.5487,126.9239],
        ['이태원',37.5345,126.9941],['한강진',37.5379,127.0023],
        ['버티고개',37.5479,127.0068],['안암',37.5876,127.0294],['고려대',37.5873,127.0303],
        ['태릉입구',37.6212,127.0749],['신내',37.6237,127.0929],
        // 7호선
        ['장암',37.7351,127.0768],['중계',37.6404,127.0725],['상봉',37.5960,127.0850],
        ['면목',37.5876,127.0825],['뚝섬유원지',37.5316,127.0665],['청담',37.5246,127.0529],
        ['강남구청',37.5215,127.0416],['학동',37.5148,127.0323],['논현',37.5112,127.0246],
        ['내방',37.4953,126.9987],['남성',37.4889,126.9818],['장승배기',37.5046,126.9421],
        ['신풍',37.5072,126.9023],['가산디지털단지',37.4778,126.8826],
        ['부천종합운동장',37.5048,126.7905],['부평구청',37.5014,126.7224],
        // 8호선
        ['암사',37.5495,127.1320],['석촌',37.5063,127.1090],['문정',37.4846,127.1258],
        ['복정',37.4463,127.1505],['모란',37.4141,127.1287],
        // 9호선
        ['가양',37.5516,126.8496],['증미',37.5444,126.8626],['염창',37.5383,126.8866],
        ['선유도',37.5367,126.9023],['국회의사당',37.5275,126.9179],['샛강',37.5175,126.9290],
        ['노들',37.5105,126.9496],['흑석',37.5038,126.9656],['구반포',37.5039,126.9919],
        ['신논현',37.5040,127.0248],['언주',37.5015,127.0392],['봉은사',37.5120,127.0760],
        ['올림픽공원',37.5160,127.1475],
        // 분당선
        ['서울숲',37.5447,127.0382],['압구정로데오',37.5269,127.0400],['한티',37.4975,127.0507],
        ['구룡',37.4780,127.0588],['야탑',37.4047,127.1263],['이매',37.3965,127.1361],
        ['서현',37.3839,127.1208],['수내',37.3765,127.1111],['정자',37.3630,127.1178],
        ['미금',37.3582,127.1084],['오리',37.3519,127.1052],['죽전',37.3284,127.1094],
        ['기흥',37.2756,127.0990],['수원',37.2664,127.0003],
        // 신분당선
        ['양재시민의숲',37.4674,127.0384],['청계산입구',37.4445,127.0490],
        ['판교',37.3944,127.1106],['동천',37.3453,127.1101],['수지구청',37.3233,127.0993],
        ['광교중앙',37.2730,127.0431],['광교',37.2608,127.0276],
        // 경의중앙선
        ['문산',37.8686,126.7704],['운정',37.7346,126.7237],['화정',37.6326,126.8303],
        ['능곡',37.6260,126.8261],['행신',37.5989,126.8330],['수색',37.5799,126.8843],
        ['망우',37.5938,127.0861],['구리',37.5973,127.1299],['도농',37.5994,127.1515],
        ['양평',37.5527,127.4020],
        // 인천 1호선
        ['계양',37.5436,126.7383],['부개',37.4982,126.7387],['동암',37.4831,126.7016],
        ['주안',37.4674,126.6892],['인천시청',37.4562,126.7053],
        // GTX-A
        ['성남',37.4469,127.1378],['동탄',37.1990,127.0752],
      ];

      const nearestStation = (lat, lng) => STATIONS
        .map(([name, slat, slng]) => ({ name, lat: slat, lng: slng, dist: distKm(lat, lng, slat, slng) }))
        .sort((a, b) => a.dist - b.dist)[0];

      const snap = nearestStation(midLat, midLng);
      const searchLat = snap.lat;
      const searchLng = snap.lng;

      let radiusUsed = 2.0;

      // ── 1단계: Google Text Search — 스냅된 역 기준
      const doTextSearch = async (radiusM) => {
        const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(snap.name + ' ' + keyword)}&location=${searchLat},${searchLng}&radius=${radiusM}&language=ko&region=kr&key=${GKEY}`;
        const r = await fetch(url);
        const d = await r.json();
        return d.results || [];
      };

      let rawPlaces = [];
      for (const radiusM of [2000, 3000]) {
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

      return res.status(200).json({ results: finalFiltered, radiusUsed, snappedStation: snap.name, snappedDistKm: Math.round(snap.dist * 10) / 10 });
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