# MoiM 확장 기획 — 날짜 투표 + 장소 찾기 원스톱

## 배경

현재 MoiM(watch-moim.vercel.app)은 **장소 찾기** 도구야.  
호스트가 참여자 위치를 직접 입력 → 중간지점 계산 → 장소 추천.

문제는 실제 모임 준비 흐름에서 장소 찾기는 **날짜 확정 이후**에 오는 스텝이라는 거야.  
지금은 그 앞 단계(날짜 조율)가 빠져 있음.

---

## 핵심 인사이트

> 보통 기획자가 날짜 후보를 몇 개 던지고,  
> 참여자들이 엑셀 파일에 O 표시 → 가장 O 많은 날로 확정하는 흐름.

이걸 MoiM 안으로 가져오면:
- 기존 네이버 폼 / 카카오 폼과 차별점 = **날짜 확정 후 바로 장소 찾기로 연결**
- 날짜 → 장소가 하나의 앱에서 원스톱

---

## 확정된 사용자 플로우

```
1. 기획자가 날짜 후보 N개 선택
          ↓
2. 링크 생성 → 카카오톡 / 링크 복사로 공유
          ↓
3. 참여자들: 이름 입력 + 가능한 날짜에 O 탭탭탭 (30초 이내, 비로그인)
          ↓
4. 실시간 집계 화면 (다른 사람 응답 보임 → 참여율 ↑)
          ↓
5. 날짜 확정 (기획자가 최다 O 날짜 선택)
          ↓
6. "장소 찾기" 진입 → 참여자들 각자 위치 입력
          ↓
7. 중간지점 계산 + 장소 추천 (기존 MoiM 로직)
```

---

## MVP 범위

### ✅ 포함
- 기획자 날짜 후보 선택 UI
- 링크 생성 (고유 room ID)
- 참여자 비로그인 응답 (이름 + O 선택)
- 실시간 집계 뷰
- 날짜 확정 → 장소 찾기 연결
- 참여자 위치 입력 → 중간지점 계산 (기존 로직 재활용)

### ❌ 제외 (오버엔지니어링)
- 장소 투표 기능
- 채팅 / 댓글
- 푸시 알림
- 회원가입 / 로그인

---

## 기술 스택 변경사항

| 항목 | 현재 | 변경 |
|------|------|------|
| 상태 관리 | Stateless (서버리스) | **Supabase** 추가 필요 |
| DB | 없음 | room / participant / vote 테이블 |
| 프론트 | Vanilla HTML/CSS/JS | 유지 |
| 배포 | Vercel | 유지 |
| API | Naver Local, Google Places, Gemini | 유지 |

---

## Supabase 테이블 설계 (초안)

```sql
-- 모임 방
rooms
  id          uuid PK
  created_at  timestamp
  host_name   text
  dates       text[]   -- 후보 날짜 배열
  final_date  text     -- 확정 날짜 (nullable)
  status      text     -- 'voting' | 'confirmed' | 'finding_place'

-- 참여자
participants
  id          uuid PK
  room_id     uuid FK → rooms.id
  name        text
  available_dates text[]  -- O 표시한 날짜들
  location    text        -- 장소 찾기 단계에서 입력

```

---

## 기존 MoiM 재활용 포인트

- `weighted centroid` 알고리즘 → 그대로 사용
- Naver Local Search / Google Places 연동 → 그대로 사용
- Gemini AI 장소 설명 → 그대로 사용
- 크림/핑크-퍼플 브랜드 디자인 → 유지

---

## 다음 스텝 (Claude Code에서 진행)

1. Supabase 프로젝트 생성 + 테이블 설계 확정
2. room 생성 → 링크 발급 플로우 구현
3. 참여자 응답 UI (날짜 O 선택)
4. 실시간 집계 뷰
5. 날짜 확정 → 기존 장소 찾기 연결
