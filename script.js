// 거미줄 쏘기 — MediaPipe Hand Landmarker 로 손동작을 찾아서 거미줄을 그려요.
// - 전부 내 브라우저 안에서만 돌아요. 카메라 화면은 보여 주지도, 저장하지도, 보내지도 않아요.

// ───────── 설정 ─────────
// MediaPipe 프로그램 주소. 버전을 바꿀 때는 아래 숫자 한 곳만 바꿔요.
const VERSION = "1.2.3";
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
// Google 이 공개한 손 모델 파일. 손 하나에서 점 21개를 찾아 줘요.
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const GROW_MS = 280; // 거미줄이 펼쳐지는 시간
const HOLD_MS = 2000; // 붙은 뒤 그대로 있는 시간 (2초)
const FADE_MS = 1500; // 그 뒤 서서히 사라지는 시간
const REACH = 3; // 검지 끝에서 "손가락 길이의 몇 배"만큼 더 간 곳을 가리켜요 (크게 하면 멀리 쏴요)
const AIM_SMOOTH = 0.12; // 빨간 점이 손을 따라가는 빠르기 (0~1 · 작을수록 천천히 · 부드럽게 움직여요)
const SHOW_AIM = true; // 조준점(빨간 작은 점)을 보여 줄지. 안 보이게 하려면 false
const DROP_MS = 400; // 이 시간 안에 손이 내려와야 "내렸다"로 쳐요
const DROP_AMOUNT = 0.6; // 얼마나 내려와야 하는지 (손바닥 길이의 몇 배 · 작게 하면 살짝만 내려도 쏴져요)

// 거미줄 그림 8장 (webs 폴더 · 배경이 투명한 PNG). 쏠 때마다 이 중 하나가 랜덤으로 나와요.
// 그림을 더 넣으려면 webs 폴더에 파일을 넣고 여기에 이름을 추가하면 돼요. 빼려면 이름을 지워요.
const WEB_IMAGES = [
  "web3.png",
  "web5.png",
  "web6.png",
  "web7.png",
  "web8.png",
  "web9.png",
  "web10.png",
  "web11.png",
].map((name) => {
  const image = new Image();
  image.src = `webs/${name}`;
  return image;
});

// 손바닥을 보여 주면 천장에서 줄을 타고 내려오는 캐릭터 그림
const HERO_IMAGE = new Image();
HERO_IMAGE.src = "webs/hero.png";
const HERO_SHOW_MS = 400; // 손바닥을 이만큼 보여 주면 등장
const HERO_HIDE_MS = 600; // 손바닥이 이만큼 안 보이면 퇴장
const HERO_SIZE = 0.6; // 그림 높이 (창 높이의 몇 배)
const HERO_BOUNCE = 1.6; // 1초에 출렁이는 횟수 (크면 빠르게 "띠용띠용")
const HERO_DAMP = 2.4; // 출렁임이 잦아드는 빠르기 (작으면 오래 출렁여요)
const HERO_LEAVE_MS = 450; // 위로 올라가 사라지는 시간

// ───────── 화면 요소 (index.html 의 id 와 약속된 이름) ─────────
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const placeholder = document.getElementById("placeholder");
const cameraBtn = document.getElementById("camera-btn");
const shotsText = document.getElementById("shots");
const handText = document.getElementById("hand-status");
const messageText = document.getElementById("message");

// ───────── 상태 ─────────
let landmarker = null; // 손 찾는 도구 (한 번만 만들고 계속 재사용)
let stream = null; // 카메라
let loopId = 0; // 반복을 멈출 때 쓰는 번호
let shots = 0; // 쏜 횟수
let webs = []; // 화면에 붙은 거미줄들
let hero = null; // 내려와 있는 캐릭터 { x: 가로 위치(0~1), born: 등장한 시각, leaveAt: 퇴장 시작 시각 }
let palmSince = null; // 손바닥이 보이기 시작한 시각
let palmGoneSince = null; // 손바닥이 안 보이기 시작한 시각
let aims = []; // 지금 검지가 가리키는 자리들 (손마다 하나 · 화면에서의 위치 0~1 비율)
const hands = new Map(); // 손마다 "최근에 어디 있었는지 · 쏠 준비가 됐는지"

// ───────── 계산 도우미 ─────────
// 점 번호: 0 손목 · 5 검지 뿌리 · 8 검지 끝 · 9 중지 뿌리
// 쏘는 때 = 손이 아래로 내려올 때 · 쏘는 곳 = 검지가 가리키는 곳
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// 손가락이 펴졌는지: 손가락 끝이 가운데 마디보다 손목에서 더 멀면 편 거예요.
function isExtended(hand, tip, joint) {
  return distance(hand[tip], hand[0]) > distance(hand[joint], hand[0]);
}

// 손바닥을 보여 주는 손인지: 검지 · 중지 · 약지 · 새끼 네 손가락을 모두 폈으면 돼요.
function isOpenPalm(hand) {
  return (
    isExtended(hand, 8, 6) &&
    isExtended(hand, 12, 10) &&
    isExtended(hand, 16, 14) &&
    isExtended(hand, 20, 18)
  );
}

function between(min, max) {
  return min + Math.random() * (max - min);
}

// ───────── 거미줄 그리기 ─────────
// web = { x, y: 화면에서의 위치(0~1 비율), image: 그림, size: 크기 비율, turn: 살짝 돌린 각도, born: 붙은 시각 }
function drawWeb(ctx, web, now, width, height) {
  const age = now - web.born;
  // 처음엔 빠르게, 끝에는 천천히 펼쳐져요.
  const grow = 1 - Math.pow(1 - Math.min(1, age / GROW_MS), 3);
  // 2초 동안은 그대로, 그 뒤 서서히 흐려져요. (1 = 또렷함 · 0 = 안 보임)
  const fade = 1 - Math.max(0, age - HOLD_MS) / FADE_MS;
  // 그림이 아직 안 불러와졌으면(naturalWidth 가 0) 건너뛰어요.
  if (grow <= 0 || fade <= 0 || !web.image.naturalWidth) return;

  // 그림의 긴 쪽이 "화면의 짧은 쪽 × size" 가 되도록 크기를 정해요. (가로세로 비율은 그대로)
  const longSide = Math.min(width, height) * web.size * grow;
  const ratio = longSide / Math.max(web.image.naturalWidth, web.image.naturalHeight);
  const w = web.image.naturalWidth * ratio;
  const h = web.image.naturalHeight * ratio;

  ctx.save();
  ctx.globalAlpha = fade;
  ctx.translate(web.x * width, web.y * height);
  ctx.rotate(web.turn);
  ctx.drawImage(web.image, -w / 2, -h / 2, w, h); // 손 자리가 그림의 한가운데
  ctx.restore();
}

// ───────── 캐릭터 그리기 ─────────
// 천장(화면 맨 위)에 줄로 매달려서, 스프링처럼 위아래로 출렁이다가 멈춰요.
function drawHero(ctx, now, width, height) {
  if (!hero || !HERO_IMAGE.naturalWidth) return;
  const h = height * HERO_SIZE;
  const w = (HERO_IMAGE.naturalWidth / HERO_IMAGE.naturalHeight) * h;
  const t = (now - hero.born) / 1000; // 등장한 지 몇 초

  // 스프링 공식: 출렁임(cos) × 점점 작아짐(exp).
  // 처음(t=0)에는 그림 높이만큼 위에 숨어 있다가, 아래로 지나쳤다 돌아오기를 반복하며 제자리(0)에 멈춰요.
  const wobble = Math.exp(-HERO_DAMP * t);
  let offset = -h * wobble * Math.cos(Math.PI * 2 * HERO_BOUNCE * t);
  // 출렁일 때 좌우로도 살짝 흔들려요. (천장의 한 점에 매달린 것처럼)
  const sway = 0.1 * wobble * Math.sin(Math.PI * HERO_BOUNCE * t);

  // 퇴장: 점점 빠르게 위로 올라가요. 다 올라가면 없애요.
  if (hero.leaveAt !== null) {
    const leave = (now - hero.leaveAt) / HERO_LEAVE_MS;
    if (leave >= 1) {
      hero = null;
      return;
    }
    offset -= h * 1.3 * leave * leave;
  }

  ctx.save();
  ctx.translate(hero.x * width, 0); // 매달린 점 = 화면 맨 위
  ctx.rotate(sway);
  // 아래로 지나쳐 내려갔을 때는 천장에서 그림까지 줄을 이어 줘요.
  if (offset > 0) {
    ctx.strokeStyle = "#9a9a9a";
    ctx.lineWidth = Math.max(1, w * 0.006);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, offset + 2);
    ctx.stroke();
  }
  ctx.drawImage(HERO_IMAGE, -w / 2, offset, w, h); // 그림 속 줄이 한가운데에 있어요
  ctx.restore();
}

function drawAll(now) {
  // 그림판을 창 크기에 맞춰요. (선명하게 보이도록 화면 배율만큼 더 촘촘하게)
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(canvas.clientWidth * ratio);
  const height = Math.round(canvas.clientHeight * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height); // 지난 그림 지우기 (검은 화면으로)
  // 다 사라진 거미줄은 목록에서 빼고, 남은 것만 그려요.
  webs = webs.filter((web) => now - web.born < HOLD_MS + FADE_MS);
  for (const web of webs) drawWeb(ctx, web, now, width, height);

  drawHero(ctx, now, width, height);

  // 조준점: 검지가 가리키는 자리에 빨간 작은 점 (손 그림은 그리지 않아요)
  if (SHOW_AIM) {
    ctx.fillStyle = "#ff2d2d";
    for (const aim of aims) {
      ctx.beginPath();
      ctx.arc(aim.x * width, aim.y * height, Math.max(3, Math.min(width, height) / 140), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ───────── 화면 한 장(프레임)마다 하는 일 ─────────
// result = 손 찾기 결과 · now = 지금 시각(ms)
function handleFrame(result, now) {
  // 카메라 영상(예: 4:3)과 창(예: 16:9)은 비율이 달라요.
  // 영상을 같은 비율로 키워서 창을 꽉 채운다고 생각하고, 손의 위치를 창 안의 위치로 옮겨요.
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const videoWidth = video.videoWidth || width;
  const videoHeight = video.videoHeight || height;
  const scale = Math.max(width / videoWidth, height / videoHeight);
  const offsetX = (width - videoWidth * scale) / 2;
  const offsetY = (height - videoHeight * scale) / 2;

  const seenHands = new Set();
  aims = []; // 조준점은 프레임마다 새로 모아요
  let palmX = null; // 손바닥을 보여 주는 손의 가로 위치 (없으면 null)
  result.landmarks.forEach((landmarks, index) => {
    const name = result.handedness[index]?.[0]?.categoryName ?? String(index);
    seenHands.add(name);
    // history = 최근 손바닥 높이 기록 · armed = 쏠 준비가 됐는지 · firedY = 마지막으로 쏜 높이
    const state = hands.get(name) ?? { history: [], armed: true, firedY: 0, aim: null };
    hands.set(name, state);

    // ── 조준: 검지 뿌리(5) → 검지 끝(8) 방향으로, 끝에서 손가락 길이의 REACH 배만큼 더 간 자리 ──
    // 먼저 두 점을 창 안의 위치(픽셀)로 옮겨요. 거울처럼 움직이도록 x 는 좌우를 뒤집어요.
    const toScreen = (point) => ({
      x: offsetX + (1 - point.x) * videoWidth * scale,
      y: offsetY + point.y * videoHeight * scale,
    });
    const base = toScreen(landmarks[5]);
    const tip = toScreen(landmarks[8]);
    // 검지를 화면 쪽으로 똑바로 향하면 손가락이 짧게 보여서 끝 근처를,
    // 옆으로 눕히면 길게 보여서 그 방향으로 멀리를 가리키게 돼요.
    // 화면 밖을 가리키면 화면 가장자리에 붙여요. (0~1 사이로 자르기)
    const target = {
      x: Math.min(1, Math.max(0, (tip.x + (tip.x - base.x) * REACH) / width)),
      y: Math.min(1, Math.max(0, (tip.y + (tip.y - base.y) * REACH) / height)),
    };
    // 손이 조금 떨려도 조준점이 튀지 않게, 지난 위치와 섞어서 부드럽게 움직여요.
    state.aim = state.aim
      ? {
          x: state.aim.x + (target.x - state.aim.x) * AIM_SMOOTH,
          y: state.aim.y + (target.y - state.aim.y) * AIM_SMOOTH,
        }
      : target;
    aims.push(state.aim);

    // 손바닥을 보여 주는 손이면 그 가로 위치를 기억해요. (캐릭터가 그 위에서 내려와요)
    if (isOpenPalm(landmarks)) {
      palmX = toScreen({ x: (landmarks[0].x + landmarks[9].x) / 2, y: 0 }).x / width;
    }

    // 손바닥 가운데 = 손목(0)과 중지 뿌리(9)의 중간. y 는 아래로 갈수록 커져요.
    const palmY = (landmarks[0].y + landmarks[9].y) / 2;
    const palmLength = distance(landmarks[0], landmarks[9]);

    // 최근 DROP_MS 동안의 높이와 그때의 조준점을 기억해요.
    state.history.push({ time: now, y: palmY, aim: state.aim });
    state.history = state.history.filter((item) => now - item.time <= DROP_MS);
    // 그동안 가장 높이 있던 순간 = 손을 내리기 시작한 순간
    const start = state.history.reduce((top, item) => (item.y < top.y ? item : top));
    // 거기서 지금까지 얼마나 내려왔는지
    const dropped = palmY - start.y >= palmLength * DROP_AMOUNT;

    if (palmY < state.firedY - palmLength * DROP_AMOUNT * 0.5) {
      // 쏜 자리보다 손을 다시 올렸으면 → 또 쏠 수 있어요
      state.armed = true;
    }

    if (dropped && state.armed) {
      // 쏘기! 손을 내리는 동안에는 조준점도 같이 내려가니까,
      // "내리기 시작한 순간"에 검지가 가리키던 자리에 거미줄을 붙여요.
      webs.push({
        x: start.aim.x,
        y: start.aim.y,
        image: WEB_IMAGES[Math.floor(Math.random() * WEB_IMAGES.length)], // 5장 중 랜덤
        size: between(0.75, 1.05),
        turn: between(-0.2, 0.2), // 사진 모양을 살리려고 아주 조금만 돌려요
        born: now,
      });
      shots++;
      shotsText.textContent = `쏜 거미줄 ${shots}개`;
      state.armed = false; // 한 번 내릴 때 한 발만
      state.firedY = palmY;
      state.history = []; // 내려온 기록을 비워서, 다시 내려와야 또 쏴져요
    }
  });

  // 화면에서 사라진 손은 잊어요.
  hands.forEach((_, name) => {
    if (!seenHands.has(name)) hands.delete(name);
  });

  // ── 캐릭터 등장 · 퇴장 ──
  if (palmX !== null) {
    palmGoneSince = null;
    palmSince ??= now; // 손바닥이 보이기 시작한 시각을 적어 둬요
    if (!hero && now - palmSince >= HERO_SHOW_MS) {
      // 등장! 화면 밖으로 나가지 않게 가로 위치는 15%~85% 사이로
      hero = { x: Math.min(0.85, Math.max(0.15, palmX)), born: now, leaveAt: null };
    }
  } else {
    palmSince = null;
    if (hero && hero.leaveAt === null) {
      palmGoneSince ??= now;
      if (now - palmGoneSince >= HERO_HIDE_MS) hero.leaveAt = now; // 퇴장 시작
    }
  }

  // 손 그림은 그리지 않아요. 대신 손을 찾았는지만 글자로 알려 줘요. (바뀔 때만 고쳐요)
  const status = seenHands.size > 0 ? "손을 찾았어요" : "손을 보여 주세요";
  if (handText.textContent !== status) handText.textContent = status;

  drawAll(now);
}

// 카메라가 켜져 있는 동안 계속 반복해요.
function loop() {
  if (video.videoWidth > 0) {
    const now = performance.now();
    handleFrame(landmarker.detectForVideo(video, now), now);
  }
  loopId = requestAnimationFrame(loop);
}

// ───────── 카메라 켜기 · 끄기 ─────────
async function startCamera() {
  cameraBtn.disabled = true;
  messageText.hidden = true;
  placeholder.textContent = "불러오는 중…";

  try {
    // 손 찾는 도구는 처음 한 번만 만들어요. (모델을 내려받느라 몇 초 걸려요)
    if (!landmarker) {
      const vision = await import(`${CDN}/vision_bundle.mjs`);
      const files = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
      landmarker = await vision.HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL_URL },
        runningMode: "VIDEO", // 카메라처럼 이어지는 화면
        numHands: 2, // 양손까지
      });
    }
  } catch {
    showMessage("손 찾기 도구를 불러오지 못했어요. 인터넷을 확인해 볼까요?");
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
    video.srcObject = stream;
    await video.play();
  } catch {
    stopCamera();
    showMessage("카메라를 켜지 못했어요. 브라우저의 카메라 허용을 확인해 주세요.");
    return;
  }

  placeholder.hidden = true;
  cameraBtn.textContent = "카메라 끄기";
  cameraBtn.disabled = false;
  loopId = requestAnimationFrame(loop);
}

function stopCamera() {
  cancelAnimationFrame(loopId);
  // 카메라를 끄면 카메라 불도 꺼져요. 화면의 거미줄도 같이 지워요.
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
  hands.clear();
  webs = [];
  aims = [];
  hero = null;
  palmSince = null;
  palmGoneSince = null;
  drawAll(performance.now());
  handText.textContent = "";
  placeholder.hidden = false;
  placeholder.textContent = "카메라를 켜고, 검지로 가리키며 손을 아래로 내려 보세요";
  cameraBtn.textContent = "카메라 켜기";
  cameraBtn.disabled = false;
}

function showMessage(text) {
  messageText.textContent = text;
  messageText.hidden = false;
  placeholder.textContent = "카메라를 켜고, 검지로 가리키며 손을 아래로 내려 보세요";
  cameraBtn.disabled = false;
}

// 버튼 하나로 켜고 끄기
cameraBtn.addEventListener("click", () => {
  if (stream) stopCamera();
  else startCamera();
});

// 창 크기를 바꾸면 그림판도 바로 맞춰요.
window.addEventListener("resize", () => drawAll(performance.now()));
