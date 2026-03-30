# Moim (Meet in the Middle) — CLAUDE.md

## 프로젝트 개요
여러 출발지의 **가중 중간지점**을 계산하고, 그 근처 맛집/카페를 추천하는 웹 서비스.
- 배포: https://moim-moim-tau.vercel.app
- 로컬 개발: `npx vercel dev` (포트 3000) — `.claude/launch.json` 설정됨
- GitHub: https://github.com/lightdrinker/MoimMoim

## 기술 스택
- **Frontend**: Vanilla JS + HTML/CSS (빌드 도구 없음, package.json 없음)
- **Backend**: Vercel Serverless Function (`api/places.js` 단일 파일)
- **지도**: Google Maps JS API
- **장소 추천**: Naver Local Search → Google Places Details → Naver Blog/Image → Gemini 큐레이션

## 파일 구조
```
api/places.js        # 모든 백엔드 로직 (단일 serverless function)
src/js/
  app.js             # 앱 초기화, 화면 전환, URL 공유 hash 처리
  map.js             # Google Maps, 핀 관리, 가중 중간지점 계산
  result.js          # 장소 추천 파이프라인, 카드 렌더링, 공유 기능
  search.js          # 역/장소 검색 자동완성
index.html           # 단일 HTML (SPA 구조, 화면별 section)
src/styles/main.css  # 전체 스타일
vercel.json          # API rewrite 설정
```

## 핵심 로직

### 1. 가중 중간지점 (map.js — weightedCentroid)
- 핀마다 인원수(count) 설정 가능
- 위도/경도를 인원수로 가중평균하여 중간지점 계산
- 1인 출발지도 허용 (인원수 설정으로 두 사람이 같은 곳에서 출발 가능)

### 2. 장소 추천 파이프라인 (api/places.js — action=nearby)
```
Stage 1: Naver Local Search
  - 쿼리: "{동+구} {keyword}" (e.g. "한강로2가 용산구 맥주 호프")
  - display=40, sort=sim
  - 카테고리 필터: 쇼핑/서비스업/숙박 등 음식점 아닌 업종 제거
  - 반경 2km → 3.5km → 5km 순으로 확장

Stage 2: Google Places Details 보완 (10개)
  - TextSearch → 이름+주소 매칭 → Details (rating, photos, types)
  - Google types 필터: liquor_store/supermarket 등 제거
  - tier1(Google 매칭+평점3.5↑) → tier2 순 정렬

Stage 3: Naver 블로그/이미지 수집 (장소당 병렬)
  - 블로그: [위치쿼리 + 메뉴쿼리] 동시 → 결과 부족시 이름 단독 retry
  - 이미지: 4단계 fallback
      1차: "{name} {dong} 맛집"
      2차: "{name}" 단독
      3차: 영문 제거한 한글 이름만 (e.g. "버누드 BurnWood" → "버누드")
      4차: "{keyword} {dong} 음식"
  - Naver 이미지는 CDN 차단 우회를 위해 서버사이드 프록시 (action=naver-image)

Stage 4: Gemini Grounding (블로그 없는 곳만, 5초 타임아웃)
  - gemini-2.5-flash + googleSearch tool
  - "정보없음" 응답 시 무시

Stage 5: 최종 정렬 → 10개 반환
```

### 3. Gemini 큐레이션 (result.js — runGemini)
- 프롬트: 모임 타입 + 조건 기반으로 TOP 10 순위 결정
- 출력 형식: `[{rank, name, description, tags}]` JSON
- description: "🍽 대표메뉴: ...\n✨ 한줄요약: ..." (블로그 근거 있을 때만)
- 할루시네이션 방지: 블로그 원문 근거 없으면 "후기 정보 없음"

### 4. 사진 로딩 (result.js — loadPhotos)
- Google photo_reference → `/api/places?action=photo` → redirect URL
- Google 없으면 → naver_image_urls (프록시 URL) fallback
- `photosFirst` 정렬: 사진 있는 곳을 앞으로

### 5. 키워드 매핑 (result.js — buildKw)
| 모임 타입 | 키워드 예시 |
|----------|------------|
| 술자리 | 맥주 호프 / 이자카야 / 막걸리 전통주 / 와인바 칵테일 |
| 회식 | 고기 삼겹살 / 해산물 / 한식 회식 등 |
| 가족 | 한식 가족 / 중식 가족 / 뷔페 등 |
| 식사 | 맛집 / 한식당 / 중식당 중국집 등 |
| 카페 | 카페 / 베이커리 빵집 / 디저트 카페 |
| 청첩 | 분위기 좋은 레스토랑 / 모임 맛집 레스토랑 |

## 환경변수 (Vercel에 설정됨)
```
GOOGLE_PLACES_API_KEY   # Google Places API
GEMINI_API_KEY          # Gemini 2.5 Flash
NAVER_CLIENT_ID         # Naver Search API
NAVER_CLIENT_SECRET
```

## API 엔드포인트 (api/places.js)
| action | 메서드 | 설명 |
|--------|--------|------|
| `nearby` | GET | 중간지점 장소 추천 메인 |
| `photo` | GET | Google Places 사진 URL 반환 |
| `gemini` | POST | Gemini 큐레이션 프록시 |
| `naver-image` | GET | Naver 이미지 CDN 프록시 (Referer 우회) |

## 주요 UI 기능
- **Next Top 3**: 결과 3개씩 페이지 전환 (S.recPage 기반)
- **결과 링크 공유**: 현재 페이지 3개를 URL hash로 인코딩 (`#share=...`)
- **개별 카드 공유**: 카드마다 ↗ 버튼 (shareCard)
- **결과 복사하기**: 현재 페이지 기준 텍스트 복사 (shareText)
- **공유 링크 수신**: app.js에서 DOMContentLoaded 시 hash 파싱 → showSharedResult

## 알려진 이슈 / 주의사항
- Naver 이미지 CDN은 Referer 없으면 placeholder 반환 (onerror 안 뜸) → 프록시 필수
- Google Places photo URL은 서버에서 redirect follow 후 최종 URL 반환
- Gemini Grounding은 느릴 수 있음 (5초 타임아웃 적용)
- 영문 포함 장소명은 Naver 이미지 검색 시 한글만 추출해서 재시도
- `vercel dev` 실행 시 Vercel 계정 로그인 필요

## 작업 루틴
- **변경 전 반드시 컨펌 받기** (분석/제안 → 사용자 확인 → 작업)
- 작업 완료 후 `git add → commit → push` (Vercel 자동 배포)
