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
const AIM_SMOOTH = 0.3; // 빨간 점이 손을 따라가는 빠르기 (0~1 · 작을수록 천천히 · 부드럽게 움직여요)
const SHOW_AIM = true; // 조준점(빨간 작은 점)을 보여 줄지. 안 보이게 하려면 false
const SOUND_ON = true; // 쏠 때 "슈욱-챱" 효과음을 낼지. 끄려면 false
const SOUND_VOLUME = 0.6; // 효과음 크기 (0~1)
// 배경 음악: music 폴더에 bgm.mp3 를 넣으면 카메라를 켤 때 재생돼요. (파일이 없으면 조용히 넘어가요)
const MUSIC = new Audio("music/bgm.mp3");
MUSIC.loop = true; // 끝나면 처음부터 다시
MUSIC.volume = 0.4; // 음악 크기 (0~1 · 효과음이 묻히지 않게 조금 작게)

// 유튜브 배경 음악: bgm.mp3 가 없으면 이 영상을 유튜브 플레이어로 재생해요.
// (영상에서 소리를 뽑아 저장하는 게 아니라, 유튜브에서 직접 틀어 주는 방식이에요)
const YOUTUBE_ID = "ApXoWvfEYVU"; // 유튜브 주소의 youtu.be/ 뒤에 오는 글자. 다른 영상으로 바꾸려면 여기만 바꿔요
const YOUTUBE_VOLUME = 40; // 유튜브 음악 크기 (0~100)
let youtube = null; // 유튜브 플레이어 (준비되면 채워져요)

// 유튜브 플레이어는 인터넷 주소(http · https)로 연 페이지에서만 동작해요.
// (파일을 더블클릭해서 연 경우에는 유튜브가 재생을 막아요)
if (location.protocol.startsWith("http")) {
  const api = document.createElement("script");
  api.src = "https://www.youtube.com/iframe_api";
  document.head.append(api);
  // 유튜브 프로그램이 다 불러와지면 이 이름의 함수를 불러 줘요. (유튜브가 정한 약속)
  window.onYouTubeIframeAPIReady = () => {
    const player = new YT.Player("youtube-player", {
      videoId: YOUTUBE_ID,
      // playsinline: 휴대폰에서 전체 화면으로 넘어가지 않게 · loop + playlist: 끝나면 반복
      playerVars: { playsinline: 1, loop: 1, playlist: YOUTUBE_ID },
      events: {
        onReady: () => {
          player.setVolume(YOUTUBE_VOLUME);
          youtube = player;
        },
        // 유튜브가 재생을 거절하면(영상이 내려갔거나 다른 사이트 재생이 막힌 경우) 플레이어를 숨겨요.
        onError: (event) => {
          console.warn("유튜브 재생 오류 코드:", event.data);
          youtube = null;
          document.getElementById("youtube-box").hidden = true;
        },
      },
    });
  };
}

// 음악 켜기 · 끄기: bgm.mp3 가 있으면 그 파일을, 없으면 유튜브를 써요.
function startMusic() {
  MUSIC.play().catch(() => {
    youtube?.playVideo();
    if (youtube) document.getElementById("youtube-box").hidden = false;
  });
}

function stopMusic() {
  MUSIC.pause(); // 다시 켜면 멈춘 곳부터 이어져요
  youtube?.pauseVideo();
  document.getElementById("youtube-box").hidden = true;
}

// 쏘는 동작 = "거미줄 손 모양"(중지 · 약지를 접은 손)에서 손목을 까딱하는 것
// (손이 향한 방향이 짧은 시간에 휙 꺾이면 쏴요. 손을 옮기기만 하면 방향이 그대로라 안 쏴져요)
const FLICK_MS = 350; // 이 시간 안에 꺾여야 해요 (천천히 기울이는 것은 까딱이 아니에요)
const FLICK_ANGLE = 25; // 몇 도 넘게 꺾여야 하는지 (작게 하면 살짝만 까딱해도 쏴져요)
const FLICK_REST_MS = 500; // 쏜 뒤 이만큼은 쉬어요 (까딱한 손이 돌아오는 움직임에 또 쏘지 않게)
const POSE_RATIO = 0.6; // 까딱하는 동안 손 모양이 이 비율 이상 유지돼야 해요 (0~1 · 높을수록 깐깐해요)
// 손 인식을 얼마나 깐깐하게 할지 (0~1 · 높을수록 확실한 손만 인정해요. 기본값은 0.5)
const HAND_CONFIDENCE = 0.7;
const PALM_GRACE_MS = 250; // 손바닥 인식이 이만큼 잠깐 끊기는 것은 봐줘요
// 손바닥 인식 기준 (실제 손 사진으로 재 본 값이에요. 숫자를 키우면 더 깐깐해져요)
const THUMB_OPEN = 0.45; // 엄지 끝이 손바닥 가운데에서 이만큼(손바닥 길이의 몇 배) 떨어져야 "폈다" (편 엄지는 0.57 이상, 접은 엄지는 0.2쯤)
const PALM_WIDTH = 0.42; // 손바닥 폭이 길이의 이 비율보다 넓어야 "정면" (정면 손바닥은 0.5쯤)
const SIDE_CONFIDENCE = 0.8; // 왼손 · 오른손 구분을 이만큼 확신할 때만 손바닥으로 인정 (0~1)

// 거미줄 그림 7장 (webs 폴더 · 배경이 투명한 PNG). 쏠 때마다 이 중 하나가 랜덤으로 나와요.
// 그림을 더 넣으려면 webs 폴더에 파일을 넣고 여기에 이름을 추가하면 돼요. 빼려면 이름을 지워요.
const WEB_IMAGES = [
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
const HERO_SHOW_MS = 100; // 손바닥을 이만큼 보여 주면 등장 (0 에 가까울수록 빨리 나오지만, 잠깐 잘못 본 것에도 나올 수 있어요)
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
let palmLastSeen = -Infinity; // 손바닥을 마지막으로 본 시각
let audio = null; // 소리를 만드는 도구 (카메라 버튼을 누를 때 만들어요)
let aims = []; // 지금 검지가 가리키는 자리들 (손마다 하나 · 화면에서의 위치 0~1 비율)
const hands = new Map(); // 손마다 "최근에 어디 있었는지 · 쏠 준비가 됐는지"

// ───────── 계산 도우미 ─────────
// 점 번호: 0 손목 · 5 검지 뿌리 · 8 검지 끝 · 9 중지 뿌리
// 쏘는 때 = 손목을 까딱할 때 · 쏘는 곳 = 접은 두 손가락의 등이 있는 자리
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// 깊이(z)까지 넣은 거리. 손을 앞으로 기울여도 손가락 길이를 제대로 재려고 써요.
function distance3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
}

// 점 a 에서 b 로 향하는 방향 (길이를 1 로 맞춘 화살표)
function direction(a, b) {
  const length = distance3(a, b) || 1;
  return { x: (b.x - a.x) / length, y: (b.y - a.y) / length, z: (b.z - a.z) / length };
}

// 두 방향이 몇 도 벌어졌는지 (같은 방향이면 0)
function angleBetween(u, v) {
  const dot = u.x * v.x + u.y * v.y + u.z * v.z;
  return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
}

// 손가락이 펴졌는지: 손가락 끝이 가운데 마디보다 손목에서 더 멀면 편 거예요.
function isExtended(hand, tip, joint) {
  return distance3(hand[tip], hand[0]) > distance3(hand[joint], hand[0]);
}

// "거미줄 손 모양"인지: 중지 · 약지는 접고, 검지나 새끼 중 하나 이상은 폈다.
// (손을 기울이면 한쪽 손가락이 접힌 것처럼 보일 수 있어서, 둘 중 하나만 펴져 있어도 인정해요)
function isWebPose(hand) {
  return (
    !isExtended(hand, 12, 10) &&
    !isExtended(hand, 16, 14) &&
    (isExtended(hand, 8, 6) || isExtended(hand, 20, 18))
  );
}

// 손바닥을 보여 주는 손인지. 아래 네 가지가 모두 맞아야 해요.
// side = MediaPipe 가 알려 준 손의 종류 { categoryName: "Left" 또는 "Right", score: 확신하는 정도 }
function isOpenPalm(hand, side) {
  // ① 다섯 손가락을 모두 폈다.
  //    엄지는 접으면 끝이 손바닥 안쪽(중지 뿌리 9 근처)으로 들어와요. 거기서 충분히 떨어져 있으면 편 거예요.
  const thumbOpen = distance3(hand[4], hand[9]) > distance3(hand[0], hand[9]) * THUMB_OPEN;
  const allOpen =
    thumbOpen &&
    isExtended(hand, 8, 6) &&
    isExtended(hand, 12, 10) &&
    isExtended(hand, 16, 14) &&
    isExtended(hand, 20, 18);

  // ② 손끝이 위를 향한다. (손목 0 → 중지 뿌리 9 방향이 위쪽이고, 옆으로 많이 기울지 않음)
  const up = hand[0].y - hand[9].y;
  const upright = up > 0 && Math.abs(hand[9].x - hand[0].x) < up;

  // ③ 손의 넓은 면이 카메라를 향한다. 옆으로 선 손은 폭이 좁게 보여요.
  //    (폭 = 검지 뿌리 5 ~ 새끼 뿌리 17 · 길이 = 손목 0 ~ 중지 뿌리 9)
  const wide = distance(hand[5], hand[17]) > distance(hand[0], hand[9]) * PALM_WIDTH;

  // ④ 손등이 아니라 손바닥 쪽이 보인다.
  //    손목에서 본 검지 뿌리(5)와 새끼 뿌리(17)의 "도는 방향"은 손바닥과 손등이 서로 반대예요.
  //    어느 쪽이 손바닥인지는 왼손 · 오른손에 따라 달라서, 손의 종류를 확실히 알 때만 인정해요.
  //    (기준은 실제 손바닥 · 손등 사진을 모델에 넣어 보고 정했어요)
  const turn =
    (hand[5].x - hand[0].x) * (hand[17].y - hand[0].y) -
    (hand[5].y - hand[0].y) * (hand[17].x - hand[0].x);
  const palmSide =
    side?.score >= SIDE_CONFIDENCE && (side.categoryName === "Right" ? turn < 0 : turn > 0);

  return allOpen && upright && wide && palmSide;
}

function between(min, max) {
  return min + Math.random() * (max - min);
}

// ───────── 효과음 "슈욱-챱" ─────────
// 소리 파일 없이, 브라우저가 "쉬이이" 하는 잡음을 만들어서 다듬어요.
// context = 소리를 만드는 도구 (보통은 audio 를 그대로 써요)
function playShootSound(context = audio) {
  if (!SOUND_ON || !context) return;
  const start = context.currentTime;

  // 재료: 0.5초짜리 잡음(무작위 숫자) — 바람 소리나 물 튀는 소리의 바탕이 돼요.
  const noise = context.createBuffer(1, context.sampleRate * 0.5, context.sampleRate);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  const playNoise = (when, filter, gain) => {
    const source = context.createBufferSource();
    source.buffer = noise;
    source.connect(filter).connect(gain).connect(context.destination);
    source.start(when);
    source.stop(when + 0.4);
  };

  // ① "슈욱" (0 ~ 0.17초): 잡음에서 높은 음 대역만 좁게 남기고, 그 음높이를 빠르게 쓸어 올려요.
  //    (대역이 좁고 높을수록 날카로운 바람 소리가 돼요)
  const whoosh = context.createBiquadFilter();
  whoosh.type = "bandpass";
  whoosh.Q.value = 3;
  whoosh.frequency.setValueAtTime(1200, start);
  whoosh.frequency.exponentialRampToValueAtTime(7000, start + 0.16);
  const whooshGain = context.createGain();
  whooshGain.gain.setValueAtTime(0.001, start);
  whooshGain.gain.exponentialRampToValueAtTime(SOUND_VOLUME * 3, start + 0.11); // 점점 커지다가
  whooshGain.gain.exponentialRampToValueAtTime(0.001, start + 0.17); // 휙 사라져요
  playNoise(start, whoosh, whooshGain);

  // ② "챱!" (0.18초 ~): 낮은 음은 빼고, 높고 짧은 소리 두 개를 바짝 붙여요.
  //    북처럼 울리지 않게 둘 다 0.1초 안에 뚝 끊어요.
  const hit = start + 0.18;

  // "ㅊ": 아주 높은 음만 남긴 잡음이 0.035초 동안 "칙!"
  const crack = context.createBiquadFilter();
  crack.type = "highpass";
  crack.frequency.value = 3500;
  const crackGain = context.createGain();
  crackGain.gain.setValueAtTime(SOUND_VOLUME * 0.9, hit);
  crackGain.gain.exponentialRampToValueAtTime(0.001, hit + 0.035);
  playNoise(hit, crack, crackGain);

  // "얍": 바로 뒤에 조금 낮은(그래도 높은) 음이 0.06초 동안 "착!" 하고 달라붙어요.
  const smack = context.createBiquadFilter();
  smack.type = "bandpass";
  smack.Q.value = 2.5;
  smack.frequency.value = 1900;
  const smackGain = context.createGain();
  smackGain.gain.setValueAtTime(0.001, hit);
  smackGain.gain.setValueAtTime(SOUND_VOLUME * 2, hit + 0.012);
  smackGain.gain.exponentialRampToValueAtTime(0.001, hit + 0.075);
  playNoise(hit, smack, smackGain);
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

  // 빨간 작은 점: 접은 두 손가락의 등이 있는 자리 (손 그림은 그리지 않아요)
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
  let poseSeen = false; // 거미줄 손 모양인 손이 있는지
  result.landmarks.forEach((landmarks, index) => {
    const name = result.handedness[index]?.[0]?.categoryName ?? String(index);
    seenHands.add(name);
    // history = 최근 손 방향 기록 · firedAt = 마지막으로 쏜 시각 · aim = 빨간 점 위치
    const state = hands.get(name) ?? { history: [], firedAt: -Infinity, aim: null };
    hands.set(name, state);

    // 점 위치(0~1 비율)를 창 안의 위치(픽셀)로 옮겨요. 거울처럼 움직이도록 x 는 좌우를 뒤집어요.
    const toScreen = (point) => ({
      x: offsetX + (1 - point.x) * videoWidth * scale,
      y: offsetY + point.y * videoHeight * scale,
    });

    // 손바닥을 보여 주는 손이면 그 가로 위치를 기억해요. (캐릭터가 그 위에서 내려와요)
    if (isOpenPalm(landmarks, result.handedness[index]?.[0])) {
      palmX = toScreen({ x: (landmarks[0].x + landmarks[9].x) / 2, y: 0 }).x / width;
    }

    // ── 쏘기: 손목 까딱 ──
    const pose = isWebPose(landmarks);
    if (pose) poseSeen = true;

    // 손이 향한 방향 = 손목(0) → 중지 뿌리(9). 손목을 까딱하면 이 방향이 휙 꺾여요.
    // worldLandmarks = 손을 실제 크기(미터)의 입체로 잰 좌표예요. 화면 속 위치와 상관없어서,
    // 손을 옮기기만 하면 방향은 그대로예요.
    const world = result.worldLandmarks[index];
    const tilt = direction(world[0], world[9]);
    // 최근 FLICK_MS 동안의 방향과, 그때 손 모양이 맞았는지를 기억해요.
    state.history.push({ time: now, tilt, pose });
    state.history = state.history.filter((item) => now - item.time <= FLICK_MS);
    // 그동안의 방향 중 지금과 가장 많이 벌어진 각도
    const turned = Math.max(...state.history.map((item) => angleBetween(item.tilt, tilt)));
    // 그동안 손 모양이 얼마나 유지됐는지 (까딱하는 순간 잠깐 잘못 본 프레임은 봐줘요)
    const poseKept =
      state.history.filter((item) => item.pose).length / state.history.length >= POSE_RATIO;

    // 빨간 점: 접은 두 손가락의 "등" = 중지 가운데 마디(10)와 약지 가운데 마디(14)의 중간.
    // 거미줄 손 모양일 때만 보여요. (부드럽게 따라가요)
    const knuckle = {
      x: (landmarks[10].x + landmarks[14].x) / 2,
      y: (landmarks[10].y + landmarks[14].y) / 2,
    };
    if (pose) {
      const onScreen = toScreen(knuckle);
      const target = {
        x: Math.min(1, Math.max(0, onScreen.x / width)),
        y: Math.min(1, Math.max(0, onScreen.y / height)),
      };
      state.aim = state.aim
        ? {
            x: state.aim.x + (target.x - state.aim.x) * AIM_SMOOTH,
            y: state.aim.y + (target.y - state.aim.y) * AIM_SMOOTH,
          }
        : target;
      aims.push(state.aim);
    } else if (!poseKept) {
      state.aim = null; // 손 모양을 풀었으면 점을 지워요 (까딱하다 잠깐 놓친 것은 그대로 둬요)
    }

    const rested = now - state.firedAt >= FLICK_REST_MS;
    if (state.aim && poseKept && turned >= FLICK_ANGLE && rested) {
      // 쏘기! 빨간 점이 있던 자리(접은 두 손가락의 등)에 거미줄을 붙여요.
      webs.push({
        x: state.aim.x,
        y: state.aim.y,
        image: WEB_IMAGES[Math.floor(Math.random() * WEB_IMAGES.length)], // 여러 장 중 랜덤
        size: between(0.75, 1.05),
        turn: between(-0.2, 0.2), // 사진 모양을 살리려고 아주 조금만 돌려요
        born: now,
      });
      playShootSound(); // 슈욱-챱!
      shots++;
      shotsText.textContent = `쏜 거미줄 ${shots}개`;
      state.firedAt = now; // 한 번 까딱에 한 발만
      state.history = []; // 기록을 비워서, 다시 까딱해야 또 쏴져요
    }
  });

  // 화면에서 사라진 손은 잊어요.
  hands.forEach((_, name) => {
    if (!seenHands.has(name)) hands.delete(name);
  });

  // ── 캐릭터 등장 · 퇴장 ──
  if (palmX !== null) {
    // 인식이 잠깐 끊겼다 이어진 것은 계속 보고 있던 것으로 쳐요.
    if (now - palmLastSeen > PALM_GRACE_MS) palmSince = now;
    palmLastSeen = now;
    if (!hero && now - palmSince >= HERO_SHOW_MS) {
      // 등장! 화면 밖으로 나가지 않게 가로 위치는 15%~85% 사이로
      hero = { x: Math.min(0.85, Math.max(0.15, palmX)), born: now, leaveAt: null };
    }
  } else if (hero && hero.leaveAt === null && now - palmLastSeen >= HERO_HIDE_MS) {
    hero.leaveAt = now; // 손바닥이 한동안 안 보이면 퇴장 시작
  }

  // 손 그림은 그리지 않아요. 대신 손을 찾았는지만 글자로 알려 줘요. (바뀔 때만 고쳐요)
  const status = poseSeen
    ? "거미줄 손 모양이에요 · 손목을 까딱하면 쏴져요"
    : palmX !== null
      ? "손바닥이 보여요"
      : seenHands.size > 0
        ? "손을 찾았어요"
        : "손을 보여 주세요";
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
  // 브라우저는 "사용자가 버튼을 누른 뒤"에만 소리를 낼 수 있게 해요. 그래서 여기서 준비해요.
  if (SOUND_ON && !audio) {
    try {
      audio = new AudioContext();
    } catch {
      audio = null; // 소리를 못 쓰는 브라우저면 소리 없이 진행해요
    }
  }
  audio?.resume();
  // 배경 음악도 버튼을 누른 이때 시작해요.
  startMusic();

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
        // 확실한 손만 인정해요. (손이 아닌 것을 손으로 잘못 보는 일을 줄여요)
        minHandDetectionConfidence: HAND_CONFIDENCE,
        minHandPresenceConfidence: HAND_CONFIDENCE,
        minTrackingConfidence: HAND_CONFIDENCE,
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
  stopMusic();
  // 카메라를 끄면 카메라 불도 꺼져요. 화면의 거미줄도 같이 지워요.
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
  hands.clear();
  webs = [];
  aims = [];
  hero = null;
  palmSince = null;
  palmLastSeen = -Infinity;
  drawAll(performance.now());
  handText.textContent = "";
  placeholder.hidden = false;
  placeholder.textContent = "카메라를 켜고, 중지 · 약지를 접은 손의 손목을 까딱해 보세요";
  cameraBtn.textContent = "카메라 켜기";
  cameraBtn.disabled = false;
}

function showMessage(text) {
  stopMusic(); // 카메라를 못 켰으면 음악도 멈춰요
  messageText.textContent = text;
  messageText.hidden = false;
  placeholder.textContent = "카메라를 켜고, 중지 · 약지를 접은 손의 손목을 까딱해 보세요";
  cameraBtn.disabled = false;
}

// 버튼 하나로 켜고 끄기
cameraBtn.addEventListener("click", () => {
  if (stream) stopCamera();
  else startCamera();
});

// 창 크기를 바꾸면 그림판도 바로 맞춰요.
window.addEventListener("resize", () => drawAll(performance.now()));
