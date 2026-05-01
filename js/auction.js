// ============================================================
//  HUSSAINI CRICKET CLUB — AUCTION (Firebase Real-Time Sync)
//  All changes sync instantly across every browser / device.
// ============================================================

const firebaseConfig = {
    apiKey: "AIzaSyBh6czvaWvhVvXitEMX_Niwh4_HoZTdrRc",
    authDomain: "hussaini-cricket-club.firebaseapp.com",
    databaseURL: "https://hussaini-cricket-club-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "hussaini-cricket-club",
    storageBucket: "hussaini-cricket-club.firebasestorage.app",
    messagingSenderId: "657917019090",
    appId: "1:657917019090:web:cb41eea1ac753e23acbe0b"
};

// Initialize Firebase
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
window.db = firebase.database();

// ─── FIREBASE REFS ───────────────────────────────────────────
const FB = {
    root        : db.ref("auction"),
    state       : db.ref("auction/state"),
    players     : db.ref("auction/players"),
    allPlayers  : db.ref("auction/allPlayers"),
    log         : db.ref("auction/log"),
    huntersRoster  : db.ref("auction/huntersRoster"),
    strikersRoster : db.ref("auction/strikersRoster"),
    unsoldRoster   : db.ref("auction/unsoldRoster"),
};

// ─── FIREBASE HELPERS ────────────────────────────────────────
function fbSet(ref, value) {
    return ref.set(value).catch(e => console.error("FB write error:", e));
}
function fbUpdate(ref, value) {
    return ref.update(value).catch(e => console.error("FB update error:", e));
}

// ─── SYNC STATUS INDICATOR ───────────────────────────────────
function showSyncBadge(status) {
    // status: 'syncing' | 'synced' | 'offline'
    let badge = $("#fbSyncBadge");
    if (!badge.length) {
        badge = $(`<div id="fbSyncBadge" style="
            position:fixed;bottom:18px;left:50%;transform:translateX(-50%);
            padding:5px 18px;border-radius:20px;font-size:0.75rem;font-weight:700;
            letter-spacing:1px;z-index:9999;transition:all 0.3s;pointer-events:none;
        "></div>`);
        $("body").append(badge);
    }
    const styles = {
        syncing : { bg: "#f5a623", text: "#000", msg: "⏳ SYNCING…" },
        synced  : { bg: "#00c851", text: "#fff", msg: "✅ SYNCED"   },
        offline : { bg: "#e83e3e", text: "#fff", msg: "🔴 OFFLINE"  },
    };
    const s = styles[status] || styles.synced;
    badge.css({ background: s.bg, color: s.text }).text(s.msg).fadeIn(200);
    if (status === "synced") {
        setTimeout(() => badge.fadeOut(600), 2000);
    }
}

// ─── ONLINE / OFFLINE DETECTION ──────────────────────────────
db.ref(".info/connected").on("value", snap => {
    showSyncBadge(snap.val() ? "synced" : "offline");
});


// ─── ADMIN CONFIG (global — must be before document.ready) ───
const ADMIN_PASSWORD = "hcc@admin2026";  // ← apna password yahan change karo
const ADMIN_LS_KEY   = "hcc_admin_token";

function isAdmin() {
    return sessionStorage.getItem(ADMIN_LS_KEY) === "granted";
}
function enterAdminMode() {
    sessionStorage.setItem(ADMIN_LS_KEY, "granted");
    applyAdminUI();
}
function exitAdminMode() {
    sessionStorage.removeItem(ADMIN_LS_KEY);
    applyAdminUI();
}
function applyAdminUI() {
    const admin = isAdmin();

    // Header controls
    $("#adminControls").css("display", admin ? "flex" : "none");
    $("#viewerControls").css("display", admin ? "none" : "flex");

    // Edit/Delete buttons in player list
    $(".player-act-btn").css("visibility", admin ? "visible" : "hidden");

    // Bid & action buttons
    const $actionBtns = $("#huntersPickBtn,#strikersPickBtn,#unsoldBtn,#skipBtn,#pauseBtn,#resumeBtn");
    const $bidInputs  = $(".bid-quick,#customBid");
    $actionBtns.prop("disabled", !admin).css("opacity", admin ? "1" : "0.35");
    $bidInputs.prop("disabled",  !admin).css("opacity", admin ? "1" : "0.4");

    // Re-add buttons in unsold list
    $(".readd-btn").css("display", admin ? "" : "none");

    // Block/unblock player list clicks for viewers
    $("#sunList,#moonList,#starList").off("click.viewer");
    $("#unsoldList").off("click.viewer");
    if (!admin) {
        $("#sunList,#moonList,#starList").on("click.viewer", "li", e => e.stopImmediatePropagation());
        $("#unsoldList").on("click.viewer", ".readd-btn",        e => e.stopImmediatePropagation());
    }

    // VIEW ONLY badge
    $("#readonlyBadge").remove();
    if (!admin) {
        $("body").append(`<div id="readonlyBadge" style="
            position:fixed;top:70px;right:16px;
            background:rgba(255,107,107,0.15);border:1px solid rgba(255,107,107,0.4);
            color:#ff6b6b;padding:5px 14px;border-radius:20px;
            font-size:0.72rem;font-weight:700;letter-spacing:1px;z-index:9000;
            pointer-events:none;">👁 VIEW ONLY</div>`);
    }
}

$(document).ready(function () {

    /* ==============================
       STATE
    ============================== */
    let budgetHunters = 200;
    let budgetStrikers = 200;
    const INITIAL_BUDGET = 200;
    const BASE_PRICE = 5;

    let players = [];
    let allPlayers = [];
    let currentPlayer = null;
    let timer;
    let timeLeft = 20;
    let timerRunning = false;
    const TIMER_MAX = 20;
    const CIRCUMFERENCE = 339.3;

    let huntersCount = 0, strikersCount = 0, unsoldPlayers = 0;
    let huntersSpent = 0, strikersSpent = 0;
    let currentFilter = "all";
    let auctionLog = [];
    let confirmCallback = null;

    let huntersRoster  = [];
    let strikersRoster = [];
    let unsoldRoster   = [];

    let huntersBid = 0, strikersBid = 0, lastBidTeam = null;

    // Suppress Firebase listener for N ms after our own writes
    let _suppressUntil = 0;
    function suppressListener(ms = 2000) { _suppressUntil = Date.now() + ms; }

    /* ==============================
       FIREBASE SAVE  (replaces localStorage saveState)
    ============================== */
    function saveState() {
        showSyncBadge("syncing");

        const state = {
            budgetHunters, budgetStrikers,
            huntersCount, strikersCount, unsoldPlayers,
            huntersSpent, strikersSpent,
        };

        suppressListener(3000);  // block listener while our own write propagates
        Promise.all([
            fbSet(FB.state,          state),
            fbSet(FB.players,        players.length        ? players        : null),
            fbSet(FB.allPlayers,     allPlayers.length     ? allPlayers     : null),
            fbSet(FB.log,            auctionLog.length     ? auctionLog     : null),
            fbSet(FB.huntersRoster,  huntersRoster.length  ? huntersRoster  : null),
            fbSet(FB.strikersRoster, strikersRoster.length ? strikersRoster : null),
            fbSet(FB.unsoldRoster,   unsoldRoster.length   ? unsoldRoster   : null),
        ]).then(() => showSyncBadge("synced"));

        // Keep localStorage as a local backup too
        try {
            localStorage.setItem("cricketAuction_fbBackup", JSON.stringify({
                budgetHunters, budgetStrikers, huntersCount, strikersCount,
                unsoldPlayers, huntersSpent, strikersSpent,
                players, allPlayers, auctionLog,
                huntersRoster, strikersRoster, unsoldRoster
            }));
        } catch(e) {}
    }

    /* ==============================
       FIREBASE LOAD  (called once on startup)
    ============================== */
    function loadFromFirebase() {
        return FB.root.once("value").then(snap => {
            const data = snap.val();
            if (!data || !data.allPlayers) return false;

            const s = data.state || {};
            budgetHunters  = s.budgetHunters  ?? 200;
            budgetStrikers = s.budgetStrikers ?? 200;
            huntersCount   = s.huntersCount   ?? 0;
            strikersCount  = s.strikersCount  ?? 0;
            unsoldPlayers  = s.unsoldPlayers  ?? 0;
            huntersSpent   = s.huntersSpent   ?? 0;
            strikersSpent  = s.strikersSpent  ?? 0;

            // Firebase stores arrays as objects with numeric keys — normalise them
            const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)) : [];

            players        = toArr(data.players);
            allPlayers     = toArr(data.allPlayers);
            auctionLog     = toArr(data.log);
            huntersRoster  = toArr(data.huntersRoster);
            strikersRoster = toArr(data.strikersRoster);
            unsoldRoster   = toArr(data.unsoldRoster);

            return true;
        });
    }

    /* ==============================
       REAL-TIME LISTENER
       Fires whenever another browser changes Firebase data
    ============================== */
    FB.root.on("value", snap => {
        if (Date.now() < _suppressUntil) return; // ignore our own writes

        const data = snap.val();
        if (!data) return;

        const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)) : [];

        const s = data.state || {};
        budgetHunters  = s.budgetHunters  ?? budgetHunters;
        budgetStrikers = s.budgetStrikers ?? budgetStrikers;
        huntersCount   = s.huntersCount   ?? huntersCount;
        strikersCount  = s.strikersCount  ?? strikersCount;
        unsoldPlayers  = s.unsoldPlayers  ?? unsoldPlayers;
        huntersSpent   = s.huntersSpent   ?? huntersSpent;
        strikersSpent  = s.strikersSpent  ?? strikersSpent;

        players        = toArr(data.players);
        allPlayers     = toArr(data.allPlayers);
        auctionLog     = toArr(data.log);
        huntersRoster  = toArr(data.huntersRoster);
        strikersRoster = toArr(data.strikersRoster);
        unsoldRoster   = toArr(data.unsoldRoster);

        // Rebuild the entire UI from fresh data
        rebuildUI();
        showSyncBadge("synced");
    });

    /* ==============================
       REBUILD UI  (used by real-time listener)
    ============================== */
    function rebuildUI() {
        // --- Teams ---
        ["teamHunters", "teamStrikers"].forEach(id => {
            $(`#${id}`).html('<li class="team-empty">None yet</li>');
        });
        if (huntersRoster.length) {
            $("#teamHunters .team-empty").remove();
            huntersRoster.forEach(p => {
                $("#teamHunters").append(buildTeamItem(p));
            });
        }
        if (strikersRoster.length) {
            $("#teamStrikers .team-empty").remove();
            strikersRoster.forEach(p => {
                $("#teamStrikers").append(buildTeamItem(p));
            });
        }

        // --- Unsold ---
        $("#unsoldList").html('<li class="team-empty">None yet</li>');
        if (unsoldRoster.length) {
            $("#unsoldList .team-empty").remove();
            unsoldRoster.forEach(p => $("#unsoldList").append(buildUnsoldItem(p)));
            $("#unsoldCount").text(unsoldPlayers);
        } else {
            $("#unsoldCount").text(0);
        }

        // --- Log ---
        $("#auctionLog").html('<div class="log-empty">No transactions yet...</div>');
        if (auctionLog.length) {
            $("#auctionLog .log-empty").remove();
            [...auctionLog].reverse().forEach(e => {
                $("#auctionLog").prepend(`<div class="log-entry">
                    <span class="log-time">${e.time}</span>
                    <span class="log-text"><b>${e.name}</b> → ${e.team}</span>
                    ${e.price ? `<span class="log-price">${e.price}</span>` : ""}
                </div>`);
            });
        }

        updateTeamDisplay();
        updateStats();
        populateLists();
        applyAdminUI();   // re-apply viewer locks after every rebuild
    }

    function buildTeamItem(p) {
        return `<li class="team-player-item cat-${p.category.toLowerCase()}">
            <div><div class="item-name">${p.name}</div><div class="item-cat">${p.category}</div></div>
            <div class="item-price">${p.price}L</div></li>`;
    }

    /* restoreUI removed — rebuildUI() handles all cases (clears before render) */

    /* ==============================
       STARTUP — Load from Firebase first, then players.json if needed
    ============================== */
    suppressListener(5000); // suppress during initial page load
    loadFromFirebase().then(hasData => {
        if (hasData) {
            rebuildUI();
        } else {
            // Fresh start — load players.json and push to Firebase
            $.getJSON("players.json", function (data) {
                data.sort((a, b) => a.name.localeCompare(b.name));
                allPlayers = data;
                players = [...data];
                populateLists();
                updateStats();
                saveState();   // push to Firebase
            }).fail(() => console.warn("players.json not found."));
        }
    }).catch(e => {
        console.error("Firebase load failed:", e);
        showSyncBadge("offline");
    });

    /* ==============================
       POPULATE LISTS
    ============================== */
    function populateLists() {
        $("#sunList, #moonList, #starList").empty();
        let num = 1;
        players.forEach(player => {
            const listId = player.category === "Sun"  ? "#sunList"
                         : player.category === "Moon" ? "#moonList" : "#starList";
            const shouldShow = currentFilter === "all" || currentFilter === player.category;
            const li = $(`<li data-category="${player.category}" data-img="${player.img || ''}" data-name="${player.name}">
                <span class="player-num">${String(num).padStart(2,'0')}</span>
                <span class="player-list-name">${player.name}</span>
                <span class="player-actions" style="visibility:${isAdmin()?'visible':'hidden'}">
                    <button class="player-act-btn edit-btn" title="Edit" data-name="${player.name}">✏️</button>
                    <button class="player-act-btn del-btn" title="Delete" data-name="${player.name}">🗑️</button>
                </span>
            </li>`);
            if (!shouldShow) li.hide();
            $(listId).append(li);
            num++;
        });
    }

    /* ==============================
       STATS
    ============================== */
    function updateStats() {
        const total = allPlayers.length;
        const left  = players.length;
        const sold  = Math.max(0, total - left - unsoldPlayers);
        $("#totalCount").text(total);
        $("#soldCount").text(sold);
        $("#leftCount").text(left);
    }

    function updateTeamDisplay() {
        $("#budgetHunters").text(budgetHunters);
        $("#huntersBudgetInline").text(budgetHunters + "L");
        $("#huntersCount").text(huntersCount);
        $("#huntersSpent").text(huntersSpent + "L");
        $("#huntersBudgetBar").css("width", (budgetHunters / INITIAL_BUDGET * 100) + "%");
        $(".hunters-header").toggleClass("budget-low", budgetHunters < 10);

        $("#budgetStrikers").text(budgetStrikers);
        $("#strikersBudgetInline").text(budgetStrikers + "L");
        $("#strikersCount").text(strikersCount);
        $("#strikersSpent").text(strikersSpent + "L");
        $("#strikersBudgetBar").css("width", (budgetStrikers / INITIAL_BUDGET * 100) + "%");
        $(".strikers-header").toggleClass("budget-low", budgetStrikers < 10);
    }

    /* ==============================
       SEARCH & FILTER
    ============================== */
    $("#searchPlayer").on("input", function () {
        const q = $(this).val().toLowerCase();
        $("#sunList li, #moonList li, #starList li").each(function () {
            const catMatch = currentFilter === "all" || $(this).data("category") === currentFilter;
            $(this).toggle(catMatch && $(this).data("name").toLowerCase().includes(q));
        });
    });

    $(".filter-btn").on("click", function () {
        $(".filter-btn").removeClass("active");
        $(this).addClass("active");
        currentFilter = $(this).data("filter");
        const q = $("#searchPlayer").val().toLowerCase();
        $("#sunList li, #moonList li, #starList li").each(function () {
            const catMatch = currentFilter === "all" || $(this).data("category") === currentFilter;
            $(this).toggle(catMatch && $(this).data("name").toLowerCase().includes(q));
        });
    });

    /* ==============================
       PLAYER SELECTION
    ============================== */
    $("#sunList, #moonList, #starList").on("click", "li", function (e) {
        if ($(e.target).hasClass("player-act-btn")) return;
        const playerName = $(this).data("name");
        const category   = $(this).data("category");
        const img        = $(this).data("img");
        $(".player-list li").removeClass("active-player");
        $(this).addClass("active-player");
        currentPlayer = { name: playerName, category, img, element: $(this) };
        showPlayerCard(currentPlayer);
        resetTimer();
        resetBidTracker();
    });

    /* ==============================
       EDIT PLAYER
    ============================== */
    $("#sunList, #moonList, #starList").on("click", ".edit-btn", function (e) {
        e.stopPropagation();
        const name   = $(this).data("name");
        const player = players.find(p => p.name === name);
        if (!player) return;
        $("#editPlayerOrigName").val(player.name);
        $("#editPlayerName").val(player.name);
        $("#editPlayerImg").val(player.img || "");
        $("#editPlayerCategory").val(player.category);
        new bootstrap.Modal(document.getElementById("editPlayerModal")).show();
    });

    $("#saveEditPlayerBtn").click(function () {
        const origName = $("#editPlayerOrigName").val();
        const newName  = $("#editPlayerName").val().trim();
        const newImg   = $("#editPlayerImg").val().trim();
        const newCat   = $("#editPlayerCategory").val();
        if (!newName) { alert("Player name cannot be empty!"); return; }
        [players, allPlayers].forEach(arr => {
            const idx = arr.findIndex(p => p.name === origName);
            if (idx !== -1) arr[idx] = { name: newName, category: newCat, img: newImg };
        });
        if (currentPlayer && currentPlayer.name === origName) {
            currentPlayer.name = newName; currentPlayer.category = newCat; currentPlayer.img = newImg;
            showPlayerCard(currentPlayer);
        }
        populateLists(); updateStats(); saveState();
        bootstrap.Modal.getInstance(document.getElementById("editPlayerModal")).hide();
        showSoldFlash("✅ Player updated: " + newName);
    });

    /* ==============================
       DELETE PLAYER
    ============================== */
    $("#sunList, #moonList, #starList").on("click", ".del-btn", function (e) {
        e.stopPropagation();
        const name = $(this).data("name");
        showConfirm(`Delete "${name}" from pool?`, function () {
            players    = players.filter(p => p.name !== name);
            allPlayers = allPlayers.filter(p => p.name !== name);
            if (currentPlayer && currentPlayer.name === name) {
                clearInterval(timer); currentPlayer = null;
                $("#playerCard").hide(); $("#noPlayerMsg").show(); resetBidTracker();
            }
            populateLists(); updateStats(); saveState();
            showSoldFlash("🗑️ Deleted: " + name);
        });
    });

    /* ==============================
       PLAYER CARD
    ============================== */
    function showPlayerCard(player) {
        $("#noPlayerMsg").hide();
        $("#playerCard").show();
        $("#playerName").text(player.name);
        $("#playerCategory").text(player.category + " Category");
        $("#playerImage").attr("src", player.img || "https://via.placeholder.com/100x100/0d1e2e/00c8ff?text=" + encodeURIComponent(player.name[0])).show();
        const colors = { Sun: "#f5a623", Moon: "#7eb8f7", Star: "#c084fc" };
        const icons  = { Sun: "☀", Moon: "🌙", Star: "⭐" };
        const col = colors[player.category] || "#aaa";
        $("#playerCatBadge").text(icons[player.category] + " " + player.category).css({
            background: `rgba(${hexToRgb(col)},0.15)`,
            border: `1px solid rgba(${hexToRgb(col)},0.4)`,
            color: col, padding: "2px 10px", borderRadius: "20px",
            fontSize: "0.62rem", fontWeight: "700", letterSpacing: "1px"
        });
        if (!$("#customBid").val()) $("#customBid").val(BASE_PRICE);
        updateBidTracker();
    }

    function hexToRgb(hex) {
        return `${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)}`;
    }

    /* ==============================
       UNSOLD / SKIPPED ITEM BUILDER
    ============================== */
    function buildUnsoldItem(p) {
        const tag = p.status === "skipped"
            ? `<span class="unsold-tag skipped-tag">⏭ SKIPPED</span>`
            : `<span class="unsold-tag">🚫 UNSOLD</span>`;
        const li = $(`<li class="team-player-item unsold-item" style="border-left-color:#666"
                data-name="${p.name}" data-category="${p.category}" data-img="${p.img||''}">
            <div style="flex:1">
                <div class="item-name">${p.name}</div>
                <div class="item-cat">${p.category} ${tag}</div>
            </div>
            <button class="readd-btn" title="Re-add to pool">↩ Re-add</button>
        </li>`);
        return li;
    }

    /* ==============================
       RE-ADD PLAYER
    ============================== */
    $("#unsoldList").on("click", ".readd-btn", function (e) {
        e.stopPropagation();
        const li       = $(this).closest("li");
        const name     = li.data("name");
        const category = li.data("category");
        const img      = li.data("img") || "";

        const playerObj = { name, category, img };
        players.push(playerObj);
        allPlayers.push(playerObj);
        players.sort((a, b) => a.name.localeCompare(b.name));

        unsoldRoster = unsoldRoster.filter(p => p.name !== name);
        unsoldPlayers = Math.max(0, unsoldPlayers - 1);
        $("#unsoldCount").text(unsoldPlayers);

        li.fadeOut(250, function () {
            $(this).remove();
            if ($("#unsoldList li:visible").length === 0)
                $("#unsoldList").append('<li class="team-empty">None yet</li>');
        });

        addLog("↩", name, "Re-added to pool", "");
        populateLists(); updateStats(); saveState();
        showSoldFlash("↩ " + name + " wapas pool mein add ho gaya!");
    });

    /* ==============================
       BID TRACKER
    ============================== */
    function resetBidTracker() {
        huntersBid = 0; strikersBid = 0; lastBidTeam = null;
        $("#huntersBidAmt, #strikersBidAmt").text("—");
        $("#huntersWinTag, #strikersWinTag").hide();
        $("#huntersBidBlock, #strikersBidBlock").removeClass("bid-leading");
        $("#currentBidValue").text("Base 5L");
        $("#currentBidOwner").text("").hide();
        $("#liveBidTracker").removeClass("tracker-active");
    }

    function updateBidTracker() {
        if (!currentPlayer) return;
        const bidVal = parseInt($("#customBid").val()) || BASE_PRICE;
        $("#currentBidValue").text(bidVal + "L");
        if (lastBidTeam === "Hunters") {
            huntersBid = bidVal;
            $("#huntersBidAmt").text(bidVal + "L");
            $("#huntersWinTag").show(); $("#strikersWinTag").hide();
            $("#huntersBidBlock").addClass("bid-leading"); $("#strikersBidBlock").removeClass("bid-leading");
            $("#currentBidOwner").text("🦅 Hunters Leading").show();
        } else if (lastBidTeam === "Strikers") {
            strikersBid = bidVal;
            $("#strikersBidAmt").text(bidVal + "L");
            $("#strikersWinTag").show(); $("#huntersWinTag").hide();
            $("#strikersBidBlock").addClass("bid-leading"); $("#huntersBidBlock").removeClass("bid-leading");
            $("#currentBidOwner").text("⚡ Strikers Leading").show();
        } else {
            $("#currentBidOwner").text("").hide();
        }
        $("#liveBidTracker").addClass("tracker-active");
    }

    $("#customBid").on("input", updateBidTracker);
    $(".bid-quick").on("click", function () { setTimeout(updateBidTracker, 0); });
    $("#huntersPickBtn").on("mouseenter", function () { if (!currentPlayer) return; lastBidTeam = "Hunters"; updateBidTracker(); });
    $("#strikersPickBtn").on("mouseenter", function () { if (!currentPlayer) return; lastBidTeam = "Strikers"; updateBidTracker(); });

    /* ==============================
       TIMER
    ============================== */
    function resetTimer() {
        clearInterval(timer); timeLeft = TIMER_MAX; updateTimerDisplay(); startTimer();
    }

    function updateTimerDisplay() {
        $("#timer").text(timeLeft);
        const offset = CIRCUMFERENCE * (1 - timeLeft / TIMER_MAX);
        let color = "#00c8ff";
        if (timeLeft <= 5) color = "#e83e3e";
        else if (timeLeft <= 10) color = "#f5a623";
        $("#timerCircle").css({ "stroke-dashoffset": offset, stroke: color, filter: `drop-shadow(0 0 6px ${color}88)` });
    }

    function startTimer() {
        timerRunning = true;
        timer = setInterval(() => {
            timeLeft--; updateTimerDisplay();
            if (timeLeft <= 0) {
                clearInterval(timer); timerRunning = false;
                showSoldFlash("⏰ Time over! Player skipped.");
                if (currentPlayer) {
                    const entry = { name: currentPlayer.name, category: currentPlayer.category, img: currentPlayer.img || "", status: "skipped" };
                    unsoldRoster.push(entry);
                    unsoldPlayers++;
                    $("#unsoldList .team-empty").remove();
                    $("#unsoldList").append(buildUnsoldItem(entry));
                    $("#unsoldCount").text(unsoldPlayers);
                    addLog("⏭", currentPlayer.name, "SKIPPED", "");
                    saveState();
                    removeCurrentPlayer();
                }
            }
        }, 1000);
    }

    $("#pauseBtn").click(function ()  { clearInterval(timer); timerRunning = false; });
    $("#resumeBtn").click(function () { if (!timerRunning && currentPlayer) startTimer(); });
    $("#skipBtn").click(function () {
        if (!currentPlayer) return;
        clearInterval(timer);
        showConfirm(`Skip ${currentPlayer.name} without assigning?`, function () {
            const entry = { name: currentPlayer.name, category: currentPlayer.category, img: currentPlayer.img || "", status: "skipped" };
            unsoldRoster.push(entry);
            unsoldPlayers++;
            $("#unsoldList .team-empty").remove();
            $("#unsoldList").append(buildUnsoldItem(entry));
            $("#unsoldCount").text(unsoldPlayers);
            addLog("⏭", currentPlayer.name, "SKIPPED", "");
            saveState();
            removeCurrentPlayer();
        });
    });

    $(".bid-quick").on("click", function () {
        $(".bid-quick").removeClass("selected");
        $(this).addClass("selected");
        $("#customBid").val($(this).data("val"));
    });
    $("#customBid").on("input", function () { $(".bid-quick").removeClass("selected"); });

    /* ==============================
       FIREWORKS
    ============================== */
    function showFireworks() {
        const colors = ["#ff0044","#00ff99","#ffdd00","#00ccff","#ff00ff","#f5a623"];
        for (let i = 0; i < 40; i++) {
            setTimeout(() => {
                const p = $("<div class='firework'></div>");
                $("#fireworks").append(p);
                const color = colors[Math.floor(Math.random() * colors.length)];
                const sx = Math.random() * window.innerWidth;
                const sy = Math.random() * window.innerHeight * 0.6;
                p.css({ "background-color": color, position: "fixed", left: sx+"px", top: sy+"px", width: "6px", height: "6px" });
                p.animate({ left: sx+(Math.random()*200-100)+"px", top: sy+(Math.random()*200-100)+"px", opacity: 0, width: "2px", height: "2px" }, 700+Math.random()*400, function () { $(this).remove(); });
            }, i * 20);
        }
    }

    /* ==============================
       SOLD OVERLAY  (Instagram Story Card)
    ============================== */
    // Store last sold info for canvas render
    let _lastSold = {};

    function showSoldOverlay(playerName, price, teamName, playerImg, teamId,teamCat) {
        _lastSold = { playerName, price, teamName, playerImg, teamId,teamCat};
        console.log(_lastSold);
        // Team colors
        const isHunters  = teamId === "Hunters";
        const teamColor  = isHunters ? "#f5a623" : "#e83e3e";
        const teamIcon   = isHunters ? "🦅" : "⚡";
        const catIcon    = { Sun:"☀", Moon:"🌙", Star:"⭐" };
        const catColor   = { Sun:"#f5a623", Moon:"#7eb8f7", Star:"#c084fc" };
        const cat        = teamCat ? teamCat : "Star";

        // Populate overlay
        $("#overlayPlayerName").text(playerName);
        $("#overlayPrice").text(price + "L");
        $("#overlayTeam").html(teamIcon + " " + teamName.replace(/^[^ ]+ /,""));
        $("#overlayCatPill").text((catIcon[cat]||"") + " " + cat)
            .css({ background: `rgba(${hexToRgb(catColor[cat]||"#aaa")},0.18)`,
                   border: `1px solid ${catColor[cat]||"#aaa"}`, color: catColor[cat]||"#aaa" });
        $("#overlayTeamBanner").css("--team-col", teamColor);
        $("#soldCard").css("--team-col", teamColor);
        $("#soldImgGlow").css("background", `radial-gradient(circle, ${teamColor}55 0%, transparent 70%)`);

        // Player image
        const imgSrc = playerImg || `https://via.placeholder.com/200x200/0d1e2e/${teamColor.replace("#","")}?text=${encodeURIComponent(playerName[0])}`;
        const $img   = $("#overlayPlayerImg");
        $img.attr("src", imgSrc).css("border-color", teamColor);

        // Show overlay (don't auto-hide — user closes manually)
        $("#soldOverlay").fadeIn(300);
        showFireworks();
    }

    // Close button
    $("#closeSoldOverlay").click(function () {
        $("#soldOverlay").fadeOut(300);
    });

    // Click backdrop to close
    $("#soldOverlay").click(function (e) {
        if ($(e.target).is("#soldOverlay")) $(this).fadeOut(300);
    });

    /* ── CANVAS STORY DOWNLOAD ── */
    $("#downloadSoldCard").click(function () {
        generateStoryCanvas(_lastSold).then(dataUrl => {
            const a    = document.createElement("a");
            a.href     = dataUrl;
            a.download = `${_lastSold.playerName}_sold_story.png`;
            a.click();
        }).catch(err => {
            console.error("Story gen error:", err);
            showSoldFlash("⚠ Image cross-origin blocked — try hosting images locally.");
        });
    });

    function generateStoryCanvas({ playerName, price, teamName, playerImg, teamId,teamCat }) {
        return new Promise((resolve, reject) => {
            const canvas = document.getElementById("storyCanvas");
            const ctx    = canvas.getContext("2d");
            const W = 1080, H = 1920;
            ctx.clearRect(0, 0, W, H);

            const isHunters = teamId === "Hunters";
            const teamCol   = isHunters ? "#f5a623" : "#e83e3e";
            const teamCol2  = isHunters ? "#c47a0a" : "#a01c1c";
            const cat       = teamCat || "Star";
            const catColor  = { Sun:"#f5a623", Moon:"#7eb8f7", Star:"#c084fc" }[cat] || "#c084fc";
            const teamIcon  = isHunters ? "🦅" : "⚡";

            // ── BG gradient ──
            const bg = ctx.createLinearGradient(0, 0, 0, H);
            bg.addColorStop(0,    "#050a0e");
            bg.addColorStop(0.45, "#0a1520");
            bg.addColorStop(1,    "#050a0e");
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, W, H);

            // Grid lines texture
            ctx.strokeStyle = "rgba(255,255,255,0.025)";
            ctx.lineWidth   = 1;
            for (let y = 0; y < H; y += 60) {
                ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
            }

            // Top accent line
            const tline = ctx.createLinearGradient(0,0,W,0);
            tline.addColorStop(0,"transparent");
            tline.addColorStop(0.5, teamCol);
            tline.addColorStop(1,"transparent");
            ctx.fillStyle = tline;
            ctx.fillRect(0, 0, W, 4);

            // Team colour radial glow (bottom)
            const glow = ctx.createRadialGradient(W/2, H, 0, W/2, H, 900);
            glow.addColorStop(0, teamCol + "44");
            glow.addColorStop(1, "transparent");
            ctx.fillStyle = glow;
            ctx.fillRect(0, 0, W, H);

            // ── EVENT TAG (top) ──
            ctx.font         = "bold 38px 'Rajdhani', sans-serif";
            ctx.fillStyle    = "rgba(255,255,255,0.35)";
            ctx.textAlign    = "center";
            ctx.letterSpacing = "6px";
            ctx.fillText("Hussain Trophy 2026  ·  HCC DELHI", W/2, 90);

            // ── SOLD! stamp ──
            ctx.font      = "bold 220px 'Bebas Neue', sans-serif";
            ctx.fillStyle = teamCol;
            ctx.shadowColor  = teamCol;
            ctx.shadowBlur   = 60;
            ctx.textAlign    = "center";
            ctx.fillText("SOLD!", W/2, 380);
            ctx.shadowBlur = 0;

            // Divider line under SOLD
            const div = ctx.createLinearGradient(0,0,W,0);
            div.addColorStop(0,"transparent");
            div.addColorStop(0.5, teamCol);
            div.addColorStop(1,"transparent");
            ctx.strokeStyle = div;
            ctx.lineWidth   = 3;
            ctx.beginPath(); ctx.moveTo(100,420); ctx.lineTo(W-100,420); ctx.stroke();

            // ── PLAYER IMAGE ──
            const imgY  = 460, imgSize = 580, imgX = (W - imgSize) / 2;
            const imgRadius = 32;

            function drawCard() {
                // Card background
                ctx.save();
                roundRect(ctx, imgX - 20, imgY - 20, imgSize + 40, imgSize + 40, imgRadius + 8);
                const cardGrad = ctx.createLinearGradient(imgX, imgY, imgX, imgY + imgSize);
                cardGrad.addColorStop(0, "#0d1e2e");
                cardGrad.addColorStop(1, "#050a0e");
                ctx.fillStyle = cardGrad;
                ctx.fill();

                // Glowing border
                ctx.shadowColor = teamCol;
                ctx.shadowBlur  = 30;
                ctx.strokeStyle = teamCol;
                ctx.lineWidth   = 4;
                roundRect(ctx, imgX - 20, imgY - 20, imgSize + 40, imgSize + 40, imgRadius + 8);
                ctx.stroke();
                ctx.shadowBlur  = 0;
                ctx.restore();

                // Category pill on image
                ctx.save();
                const catLabel = ({ Sun:"☀ SUN", Moon:"🌙 MOON", Star:"⭐ STAR" })[cat] || cat;
                const pillW = 200, pillH = 52;
                roundRect(ctx, W/2 - pillW/2, imgY + imgSize - pillH/2 + 20, pillW, pillH, 26);
                ctx.fillStyle = catColor + "cc";
                ctx.fill();
                ctx.strokeStyle = catColor;
                ctx.lineWidth   = 2;
                roundRect(ctx, W/2 - pillW/2, imgY + imgSize - pillH/2 + 20, pillW, pillH, 26);
                ctx.stroke();
                ctx.font      = "bold 30px 'Rajdhani', sans-serif";
                ctx.fillStyle = "#fff";
                ctx.textAlign = "center";
                ctx.fillText(catLabel, W/2, imgY + imgSize + 20 + 35);
                ctx.restore();
            }

            function roundRect(c, x, y, w, h, r) {
                c.beginPath();
                c.moveTo(x+r, y);
                c.lineTo(x+w-r, y);
                c.quadraticCurveTo(x+w, y, x+w, y+r);
                c.lineTo(x+w, y+h-r);
                c.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
                c.lineTo(x+r, y+h);
                c.quadraticCurveTo(x, y+h, x, y+h-r);
                c.lineTo(x, y+r);
                c.quadraticCurveTo(x, y, x+r, y);
                c.closePath();
            }

            function drawRestOfCard() {
                // ── PLAYER NAME ──
                ctx.font         = "bold 148px 'Bebas Neue', sans-serif";
                ctx.fillStyle    = "#e8f0f8";
                ctx.shadowColor  = "rgba(0,0,0,0.6)";
                ctx.shadowBlur   = 10;
                ctx.textAlign    = "center";
                ctx.fillText(playerName.toUpperCase(), W/2, imgY + imgSize + 160);
                ctx.shadowBlur   = 0;

                // ── PRICE ──
                const priceY = imgY + imgSize + 280;
                ctx.font      = "700 52px 'Rajdhani', sans-serif";
                ctx.fillStyle = "rgba(255,255,255,0.45)";
                ctx.textAlign = "center";
                ctx.fillText("SOLD FOR", W/2, priceY);

                ctx.font         = "bold 180px 'Bebas Neue', sans-serif";
                ctx.fillStyle    = teamCol;
                ctx.shadowColor  = teamCol;
                ctx.shadowBlur   = 50;
                ctx.textAlign    = "center";
                ctx.fillText(price + "L", W/2, priceY + 170);
                ctx.shadowBlur   = 0;

                // ── TEAM BANNER ──
                const bannerY  = priceY + 230;
                const bannerH  = 140;
                const bannerGrad = ctx.createLinearGradient(0, bannerY, W, bannerY);
                bannerGrad.addColorStop(0, teamCol2 + "00");
                bannerGrad.addColorStop(0.15, teamCol2);
                bannerGrad.addColorStop(0.85, teamCol2);
                bannerGrad.addColorStop(1, teamCol2 + "00");
                ctx.fillStyle = bannerGrad;
                ctx.fillRect(0, bannerY, W, bannerH);

                ctx.font      = "700 44px 'Rajdhani', sans-serif";
                ctx.fillStyle = "rgba(255,255,255,0.55)";
                ctx.textAlign = "center";
                ctx.fillText("PICKED BY", W/2, bannerY + 48);

                ctx.font      = "bold 80px 'Bebas Neue', sans-serif";
                ctx.fillStyle = "#fff";
                ctx.shadowColor = "rgba(0,0,0,0.5)";
                ctx.shadowBlur  = 8;
                ctx.fillText(teamIcon + " " + teamName.replace(/^[^\s]+ /, ""), W/2, bannerY + 118);
                ctx.shadowBlur  = 0;

                // Bottom line
                const bline = ctx.createLinearGradient(0,0,W,0);
                bline.addColorStop(0,"transparent");
                bline.addColorStop(0.5, teamCol);
                bline.addColorStop(1,"transparent");
                ctx.fillStyle = bline;
                ctx.fillRect(0, H-4, W, 4);

                // Bottom text
                ctx.font      = "600 36px 'Rajdhani', sans-serif";
                ctx.fillStyle = "rgba(255,255,255,0.25)";
                ctx.textAlign = "center";
                ctx.fillText("Hussaini Cricket Club  ·  Delhi", W/2, H - 50);

                resolve(canvas.toDataURL("image/png"));
            }

            // Draw card frame first, then try loading image
            drawCard();

            const tryLoadImg = (src, cb) => {
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload  = () => cb(img);
                img.onerror = () => cb(null);
                img.src = src;
                // Timeout fallback
                setTimeout(() => { if (!img.complete) cb(null); }, 4000);
            };

            tryLoadImg(playerImg || "", function(img) {
                if (img) {
                    // Clip image to rounded rect
                    ctx.save();
                    roundRect(ctx, imgX, imgY, imgSize, imgSize, imgRadius);
                    ctx.clip();
                    ctx.drawImage(img, imgX, imgY, imgSize, imgSize);
                    ctx.restore();
                } else {
                    // Fallback: gradient + initial letter
                    ctx.save();
                    roundRect(ctx, imgX, imgY, imgSize, imgSize, imgRadius);
                    const fb = ctx.createLinearGradient(imgX, imgY, imgX+imgSize, imgY+imgSize);
                    fb.addColorStop(0, "#0d1e2e"); fb.addColorStop(1, "#163352");
                    ctx.fillStyle = fb; ctx.fill();
                    ctx.font      = `bold ${imgSize*0.55}px 'Bebas Neue', sans-serif`;
                    ctx.fillStyle = teamCol + "88";
                    ctx.textAlign = "center";
                    ctx.fillText(playerName[0].toUpperCase(), imgX + imgSize/2, imgY + imgSize*0.75);
                    ctx.restore();
                }
                drawRestOfCard();
            });
        });
    }

    function showSoldFlash(msg) {
        $("#soldFlash").text(msg).stop(true).css({ display: "flex", opacity: 1 })
            .animate({ opacity: 0 }, 2500, function () { $(this).hide(); });
    }

    /* ==============================
       ASSIGN PLAYER
    ============================== */
    function assignPlayer(team) {
        if (!currentPlayer) { showSoldFlash("⚠ Select a player first!"); return; }
        let bid = parseInt($("#customBid").val());
        if (!bid || bid <= 0) bid = BASE_PRICE;

        if (team === "Hunters") {
            if (budgetHunters < bid) { showSoldFlash("❌ Hunters: Budget insufficient!"); return; }
            budgetHunters -= bid; huntersSpent += bid; huntersCount++;
            addTeamPlayer("teamHunters", currentPlayer, bid);
            huntersRoster.push({ name: currentPlayer.name, category: currentPlayer.category, price: bid });
        } else {
            if (budgetStrikers < bid) { showSoldFlash("❌ Strikers: Budget insufficient!"); return; }
            budgetStrikers -= bid; strikersSpent += bid; strikersCount++;
            addTeamPlayer("teamStrikers", currentPlayer, bid);
            strikersRoster.push({ name: currentPlayer.name, category: currentPlayer.category, price: bid });
        }

        const teamLabel = team === "Hunters" ? "🦅 Danish Dominators" : "⚡ Zaki Zenith";
        addLog(team === "Hunters" ? "🦅" : "⚡", currentPlayer.name, teamLabel, bid + "L");
        _lastSold._cat = currentPlayer.category;   // store category for canvas
        showSoldOverlay(currentPlayer.name, bid, teamLabel, currentPlayer.img || "", team,currentPlayer.category);
        updateTeamDisplay(); saveState(); removeCurrentPlayer();
    }

    function addTeamPlayer(listId, player, bid) {
        $(`#${listId} .team-empty`).remove();
        $(`#${listId}`).append(buildTeamItem({ name: player.name, category: player.category, price: bid }));
        const el = document.getElementById(listId);
        el.scrollTop = el.scrollHeight;
    }

    function markUnsold() {
        if (!currentPlayer) return;
        unsoldPlayers++;
        addLog("🚫", currentPlayer.name, "UNSOLD", "");
        $("#unsoldList .team-empty").remove();
        const entry = { name: currentPlayer.name, category: currentPlayer.category, img: currentPlayer.img || "", status: "unsold" };
        unsoldRoster.push(entry);
        $("#unsoldList").append(buildUnsoldItem(entry));
        $("#unsoldCount").text(unsoldPlayers);
        showSoldFlash("🚫 " + currentPlayer.name + " went unsold.");
        saveState(); removeCurrentPlayer();
    }

    function removeCurrentPlayer() {
        if (currentPlayer && currentPlayer.element) {
            currentPlayer.element.fadeOut(300, function () { $(this).remove(); });
        }
        players = players.filter(p => p.name !== (currentPlayer ? currentPlayer.name : ""));
        currentPlayer = null;
        clearInterval(timer); timeLeft = TIMER_MAX; timerRunning = false;
        updateTimerDisplay();
        $("#customBid").val(""); $(".bid-quick").removeClass("selected");
        $("#playerCard").hide(); $("#noPlayerMsg").show();
        resetBidTracker(); updateStats(); saveState();
    }

    $("#huntersPickBtn").click(() => assignPlayer("Hunters"));
    $("#strikersPickBtn").click(() => assignPlayer("Strikers"));
    $("#unsoldBtn").click(markUnsold);

    /* ==============================
       AUCTION LOG
    ============================== */
    function addLog(icon, name, team, price) {
        const now  = new Date();
        const time = now.getHours().toString().padStart(2,"0") + ":" + now.getMinutes().toString().padStart(2,"0");
        auctionLog.push({ icon, name, team, price, time });
        $("#auctionLog .log-empty").remove();
        $("#auctionLog").prepend(`<div class="log-entry">
            <span class="log-time">${time}</span>
            <span class="log-text"><b>${name}</b> → ${team}</span>
            ${price ? `<span class="log-price">${price}</span>` : ""}
        </div>`);
    }

    $("#clearLogBtn").click(function () {
        showConfirm("Clear auction log?", function () {
            $("#auctionLog").html('<div class="log-empty">No transactions yet...</div>');
            auctionLog = []; saveState();
        });
    });

    /* ==============================
       ADD PLAYER
    ============================== */
    $("#addPlayerBtn").click(function () {
        const name = $("#newPlayerName").val().trim();
        const img  = $("#newPlayerImg").val().trim();
        const cat  = $("#newPlayerCategory").val();
        if (!name) { alert("Enter player name!"); return; }
        const player = { name, category: cat, img: img || "" };
        players.push(player); allPlayers.push(player);
        players.sort((a,b) => a.name.localeCompare(b.name));
        populateLists(); updateStats(); saveState();
        $("#newPlayerName, #newPlayerImg").val("");
        bootstrap.Modal.getInstance(document.getElementById("addPlayerModal")).hide();
    });

    /* ==============================
       RESET
    ============================== */
    $("#resetAuctionBtn").click(function () {
        showConfirm("Reset entire auction? All Firebase data will be cleared.", function () {
            showSyncBadge("syncing");
            FB.root.remove().then(() => {
                localStorage.removeItem("cricketAuction_fbBackup");
                showSyncBadge("synced");
                location.reload();
            });
        });
    });

    /* ==============================
       EXPORT TO EXCEL
    ============================== */
    function doExcelExport() {
        const XLSX = window.XLSX;
        const huntersData = [["#","Player Name","Category","Price (L)"],
            ...huntersRoster.map((p,i) => [i+1, p.name, p.category, p.price])];
        if (huntersRoster.length) {
            huntersData.push([]);
            huntersData.push(["","","Total Spent", huntersSpent]);
            huntersData.push(["","","Budget Left", budgetHunters]);
        }
        const strikersData = [["#","Player Name","Category","Price (L)"],
            ...strikersRoster.map((p,i) => [i+1, p.name, p.category, p.price])];
        if (strikersRoster.length) {
            strikersData.push([]);
            strikersData.push(["","","Total Spent", strikersSpent]);
            strikersData.push(["","","Budget Left", budgetStrikers]);
        }
        const unsoldData = [["#","Player Name","Category"],
            ...unsoldRoster.map((p,i) => [i+1, p.name, p.category])];
        const logData = [["Time","Player","Team / Status","Price"],
            ...auctionLog.map(e => [e.time, e.name, e.team, e.price || "-"])];

        const wb = XLSX.utils.book_new();
        [
            { data: huntersData,  name: "Danish Dominators" },
            { data: strikersData, name: "Zaki Zenith"   },
            { data: unsoldData,   name: "Unsold Players"  },
            { data: logData,      name: "Auction Log"     }
        ].forEach(s => {
            const ws = XLSX.utils.aoa_to_sheet(s.data);
            ws["!cols"] = [{ wch: 4 }, { wch: 22 }, { wch: 12 }, { wch: 12 }];
            XLSX.utils.book_append_sheet(wb, ws, s.name);
        });
        XLSX.writeFile(wb, "Hassan_Trophy_2026_Auction.xlsx");
        showSoldFlash("✅ Excel file downloaded!");
    }

    $("#exportBtn").click(function () {
        if (window.XLSX) {
            doExcelExport();
        } else {
            const s = document.createElement("script");
            s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
            s.onload  = doExcelExport;
            s.onerror = () => alert("Could not load Excel library. Check internet connection.");
            document.head.appendChild(s);
        }
    });

    /* ==============================
       CONFIRM MODAL
    ============================== */
    function showConfirm(msg, cb) {
        $("#confirmMsg").text(msg);
        confirmCallback = cb;
        new bootstrap.Modal(document.getElementById("confirmModal")).show();
    }

    $("#confirmYes").click(function () {
        bootstrap.Modal.getInstance(document.getElementById("confirmModal")).hide();
        if (confirmCallback) confirmCallback();
        confirmCallback = null;
    });

    $("#soldOverlay").click(function () { $(this).fadeOut(300); });


    /* ==============================
       ADMIN LOGIN / LOGOUT
    ============================== */
    // Login modal submit
    $("#adminLoginBtn").click(function () {
        $("#adminPasswordInput").val("");
        $("#adminLoginError").hide();
        new bootstrap.Modal(document.getElementById("adminLoginModal")).show();
        setTimeout(() => $("#adminPasswordInput").focus(), 400);
    });

    $("#adminLoginSubmit").click(function () {
        const pwd = $("#adminPasswordInput").val();
        if (pwd === ADMIN_PASSWORD) {
            bootstrap.Modal.getInstance(document.getElementById("adminLoginModal")).hide();
            enterAdminMode();
            showSoldFlash("✅ Admin mode unlocked!");
        } else {
            $("#adminLoginError").show();
            $("#adminPasswordInput").val("").focus();
        }
    });

    $("#adminPasswordInput").on("keydown", function(e) {
        if (e.key === "Enter") $("#adminLoginSubmit").trigger("click");
    });

    // Logout
    $("#adminLogoutBtn").click(function () {
        exitAdminMode();
        showSoldFlash("🔒 Logged out of admin mode.");
    });

    // Export button for viewer (same function, just different button)
    $("#exportBtnViewer").click(function () { $("#exportBtn").trigger("click"); });

    // Apply UI state on load
    applyAdminUI();

    /* ==============================
       SPIN WHEEL
    ============================== */
    let spinModal = null;
    let spinning  = false;
    let spinAngle = 0;          // current rotation in radians
    let spinSelected = null;    // player object picked by wheel

    // Category pair tracking: har category 2 baar consecutively aati hai
    let spinLastCategory = null;   // pichli baar jo category aayi thi
    let spinCategoryUsed = false;  // kya us category ka dusra spin ho chuka hai

    // Colour palette for segments
    const WHEEL_COLORS = [
        "#1a3a5c","#0d2d4a","#163352","#0f2840",
        "#1e4060","#112238","#192f4a","#0c2035",
    ];
    const CAT_COLORS = { Sun: "#f5a623", Moon: "#7eb8f7", Star: "#c084fc" };

    function openSpinWheel() {
        if (!players.length) { showSoldFlash("⚠ No players left in pool!"); return; }
        spinSelected = null;
        $("#spinResultCard").hide();
        $("#spinIdleMsg").show();
        $("#doSpinBtn").prop("disabled", false).text("🎡 SPIN");
        $("#spinAvailCount").text(players.length);

        drawWheel(players, spinAngle);

        if (!spinModal) {
            spinModal = new bootstrap.Modal(document.getElementById("spinWheelModal"), { keyboard: false });
        }
        spinModal.show();
    }

    $("#spinWheelBtn").click(openSpinWheel);

    $("#closeSpinModal").click(function () {
        if (spinModal) spinModal.hide();
    });

    function drawWheel(list, rotation) {
        const canvas = document.getElementById("spinCanvas");
        if (!canvas) return;
        const ctx    = canvas.getContext("2d");
        const cx     = canvas.width  / 2;
        const cy     = canvas.height / 2;
        const radius = cx - 8;
        const slice  = (2 * Math.PI) / list.length;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Outer glow ring
        ctx.save();
        ctx.shadowColor = "rgba(0,200,255,0.4)";
        ctx.shadowBlur  = 18;
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 4, 0, 2 * Math.PI);
        ctx.strokeStyle = "rgba(0,200,255,0.25)";
        ctx.lineWidth   = 3;
        ctx.stroke();
        ctx.restore();

        list.forEach((player, i) => {
            const startAngle = rotation + i * slice;
            const endAngle   = startAngle + slice;

            // Segment fill
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, radius, startAngle, endAngle);
            ctx.closePath();
            ctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length];
            ctx.fill();

            // Category accent arc on outer edge
            ctx.beginPath();
            ctx.arc(cx, cy, radius, startAngle, endAngle);
            ctx.strokeStyle = CAT_COLORS[player.category] || "#fff";
            ctx.lineWidth   = 4;
            ctx.stroke();

            // Divider lines
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + radius * Math.cos(startAngle), cy + radius * Math.sin(startAngle));
            ctx.strokeStyle = "rgba(0,200,255,0.15)";
            ctx.lineWidth   = 1;
            ctx.stroke();

            // Player name text
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(startAngle + slice / 2);
            ctx.textAlign    = "right";
            ctx.fillStyle    = "#e8f0f8";
            ctx.font         = `bold ${list.length > 12 ? 11 : 13}px Rajdhani, sans-serif`;
            ctx.shadowColor  = "rgba(0,0,0,0.8)";
            ctx.shadowBlur   = 4;
            ctx.fillText(player.name, radius - 10, 5);
            ctx.restore();
        });

        // Centre circle
        ctx.beginPath();
        ctx.arc(cx, cy, 28, 0, 2 * Math.PI);
        const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, 28);
        grad.addColorStop(0, "#1a3a5c");
        grad.addColorStop(1, "#050a0e");
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = "rgba(0,200,255,0.5)";
        ctx.lineWidth   = 2;
        ctx.stroke();

        // Centre cricket ball icon
        ctx.font      = "18px serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "#fff";
        ctx.fillText("🏏", cx, cy + 7);
    }

    $("#doSpinBtn").click(function () {
        if (spinning || !players.length) return;
        if (currentPlayer) {
            showSoldFlash("⚠ Pehle current player ka decision lo!");
            return;
        }

        spinning = true;

        // Agar pichla spin send nahi hua (Spin Again bina Send ke),
        // toh category state undo karo — warna wahi player baar baar aayega
        if (spinSelected) {
            if (spinCategoryUsed) {
                // Dusra spin tha jo send nahi hua — pair incomplete karo wapas
                spinLastCategory = spinSelected.category;
                spinCategoryUsed = false;
            } else if (spinLastCategory === null) {
                // Pehla spin tha jo send nahi hua — category clear karo
                spinLastCategory = null;
            }
        }

        spinSelected = null;
        $("#spinResultCard").hide();
        $("#spinIdleMsg").show();
        $(this).prop("disabled", true).text("⏳ Spinning…");

        // ── CATEGORY-PAIR LOGIC ──────────────────────────────────
        // Pehli baar random category, dusri baar usi category se,
        // phir fresh random category, phir usi se — aur aise hi chalta rahe
        let targetPlayers;
        if (spinLastCategory && !spinCategoryUsed) {
            // Dusra spin: usi category ke players mein se chunna hai
            const sameCatPlayers = players.filter(p => p.category === spinLastCategory);
            targetPlayers = sameCatPlayers.length > 0 ? sameCatPlayers : players;
            spinCategoryUsed = true;   // pair complete — agli baar fresh random
        } else {
            // Pehla spin ya naya cycle: puri list mein se random
            targetPlayers = players;
        }

        // targetPlayers mein se ek random player chunte hain
        const targetWinnerIdx = Math.floor(Math.random() * targetPlayers.length);
        const targetPlayer    = targetPlayers[targetWinnerIdx];

        // Actual index players[] mein dhundhte hain (wheel ke liye)
        const winnerIdx = players.findIndex(p => p.name === targetPlayer.name);

        // Category state update — sirf pehle spin (ya fresh cycle) pe set karo
        if (!spinCategoryUsed) {
            // Yeh pehla spin tha, category save karo dusre spin ke liye
            spinLastCategory = targetPlayer.category;
        } else {
            // Dusra spin complete hua — cycle reset karo
            spinLastCategory = null;
            spinCategoryUsed = false;
        }

        const slice = (2 * Math.PI) / players.length;

        // ── SPIN ANGLE FIX ───────────────────────────────────────
        // spinAngle ko 0–2PI range mein normalise karo taaki
        // totalDelta kabhi giant number na bane (slow spin bug fix)
        spinAngle = spinAngle % (2 * Math.PI);

        // Pointer fixed at top = -PI/2.
        // finalAngle + winnerIdx*slice + slice/2 = -PI/2  =>  finalAngle = -PI/2 - winnerIdx*slice - slice/2
        const pointerTarget = -Math.PI / 2 - winnerIdx * slice - slice / 2;
        // Normalise pointerTarget to 0–2PI
        const normTarget = ((pointerTarget % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        // Add 5–7 full forward spins for drama
        const extraSpins = (5 + Math.floor(Math.random() * 3)) * 2 * Math.PI;
        const finalAngle = normTarget + extraSpins;

        const duration   = 4000 + Math.random() * 1500;
        const startTime  = performance.now();
        const startAngle = spinAngle;
        const totalDelta = finalAngle - startAngle + (2 * Math.PI); // guaranteed good delta

        function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

        function animate(now) {
            const elapsed  = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            spinAngle      = startAngle + totalDelta * easeOut(progress);

            drawWheel(players, spinAngle);

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                spinAngle = startAngle + totalDelta; // exact final position
                drawWheel(players, spinAngle);
                spinning = false;

                spinSelected = players[winnerIdx];
                showSpinResult(spinSelected);
                $("#doSpinBtn").prop("disabled", false).text("🔄 Spin Again");
            }
        }

        requestAnimationFrame(animate);
    });

    function showSpinResult(player) {
        const catIcons  = { Sun: "☀", Moon: "🌙", Star: "⭐" };
        const catColors = { Sun: "#f5a623", Moon: "#7eb8f7", Star: "#c084fc" };

        $("#spinResultName").text(player.name);
        $("#spinResultCat")
            .text(catIcons[player.category] + " " + player.category)
            .css("color", catColors[player.category] || "#aaa");

        // Next spin hint
        const nextHintEl = $("#spinNextHint");
        if (nextHintEl.length) {
            if (!spinCategoryUsed) {
                nextHintEl.text("🔁 Next spin: " + catIcons[player.category] + " " + player.category + " category se")
                          .css("color", catColors[player.category] || "#aaa").show();
            } else {
                nextHintEl.text("🎲 Next spin: Naye random category se").css("color", "#aaa").show();
            }
        }

        $("#spinIdleMsg").hide();
        $("#spinResultCard").show();

        // Flash the pointer
        $(".wheel-pointer").addClass("pointer-flash");
        setTimeout(() => $(".wheel-pointer").removeClass("pointer-flash"), 1000);
    }

    $("#sendToAuctionBtn").click(function () {
        if (!spinSelected) return;
        if (!isAdmin()) { showSoldFlash("⚠ Admin access required!"); return; }

        // Find and activate the player in the list
        const $li = $(`#sunList li[data-name="${spinSelected.name}"], #moonList li[data-name="${spinSelected.name}"], #starList li[data-name="${spinSelected.name}"]`).first();

        if (!$li.length) {
            showSoldFlash("⚠ Player not found in pool (already sold?)");
            if (spinModal) spinModal.hide();
            return;
        }

        // Close modal first
        if (spinModal) spinModal.hide();

        // Simulate click on that player li (triggers full selection flow)
        $(".player-list li").removeClass("active-player");
        $li.addClass("active-player");

        currentPlayer = {
            name:     spinSelected.name,
            category: spinSelected.category,
            img:      spinSelected.img || "",
            element:  $li
        };
        showPlayerCard(currentPlayer);
        resetTimer();
        resetBidTracker();

        spinSelected = null;
        showSoldFlash("🎡 " + currentPlayer.name + " spin se select hua!");
    });

    /* INIT */
    updateTeamDisplay();
});