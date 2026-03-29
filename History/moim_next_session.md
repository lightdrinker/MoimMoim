# Moim 프로젝트 인수인계 문서

## 배포 URL
https://moim-moim-tau.vercel.app

## GitHub
https://github.com/lightdrinker/MoimMoim

## 프로젝트 개요
여러 명이 각자 출발지를 입력하면 가중 중간지점을 계산해서 AI가 모임 장소(식당/카페 등)를 추천해주는 서비스

## 기술 스택
- Frontend: Vanilla JS (파일 분리 구조)
- Backend: Vercel 서버리스 (api/places.js)
- APIs: Google Maps JS, Google Places, 네이버 로컬/블로그, Gemini 2.0 Flash
- 배포: GitHub → Vercel 자동배포

## 파일 구조
```
MoimMoim/
├── api/
│   └── places.js       ← 서버 (네이버 + Google + Gemini + 블로그)
├── src/
│   ├── js/
│   │   ├── app.js      ← 상태관리 (S 객체), 네비게이션, 조건 선택
│   │   ├── map.js      ← 지도, 핀, 중간지점 계산
│   │   ├── search.js   ← 장소 검색 (Google Autocomplete)
│   │   └── result.js   ← 결과 렌더링, Gemini 호출, 공유
│   └── styles/
│       └── main.css
├── index.html
└── vercel.json
```

## 추천 로직 흐름
```
1. 가중 중간지점 계산 (인원수 반영)
2. 네이버 로컬 검색 (중간지점 + 키워드, 예: "종암동 막걸리집")
3. Google Places로 사진/평점 보완 (식당명 매칭)
4. 블로그 snippet 수집 (식당명 + "맛집 후기"로 검색)
5. Gemini가 TOP 3 선정 + 설명 생성 (블로그 후기 참고)
6. 결과 화면 렌더링
```

## 오늘 완료한 작업
- VS Code + Git 로컬 환경 세팅 (git push → Vercel 자동배포)
- 단일 HTML → 폴더 구조로 분리
- Google Maps API 키 도메인 제한 설정
- 추천 로직 개선 (후보 풀 5→10개, 평점 3.5↑ 필터, tier1/tier2 구조)
- 네이버 검색 키워드 단순화 (한국어 단어 위주)
- 블로그 snippet 재도입 (식당명 기반 검색으로 납품점 문제 해결)
- 결과 화면 버튼 추가 (모임 속성 바꾸기, 결과 복사하기, 새 모임 시작)
- 카카오톡 공유 → 텍스트 복사 방식으로 변경 (3개 식당 + 네이버맵 링크)
- 버튼 간격 통일

## 다음 세션 즉시 작업할 버그

### 1. 사진 안 뜨는 문제
**원인**: Google 매칭 실패한 식당은 photos 데이터가 없음
**현재 코드 위치**: api/places.js → Google Text Search 매칭 로직
**해결 방향**: 매칭 실패 식당도 사진을 가져올 수 있는 대안 찾기
- 네이버 로컬 검색 결과에 이미지 URL이 있는 경우 활용 가능 (item.thumbnail)
- 또는 Google Places Text Search를 이름만으로 한 번 더 시도

### 2. 블로그 글 그대로 복사되는 문제
**현재 증상**: Gemini가 블로그 후기 원문을 그대로 description에 삽입
예시: "안암역 가성비 맛집 <팽전집> 후기! 그래도 9000원이라는 가격이 너무 만족스러워서..."
**현재 코드 위치**: src/js/result.js → runGemini() 함수 → prompt
**해결 방향**: 
- Gemini 프롬프트 강화 (블로그 원문 절대 금지, 핵심 키워드만 추출해서 재작성 지시)
- 또는 블로그 snippet을 Gemini에 넘기기 전에 전처리 (태그/특수문자 제거 + 핵심 키워드만 추출)

## 주요 환경변수 (Vercel에 설정됨)
- GOOGLE_PLACES_API_KEY
- GEMINI_API_KEY
- NAVER_CLIENT_ID
- NAVER_CLIENT_SECRET

## 다음 세션 시작 방법
1. 이 md 파일 첨부
2. api/places.js, src/js/result.js 첨부
3. "위 문서 기반으로 다음 세션 작업 시작해줘" 라고 입력
