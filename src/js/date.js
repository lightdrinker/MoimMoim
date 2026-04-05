/* ══════════════════════════════════════
   DATE VOTE — 날짜 투표 기능
   Supabase Realtime 연동 버전
   ══════════════════════════════════════ */

const SUPABASE_URL = 'https://rjohcfdmnywqutradryt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Yy3bIVFJJ58NjFPP0b_b5Q_O4MnL7zw';

const _sb = window.supabase;
const sb = (_sb && _sb.createClient)
  ? _sb.createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

if (!sb) console.warn('Supabase 로딩 실패');

const DateVote = (() => {
  let hostName = '';
  let expectedCount = null;
  let selectedDates = [];
  let calYear, calMonth;
  let currentRoomId = null;
  let realtimeSub = null;
  let voteCalYear, voteCalMonth;
  let roomDates = [];
  let suggestedDates = [];
  const MAX_DATES = 5;

  // ── Step 1: 이름 입력 ──
  function initNameScreen() {
    const input = document.getElementById('date-host-name');
    const btn = document.getElementById('date-name-next');
    input.value = '';
    btn.disabled = true;
    input.addEventListener('input', () => {
      btn.disabled = input.value.trim().length === 0;
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) dateNameNext();
    });
  }

  function nameNext() {
    const input = document.getElementById('date-host-name');
    hostName = input.value.trim();
    if (!hostName) return;

    const countInput = document.getElementById('date-expected-count');
    const val = parseInt(countInput?.value);
    expectedCount = (val >= 2 && val <= 99) ? val : null;

    selectedDates = [];
    initCalendar();
    go('s-date-pick');
  }

  // ── Step 2: 달력 날짜 선택 ──
  function initCalendar() {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
    renderCalendar();
  }

  function renderCalendar() {
    const title = document.getElementById('date-cal-title');
    const grid = document.getElementById('date-cal-grid');
    title.textContent = `${calYear}년 ${calMonth + 1}월`;

    const firstDay = new Date(calYear, calMonth, 1);
    let startDay = firstDay.getDay();
    startDay = startDay === 0 ? 6 : startDay - 1;

    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let html = '';
    for (let i = 0; i < startDay; i++) {
      html += '<div class="date-cal-day empty"></div>';
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(calYear, calMonth, d);
      const dateStr = formatDate(date);
      const isPast = date < today;
      const isToday = date.getTime() === today.getTime();
      const isSelected = selectedDates.includes(dateStr);
      const isMaxed = !isSelected && selectedDates.length >= MAX_DATES;

      let cls = 'date-cal-day';
      if (isPast) cls += ' past';
      if (isToday) cls += ' today';
      if (isSelected) cls += ' selected';
      if (isMaxed) cls += ' maxed';

      html += `<button class="${cls}" onclick="DateVote.toggleDate('${dateStr}')" ${isPast ? 'disabled' : ''}>${d}</button>`;
    }

    grid.innerHTML = html;
    renderSelectedChips();
    updatePickButton();
  }

  function toggleDate(dateStr) {
    const idx = selectedDates.indexOf(dateStr);
    if (idx >= 0) {
      selectedDates.splice(idx, 1);
    } else if (selectedDates.length < MAX_DATES) {
      selectedDates.push(dateStr);
      selectedDates.sort();
    }
    renderCalendar();
  }

  function calMove(dir) {
    calMonth += dir;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
  }

  function renderSelectedChips() {
    const wrap = document.getElementById('date-selected-chips');
    wrap.innerHTML = selectedDates.map(d => {
      const label = formatDateLabel(d);
      return `<span class="date-chip" onclick="DateVote.toggleDate('${d}')">${label} <span class="x">✕</span></span>`;
    }).join('');
  }

  function updatePickButton() {
    const btn = document.getElementById('date-pick-next');
    const count = document.getElementById('date-pick-count');
    count.textContent = selectedDates.length;
    btn.disabled = selectedDates.length === 0;
  }

  async function pickNext() {
    if (selectedDates.length === 0) return;
    await createRoom();
    renderShareScreen();
    go('s-date-share');
  }

  // ── PIN 생성 ──
  function generatePin() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  // ── Supabase: Room 생성 ──
  async function createRoom() {
    const pin = generatePin();
    const { data, error } = await sb
      .from('rooms')
      .insert({
        host_name: hostName,
        dates: selectedDates,
        status: 'voting',
        expected_count: expectedCount,
        host_pin: pin
      })
      .select()
      .single();

    if (error) {
      console.error('Room 생성 실패:', error);
      showToast('앗, 문제가 생겼어요. 다시 시도해주세요');
      return;
    }

    currentRoomId = data.id;
    localStorage.setItem('moim-host-room', currentRoomId);
    localStorage.setItem('moim-host-pin', pin);
  }

  // ── Step 3: 공유 화면 ──
  function renderShareScreen() {
    const voteUrl = `${location.origin}${location.pathname}#vote=${currentRoomId}`;
    const hostUrl = `${location.origin}${location.pathname}#host=${currentRoomId}`;
    const dateLabels = selectedDates.map(d => formatDateLabel(d)).join(', ');
    const countText = expectedCount ? `\n참여 인원: ${expectedCount}명` : '';

    const msg = [
      `🧭 MoiM — 모두의 딱! 중간 지점에서 만나요 😉`,
      ``,
      `📅 모임 날짜 투표가 열렸어요.`,
      `가능한 날짜를 골라주시면, 모두의 중간 지점에서 맛집 추천해드려요🙏`,
      ``,
      `후보: ${dateLabels}${countText}`,
      ``,
      `🗳️ 투표 링크`,
      voteUrl,
      ``,
      `──────────────────`,
      `📌 투표가 끝나면 모임장님은,`,
      `1️⃣ 아래 링크 열기`,
      `2️⃣ 투표 마감 누르고 날짜 확정!`,
      `3️⃣ 자동으로 중간 지점에서 맛집 추천! 🍽️`,
      ``,
      `👑 방장 링크`,
      hostUrl,
      `──────────────────`,
    ].join('\n');

    document.getElementById('date-share-msg').textContent = msg;
  }

  // Web Share API or clipboard fallback
  async function shareMsg() {
    const msg = document.getElementById('date-share-msg').textContent;
    if (navigator.share) {
      try {
        await navigator.share({ text: msg });
        showToast('공유 완료!');
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    // fallback
    await copyToClipboard(msg);
    showToast('메시지가 복사됐어요!');
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return Promise.resolve();
  }

  // ── Step 4: 참여자 투표 ──
  async function initVoteScreen(roomId) {
    currentRoomId = roomId;

    const { data: room, error } = await sb
      .from('rooms')
      .select('*')
      .eq('id', roomId)
      .single();

    if (error || !room) {
      showToast('앗, 투표 링크가 유효하지 않아요');
      go('s-home');
      return;
    }

    // 마감/확정된 투표
    if (room.status === 'closed' || room.status === 'confirmed') {
      await renderResultScreen(roomId);
      go('s-date-result');
      showToast('마감된 투표예요. 결과를 확인해보세요 👀');
      return;
    }

    // 이미 투표한 경우
    const votedKey = `moim-voted-${roomId}`;
    if (localStorage.getItem(votedKey)) {
      await renderResultScreen(roomId);
      go('s-date-result');
      showToast('이미 투표했어요! 현황을 확인해보세요 😊');
      return;
    }

    roomDates = room.dates || [];
    suggestedDates = [];

    document.getElementById('date-vote-title').textContent = `${room.host_name}님이 날짜를 골라달래요 😊`;

    const wrap = document.getElementById('date-vote-chips');
    wrap.innerHTML = roomDates.map(d => {
      const label = formatDateLabel(d);
      return `<button class="date-vote-chip" data-date="${d}" onclick="DateVote.toggleVote(this)">${label}</button>`;
    }).join('');

    const input = document.getElementById('date-voter-name');
    const btn = document.getElementById('date-vote-submit');
    input.value = '';
    btn.disabled = true;

    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);
    newInput.addEventListener('input', checkVoteReady);

    initDepartureAutocomplete();
    initVoteCalendar();
  }

  // 출발지 Google Places 자동완성
  function initDepartureAutocomplete() {
    const input = document.getElementById('date-departure');
    if (!input) return;
    input.value = '';

    if (window.google && window.google.maps && window.google.maps.places) {
      const ac = new google.maps.places.Autocomplete(input, {
        componentRestrictions: { country: 'kr' },
        fields: ['name', 'geometry', 'formatted_address'],
        types: ['establishment', 'geocode']
      });
      ac.addListener('place_changed', () => {
        const place = ac.getPlace();
        if (place && place.formatted_address) {
          input.dataset.address = place.formatted_address;
          input.dataset.lat = place.geometry?.location?.lat() || '';
          input.dataset.lng = place.geometry?.location?.lng() || '';
        }
      });
    }
  }

  // ── 투표 달력 (제안용) ──
  function initVoteCalendar() {
    const now = new Date();
    voteCalYear = now.getFullYear();
    voteCalMonth = now.getMonth();
    renderVoteCalendar();
  }

  function renderVoteCalendar() {
    const title = document.getElementById('date-vote-cal-title');
    const grid = document.getElementById('date-vote-cal-grid');
    if (!title || !grid) return;

    title.textContent = `${voteCalYear}년 ${voteCalMonth + 1}월`;

    const firstDay = new Date(voteCalYear, voteCalMonth, 1);
    let startDay = firstDay.getDay();
    startDay = startDay === 0 ? 6 : startDay - 1;

    const daysInMonth = new Date(voteCalYear, voteCalMonth + 1, 0).getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const votedDates = [...document.querySelectorAll('.date-vote-chip.voted')].map(el => el.dataset.date);

    let html = '';
    for (let i = 0; i < startDay; i++) {
      html += '<div class="date-cal-day empty"></div>';
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(voteCalYear, voteCalMonth, d);
      const dateStr = formatDate(date);
      const isPast = date < today;
      const isHostPick = roomDates.includes(dateStr);
      const isSuggested = suggestedDates.includes(dateStr);
      const isVoted = votedDates.includes(dateStr) || isSuggested;

      let cls = 'date-cal-day';
      if (isPast) cls += ' past';
      if (date.getTime() === today.getTime()) cls += ' today';
      if (isHostPick) cls += ' host-pick';
      if (isSuggested) cls += ' suggested';
      if (isVoted || (isHostPick && votedDates.includes(dateStr))) cls += ' selected';

      html += `<button class="${cls}" onclick="DateVote.toggleVoteCal('${dateStr}')" ${isPast ? 'disabled' : ''}>${d}</button>`;
    }

    grid.innerHTML = html;
  }

  function toggleVoteCal(dateStr) {
    const isHostDate = roomDates.includes(dateStr);

    if (isHostDate) {
      const chip = document.querySelector(`.date-vote-chip[data-date="${dateStr}"]`);
      if (chip) toggleVote(chip);
    } else {
      const idx = suggestedDates.indexOf(dateStr);
      if (idx >= 0) {
        suggestedDates.splice(idx, 1);
        const chip = document.querySelector(`.date-vote-chip[data-date="${dateStr}"]`);
        if (chip) chip.remove();
      } else {
        suggestedDates.push(dateStr);
        const wrap = document.getElementById('date-vote-chips');
        const label = formatDateLabel(dateStr);
        const btn = document.createElement('button');
        btn.className = 'date-vote-chip voted';
        btn.dataset.date = dateStr;
        btn.textContent = `${label} ✨`;
        btn.onclick = function() { DateVote.toggleVote(this); };
        wrap.appendChild(btn);
      }
    }
    renderVoteCalendar();
    checkVoteReady();
  }

  function voteCalMove(dir) {
    voteCalMonth += dir;
    if (voteCalMonth > 11) { voteCalMonth = 0; voteCalYear++; }
    if (voteCalMonth < 0) { voteCalMonth = 11; voteCalYear--; }
    renderVoteCalendar();
  }

  function toggleVote(el) {
    el.classList.toggle('voted');
    checkVoteReady();
    renderVoteCalendar();
  }

  function checkVoteReady() {
    const name = document.getElementById('date-voter-name').value.trim();
    const voted = document.querySelectorAll('.date-vote-chip.voted').length;
    document.getElementById('date-vote-submit').disabled = !name || voted === 0;
  }

  async function voteSubmit() {
    const name = document.getElementById('date-voter-name').value.trim();
    const votedDates = [...document.querySelectorAll('.date-vote-chip.voted')].map(el => el.dataset.date);
    if (!name || votedDates.length === 0 || !currentRoomId) return;

    const depInput = document.getElementById('date-departure');
    const departure = depInput?.value.trim() || null;

    await sb
      .from('participants')
      .delete()
      .eq('room_id', currentRoomId)
      .eq('name', name);

    const { error } = await sb
      .from('participants')
      .insert({
        room_id: currentRoomId,
        name,
        available_dates: votedDates,
        departure
      });

    if (error) {
      console.error('투표 실패:', error);
      showToast('앗, 문제가 생겼어요. 다시 시도해주세요');
      return;
    }

    localStorage.setItem(`moim-voted-${currentRoomId}`, name);

    await renderResultScreen(currentRoomId);
    go('s-date-result');
    showToast('투표 완료! 😊');
  }

  // ── Step 5: 집계 결과 ──
  async function renderResultScreen(roomId) {
    const id = roomId || currentRoomId;
    if (!id) return;
    currentRoomId = id;

    const { data: room } = await sb
      .from('rooms')
      .select('*')
      .eq('id', id)
      .single();

    if (!room) return;

    const { data: votes } = await sb
      .from('participants')
      .select('*')
      .eq('room_id', id);

    const sub = document.getElementById('date-result-sub');
    const list = document.getElementById('date-result-list');
    const confirmBtn = document.getElementById('date-confirm-btn');
    const closeBtn = document.getElementById('date-close-btn');
    const deleteBtn = document.getElementById('date-delete-btn');
    const progressEl = document.getElementById('date-result-progress');

    const isHost = localStorage.getItem('moim-host-room') === id;
    const isClosed = room.status === 'closed';
    const isConfirmed = room.status === 'confirmed';

    // 진행 상황
    const voteCount = votes?.length || 0;
    if (room.expected_count) {
      const displayCount = voteCount + 1; // +1 for host
      const pct = Math.min(100, Math.round(displayCount / room.expected_count * 100));
      sub.textContent = `${displayCount}/${room.expected_count}명 응답 완료`;
      if (progressEl) {
        progressEl.style.display = 'block';
        progressEl.querySelector('.date-progress-bar').style.width = `${pct}%`;
        progressEl.querySelector('.date-progress-text').textContent = `${pct}%`;
      }
    } else {
      sub.textContent = voteCount === 0 ? '아직 아무도 응답하지 않았어요' : `${voteCount}명이 응답했어요`;
      if (progressEl) progressEl.style.display = 'none';
    }

    if (!votes || votes.length === 0) {
      list.innerHTML = '<p class="date-result-empty">아직 투표가 없어요</p>';
      if (confirmBtn) confirmBtn.style.display = 'none';
      if (closeBtn) closeBtn.style.display = isHost && !isClosed && !isConfirmed ? 'block' : 'none';
      if (deleteBtn) deleteBtn.style.display = isHost ? 'block' : 'none';
      subscribeRealtime(id);
      return;
    }

    // 모든 날짜 집계 (방장 후보 + 참여자 제안)
    const counts = {};
    room.dates.forEach(d => counts[d] = { count: 0, names: [], isSuggested: false });
    votes.forEach(v => {
      (v.available_dates || []).forEach(d => {
        if (!counts[d]) counts[d] = { count: 0, names: [], isSuggested: true };
        counts[d].count++;
        counts[d].names.push(v.name);
      });
    });

    const maxCount = Math.max(...Object.values(counts).map(c => c.count));

    const sortedDates = Object.keys(counts).sort((a, b) => {
      if (counts[b].count !== counts[a].count) return counts[b].count - counts[a].count;
      return (counts[a].isSuggested ? 1 : 0) - (counts[b].isSuggested ? 1 : 0);
    });

    list.innerHTML = sortedDates.map(d => {
      const c = counts[d];
      const isBest = c.count === maxCount && c.count > 0;
      const crownHtml = isBest ? '<span class="date-crown">👑</span>' : '';
      const suggestedBadge = c.isSuggested ? '<span class="date-suggested-badge">제안</span>' : '';
      return `<div class="date-result-item${isBest ? ' best' : ''}" onclick="DateVote.selectResult('${d}')">
        <div class="date-result-left">
          ${crownHtml}
          <div>
            <div class="date-result-date">${suggestedBadge}${formatDateLabel(d)}</div>
            <div class="date-result-names">${c.names.join(', ') || '-'}</div>
          </div>
        </div>
        <div class="date-result-count">${c.count}명</div>
      </div>`;
    }).join('');

    // 방장 버튼들
    // 투표 진행 중: [마감하기]
    // 마감 후: [날짜 확정하기]
    // 확정 후: 없음 (이미 confirm 화면으로 넘어감)
    if (isHost && !isConfirmed) {
      if (isClosed) {
        // 마감됨 → 확정 가능
        if (confirmBtn) confirmBtn.style.display = 'block';
        if (closeBtn) closeBtn.style.display = 'none';
      } else {
        // 투표 중 → 마감 or 바로 확정 가능
        if (confirmBtn) confirmBtn.style.display = 'block';
        if (closeBtn) closeBtn.style.display = 'block';
      }
    } else {
      if (confirmBtn) confirmBtn.style.display = 'none';
      if (closeBtn) closeBtn.style.display = 'none';
    }

    // 삭제 X 버튼
    if (deleteBtn) deleteBtn.style.display = isHost ? 'block' : 'none';

    // 마감 배너
    const closedBanner = document.getElementById('date-closed-banner');
    if (closedBanner) closedBanner.style.display = (isClosed || isConfirmed) ? 'block' : 'none';

    subscribeRealtime(id);
  }

  // ── 투표 마감 ──
  async function closeVoting() {
    if (!currentRoomId) return;
    const { error } = await sb
      .from('rooms')
      .update({ status: 'closed' })
      .eq('id', currentRoomId);

    if (error) {
      showToast('마감에 실패했어요. 다시 시도해주세요');
      return;
    }
    await renderResultScreen(currentRoomId);
    showToast('투표가 마감됐어요!');
  }

  // ── 투표 삭제 ──
  async function deleteRoom() {
    if (!currentRoomId) return;
    if (!window.confirm('정말 이 투표를 삭제할까요?\n삭제하면 되돌릴 수 없어요.')) return;

    await sb.from('participants').delete().eq('room_id', currentRoomId);
    await sb.from('rooms').delete().eq('id', currentRoomId);

    localStorage.removeItem('moim-host-room');
    localStorage.removeItem('moim-host-pin');
    currentRoomId = null;

    showToast('투표가 삭제됐어요');
    go('s-home');
    checkHomeBanner();
  }

  // ── Supabase Realtime ──
  function subscribeRealtime(roomId) {
    if (realtimeSub) sb.removeChannel(realtimeSub);
    const id = roomId || currentRoomId;
    realtimeSub = sb
      .channel(`room-${id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'participants', filter: `room_id=eq.${id}` },
        () => renderResultScreen(id)
      )
      .subscribe();
  }

  let selectedFinalDate = null;
  function selectResult(dateStr) {
    selectedFinalDate = dateStr;
    document.querySelectorAll('.date-result-item').forEach(el => el.classList.remove('picked'));
    // onclick string에서 날짜 매칭
    document.querySelectorAll('.date-result-item').forEach(el => {
      const onclick = el.getAttribute('onclick') || '';
      if (onclick.includes(`'${dateStr}'`)) el.classList.add('picked');
    });
  }

  async function confirm() {
    if (!selectedFinalDate) {
      showToast('확정할 날짜를 탭해주세요');
      return;
    }

    const { error } = await sb
      .from('rooms')
      .update({ final_date: selectedFinalDate, status: 'confirmed' })
      .eq('id', currentRoomId);

    if (error) {
      showToast('앗, 문제가 생겼어요. 다시 시도해주세요');
      return;
    }

    await initConfirmedScreen(selectedFinalDate);
    go('s-date-confirmed');
  }

  // ── 날짜 확정 브릿지 화면 ──
  async function initConfirmedScreen(dateStr) {
    const label = formatDateLabel(dateStr);
    const el = document.getElementById('date-confirmed-label');
    if (el) el.textContent = label;

    const { data: votes } = await sb
      .from('participants')
      .select('name, departure')
      .eq('room_id', currentRoomId);

    const departures = (votes || []).filter(v => v.departure).map(v => ({
      name: v.name,
      departure: v.departure
    }));

    const depList = document.getElementById('date-confirmed-departures');
    if (depList) {
      if (departures.length > 0) {
        depList.style.display = 'block';
        depList.querySelector('.dep-list').innerHTML = departures.map(v =>
          `<div class="dep-item"><span class="dep-name">${v.name}</span><span class="dep-addr">${v.departure}</span></div>`
        ).join('');
      } else {
        depList.style.display = 'none';
      }
    }

    localStorage.setItem('moim-departures', JSON.stringify(departures));
  }

  function goToPlace() {
    // 투표 시 입력된 출발지를 locations 화면에 pre-fill
    const deps = JSON.parse(localStorage.getItem('moim-departures') || '[]');
    window._moimPendingDeps = deps.filter(d => d.departure);
    go('s-type');
  }

  async function goResult() {
    await renderResultScreen(currentRoomId);
    go('s-date-result');
  }

  // ── URL hash 라우팅 ──
  function checkHash() {
    const hash = location.hash;
    if (hash.startsWith('#vote=')) {
      const roomId = hash.replace('#vote=', '');
      currentRoomId = roomId;
      initVoteScreen(roomId);
      go('s-date-vote');
      history.replaceState(null, '', location.pathname);
      return true;
    }
    if (hash.startsWith('#host=')) {
      const roomId = hash.replace('#host=', '');
      currentRoomId = roomId;
      localStorage.setItem('moim-host-room', roomId);
      history.replaceState(null, '', location.pathname);
      renderResultScreen(roomId).then(() => {
        go('s-date-result');
        showToast('투표 현황이에요 👑');
      });
      return true;
    }
    return false;
  }

  // ── 방장 PIN 인증 ──
  async function verifyPin() {
    const nameInput = document.getElementById('date-pin-name');
    const pinInput = document.getElementById('date-pin-input');
    const name = nameInput?.value.trim();
    const pin = pinInput?.value.trim();

    if (!name || !pin || pin.length !== 4) {
      showToast('이름과 4자리 번호를 입력해주세요');
      return;
    }

    const { data: rooms, error } = await sb
      .from('rooms')
      .select('id')
      .eq('host_name', name)
      .eq('host_pin', pin);

    if (error || !rooms || rooms.length === 0) {
      showToast('일치하는 투표를 찾을 수 없어요');
      return;
    }

    const room = rooms[0];
    currentRoomId = room.id;
    localStorage.setItem('moim-host-room', room.id);
    localStorage.setItem('moim-host-pin', pin);

    await renderResultScreen(room.id);
    go('s-date-result');
    showToast('방장 인증 완료!');
  }

  // ── 홈 화면 배너 ──
  async function checkHomeBanner() {
    const roomId = localStorage.getItem('moim-host-room');
    const banner = document.getElementById('date-home-banner');
    if (!banner) return;

    if (!roomId || !sb) {
      banner.style.display = 'none';
      return;
    }

    const { data: room } = await sb
      .from('rooms')
      .select('host_name, dates, status, expected_count')
      .eq('id', roomId)
      .single();

    if (!room) {
      banner.style.display = 'none';
      localStorage.removeItem('moim-host-room');
      return;
    }

    const { data: votes } = await sb
      .from('participants')
      .select('id')
      .eq('room_id', roomId);

    const voteCount = votes?.length || 0;
    const countText = room.expected_count ? `${voteCount}/${room.expected_count}명` : `${voteCount}명`;
    const statusText = (room.status === 'confirmed' || room.status === 'closed') ? '마감' : '진행 중';

    banner.style.display = 'flex';
    banner.querySelector('.banner-status').textContent = statusText === '마감' ? '✅ 마감됨' : '📊 투표 진행 중';
    banner.querySelector('.banner-count').textContent = `${countText} 응답`;
    banner.querySelector('.banner-dates').textContent = room.dates.map(d => formatDateLabel(d)).join(' · ');
    banner.onclick = () => {
      currentRoomId = roomId;
      renderResultScreen(roomId).then(() => go('s-date-result'));
    };
  }

  // ── 유틸리티 ──
  function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function formatDateLabel(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${m}/${d} (${days[date.getDay()]})`;
  }

  function showToast(msg) {
    const t = document.querySelector('.toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2000);
  }

  // 초기화
  document.addEventListener('DOMContentLoaded', () => {
    initNameScreen();
    checkHomeBanner();
    checkHash();
  });

  return {
    toggleDate, calMove, toggleVote, selectResult,
    nameNext, pickNext, shareMsg,
    voteSubmit, goResult, confirm, closeVoting, deleteRoom,
    checkHash, voteCalMove, toggleVoteCal, goToPlace, verifyPin
  };
})();

// 글로벌 함수 바인딩
function dateNameNext() { DateVote.nameNext(); }
function datePickNext() { DateVote.pickNext(); }
function dateCalMove(dir) { DateVote.calMove(dir); }
function dateShareMsg() { DateVote.shareMsg(); }
function dateVoteSubmit() { DateVote.voteSubmit(); }
function dateGoResult() { DateVote.goResult(); }
function dateConfirm() { DateVote.confirm(); }
function dateCloseVoting() { DateVote.closeVoting(); }
function dateDeleteRoom() { DateVote.deleteRoom(); }
function dateVoteCalMove(dir) { DateVote.voteCalMove(dir); }
function dateGoToPlace() { DateVote.goToPlace(); }
function dateVerifyPin() { DateVote.verifyPin(); }
