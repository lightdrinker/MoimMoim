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

  // ── 음식 사전 / 카테고리 매핑 / 메뉴 추출 / 스코어링 유틸
  const FOOD_DICT = [
    // 한식
    '삼겹살','목살','오겹살','갈비살','차돌박이','우삼겹','LA갈비','갈비탕','갈비찜','갈비','등심','안심','육회',
    '김치찌개','된장찌개','부대찌개','순두부찌개','순두부','김치찜','순대국','순댓국','감자탕','뼈해장국','해장국','설렁탕','곰탕','육개장','삼계탕','닭한마리','닭볶음탕',
    '곱창','대창','막창','닭갈비','제육볶음','제육','불고기','떡갈비','족발','보쌈','수육','김치말이','국밥',
    '비빔밥','회덮밥','연어덮밥','참치덮밥','오징어덮밥','떡볶이','순대','튀김','김밥','라면','우동','만두','칼국수','콩국수','잔치국수','수제비','냉면','막국수','국수',
    '김치전','파전','부추전','해물파전','모듬전','메밀전병','전','전골','뚝배기',
    // 중식
    '짜장면','짬뽕','탕수육','마라탕','마라샹궈','꿔바로우','양꼬치','마파두부','짜장','쟁반짜장','삼선짜장','볶음밥','동파육','깐풍기','유린기',
    // 일식
    '초밥','스시','사시미','회','연어','참치','우니','이자카야','꼬치','야키토리','오뎅','어묵',
    '라멘','돈코츠','쇼유','텐푸라','텐동','오므라이스','카레','돈까스','규동','우니덮밥','오니기리','마끼','롤','가츠동',
    // 양식
    '파스타','피자','스테이크','리조또','라자냐','뇨끼','샐러드','브런치','수프','감자튀김',
    '햄버거','부리또','타코','퀘사디아','샌드위치','스파게티','크림파스타','로제파스타','토마토파스타','봉골레','알리오올리오','까르보나라','뇨끼',
    // 디저트/카페
    '와플','팬케이크','케이크','컵케이크','마카롱','마들렌','쿠키','크로와상','크로플','크로크무슈','베이글','도넛','식빵','크림빵','앙버터','휘낭시에','스콘',
    '커피','아메리카노','라떼','카푸치노','에스프레소','드립커피','콜드브루','말차','녹차','홍차','얼그레이','스무디','에이드','주스','빙수','젤라또','아이스크림','밀크티','버블티',
    // 술
    '맥주','생맥주','수제맥주','크래프트맥주','크래프트','IPA','라거','흑맥주','스타우트','에일','밀맥주','필스너',
    '와인','레드와인','화이트와인','로제와인','스파클링','샴페인',
    '사케','정종','청주','막걸리','동동주','전통주','소주','과실주','매실주','복분자','칵테일','하이볼','진토닉','모히토','마티니','데킬라','위스키','보드카','럼','진',
    // 안주
    '치킨','후라이드','양념치킨','간장치킨','파닭','순살','뼈닭','반반','닭발','닭똥집','똥집','노가리','쥐포','마른안주','골뱅이','골뱅이무침','오징어','쭈꾸미','낙지',
    '소시지','햄','치즈','나초','피쉬앤칩스','올리브','피넛','콘치즈','계란찜','두부김치','감자전','옥수수치즈',
    // 동남아
    '쌀국수','분짜','반미','팟타이','똠얌꿍','나시고렝','미고렝','월남쌈','짜조','커리','똠얌',
  ];
  const FOOD_DICT_SORTED = [...new Set(FOOD_DICT)].sort((a, b) => b.length - a.length);

  const TYPE_MAP = {
    bar: { ko: '술집', icon: '🍻' },
    night_club: { ko: '클럽', icon: '🍸' },
    cafe: { ko: '카페', icon: '☕' },
    bakery: { ko: '베이커리', icon: '🥐' },
    meal_takeaway: { ko: '포장전문', icon: '🥡' },
    meal_delivery: { ko: '배달전문', icon: '🛵' },
    korean_restaurant: { ko: '한식', icon: '🍚' },
    chinese_restaurant: { ko: '중식', icon: '🥢' },
    japanese_restaurant: { ko: '일식', icon: '🍣' },
    italian_restaurant: { ko: '양식', icon: '🍝' },
    french_restaurant: { ko: '양식', icon: '🍷' },
    american_restaurant: { ko: '양식', icon: '🍔' },
    seafood_restaurant: { ko: '해산물', icon: '🦐' },
    steak_house: { ko: '스테이크', icon: '🥩' },
    pizza_restaurant: { ko: '피자', icon: '🍕' },
    sandwich_shop: { ko: '샌드위치', icon: '🥪' },
    hamburger_restaurant: { ko: '버거', icon: '🍔' },
    barbecue_restaurant: { ko: '바비큐', icon: '🍖' },
    restaurant: { ko: '음식점', icon: '🍽️' },
    food: { ko: '식당', icon: '🍽️' },
  };
  const SPECIFIC_TYPES = ['bar','cafe','bakery','night_club','meal_takeaway','meal_delivery','steak_house','pizza_restaurant','sandwich_shop','hamburger_restaurant','barbecue_restaurant','seafood_restaurant'];
  const CUISINE_TYPES = ['korean_restaurant','chinese_restaurant','japanese_restaurant','italian_restaurant','french_restaurant','american_restaurant'];

  const buildCategory = (types, menus) => {
    const t = types || [];
    const specific = t.find(x => SPECIFIC_TYPES.includes(x));
    const cuisine = t.find(x => CUISINE_TYPES.includes(x));
    let icon = '🍽️', label = '음식점';
    if (specific && cuisine) {
      icon = TYPE_MAP[specific].icon;
      label = `${TYPE_MAP[cuisine].ko} · ${TYPE_MAP[specific].ko}`;
    } else if (specific) {
      icon = TYPE_MAP[specific].icon;
      label = TYPE_MAP[specific].ko;
    } else if (cuisine) {
      icon = TYPE_MAP[cuisine].icon;
      label = TYPE_MAP[cuisine].ko;
    } else if (t.includes('restaurant')) {
      icon = TYPE_MAP.restaurant.icon;
      label = TYPE_MAP.restaurant.ko;
    }
    if (menus && menus.length) {
      label = `${label} · ${menus[0]} 전문`;
    }
    return { label: `${icon} ${label}`, icon };
  };

  const extractMenus = (snippetText, keywordRaw) => {
    const text = (snippetText || '').toString();
    const counts = new Map();
    if (text) {
      for (const word of FOOD_DICT_SORTED) {
        if (!text.includes(word)) continue;
        const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        const m = text.match(re);
        if (m) counts.set(word, m.length);
      }
    }
    if (keywordRaw) {
      keywordRaw.split(/\s+/).forEach(w => {
        if (FOOD_DICT.includes(w) && !counts.has(w)) counts.set(w, 1);
      });
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([w]) => w);
  };

  const normalize = (vals, reverse = false) => {
    if (!vals.length) return [];
    let min = Infinity, max = -Infinity;
    for (const v of vals) { if (v < min) min = v; if (v > max) max = v; }
    if (max === min) return vals.map(() => 0.5);
    return vals.map(v => {
      const n = (v - min) / (max - min);
      return reverse ? 1 - n : n;
    });
  };

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

      // ── 3단계: 블로그 snippet/hit 수 + 네이버 이미지 수집 (장소당 병렬 처리)
      if (NAVER_ID && NAVER_SECRET) {
        const fetchBlog = async (q) => {
          try {
            const blogUrl = `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(q)}&display=3&sort=sim`;
            const blogRes = await fetch(blogUrl, {
              headers: { 'X-Naver-Client-Id': NAVER_ID, 'X-Naver-Client-Secret': NAVER_SECRET },
            });
            const blogData = await blogRes.json();
            const snippets = (blogData.items || []).slice(0, 3).map(item =>
              (item.title + ' ' + item.description)
                .replace(/<[^>]+>/g, '')
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&')
                .replace(/&#\d+;/g, '')
                .slice(0, 200)
            );
            return { total: blogData.total || 0, snippets };
          } catch { return { total: 0, snippets: [] }; }
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
          const [locResult, menuResult, naverImages] = await Promise.all([
            fetchBlog(queryWithLoc),
            fetchBlog(`${place.name} 메뉴`),
            fetchImage(place.name, dong, keyword),
          ]);

          // 위치 결과가 부족할 때만 이름 단독 재시도 (1회만)
          let snippets = locResult.snippets;
          let total = locResult.total;
          if (snippets.length < 2 && dong) {
            const retry = await fetchBlog(place.name);
            snippets = retry.snippets;
            total = retry.total || total;
          }

          place.blog_snippets = snippets;
          place.menu_snippets = menuResult.snippets;
          place.naver_image_urls = naverImages;
          place.blog_count = total;
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
        if (!r.types || !r.types.length) return true;
        return !r.types.some(t => GOOGLE_BLOCKED_TYPES.includes(t));
      };
      const enrichedFiltered = enriched.filter(isGoogleFoodPlace);

      // ── 4단계: 메뉴/카테고리 추출 + 거리 + 결정론적 스코어링
      enrichedFiltered.forEach(p => {
        const blogText = (p.blog_snippets || []).join(' ');
        const menuText = (p.menu_snippets || []).join(' ');
        p.menus = extractMenus(`${menuText} ${blogText}`, keyword);
        const cat = buildCategory(p.types, p.menus);
        p.category_label = cat.label;
        p.category_icon = cat.icon;
        p.dist_m = (p._lat && p._lng)
          ? Math.round(distKm(midLat, midLng, p._lat, p._lng) * 1000)
          : null;
      });

      const ratingRaw = enrichedFiltered.map(p => (p.rating || 0) * Math.log((p.user_ratings_total || 0) + 1));
      const blogRaw = enrichedFiltered.map(p => p.blog_count || 0);
      const distRaw = enrichedFiltered.map(p => p.dist_m == null ? 9999 : p.dist_m);

      const ratingN = normalize(ratingRaw);
      const blogN = normalize(blogRaw);
      const distN = normalize(distRaw, true);

      const kwTokens = (keyword || '').split(/\s+/).filter(Boolean);
      const matchKeyword = (p) => {
        if (!kwTokens.length) return 0;
        const hay = `${p.name} ${p.formatted_address} ${(p.menus || []).join(' ')}`;
        return kwTokens.some(t => hay.includes(t)) ? 1 : 0;
      };

      enrichedFiltered.forEach((p, i) => {
        p.score = +(
          0.35 * ratingN[i] +
          0.25 * blogN[i] +
          0.20 * distN[i] +
          0.10 * (p.photos?.length > 0 ? 1 : 0) +
          0.10 * matchKeyword(p)
        ).toFixed(3);
      });

      const finalFiltered = [...enrichedFiltered]
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

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