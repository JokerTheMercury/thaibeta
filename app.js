/* =====================================================================
   Config
   ===================================================================== */
const SUPABASE_URL = "https://obokvhahkdcbgipompxy.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_kxEo3dqrte7MT42_9EXwIw_o_Gdmp1Q";   // anon key only, never service_role
const BUCKET = "videos";
const AVATAR_BUCKET = "avatars";
const MAX_VIDEO_MB = 50;     // Supabase free plan limit per file
const MAX_AVATAR_MB = 5;
const PROFILE_COLS = "id, username, avatar_path, updated_at";

const GYMS = ["Stonegoat The Parq","Stonegoat S69","Balance Rama 9","Balance Prime","Urban Playground","Rock Domain","Climb Central","Beat Active","Boulder Planet"];
const CITIES = ["Bangkok","Chiang Mai","Phuket","Krabi","Pattaya / Chonburi","Hua Hin","Khon Kaen","Nonthaburi","Other"];
const STYLES = ["Crimpy","Slopers","Pinches","Jugs","Pockets","Dyno","Overhang","Slab","Vertical","Roof","Compression","Balance","Technical","Powerful","Endurance","Heel hooks","Toe hooks","Coordination"];
const HOLD_COLORS = [["Red","#e5484d"],["Orange","#ff7a1a"],["Yellow","#f5d90a"],["Green","#30a46c"],["Mint","#6ee7c5"],["Blue","#3e63dd"],["Purple","#8e4ec6"],["Pink","#e93d82"],["Black","#111111"],["White","#f5f5f5"],["Brown","#8d6e63"]];
const FRENCH = ["4","5a","5b","5c","6a","6a+","6b","6b+","6c","6c+","7a","7a+","7b","7b+","7c","7c+","8a","8a+","8b","8b+"];
const GRADES = {"Boulder":["VB","V0","V1","V2","V3","V4","V5","V6","V7","V8","V9","V10+"],"Top rope":FRENCH,"Lead":FRENCH,"Auto-belay":FRENCH};
const TYPES = Object.keys(GRADES);

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }   // remember the account on this device
});

/* =====================================================================
   State
   ===================================================================== */
let user = null, myProfile = null, guestMode = false;
let reviews = [], loadState = "loading", loadError = "", loadSeq = 0, lastFetch = 0, reviewsSig = "";
const profilesById = {};
let rating = 0, holdColor = null, videoFile = null, videoUrl = null;
const selectedStyles = new Set();

/* =====================================================================
   Helpers
   ===================================================================== */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const nowIso = () => new Date().toISOString();
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const safeColor = c => /^#[0-9a-f]{3,8}$/i.test(c || "") ? c : null;          // only allow real hex colours into style=""
const clampRating = v => Math.max(0, Math.min(5, Math.round(Number(v) || 0)));
const publicUrl = (bucket, path) => sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
const mb = bytes => (bytes / 1048576).toFixed(1);
const isMobile = window.matchMedia("(max-width:900px)");
const onMedia = (mq, fn) => mq.addEventListener ? mq.addEventListener("change", fn) : mq.addListener(fn);
const DEFAULT_AVATAR = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#2a231f"/><circle cx="20" cy="15" r="7" fill="#a99d93"/><rect x="8" y="25" width="24" height="13" rx="6" fill="#a99d93"/></svg>');

let toastTimer;
function toast(msg, kind = "ok"){
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast show" + (kind === "err" ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), kind === "err" ? 4500 : 2800);
}
function setMsg(id, text = "", ok = true){ const el = $(id); el.textContent = text; el.className = "tb-msg " + (text ? (ok ? "ok" : "err") : ""); }

// Put a button into a "working…" state, then call busy(btn) again to restore it
function busy(btn, label){
  if (label){
    if (!("label" in btn.dataset)) btn.dataset.label = btn.textContent;
    btn.textContent = label; btn.disabled = true;
  } else {
    if ("label" in btn.dataset) btn.textContent = btn.dataset.label;
    delete btn.dataset.label; btn.disabled = false;
  }
}

// Turn Supabase / network errors into plain sentences
function friendly(err){
  const m = err?.message || String(err || "Something went wrong");
  if (/invalid login credentials/i.test(m)) return "Wrong email or password.";
  if (/email not confirmed/i.test(m)) return "Confirm your email first. Check your inbox for the link.";
  if (/failed to fetch|networkerror|load failed/i.test(m)) return "Can't reach the server. Check your connection and try again.";
  if (/payload too large|exceeded the maximum allowed size/i.test(m)) return "That file is too big to upload.";
  if (/row-level security|permission denied/i.test(m)) return "You don't have permission to do that. Try logging out and in again.";
  if (/rate limit/i.test(m)) return "Too many tries. Wait a minute and try again.";
  return m;
}

function avatarUrl(p){
  if (!p?.avatar_path) return DEFAULT_AVATAR;
  return publicUrl(AVATAR_BUCKET, p.avatar_path) + "?v=" + encodeURIComponent(p.updated_at || "");
}
function myName(){ return myProfile?.username || user?.user_metadata?.username || user?.email?.split("@")[0] || "Climber"; }

// Blur the site straight away for visitors with no saved login, so they never see a flash of the page
try {
  const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
  if (!localStorage.getItem(`sb-${ref}-auth-token`)) document.body.classList.add("tb-gated");
} catch { document.body.classList.add("tb-gated"); }

/* =====================================================================
   Sidebar + modals
   ===================================================================== */
function openSidebar(){ $("tbSidebar").classList.add("open"); $("tbToggle").setAttribute("aria-expanded", "true"); }
function closeSidebar(){ $("tbSidebar").classList.remove("open"); $("tbToggle").setAttribute("aria-expanded", "false"); }
function toggleSidebar(){ $("tbSidebar").classList.contains("open") ? closeSidebar() : openSidebar(); }

let lastFocus = null;
function syncScrollLock(){ document.body.classList.toggle("no-scroll", !!document.querySelector(".tb-modal.show")); }
function openModal(id, focusEl){
  if (!document.querySelector(".tb-modal.show")) lastFocus = document.activeElement;
  closeSidebar();
  $(id).classList.add("show");
  syncScrollLock();
  requestAnimationFrame(() => (focusEl || $(id).querySelector("[role=dialog]"))?.focus({ preventScroll: true }));
}
function closeModal(id){
  const m = $(id);
  if (!m.classList.contains("show")) return;
  m.classList.remove("show");
  m.querySelectorAll("video").forEach(v => v.pause());
  syncScrollLock();
  if (!document.querySelector(".tb-modal.show") && lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
}

/* =====================================================================
   Auth
   ===================================================================== */
let signUpMode = false;
function setAuthMode(signUp){
  signUpMode = signUp;
  $("tbLoginTitle").textContent = signUp ? "Sign up" : "Log in";
  $("tbLoginSubmit").textContent = signUp ? "Sign up" : "Log in";
  $("tbLoginSwitch").textContent = signUp ? "or, log in" : "or, sign up";
  $("tbLoginName").hidden = !signUp;
  $("tbLoginName").required = signUp;
  $("tbLoginPw").autocomplete = signUp ? "new-password" : "current-password";
  setMsg("tbLoginMsg");
}
function openLogin(signUp = false){
  setAuthMode(signUp);
  openModal("tbLoginModal", $(signUp ? "tbLoginName" : "tbLoginEmail"));
}
// × / Esc / clicking outside the log in box: look around without an account
function dismissLogin(){
  if (!user){ guestMode = true; document.body.classList.remove("tb-gated"); }
  closeModal("tbLoginModal");
}

$("tbLoginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("tbLoginEmail").value.trim(), password = $("tbLoginPw").value, username = $("tbLoginName").value.trim();
  const btn = $("tbLoginSubmit");
  setMsg("tbLoginMsg");
  try {
    if (signUpMode){
      if (username.length < 3) return setMsg("tbLoginMsg", "Username must be at least 3 characters", false);
      busy(btn, "Creating account…");
      const { data: taken } = await sb.from("profiles").select("id").eq("username", username).maybeSingle();
      if (taken) return setMsg("tbLoginMsg", "That username is taken. Try another.", false);
      // The username rides along with the account, so it is saved even if the email needs confirming first
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username } } });
      if (error) return setMsg("tbLoginMsg", friendly(error), false);
      if (data.user && Array.isArray(data.user.identities) && !data.user.identities.length)
        return setMsg("tbLoginMsg", "An account with this email already exists. Log in instead.", false);
      if (!data.session){
        setAuthMode(false);
        $("tbLoginPw").value = "";
        return setMsg("tbLoginMsg", "Check your email for a confirmation link, then log in here.", true);
      }
      toast("Welcome to ThaiBeta! 🧗");
    } else {
      busy(btn, "Logging in…");
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return setMsg("tbLoginMsg", friendly(error), false);
      toast("Logged in");
    }
    $("tbLoginPw").value = "";
    closeModal("tbLoginModal");
  } catch (err) {
    setMsg("tbLoginMsg", friendly(err), false);
  } finally {
    busy(btn);
  }
});

// Only react when the person actually changes (not on every token refresh)
sb.auth.onAuthStateChange((event, session) => {
  const next = session?.user ?? null;
  const changed = event === "INITIAL_SESSION" || next?.id !== user?.id;
  user = next;
  if (changed) setTimeout(onUserChanged, 0);   // don't call Supabase inside this callback
});

async function onUserChanged(){
  $("tbLogoutBtn").hidden = !user;
  $("tbLoginBtn").hidden = !!user;
  if (user){
    document.body.classList.remove("tb-gated");
    closeModal("tbLoginModal");
  } else {
    myProfile = null;
    closeModal("tbProfileModal"); closeModal("tbSettingsModal");
    if (!guestMode){ document.body.classList.add("tb-gated"); if (!$("tbLoginModal").classList.contains("show")) openLogin(); }
  }
  refreshMeUI();
  draw();
  if (inChat()){ renderCompose(); renderMessages(); }
  if (user) await loadMyProfile();
}

async function loadMyProfile(){
  const uid = user.id;
  let { data: p, error } = await sb.from("profiles").select(PROFILE_COLS).eq("id", uid).maybeSingle();
  if (error) console.error(error);
  // First log in after signing up: save the username they picked
  const wanted = user?.user_metadata?.username;
  if (!p?.username && wanted){
    const res = await sb.from("profiles").upsert({ id: uid, username: wanted, updated_at: nowIso() }).select(PROFILE_COLS).maybeSingle();
    if (res.error) toast(res.error.code === "23505" ? "That username was taken. Choose another in Settings." : friendly(res.error), "err");
    else p = res.data;
  }
  if (user?.id !== uid) return;   // logged out while we were waiting
  myProfile = p || { id: uid, username: null, avatar_path: null };
  if (p) profilesById[uid] = p;
  refreshMeUI();
  draw();
}

function refreshMeUI(){
  $("tbSideName").textContent = user ? myName() : "Guest";
  $("tbSideAvatar").src = user ? avatarUrl(myProfile) : DEFAULT_AVATAR;
  $("postingAs").innerHTML = user ? `Posting as <b>${esc(myName())}</b>` : "Log in when you're ready to publish.";
  syncSubmit();
}

async function logout(){
  closeSidebar();
  guestMode = false;
  const { error } = await sb.auth.signOut();
  if (error) toast(friendly(error), "err"); else toast("Logged out");
}

/* =====================================================================
   Review form
   ===================================================================== */
$("city").innerHTML = CITIES.map(c => `<option>${esc(c)}</option>`).join("");
$("gym").innerHTML = `<option value="">— Select gym —</option>` + GYMS.map(g => `<option>${esc(g)}</option>`).join("") + `<option value="__other">Other (type your own)</option>`;
$("type").innerHTML = TYPES.map(t => `<option>${t}</option>`).join("");
$("fCity").innerHTML += CITIES.map(c => `<option>${esc(c)}</option>`).join("");
$("fType").innerHTML += TYPES.map(t => `<option>${t}</option>`).join("");
$("fStyle").innerHTML += STYLES.map(s => `<option>${esc(s)}</option>`).join("");

function toggleGymOther(){
  const other = $("gym").value === "__other";
  $("gymOther").hidden = !other;
  $("gymOther").required = other;
  if (other) $("gymOther").focus(); else $("gymOther").value = "";
}
$("gym").addEventListener("change", toggleGymOther);

function fillGrades(){ $("grade").innerHTML = GRADES[$("type").value].map(g => `<option>${g}</option>`).join(""); }
$("type").addEventListener("change", fillGrades);
fillGrades();

// Hold colour: pick one (tap again to clear)
$("holdChips").innerHTML = HOLD_COLORS.map(([name, hex]) =>
  `<button type="button" class="chip" data-hold="${hex}" data-name="${name}" aria-pressed="false"><span class="dot" style="background:${hex}"></span>${name}</button>`).join("");
$("holdChips").addEventListener("click", e => {
  const chip = e.target.closest("[data-hold]"); if (!chip) return;
  holdColor = holdColor?.hex === chip.dataset.hold ? null : { hex: chip.dataset.hold, name: chip.dataset.name };
  paintChips();
});

// Styles: pick any number
$("styleChips").innerHTML = STYLES.map(s => `<button type="button" class="chip" data-style="${esc(s)}" aria-pressed="false">${esc(s)}</button>`).join("");
$("styleChips").addEventListener("click", e => {
  const chip = e.target.closest("[data-style]"); if (!chip) return;
  const s = chip.dataset.style;
  selectedStyles.has(s) ? selectedStyles.delete(s) : selectedStyles.add(s);
  paintChips();
});
function paintChips(){
  $("holdChips").querySelectorAll("[data-hold]").forEach(c => c.setAttribute("aria-pressed", String(holdColor?.hex === c.dataset.hold)));
  $("styleChips").querySelectorAll("[data-style]").forEach(c => c.setAttribute("aria-pressed", String(selectedStyles.has(c.dataset.style))));
}

// Stars
$("stars").innerHTML = [1,2,3,4,5].map(i => `<button type="button" data-v="${i}" aria-label="${plural(i, "star")}" aria-pressed="false">★</button>`).join("");
$("stars").addEventListener("click", e => {
  const b = e.target.closest("[data-v]"); if (!b) return;
  rating = +b.dataset.v; paintStars();
});
function paintStars(){
  [...$("stars").children].forEach((b, i) => { b.classList.toggle("on", i < rating); b.setAttribute("aria-pressed", String(i + 1 === rating)); });
  $("ratingText").textContent = rating ? `${rating} / 5` : "Tap to rate";
}
paintStars();

// Beta video picker + drag and drop
function setVideo(file){
  if (!file) return;
  const looksLikeVideo = file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(file.name);
  if (!looksLikeVideo) return toast("Choose a video file (MP4, MOV or WebM)", "err");
  if (file.size > MAX_VIDEO_MB * 1048576) return toast(`That video is ${mb(file.size)} MB. The limit is ${MAX_VIDEO_MB} MB.`, "err");
  clearVideo();
  videoFile = file;
  videoUrl = URL.createObjectURL(file);
  const p = $("videoPreview"); p.src = videoUrl; p.hidden = false;
  $("videoName").textContent = `${file.name} (${mb(file.size)} MB)`;
  $("videoPicked").hidden = false;
  syncSubmit();
}
function clearVideo(){
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = null; videoFile = null;
  const p = $("videoPreview"); p.pause(); p.removeAttribute("src"); p.load(); p.hidden = true;
  $("videoPicked").hidden = true;
  $("video").value = "";
  syncSubmit();
}
// Publish button stays grey until a video is chosen
function syncSubmit(){
  const btn = $("submitBtn");
  if ("label" in btn.dataset) return;   // busy uploading/saving, leave it alone
  btn.disabled = !videoFile;
  btn.textContent = !videoFile ? "Add a video to publish" : (user ? "Publish review" : "Log in to publish");
}
const drop = $("fileDrop");
drop.addEventListener("click", () => $("video").click());
$("video").addEventListener("change", e => setVideo(e.target.files[0]));
["dragenter","dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("drag"); }));
["dragleave","drop"].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove("drag")));
drop.addEventListener("drop", e => { e.preventDefault(); setVideo(e.dataTransfer.files[0]); });
syncSubmit();

// Phones / tablets: the form folds up so the reviews are visible first
function setFormOpen(open){
  $("reviewForm").classList.toggle("collapsed", !open);
  $("formToggle").setAttribute("aria-expanded", String(open));
}
function syncFormLayout(){
  $("formToggle").tabIndex = isMobile.matches ? 0 : -1;
  setFormOpen(!isMobile.matches);
}
onMedia(isMobile, syncFormLayout);
syncFormLayout();

/* ---------- Publish: upload video → insert row ---------- */
$("reviewForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!user){ toast("Log in to publish your review"); return openLogin(); }
  if (!videoFile){ toast("Upload a beta video before publishing", "err"); return; }
  if (!rating){ toast("Give the route a star rating first", "err"); $("stars").querySelector("button").focus(); return; }
  const btn = $("submitBtn");
  let video_path = null;
  try {
    if (videoFile){
      busy(btn, "Uploading video…");
      const ext = (videoFile.name.split(".").pop() || "mp4").toLowerCase();
      video_path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await sb.storage.from(BUCKET).upload(video_path, videoFile, { contentType: videoFile.type || "video/mp4", cacheControl: "3600" });
      if (upErr){ video_path = null; throw upErr; }
    }
    busy(btn, "Saving review…");
    const { data, error } = await sb.from("reviews").insert({
      reviewer: myName(),
      city: $("city").value,
      gym: $("gym").value === "__other" ? $("gymOther").value.trim() : $("gym").value,
      area: $("area").value.trim(),
      route_name: $("routeName").value.trim(),
      type: $("type").value,
      grade: $("grade").value,
      hold_color: holdColor?.hex || null,
      hold_color_name: holdColor?.name || null,
      styles: [...selectedStyles],
      rating,
      review_text: $("reviewText").value.trim(),
      video_path
    }).select().single();
    if (error) throw error;

    reviews.unshift(normalize(data));          // show it instantly, no reload
    reviewsSig = sigOf(reviews);
    fillGymFilter();
    resetForm();
    draw();
    toast("Review published! 🧗");
    if (isMobile.matches){ setFormOpen(false); $("feed").scrollIntoView({ behavior: "smooth", block: "start" }); }
  } catch (err) {
    console.error(err);
    if (video_path) sb.storage.from(BUCKET).remove([video_path]);   // don't leave an orphan video behind
    toast("Couldn't publish: " + friendly(err), "err");
  } finally {
    busy(btn);
    refreshMeUI();
  }
});

// Clears the route details but keeps city + gym, since people often log several routes in one session
function resetForm(){
  const keep = { city: $("city").value, gym: $("gym").value, gymOther: $("gymOther").value };
  $("reviewForm").reset();
  $("city").value = keep.city; $("gym").value = keep.gym;
  $("gymOther").hidden = keep.gym !== "__other"; $("gymOther").value = keep.gymOther;
  fillGrades();
  rating = 0; paintStars();
  holdColor = null; selectedStyles.clear(); paintChips();
  clearVideo();
}

/* =====================================================================
   Load reviews (once) — filtering and sorting happen locally
   ===================================================================== */
function normalize(r){
  return {
    ...r,
    routeName: r.route_name || "",
    text: r.review_text || "",
    styles: Array.isArray(r.styles) ? r.styles : (r.styles ? String(r.styles).split(/,\s*/) : []),
    rating: clampRating(r.rating),
    holdColor: safeColor(r.hold_color),
    holdColorName: r.hold_color_name || "",
    createdAt: Date.parse(r.created_at) || Date.now(),
    video: r.video_path ? publicUrl(BUCKET, r.video_path) : null
  };
}
const sigOf = list => list.map(r => r.id).join(",");

async function fetchReviews(){
  const seq = ++loadSeq;
  if (!reviews.length){ loadState = "loading"; draw(); }
  const { data, error } = await sb.from("reviews").select("*").order("created_at", { ascending: false }).limit(300);
  if (seq !== loadSeq) return;
  if (error){ console.error(error); loadState = "error"; loadError = friendly(error); draw(); return; }

  // Username + photo of everyone who posted (in batches so the request URL stays short)
  const ids = [...new Set(data.map(r => r.user_id).filter(Boolean))].filter(id => !profilesById[id]);
  for (let i = 0; i < ids.length; i += 100){
    const { data: profs, error: pErr } = await sb.from("profiles").select(PROFILE_COLS).in("id", ids.slice(i, i + 100));
    if (pErr) console.error(pErr);
    (profs || []).forEach(p => profilesById[p.id] = p);
  }
  if (seq !== loadSeq) return;

  lastFetch = Date.now();
  const sig = sigOf(data);
  if (loadState === "ready" && sig === reviewsSig) return;   // nothing new, don't interrupt anyone
  reviews = data.map(normalize);
  reviewsSig = sig;
  loadState = "ready";
  fillGymFilter();
  draw();
}

function fillGymFilter(){
  const sel = $("fGym"), cur = sel.value;
  const gyms = [...new Set([...GYMS, ...reviews.map(r => r.gym).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
  sel.innerHTML = `<option value="">All gyms</option>` + gyms.map(g => `<option>${esc(g)}</option>`).join("");
  sel.value = gyms.includes(cur) ? cur : "";
}

/* =====================================================================
   Render
   ===================================================================== */
const FILTER_IDS = ["q","fCity","fGym","fType","fStyle"];
const hasFilters = () => FILTER_IDS.some(id => $(id).value.trim());
function clearFilters(){ FILTER_IDS.forEach(id => $(id).value = ""); draw(); }

function filtered(){
  const q = $("q").value.toLowerCase().trim();
  const fCity = $("fCity").value, fGym = $("fGym").value, fType = $("fType").value, fStyle = $("fStyle").value, sort = $("sort").value;
  return reviews.filter(r =>
    (!fCity || r.city === fCity) && (!fGym || r.gym === fGym) && (!fType || r.type === fType) && (!fStyle || r.styles.includes(fStyle)) &&
    (!q || [r.routeName, r.gym, r.area, r.grade, r.text, r.reviewer, profilesById[r.user_id]?.username].join(" ").toLowerCase().includes(q))
  ).sort((a, b) =>
    sort === "old" ? a.createdAt - b.createdAt :
    sort === "rating" ? b.rating - a.rating || b.createdAt - a.createdAt :
    b.createdAt - a.createdAt);
}

function draw(){
  const feed = $("feed"), stats = $("stats");
  if (loadState === "loading" && !reviews.length){
    stats.textContent = "Loading reviews…";
    feed.innerHTML = `<div class="skel"></div>`.repeat(3);
    return;
  }
  if (loadState === "error" && !reviews.length){
    stats.textContent = "";
    feed.innerHTML = `<div class="empty"><p>Couldn't load reviews. ${esc(loadError)}</p><button type="button" class="btn-sm" data-action="retry">Try again</button></div>`;
    return;
  }

  const list = filtered(), active = hasFilters();
  const rated = list.filter(r => r.rating);
  const avg = rated.length ? (rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(1) + "★" : "–";
  stats.innerHTML = `${plural(list.length, "review")} · ${plural(list.filter(r => r.video).length, "beta video")} · avg rating ${avg}` +
    (active ? ` <button type="button" class="btn-link" data-action="clear-filters">Clear filters</button>` : "");

  feed.querySelectorAll("video[data-src]:not([src])").forEach(v => vidObserver?.unobserve(v));
  if (!list.length){
    feed.innerHTML = active
      ? `<div class="empty"><p>No reviews match these filters.</p><button type="button" class="btn-sm" data-action="clear-filters">Clear filters</button></div>`
      : `<div class="empty"><p>No reviews yet. Send a route and post the first beta! 💪</p></div>`;
    return;
  }
  feed.innerHTML = list.map(cardHtml).join("");
  observeVideos(feed);
}

function cardHtml(r){
  const media = r.video ? tbVideoHtml(r.video, r) : `<div class="no-video">No beta video yet</div>`;
  const hold = r.holdColor ? `<span class="hold-dot" style="background:${r.holdColor}"></span>${esc(r.holdColorName)} holds · ` : "";
  const mine = user && r.user_id === user.id;
  const date = new Date(r.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `
    <article class="card">
      ${media}
      <div class="card-body">
        <div class="card-title"><h3>${esc(r.routeName)}</h3><span class="grade">${esc(r.grade)}</span></div>
        <div class="meta">📍 <strong>${esc(r.gym)}</strong>, ${esc(r.city)}<br>🧱 ${esc(r.area)}<br>${hold}${esc(r.type)}</div>
        ${r.rating ? `<div class="rating" role="img" aria-label="${r.rating} out of 5 stars">${"★".repeat(r.rating)}<span>${"★".repeat(5 - r.rating)}</span></div>` : ""}
        ${r.styles.length ? `<div class="tags">${r.styles.map(s => `<span class="tag">${esc(s)}</span>`).join("")}</div>` : ""}
        <div class="review-text">${esc(r.text)}</div>
        <div class="card-foot">
          <span>by ${byUser(r)} · ${date}</span>
          ${mine ? `<button type="button" class="btn-ghost" data-del="${esc(r.id)}">Delete</button>` : ""}
        </div>
      </div>
    </article>`;
}

// Small photo + name after "by" — tap to open that person's profile
function byUser(r){
  const p = profilesById[r.user_id];
  const name = p?.username || r.reviewer || "Climber";
  if (!r.user_id) return esc(name);
  return `<button type="button" class="by-user" data-user="${esc(r.user_id)}" title="View profile"><img src="${esc(avatarUrl(p))}" alt="" loading="lazy"><span>${esc(name)}</span></button>`;
}

async function deleteReview(btn){
  const id = btn.dataset.del;
  if (!confirm("Delete this review? This can't be undone.")) return;
  const rv = reviews.find(r => String(r.id) === id);
  busy(btn, "Deleting…");
  // .select() tells us whether a row was really removed (security rules can silently block a delete)
  const { data, error } = await sb.from("reviews").delete().eq("id", rv ? rv.id : id).select("id");
  if (error || !data?.length){ busy(btn); return toast("Couldn't delete: " + (error ? friendly(error) : "this review isn't yours or is already gone."), "err"); }
  if (rv?.video_path) sb.storage.from(BUCKET).remove([rv.video_path]).then(({ error }) => error && console.error(error));
  reviews = reviews.filter(r => String(r.id) !== id);
  reviewsSig = sigOf(reviews);
  fillGymFilter();
  draw();
  toast("Review deleted");
}

/* =====================================================================
   Videos: load only when near the screen, one plays at a time
   ===================================================================== */
const vidObserver = "IntersectionObserver" in window
  ? new IntersectionObserver(entries => entries.forEach(en => {
      if (!en.isIntersecting) return;
      const v = en.target; v.src = v.dataset.src; vidObserver.unobserve(v);
    }), { rootMargin: "400px 0px" })
  : null;
function observeVideos(root){
  root.querySelectorAll("video[data-src]:not([src])").forEach(v => vidObserver ? vidObserver.observe(v) : (v.src = v.dataset.src));
}
document.addEventListener("play", e => {
  document.querySelectorAll("video").forEach(v => { if (v !== e.target && !v.paused) v.pause(); });
}, true);

// Video + beta details shown in full screen. Full screen goes through our ⛶ button
// (the browser's own full screen button can't show anything on top of the video, so it is hidden).
function tbVideoHtml(url, r){
  const title = [r.routeName && r.routeName !== "-" ? r.routeName : "", r.grade, r.type].filter(Boolean).join(" · ");
  const where = [r.gym, r.area, r.city].filter(Boolean).join(" · ");
  const extra = [r.holdColorName ? r.holdColorName + " holds" : "", r.rating ? "★".repeat(r.rating) : "", r.styles.join(", ")].filter(Boolean).join(" · ");
  return `<div class="tb-vid">
    <video data-src="${esc(url)}#t=0.1" controls controlslist="nofullscreen" playsinline preload="metadata"></video>
    <button type="button" class="tb-fs" title="Full screen" aria-label="Full screen">⛶</button>
    <div class="tb-vid-info">
      <b>${esc(title || "Beta video")}</b>
      ${where ? `<div>${esc(where)}</div>` : ""}
      ${extra ? `<div>${esc(extra)}</div>` : ""}
    </div>
  </div>`;
}
function tbVidFull(box){
  if (document.fullscreenElement || document.webkitFullscreenElement)
    return void (document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen());
  const vid = box.querySelector("video");
  if (!vid.src && vid.dataset.src) vid.src = vid.dataset.src;
  if (box.requestFullscreen) box.requestFullscreen();
  else if (box.webkitRequestFullscreen) box.webkitRequestFullscreen();
  else if (vid.webkitEnterFullscreen) vid.webkitEnterFullscreen();   // iPhone: plain video full screen
}
document.addEventListener("dblclick", e => { const vid = e.target.closest(".tb-vid video"); if (vid) tbVidFull(vid.closest(".tb-vid")); });

/* =====================================================================
   Profile
   ===================================================================== */
async function showProfile(userId){
  const isMe = user?.id === userId;
  const fallback = reviews.find(r => r.user_id === userId)?.reviewer || "Climber";
  const paint = p => {
    const name = p?.username || (isMe ? myName() : fallback);
    $("tbProfName").textContent = name;
    $("tbProfAvatar").src = avatarUrl(p);
    $("tbVidsTitle").textContent = isMe ? "My beta videos" : `${name}'s beta videos`;
  };
  let p = isMe ? myProfile : profilesById[userId];
  paint(p);
  $("tbAvatarEdit").hidden = !isMe;   // only you can change your own photo
  setMsg("tbAvatarMsg");
  openModal("tbProfileModal");
  loadUserVideos(userId);
  if (!p){
    const { data } = await sb.from("profiles").select(PROFILE_COLS).eq("id", userId).maybeSingle();
    if (data){ profilesById[userId] = data; paint(data); }
  }
}

let vidsSeq = 0;
async function loadUserVideos(userId){
  const seq = ++vidsSeq, box = $("tbMyVideos");
  box.innerHTML = `<small>Loading…</small>`;
  const { data, error } = await sb.from("reviews").select("*")
    .eq("user_id", userId).not("video_path", "is", null).order("created_at", { ascending: false });
  if (seq !== vidsSeq) return;
  if (error){ box.innerHTML = `<small>${esc(friendly(error))}</small>`; return; }
  if (!data.length){
    box.innerHTML = `<small>${user?.id === userId ? "No beta videos yet. Add one with your next review." : "No beta videos yet."}</small>`;
    return;
  }
  box.innerHTML = data.map(normalize).map(r => `
    <div>
      ${tbVideoHtml(r.video, r)}
      <small>${esc([r.routeName, r.grade, r.gym].filter(Boolean).join(" · "))}</small>
    </div>`).join("");
  observeVideos(box);
}

// Upload / replace profile photo → avatars/<user id>/avatar.<ext>
$("tbAvatarFile").addEventListener("change", async e => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || !user) return;
  if (!file.type.startsWith("image/")) return setMsg("tbAvatarMsg", "Choose an image file", false);
  if (file.size > MAX_AVATAR_MB * 1048576) return setMsg("tbAvatarMsg", `Photo must be under ${MAX_AVATAR_MB} MB`, false);
  setMsg("tbAvatarMsg", "Uploading…", true);
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${user.id}/avatar.${ext}`;
  const up = await sb.storage.from(AVATAR_BUCKET).upload(path, file, { upsert: true, contentType: file.type });
  if (up.error) return setMsg("tbAvatarMsg", friendly(up.error), false);
  const stamp = nowIso();
  const { data, error } = await sb.from("profiles").upsert({ id: user.id, avatar_path: path, updated_at: stamp }).select(PROFILE_COLS).maybeSingle();
  if (error) return setMsg("tbAvatarMsg", friendly(error), false);
  myProfile = data || { ...myProfile, avatar_path: path, updated_at: stamp };
  profilesById[user.id] = myProfile;
  setMsg("tbAvatarMsg", "Photo updated", true);
  $("tbProfAvatar").src = avatarUrl(myProfile);
  refreshMeUI();
  draw();   // refresh the little photos on your review cards
});

/* =====================================================================
   Settings
   ===================================================================== */
function openSettings(){
  $("tbNewName").value = myProfile?.username || "";
  $("tbNewName").placeholder = myName();
  $("tbPwEmail").value = user.email || "";
  ["tbNameMsg","tbPwMsg"].forEach(id => setMsg(id));
  openModal("tbSettingsModal");
}

$("tbNameForm").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("tbNewName").value.trim(), btn = $("tbNameBtn");
  if (name.length < 3) return setMsg("tbNameMsg", "Username must be at least 3 characters", false);
  if (name === myProfile?.username) return setMsg("tbNameMsg", "That's already your username", true);
  busy(btn, "Saving…");
  const { data, error } = await sb.from("profiles").upsert({ id: user.id, username: name, updated_at: nowIso() }).select(PROFILE_COLS).maybeSingle();
  busy(btn);
  if (error) return setMsg("tbNameMsg", error.code === "23505" ? "That username is already taken" : friendly(error), false);
  myProfile = data || { ...myProfile, username: name };
  profilesById[user.id] = myProfile;
  setMsg("tbNameMsg", "Username saved", true);
  refreshMeUI();
  draw();   // refresh the names on your review cards
});

$("tbPwForm").addEventListener("submit", async e => {
  e.preventDefault();
  const cur = $("tbCurPw").value, pw = $("tbNewPw").value, pw2 = $("tbNewPw2").value, btn = $("tbPwBtn");
  if (pw.length < 6) return setMsg("tbPwMsg", "New password must be at least 6 characters", false);
  if (pw !== pw2) return setMsg("tbPwMsg", "New passwords don't match", false);
  if (pw === cur) return setMsg("tbPwMsg", "New password is the same as the current one", false);
  busy(btn, "Changing…");
  try {
    const check = await sb.auth.signInWithPassword({ email: user.email, password: cur });   // confirm current password
    if (check.error) return setMsg("tbPwMsg", "Current password is wrong", false);
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) return setMsg("tbPwMsg", friendly(error), false);
    ["tbCurPw","tbNewPw","tbNewPw2"].forEach(id => $(id).value = "");
    setMsg("tbPwMsg", "Password changed", true);
  } finally { busy(btn); }
});

/* =====================================================================
   Chat: Discord-style channels with live messages
   ===================================================================== */
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const TOPIC_CHANNELS = [
  ["general", "Anything climbing"],
  ["beta-help", "Stuck on a route? Ask for beta here"],
  ["find-partners", "Find people to climb with"],
  ["gear", "Shoes, chalk and gear talk"],
  ["outdoor", "Outdoor trips and crags"]
];
const GYM_CHANNELS = GYMS.map(g => [slugify(g), `Talk about ${g}`]);
const ALL_CHANNELS = [...TOPIC_CHANNELS, ...GYM_CHANNELS];

let chCurrent = "general", chMsgsList = [], chSub = null, chLoaded = false;
const chUnread = new Set();
try { const saved = localStorage.getItem("tb-chat-channel"); if (ALL_CHANNELS.some(c => c[0] === saved)) chCurrent = saved; } catch {}

const inChat = () => document.body.classList.contains("chat-mode");

function setView(chat){
  document.body.classList.toggle("chat-mode", chat);
  $("navReviews").classList.toggle("active", !chat);
  $("navChat").classList.toggle("active", chat);
  closeSidebar();
  if (!chat) return;
  renderChannels();
  renderCompose();
  startRealtime();
  if (!chLoaded) openChannel(chCurrent);
}

function renderChannels(){
  const item = ([slug]) => `<button type="button" class="ch-item${slug === chCurrent ? " active" : ""}${chUnread.has(slug) ? " unread" : ""}" data-ch="${slug}"><span class="hash">#</span>${slug}</button>`;
  $("chList").innerHTML =
    `<div class="ch-group">Topics</div>${TOPIC_CHANNELS.map(item).join("")}` +
    `<div class="ch-group">Gyms</div>${GYM_CHANNELS.map(item).join("")}`;
  $("chList").querySelector(".ch-item.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

async function openChannel(slug){
  chCurrent = slug; chLoaded = true; chMsgsList = [];
  chUnread.delete(slug);
  try { localStorage.setItem("tb-chat-channel", slug); } catch {}
  const info = ALL_CHANNELS.find(c => c[0] === slug);
  $("chName").textContent = slug;
  $("chDesc").textContent = info ? info[1] : "";
  if ($("chText")) $("chText").placeholder = `Message #${slug}`;
  $("chMsgs").innerHTML = `<div class="ch-empty">Loading…</div>`;
  renderChannels();
  const { data, error } = await sb.from("messages")
    .select("id, channel, user_id, body, created_at")
    .eq("channel", slug).order("created_at", { ascending: false }).limit(150);
  if (slug !== chCurrent) return;
  if (error){
    console.error(error);
    $("chMsgs").innerHTML = `<div class="ch-empty">Couldn't load messages. ${esc(friendly(error))}</div>`;
    return;
  }
  await loadProfiles(data.map(m => m.user_id));
  if (slug !== chCurrent) return;
  chMsgsList = data.reverse();
  renderMessages(true);
  if (!isMobile.matches) $("chText")?.focus({ preventScroll: true });
}

async function loadProfiles(ids){
  const need = [...new Set(ids.filter(Boolean))].filter(id => !profilesById[id]);
  for (let i = 0; i < need.length; i += 100){
    const { data, error } = await sb.from("profiles").select(PROFILE_COLS).in("id", need.slice(i, i + 100));
    if (error) console.error(error);
    (data || []).forEach(p => profilesById[p.id] = p);
  }
}

function chTime(iso){
  const d = new Date(iso), now = new Date();
  const t = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return "Today " + t;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday " + t;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" }) + " " + t;
}

function renderMessages(toBottom){
  const box = $("chMsgs");
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  if (!chMsgsList.length){
    box.innerHTML = `<div class="ch-empty">This is the start of #${esc(chCurrent)}. Say hi! 👋</div>`;
    return;
  }
  let prev = null;
  box.innerHTML = chMsgsList.map(m => {
    // Messages from the same person within 5 minutes are grouped, like Discord
    const first = !prev || prev.user_id !== m.user_id || Date.parse(m.created_at) - Date.parse(prev.created_at) > 5 * 60000;
    prev = m;
    const p = profilesById[m.user_id];
    const mine = user && m.user_id === user.id;
    return `<div class="ch-msg${first ? " first" : ""}">
      ${first ? `<img src="${esc(avatarUrl(p))}" alt="" loading="lazy">` : `<span class="ch-gap"></span>`}
      <div class="ch-body">
        ${first ? `<div class="ch-msg-head"><button type="button" class="ch-who" data-user="${esc(m.user_id)}">${esc(p?.username || "Climber")}</button><span class="ch-time">${esc(chTime(m.created_at))}</span></div>` : ""}
        <div class="ch-text">${esc(m.body)}</div>
      </div>
      ${mine ? `<button type="button" class="ch-del" data-mdel="${esc(m.id)}">Delete</button>` : ""}
    </div>`;
  }).join("");
  if (toBottom || nearBottom) box.scrollTop = box.scrollHeight;
}

function renderCompose(){
  $("chCompose").innerHTML = user
    ? `<div class="ch-box"><textarea id="chText" rows="1" maxlength="2000" placeholder="Message #${esc(chCurrent)}"></textarea>
       <button type="button" class="btn-sm" id="chSend" data-action="send-chat">Send</button></div>`
    : `<div class="ch-guest"><span>Log in to join the chat.</span><button type="button" class="btn-sm" data-action="login">Log in</button></div>`;
}

async function sendChat(){
  if (!user) return openLogin();
  const box = $("chText"), btn = $("chSend");
  const body = box.value.trim();
  if (!body || "label" in btn.dataset) return;
  const channel = chCurrent;
  busy(btn, "…");
  const { data, error } = await sb.from("messages")
    .insert({ channel, user_id: user.id, body })
    .select("id, channel, user_id, body, created_at").single();
  busy(btn);
  if (error) return toast("Couldn't send: " + friendly(error), "err");
  if (myProfile) profilesById[user.id] = myProfile;
  box.value = ""; box.style.height = "";
  box.focus();
  if (channel === chCurrent && !chMsgsList.some(m => m.id === data.id)){
    chMsgsList.push(data);
    renderMessages(true);
  }
}

async function deleteMessage(btn){
  if (!confirm("Delete this message?")) return;
  const id = btn.dataset.mdel;
  const { data, error } = await sb.from("messages").delete().eq("id", id).select("id");
  if (error || !data?.length) return toast("Couldn't delete: " + (error ? friendly(error) : "this message isn't yours or is already gone."), "err");
  chMsgsList = chMsgsList.filter(m => String(m.id) !== String(id));
  renderMessages();
}

// Live updates: new and deleted messages appear without refreshing
function startRealtime(){
  if (chSub) return;
  chSub = sb.channel("tb-chat")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, async ({ new: m }) => {
      if (m.channel !== chCurrent){ chUnread.add(m.channel); if (inChat()) renderChannels(); return; }
      if (chMsgsList.some(x => x.id === m.id)) return;
      await loadProfiles([m.user_id]);
      if (m.channel !== chCurrent || chMsgsList.some(x => x.id === m.id)) return;
      chMsgsList.push(m);
      renderMessages();
    })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, ({ old }) => {
      if (!chMsgsList.some(m => m.id === old.id)) return;
      chMsgsList = chMsgsList.filter(m => m.id !== old.id);
      renderMessages();
    })
    .subscribe();
}

// Enter sends, Shift+Enter makes a new line; the box grows as you type
document.addEventListener("keydown", e => {
  if (e.target.id === "chText" && e.key === "Enter" && !e.shiftKey && !e.isComposing){ e.preventDefault(); sendChat(); }
});
document.addEventListener("input", e => {
  if (e.target.id !== "chText") return;
  e.target.style.height = "";
  e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
});

// #chat in the address bar opens the chat, so the back button works
window.addEventListener("hashchange", () => setView(location.hash === "#chat"));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && inChat()) openChannel(chCurrent);
});

/* =====================================================================
   One click handler for every button on the page
   ===================================================================== */
document.addEventListener("click", e => {
  // Clicking the dark area around a popup closes it
  if (e.target.classList?.contains("tb-modal")) return e.target.id === "tbLoginModal" ? dismissLogin() : closeModal(e.target.id);

  const a = e.target.closest("[data-action]");
  if (a){
    switch (a.dataset.action){
      case "toggle-sidebar": return toggleSidebar();
      case "close-sidebar":  return closeSidebar();
      case "profile":        return user ? showProfile(user.id) : openLogin();
      case "settings":       return user ? openSettings() : openLogin();
      case "login":          return openLogin();
      case "logout":         return logout();
      case "close":          return closeModal(a.dataset.target);
      case "dismiss-login":  return dismissLogin();
      case "switch-auth":    setAuthMode(!signUpMode); return $(signUpMode ? "tbLoginName" : "tbLoginEmail").focus();
      case "retry":          return fetchReviews();
      case "clear-filters":  return clearFilters();
      case "remove-video":   return clearVideo();
      case "view-chat":      if (location.hash === "#chat") return setView(true); location.hash = "chat"; return;
      case "view-reviews":   if (location.hash) history.pushState(null, "", location.pathname + location.search); return setView(false);
      case "send-chat":      return sendChat();
      case "toggle-form":    if (isMobile.matches) setFormOpen($("reviewForm").classList.contains("collapsed")); return;
    }
  }
  const who = e.target.closest("[data-user]"); if (who) return showProfile(who.dataset.user);
  const del = e.target.closest("[data-del]");  if (del) return deleteReview(del);
  const ch  = e.target.closest("[data-ch]");   if (ch)  return openChannel(ch.dataset.ch);
  const md  = e.target.closest("[data-mdel]"); if (md)  return deleteMessage(md);
  const fs  = e.target.closest(".tb-fs");      if (fs)  return tbVidFull(fs.closest(".tb-vid"));
});

document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  const open = [...document.querySelectorAll(".tb-modal.show")].pop();
  if (open) return open.id === "tbLoginModal" ? dismissLogin() : closeModal(open.id);
  closeSidebar();
});

// Filters: search waits for a short pause in typing, the dropdowns apply instantly
let qTimer;
$("q").addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(draw, 150); });
["fCity","fGym","fType","fStyle","sort"].forEach(id => $(id).addEventListener("change", draw));

// Coming back to the tab after a while: quietly check for new reviews
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - lastFetch > 60000) fetchReviews();
});

/* ---------- Start ---------- */
refreshMeUI();
fetchReviews();
if (location.hash === "#chat") setView(true);
