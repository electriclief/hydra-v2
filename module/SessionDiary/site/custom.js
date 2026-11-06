(function(){
  "use strict";
  var page = document.body.dataset.page;

  function copyText(text, button){
    var done = function(){ if(!button) return; var old = button.textContent; button.textContent = "copied"; button.classList.add("done");
      setTimeout(function(){ button.textContent = old; button.classList.remove("done"); }, 1200); };
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(done).catch(function(){ legacyCopy(text); done(); });
    } else { legacyCopy(text); done(); }
  }
  function legacyCopy(text){
    var area = document.createElement("textarea");
    area.value = text; area.style.position = "fixed"; area.style.opacity = "0";
    document.body.appendChild(area); area.select();
    try { document.execCommand("copy"); } catch(e){}
    document.body.removeChild(area);
  }

  document.addEventListener("click", function(event){
    var copyBtn = event.target.closest("[data-copy]");
    if(copyBtn){ copyText(copyBtn.getAttribute("data-copy"), copyBtn); }
    if(page === "index"){
      var row = event.target.closest("tr[data-href]");
      if(row && !event.target.closest("a")){ location.href = row.getAttribute("data-href"); }
    }
  });

  if(page === "index") indexPage();
  if(page === "session") sessionPage();

  function fmtDate(epoch){
    if(!epoch) return "—";
    var d = new Date(epoch * 1000), pad = function(n){ return String(n).padStart(2,"0"); };
    return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function esc(s){ return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function money(v){ if(v == null) return "—"; if(v === 0) return "$0"; return v < 0.01 ? "$" + v.toFixed(4) : "$" + v.toFixed(2); }
  function fileFor(ref){ return "session_" + ref + ".html"; }

  function indexPage(){
    var rows = window.SD_INDEX || [];
    var state = { q:"", source:"__all", diary:false, pinned:false, quiet:false, cursor:-1, view:[] };
    var q = document.getElementById("q"), tbody = document.getElementById("rows"), empty = document.getElementById("empty"),
        shown = document.getElementById("shown"), chipBar = document.querySelector(".chips");

    function matches(row){
      if(!state.quiet && (row.source === "cron" || row.source === "oneshot")) return false;
      if(state.source !== "__all" && row.source !== state.source) return false;
      if(state.diary && !row.hasDiary) return false;
      if(state.pinned && !row.pinned) return false;
      if(!state.q) return true;
      var hay = [row.title, row.goal, row.source, row.ref, row.id, (row.tools||[]).join(" ")].join(" ").toLowerCase();
      return state.q.split(/\s+/).filter(Boolean).every(function(part){ return hay.indexOf(part.toLowerCase()) !== -1; });
    }

    function paint(){
      state.view = rows.filter(matches).sort(function(a,b){ return (b.startedAt||0) - (a.startedAt||0); });
      state.cursor = -1;
      var html = state.view.map(function(row){
        var badges = (row.hasDiary ? '<span class="badge diary">diary</span>' : '') + (row.hasSeance ? '<span class="badge ask">asked</span>' : '');
        return '<tr data-href="' + fileFor(row.ref) + '" data-id="' + esc(row.id) + '">' +
          '<td class="c-date">' + fmtDate(row.startedAt) + '</td>' +
          '<td class="c-title"><div class="t">' + esc(row.title) + badges + '</div><div class="g">' + esc(row.goal) + '</div></td>' +
          '<td class="c-source">' + esc(row.source) + '</td>' +
          '<td class="c-num">' + row.messages + '</td>' +
          '<td class="c-num">' + row.toolCalls + '</td>' +
          '<td class="c-num">' + (row.files || 0) + '</td>' +
          '<td class="c-num">' + money(row.costUsd) + '</td>' +
          '<td class="c-ref">' + esc(row.ref) + '</td></tr>';
      }).join("");
      tbody.innerHTML = html;
      empty.hidden = state.view.length > 0;
      if(shown) shown.textContent = state.view.length + " shown";
    }

    function move(delta){
      if(!state.view.length) return;
      state.cursor = Math.max(0, Math.min(state.view.length - 1, state.cursor + delta));
      var trs = tbody.querySelectorAll("tr");
      trs.forEach(function(tr, i){ tr.classList.toggle("is-cursor", i === state.cursor); });
      var el = trs[state.cursor];
      if(el){ el.scrollIntoView({ block:"nearest" }); }
    }

    if(q){ q.addEventListener("input", function(){ state.q = q.value.trim(); paint(); }); }
    document.addEventListener("keydown", function(event){
      if(event.key === "/" && document.activeElement !== q){ event.preventDefault(); q.focus(); return; }
      if(event.key === "Escape"){ q.value = ""; state.q = ""; q.blur(); paint(); return; }
      if(event.key === "j"){ event.preventDefault(); move(1); }
      if(event.key === "k"){ event.preventDefault(); move(-1); }
      if(event.key === "Enter" && state.cursor >= 0 && state.view[state.cursor]){ location.href = fileFor(state.view[state.cursor].ref); }
    });
    if(chipBar){
      chipBar.addEventListener("click", function(event){
        var chip = event.target.closest(".chip");
        if(!chip) return;
        if(chip.dataset.source){
          state.source = chip.dataset.source;
          chipBar.querySelectorAll(".chip[data-source]").forEach(function(other){ other.classList.toggle("is-on", other === chip); });
        }
        if(chip.dataset.flag === "diary"){ state.diary = !state.diary; chip.classList.toggle("is-on", state.diary); }
        if(chip.dataset.flag === "pinned"){ state.pinned = !state.pinned; chip.classList.toggle("is-on", state.pinned); }
        if(chip.dataset.flag === "quiet"){ state.quiet = !state.quiet; chip.classList.toggle("is-on", state.quiet); }
        paint();
      });
    }
    paint();
  }

  function sessionPage(){
    var meta = window.SD_SESSION || {};
    var api = window.SD_API || "http://127.0.0.1:8134";
    var askForm = document.getElementById("ask-form"), askInput = document.getElementById("ask-input"),
        askStatus = document.getElementById("ask-status"), seances = document.getElementById("seances"),
        diaryBtn = document.getElementById("write-diary"), diaryStatus = document.getElementById("diary-status"),
        forkBtn = document.getElementById("fork-session"), restartBtn = document.getElementById("restart-session");

    function status(el, text, cls){ if(!el) return; el.textContent = text; el.className = "hint" + (cls ? " " + cls : ""); }

    function post(url, body){
      return fetch(url, { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(body || {}) })
        .then(function(response){ return response.json().then(function(data){ return { ok: response.ok, data: data }; }); });
    }

    if(diaryBtn){
      diaryBtn.addEventListener("click", function(){
        diaryBtn.disabled = true;
        status(diaryStatus, "deepseek is reading this session… (10-40 s)");
        var started = Date.now();
        post(api + "/api/diary/" + encodeURIComponent(meta.id), {})
          .then(function(result){
            if(!result.ok || !result.data.ok) throw new Error(result.data.error || "request failed");
            status(diaryStatus, "diary written in " + ((Date.now()-started)/1000).toFixed(1) + "s — reloading");
            setTimeout(function(){ location.reload(); }, 600);
          })
          .catch(function(error){ diaryBtn.disabled = false; status(diaryStatus, "failed: " + error.message + " — is the door running? (node public/js/main.js)"); });
      });
    }

    if(askForm){
      askForm.addEventListener("submit", function(event){
        event.preventDefault();
        var question = askInput.value.trim();
        if(!question) return;
        var button = askForm.querySelector("button[type=submit]");
        button.disabled = true; askInput.disabled = true;
        status(askStatus, "asking the dead… the agent is reading this session (10-45 s)");
        post(api + "/api/ask", { session_id: meta.id, question: question })
          .then(function(result){
            if(!result.ok || !result.data.ok) throw new Error(result.data.error || "request failed");
            var answer = result.data.answer || "";
            var div = document.createElement("div");
            div.className = "seance";
            div.innerHTML = '<div class="q">' + esc(question) + '</div><div class="a">' + esc(answer).replace(/\r/g,"").replace(/\n{2,}/g,"<br><br>").replace(/\n/g,"<br>") + '</div>' +
              '<div class="meta">just now · ' + (result.data.ms/1000).toFixed(1) + 's</div>';
            seances.insertBefore(div, seances.firstChild);
            askInput.value = "";
            status(askStatus, "answered and filed");
          })
          .catch(function(error){ status(askStatus, "failed: " + error.message + " — start the door with node public/js/main.js"); })
          .finally(function(){ button.disabled = false; askInput.disabled = false; askInput.focus(); });
      });
    }

    if(forkBtn){
      forkBtn.addEventListener("click", function(){
        if(!confirm("Fork this session? A backup of state.db is taken first; the fork is verified before it is reported.")) return;
        forkBtn.disabled = true;
        status(askStatus, "forking…");
        post(api + "/api/fork/" + encodeURIComponent(meta.id), {})
          .then(function(result){
            if(!result.ok || !result.data.ok) throw new Error(result.data.error || "fork failed");
            status(askStatus, "forked → " + result.data.title + " (" + result.data.newId.slice(0, 20) + "…) — open it from the index");
          })
          .catch(function(error){ status(askStatus, "fork failed: " + error.message); forkBtn.disabled = false; });
      });
    }

    if(restartBtn){
      restartBtn.addEventListener("click", function(){
        status(askStatus, "opening a terminal…");
        post(api + "/api/restart/" + encodeURIComponent(meta.id), {})
          .then(function(result){
            if(!result.ok || !result.data.ok) throw new Error(result.data.error || "restart failed");
            status(askStatus, "terminal opened: " + result.data.command);
          })
          .catch(function(error){ status(askStatus, "restart failed: " + error.message); });
      });
    }
  }
})();
