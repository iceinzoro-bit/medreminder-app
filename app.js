import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  query,
  where,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ================= ตั้งค่า EMAILJS ตรงนี้ =================
const EMAILJS_PUBLIC_KEY = "449Eh6FIBn-8-hxvd";
const EMAILJS_SERVICE_ID = "somice5255";
const EMAILJS_TEMPLATE_ID = "somice5255";

if (window.emailjs) {
  emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
}

let currentUser = null;
let currentMeds = [];
let currentAppts = [];
let unsubscribers = [];
let reminderInterval = null;

// ---------------- UI HELPERS ----------------
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 3500);
}

function escapeHTML(str = "") {
  return str.replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}

window.toggleAuthMode = (mode) => {
  const loginForm = document.getElementById("login-form");
  const regForm = document.getElementById("register-form");
  const tabLogin = document.getElementById("tab-login");
  const tabReg = document.getElementById("tab-register");

  if (mode === "login") {
    loginForm.classList.remove("hidden");
    regForm.classList.add("hidden");
    tabLogin.className = "flex-1 py-2 text-sm font-semibold rounded-lg bg-white text-medblue shadow-sm transition";
    tabReg.className = "flex-1 py-2 text-sm font-semibold rounded-lg text-slate-500 transition";
  } else {
    loginForm.classList.add("hidden");
    regForm.classList.remove("hidden");
    tabReg.className = "flex-1 py-2 text-sm font-semibold rounded-lg bg-white text-medgreen shadow-sm transition";
    tabLogin.className = "flex-1 py-2 text-sm font-semibold rounded-lg text-slate-500 transition";
  }
};

window.switchTab = (tabName) => {
  document.querySelectorAll(".view-section").forEach((s) => s.classList.add("hidden"));
  document.getElementById(`view-${tabName}`).classList.remove("hidden");

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    const active = btn.dataset.nav === tabName;
    btn.className = active
      ? "nav-btn w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold bg-blue-50 text-medblue transition"
      : "nav-btn w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition";
  });

  document.querySelectorAll(".mobile-nav-btn").forEach((btn) => {
    const active = btn.dataset.nav === tabName;
    btn.className = active
      ? "mobile-nav-btn flex flex-col items-center p-1.5 text-[11px] text-medblue font-semibold"
      : "mobile-nav-btn flex flex-col items-center p-1.5 text-[11px] text-slate-400";
  });
};

window.openModal = (id) => document.getElementById(id).classList.remove("hidden");
window.closeModal = (id) => document.getElementById(id).classList.add("hidden");

// ---------------- EMAIL NOTIFICATION SYSTEM ----------------
// 1. แจ้งเตือนทานยา
async function sendEmailNotification(med, isManual = false) {
  if (!currentUser?.email) return;

  const templateParams = {
    to_email: currentUser.email,
    user_name: currentUser.displayName || "ผู้ใช้งาน",
    email_subject: `⏰ แจ้งเตือนเวลาทานยา: ${med.name}`,
    intro_text: "ถึงเวลาทานยาของคุณแล้วครับ 💊",
    label_1: "ชื่อยา",
    value_1: med.name,
    label_2: "ขนาดรับประทาน",
    value_2: `${med.dosage} (${med.meal})`,
    time: med.time,
    footer_text: "อย่าลืมเข้าไปกดติ๊กทานยาในแอป MedReminder นะครับ"
  };

  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, templateParams);
    showToast(
      isManual
        ? `ส่งอีเมลแจ้งเตือน "${med.name}" ไปที่ ${currentUser.email} แล้ว ✉️`
        : `⏰ ถึงเวลาทานยา "${med.name}"! ส่งอีเมลแจ้งเตือนแล้ว`
    );
  } catch (err) {
    console.error("EmailJS Error:", err);
    showToast("ส่งอีเมลไม่สำเร็จ กรุณาเช็กค่า EmailJS Key/ID");
  }
}

// 2. แจ้งเตือนนัดหมายแพทย์
async function sendAppointmentEmail(appt, isManual = false) {
  if (!currentUser?.email) return;

  const templateParams = {
    to_email: currentUser.email,
    user_name: currentUser.displayName || "ผู้ใช้งาน",
    email_subject: `🏥 แจ้งเตือนนัดหมายแพทย์: ${appt.title}`,
    intro_text: "ถึงเวลานัดหมายแพทย์ของคุณแล้วครับ 🩺",
    label_1: "หัวข้อนัดหมาย",
    value_1: appt.title,
    label_2: "สถานที่ / หมายเหตุ",
    value_2: `${appt.hospital}${appt.note ? ` (${appt.note})` : ""}`,
    time: `${appt.date} เวลา ${appt.time}`,
    footer_text: "เตรียมตัวและเอกสารให้พร้อมก่อนออกเดินทางนะครับ"
  };

  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, templateParams);
    showToast(
      isManual
        ? `ส่งอีเมลเตือนนัดหมาย "${appt.title}" ไปที่ ${currentUser.email} แล้ว ✉️`
        : `🏥 ถึงเวลานัดหมาย "${appt.title}"! ส่งอีเมลแจ้งเตือนแล้ว`
    );
  } catch (err) {
    console.error("EmailJS Error:", err);
    showToast("ส่งอีเมลไม่สำเร็จ กรุณาเช็กค่า EmailJS Key/ID");
  }
}

window.testSendEmail = (medId) => {
  const med = currentMeds.find((m) => m.id === medId);
  if (med) {
    showToast("กำลังส่งอีเมลแจ้งเตือน...");
    sendEmailNotification(med, true);
  }
};

window.testSendApptEmail = (apptId) => {
  const appt = currentAppts.find((a) => a.id === apptId);
  if (appt) {
    showToast("กำลังส่งอีเมลเตือนนัดหมายแพทย์...");
    sendAppointmentEmail(appt, true);
  }
};

function startReminderWatcher() {
  if (reminderInterval) clearInterval(reminderInterval);

  // เช็กเวลาทุกๆ 30 วินาที ทั้งรายการยาและนัดหมายแพทย์
  reminderInterval = setInterval(() => {
    if (!currentUser) return;

    const now = new Date();
    const yyyy = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const todayKey = `${yyyy}-${mo}-${dd}`;

    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const currentTime = `${hh}:${mm}`;

    // เช็กเวลาทานยา
    currentMeds.forEach((med) => {
      if (med.taken) return;
      if (med.time === currentTime) {
        const sentKey = `notified_med_${med.id}_${todayKey}_${currentTime}`;
        if (!localStorage.getItem(sentKey)) {
          localStorage.setItem(sentKey, "true");
          sendEmailNotification(med, false);
        }
      }
    });

    // เช็กวันและเวลานัดหมายแพทย์
    currentAppts.forEach((appt) => {
      if (appt.date === todayKey && appt.time === currentTime) {
        const sentKey = `notified_appt_${appt.id}_${todayKey}_${currentTime}`;
        if (!localStorage.getItem(sentKey)) {
          localStorage.setItem(sentKey, "true");
          sendAppointmentEmail(appt, false);
        }
      }
    });
  }, 30000);
}

// ---------------- AUTHENTICATION ----------------
document.getElementById("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("reg-name").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const password = document.getElementById("reg-password").value;

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
    showToast("สมัครสมาชิกสำเร็จ!");
  } catch (err) {
    showToast("เกิดข้อผิดพลาด: " + err.message);
  }
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
    showToast("เข้าสู่ระบบสำเร็จ!");
  } catch (err) {
    showToast("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
  }
});

window.handleLogout = async () => {
  await signOut(auth);
  showToast("ออกจากระบบแล้ว");
};

onAuthStateChanged(auth, (user) => {
  unsubscribers.forEach((unsub) => unsub());
  unsubscribers = [];
  if (reminderInterval) clearInterval(reminderInterval);

  if (user) {
    currentUser = user;
    document.getElementById("auth-section").classList.add("hidden");
    document.getElementById("app-section").classList.remove("hidden");
    const displayName = user.displayName || user.email;
    document.getElementById("sidebar-user-name").textContent = displayName;
    document.getElementById("home-user-name").textContent = displayName;
    switchTab("home");
    subscribeAllData(user.uid);
    startReminderWatcher();
  } else {
    currentUser = null;
    currentMeds = [];
    currentAppts = [];
    document.getElementById("auth-section").classList.remove("hidden");
    document.getElementById("app-section").classList.add("hidden");
  }
});

// ---------------- FIRESTORE REAL-TIME LISTENERS ----------------
function subscribeAllData(uid) {
  const qMeds = query(collection(db, "medications"), where("uid", "==", uid));
  unsubscribers.push(onSnapshot(qMeds, (snap) => {
    currentMeds = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    document.getElementById("stat-meds").textContent = currentMeds.length;
    renderMeds(currentMeds);
  }));

  const qAppts = query(collection(db, "appointments"), where("uid", "==", uid));
  unsubscribers.push(onSnapshot(qAppts, (snap) => {
    currentAppts = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    document.getElementById("stat-appts").textContent = currentAppts.length;
    renderAppts(currentAppts);
  }));

  const qAllergies = query(collection(db, "allergies"), where("uid", "==", uid));
  unsubscribers.push(onSnapshot(qAllergies, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    document.getElementById("stat-allergies").textContent = items.length;
    renderAllergies(items);
  }));

  const qActs = query(collection(db, "activities"), where("uid", "==", uid));
  unsubscribers.push(onSnapshot(qActs, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    document.getElementById("stat-activities").textContent = items.length;
    renderActivities(items);
  }));
}

// ---------------- RENDER FUNCTIONS ----------------
function renderMeds(items) {
  const list = document.getElementById("meds-list");
  const homeList = document.getElementById("home-meds-list");
  if (!items.length) {
    const empty = `<p class="text-sm text-slate-400 text-center py-4">ยังไม่มีรายการยา กดปุ่มเพิ่มรายการยาได้เลย</p>`;
    list.innerHTML = empty;
    homeList.innerHTML = empty;
    return;
  }

  const cardHTML = (item) => `
    <div class="bg-white p-4 rounded-2xl border ${item.taken ? "border-green-200 bg-green-50/40" : "border-blue-100"} shadow-sm flex items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <button onclick="toggleMedStatus('${item.id}', ${!item.taken})" class="w-9 h-9 rounded-full flex items-center justify-center transition ${item.taken ? "bg-medgreen text-white" : "bg-blue-50 text-medblue hover:bg-blue-100"}">
          <i class="fa-solid ${item.taken ? "fa-check" : "fa-pills"}"></i>
        </button>
        <div>
          <h4 class="font-semibold text-sm ${item.taken ? "line-through text-slate-400" : "text-slate-800"}">${escapeHTML(item.name)}</h4>
          <p class="text-xs text-slate-500">${escapeHTML(item.dosage)} • ${escapeHTML(item.meal)} • <span class="font-semibold text-medblue">${escapeHTML(item.time)} น.</span></p>
        </div>
      </div>
      <div class="flex items-center gap-1">
        <button onclick="testSendEmail('${item.id}')" title="ส่งอีเมลแจ้งเตือนทันที" class="text-slate-400 hover:text-medblue p-2 transition">
          <i class="fa-solid fa-envelope"></i>
        </button>
        <button onclick="deleteItem('medications', '${item.id}')" title="ลบรายการ" class="text-slate-300 hover:text-red-500 p-2 transition">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>`;

  list.innerHTML = items.map(cardHTML).join("");
  homeList.innerHTML = items.slice(0, 4).map(cardHTML).join("");
}

function renderAppts(items) {
  const list = document.getElementById("appts-list");
  const homeList = document.getElementById("home-appts-list");
  if (!items.length) {
    const empty = `<p class="text-sm text-slate-400 text-center py-4">ยังไม่มีนัดหมายแพทย์</p>`;
    list.innerHTML = empty;
    homeList.innerHTML = empty;
    return;
  }

  const cardHTML = (item) => `
    <div class="bg-white p-4 rounded-2xl border border-blue-100 shadow-sm flex items-start justify-between gap-3">
      <div class="flex gap-3">
        <div class="w-12 h-12 rounded-xl bg-green-50 text-medgreen flex flex-col items-center justify-center shrink-0">
          <i class="fa-solid fa-calendar-day text-lg"></i>
        </div>
        <div>
          <h4 class="font-semibold text-sm text-slate-800">${escapeHTML(item.title)}</h4>
          <p class="text-xs text-slate-500 mt-0.5"><i class="fa-solid fa-hospital mr-1 text-medblue"></i>${escapeHTML(item.hospital)}</p>
          <p class="text-xs text-medgreen font-medium mt-1">${escapeHTML(item.date)} เวลา ${escapeHTML(item.time)} น.</p>
          ${item.note ? `<p class="text-xs text-slate-400 mt-1">หมายเหตุ: ${escapeHTML(item.note)}</p>` : ""}
        </div>
      </div>
      <div class="flex items-center gap-1">
        <button onclick="testSendApptEmail('${item.id}')" title="ส่งอีเมลเตือนนัดหมายทันที" class="text-slate-400 hover:text-medgreen p-2 transition">
          <i class="fa-solid fa-envelope"></i>
        </button>
        <button onclick="deleteItem('appointments', '${item.id}')" title="ลบรายการ" class="text-slate-300 hover:text-red-500 p-2 transition">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>`;

  list.innerHTML = items.map(cardHTML).join("");
  homeList.innerHTML = items.slice(0, 3).map(cardHTML).join("");
}

function renderAllergies(items) {
  const list = document.getElementById("allergies-list");
  if (!items.length) {
    list.innerHTML = `<p class="text-sm text-slate-400 text-center py-4 col-span-full">ยังไม่มีประวัติการแพ้ยา</p>`;
    return;
  }
  list.innerHTML = items.map((item) => `
    <div class="bg-white p-4 rounded-2xl border-l-4 border-red-500 shadow-sm flex items-start justify-between">
      <div>
        <span class="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600 mb-1">${escapeHTML(item.severity)}</span>
        <h4 class="font-bold text-slate-800">${escapeHTML(item.name)}</h4>
        <p class="text-xs text-slate-500 mt-1">อาการ: ${escapeHTML(item.symptom)}</p>
      </div>
      <button onclick="deleteItem('allergies', '${item.id}')" class="text-slate-300 hover:text-red-500 p-2"><i class="fa-solid fa-trash"></i></button>
    </div>`).join("");
}

function renderActivities(items) {
  const list = document.getElementById("activities-list");
  if (!items.length) {
    list.innerHTML = `<p class="text-sm text-slate-400 text-center py-4">ยังไม่มีบันทึกกิจกรรมสุขภาพ</p>`;
    return;
  }
  list.innerHTML = items.map((item) => `
    <div class="bg-white p-4 rounded-2xl border border-blue-100 shadow-sm flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-amber-50 text-amber-500 flex items-center justify-center"><i class="fa-solid fa-heart-circle-check"></i></div>
        <div>
          <h4 class="font-semibold text-sm text-slate-800">${escapeHTML(item.title)}</h4>
          <p class="text-xs text-slate-500">${escapeHTML(item.detail)} • <span class="text-slate-400">${escapeHTML(item.date)}</span></p>
        </div>
      </div>
      <button onclick="deleteItem('activities', '${item.id}')" class="text-slate-300 hover:text-red-500 p-2"><i class="fa-solid fa-trash"></i></button>
    </div>`).join("");
}

// ---------------- CRUD ACTIONS ----------------
document.getElementById("form-med").addEventListener("submit", async (e) => {
  e.preventDefault();
  await addDoc(collection(db, "medications"), {
    uid: currentUser.uid,
    name: document.getElementById("med-name").value.trim(),
    dosage: document.getElementById("med-dosage").value.trim(),
    time: document.getElementById("med-time").value,
    meal: document.getElementById("med-meal").value,
    taken: false,
    createdAt: serverTimestamp()
  });
  e.target.reset();
  closeModal("modal-med");
  showToast("เพิ่มรายการยาเรียบร้อย");
});

document.getElementById("form-appt").addEventListener("submit", async (e) => {
  e.preventDefault();
  await addDoc(collection(db, "appointments"), {
    uid: currentUser.uid,
    title: document.getElementById("appt-title").value.trim(),
    hospital: document.getElementById("appt-hospital").value.trim(),
    date: document.getElementById("appt-date").value,
    time: document.getElementById("appt-time").value,
    note: document.getElementById("appt-note").value.trim(),
    createdAt: serverTimestamp()
  });
  e.target.reset();
  closeModal("modal-appt");
  showToast("บันทึกนัดหมายแพทย์เรียบร้อย");
});

document.getElementById("form-allergy").addEventListener("submit", async (e) => {
  e.preventDefault();
  await addDoc(collection(db, "allergies"), {
    uid: currentUser.uid,
    name: document.getElementById("allergy-name").value.trim(),
    symptom: document.getElementById("allergy-symptom").value.trim(),
    severity: document.getElementById("allergy-severity").value,
    createdAt: serverTimestamp()
  });
  e.target.reset();
  closeModal("modal-allergy");
  showToast("บันทึกประวัติการแพ้ยาเรียบร้อย");
});

document.getElementById("form-activity").addEventListener("submit", async (e) => {
  e.preventDefault();
  await addDoc(collection(db, "activities"), {
    uid: currentUser.uid,
    title: document.getElementById("act-title").value.trim(),
    detail: document.getElementById("act-detail").value.trim(),
    date: document.getElementById("act-date").value,
    createdAt: serverTimestamp()
  });
  e.target.reset();
  closeModal("modal-activity");
  showToast("บันทึกกิจกรรมสุขภาพเรียบร้อย");
});

window.toggleMedStatus = async (id, taken) => {
  await updateDoc(doc(db, "medications", id), { taken });
  showToast(taken ? "เช็กทานยาเรียบร้อย ✅" : "ยกเลิกสถานะทานยา");
};

window.deleteItem = async (colName, id) => {
  if (!confirm("ต้องการลบข้อมูลนี้ใช่หรือไม่?")) return;
  await deleteDoc(doc(db, colName, id));
  showToast("ลบข้อมูลเรียบร้อย");
};