(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  const state = {
    exams: load() || [],
    search: "",
    sortBy: "dateAsc",
    statusFilter: "upcoming",
    timers: new Map(),
  };

  // DOM refs
  const addBtn = $("#addBtn");
  const exportIcsBtn = $("#exportIcsBtn");
  const backupBtn = $("#backupBtn");
  const importFile = $("#importFile");
  const q = $("#q");
  const sortBy = $("#sortBy");
  const statusFilter = $("#statusFilter");
  const cards = $("#cards");
  const empty = $("#empty");

  const formSection = $("#formSection");
  const formTitle = $("#formTitle");
  const examForm = $("#examForm");
  const examId = $("#examId");
  const title = $("#title");
  const subject = $("#subject");
  const date = $("#date");
  const time = $("#time");
  const locationInput = $("#location");
  const tags = $("#tags");
  const notes = $("#notes");
  const notifyChk = $("#notifyChk");
  const notifyLead = $("#notifyLead");
  const cancelBtn = $("#cancelBtn");

  $("#howToInstall").addEventListener("click", (e)=>{
    e.preventDefault();
    $("#installDialog").showModal();
  });
  $("#closeInstall").addEventListener("click", ()=> $("#installDialog").close());

  addBtn.addEventListener("click", () => openForm());
  cancelBtn.addEventListener("click", () => closeForm());
  q.addEventListener("input", () => { state.search = q.value.trim().toLowerCase(); render(); });
  sortBy.addEventListener("change", () => { state.sortBy = sortBy.value; render(); });
  statusFilter.addEventListener("change", () => { state.statusFilter = statusFilter.value; render(); });

  exportIcsBtn.addEventListener("click", () => {
    const ics = buildIcs(state.exams);
    download("ExamTrack.ics", ics);
  });

  backupBtn.addEventListener("click", () => {
    download("ExamTrack-backup.json", JSON.stringify(state.exams, null, 2));
  });

  importFile.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error("Invalid backup");
      state.exams = data;
      persist();
      render();
      alert("Imported successfully.");
    } catch (err) {
      alert("Import failed: " + err.message);
    } finally {
      importFile.value = "";
    }
  });

  examForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const payload = {
      id: examId.value || crypto.randomUUID(),
      title: title.value.trim(),
      subject: subject.value.trim(),
      datetime: parseLocal(date.value, time.value),
      location: locationInput.value.trim(),
      tags: tags.value.split(",").map(s=>s.trim()).filter(Boolean),
      notes: notes.value.trim(),
      notify: notifyChk.checked,
      notifyLead: parseInt(notifyLead.value, 10),
      createdAt: Date.now(),
    };
    if (!payload.title || !date.value || !time.value) return;

    const idx = state.exams.findIndex(x => x.id === payload.id);
    if (idx >= 0) state.exams[idx] = payload;
    else state.exams.push(payload);

    persist();
    closeForm();
    render();
    scheduleNotification(payload);
  });

  function openForm(item = null) {
    formTitle.textContent = item ? "Edit exam" : "Add exam";
    examId.value = item?.id || "";
    title.value = item?.title || "";
    subject.value = item?.subject || "";
    if (item) {
      const dt = new Date(item.datetime);
      date.value = dt.toISOString().slice(0,10);
      time.value = dt.toTimeString().slice(0,5);
    } else {
      date.value = new Date().toISOString().slice(0,10);
      time.value = "09:00";
    }
    locationInput.value = item?.location || "";
    tags.value = item?.tags?.join(", ") || "";
    notes.value = item?.notes || "";
    notifyChk.checked = item?.notify ?? true;
    notifyLead.value = String(item?.notifyLead ?? 60);
    formSection.classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function closeForm() {
    formSection.classList.add("hidden");
    examForm.reset();
  }

  function render() {
    const now = Date.now();
    const filtered = state.exams.filter(e => {
      const matchQ = !state.search ||
        e.title.toLowerCase().includes(state.search) ||
        (e.subject||"").toLowerCase().includes(state.search) ||
        (e.tags||[]).some(t => t.toLowerCase().includes(state.search));
      const isPast = e.datetime < now;
      const matchStatus = state.statusFilter === "all" ||
        (state.statusFilter === "upcoming" && !isPast) ||
        (state.statusFilter === "past" && isPast);
      return matchQ && matchStatus;
    });

    filtered.sort((a,b)=>{
      switch(state.sortBy){
        case "dateAsc": return a.datetime - b.datetime;
        case "dateDesc": return b.datetime - a.datetime;
        case "subject": return (a.subject||"").localeCompare(b.subject||"");
        case "title": return (a.title||"").localeCompare(b.title||"");
      }
      return 0;
    });

    cards.innerHTML = "";
    empty.style.display = filtered.length ? "none" : "block";

    for (const e of filtered) {
      const el = document.createElement("div");
      el.className = "card";
      const dt = new Date(e.datetime);
      const [cdText, cdClass] = countdownText(dt);
      el.innerHTML = `
        <h3>${escapeHtml(e.title)}</h3>
        <div class="meta">
          <span class="badge">${escapeHtml(e.subject || "General")}</span>
          <span>${dt.toLocaleString()}</span>
          ${e.location ? `<span>• ${escapeHtml(e.location)}</span>` : ""}
        </div>
        <div class="countdown ${cdClass}">${cdText}</div>
        ${e.tags?.length ? `<div class="meta">Tags: ${e.tags.map(t=>`<span class="badge">${escapeHtml(t)}</span>`).join(" ")}</div>` : ""}
        ${e.notes ? `<div class="meta">Notes: ${escapeHtml(e.notes)}</div>` : ""}
        <div class="btns">
          <button data-id="${e.id}" class="edit">Edit</button>
          <button data-id="${e.id}" class="ics">.ics</button>
          <button data-id="${e.id}" class="danger del">Delete</button>
        </div>
      `;
      cards.appendChild(el);
    }

    // attach listeners
    $$(".edit").forEach(b=> b.onclick = () => {
      const item = state.exams.find(x => x.id === b.dataset.id);
      if (item) openForm(item);
    });
    $$(".del").forEach(b=> b.onclick = () => {
      const i = state.exams.findIndex(x => x.id === b.dataset.id);
      if (i>=0 && confirm("Delete this exam?")) {
        const [removed] = state.exams.splice(i,1);
        clearTimer(removed.id);
        persist(); render();
      }
    });
    $$(".ics").forEach(b=> b.onclick = () => {
      const item = state.exams.find(x => x.id === b.dataset.id);
      const ics = buildIcs([item]);
      download(`${sanitize(item.title)}.ics`, ics);
    });
  }

  function countdownText(dt) {
    const ms = dt.getTime() - Date.now();
    const past = ms < 0;
    const abs = Math.abs(ms);
    const d = Math.floor(abs / 86400000);
    const h = Math.floor((abs % 86400000) / 3600000);
    const m = Math.floor((abs % 3600000) / 60000);
    const text = past
      ? `Started ${d}d ${h}h ${m}m ago`
      : `In ${d}d ${h}h ${m}m`;
    const cls = past ? "" : (abs < 3600000 ? "soon" : "");
    return [text, cls];
  }

  function scheduleNotification(item) {
    // Foreground scheduling only (browser must be open)
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission();
    }
    clearTimer(item.id);
    if (!item.notify) return;
    const fireAt = item.datetime - item.notifyLead * 60000;
    const delta = fireAt - Date.now();
    if (delta <= 0) return; // too soon/past
    const t = setTimeout(() => {
      new Notification("Exam reminder", {
        body: `${item.title} (${item.subject || "General"}) at ${new Date(item.datetime).toLocaleString()}`
      });
      state.timers.delete(item.id);
    }, Math.min(delta, 2147483647)); // clamp to max setTimeout
    state.timers.set(item.id, t);
  }
  function clearTimer(id) {
    const t = state.timers.get(id);
    if (t) { clearTimeout(t); state.timers.delete(id); }
  }

  function buildIcs(items) {
    const esc = s => s.replace(/[\;,]/g, "\$&").replace(/\n/g, "\n");
    const dtStamp = new Date().toISOString().replace(/[-:]/g,"").split(".")[0] + "Z";
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//ExamTrack//student//EN"
    ];
    items.forEach(it => {
      const start = new Date(it.datetime);
      const end = new Date(it.datetime + 60*60*1000); // default 1h
      const fmt = (d)=> {
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth()+1).padStart(2,"0");
        const da = String(d.getUTCDate()).padStart(2,"0");
        const h = String(d.getUTCHours()).padStart(2,"0");
        const mi = String(d.getUTCMinutes()).padStart(2,"0");
        const s = String(d.getUTCSeconds()).padStart(2,"0");
        return `${y}${m}${da}T${h}${mi}${s}Z`;
      };
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${it.id}@examtrack.local`);
      lines.push(`DTSTAMP:${dtStamp}`);
      lines.push(`DTSTART:${fmt(start)}`);
      lines.push(`DTEND:${fmt(end)}`);
      lines.push(`SUMMARY:${esc(it.title)}`);
      if (it.location) lines.push(`LOCATION:${esc(it.location)}`);
      const desc = `Subject: ${it.subject||"General"}\nTags: ${(it.tags||[]).join(", ")}\nNotes: ${it.notes||""}`;
      lines.push(`DESCRIPTION:${esc(desc)}`);
      lines.push("END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }

  function parseLocal(d, t) {
    // create Date from local date and time
    const [y,m,da] = d.split("-").map(Number);
    const [hh,mm] = t.split(":").map(Number);
    return new Date(y, m-1, da, hh, mm, 0, 0).getTime();
  }

  function persist(){ localStorage.setItem("examtrack:v1", JSON.stringify(state.exams)); }
  function load(){
    try{ return JSON.parse(localStorage.getItem("examtrack:v1")); }
    catch{ return []; }
  }
  function download(name, content) {
    const blob = new Blob([content], {type:"text/plain"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }
  function sanitize(s){ return s.replace(/[^a-z0-9-_]+/gi,"_"); }
  function escapeHtml(s){ return s.replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;", '"':"&quot;" }[c])); }

  // Initial render
  render();

  // Reschedule notifications on load
  state.exams.forEach(scheduleNotification);

  // PWA
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js");
  }
})();