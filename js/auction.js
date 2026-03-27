$(document).ready(function () {

    /* ==============================
       STATE
    ============================== */
    let budgetHunters = 100;
    let budgetStrikers = 100;
    const INITIAL_BUDGET = 100;
    const BASE_PRICE = 5;

    let players = [];
    let allPlayers = [];
    let currentPlayer = null;
    let timer;
    let timeLeft = 20;
    let timerRunning = false;
    const TIMER_MAX = 20;
    const CIRCUMFERENCE = 339.3; // 2 * PI * 54

    let huntersCount = 0, strikersCount = 0, unsoldPlayers = 0;
    let huntersSpent = 0, strikersSpent = 0;
    let currentFilter = "all";
    let auctionLog = [];
    let confirmCallback = null;

    // Bid tracker state
    let huntersBid = 0;
    let strikersBid = 0;
    let lastBidTeam = null; // "Hunters" | "Strikers" | null

    /* ==============================
       LOAD PLAYERS
    ============================== */
    $.getJSON("players.json", function (data) {
        data.sort((a, b) => a.name.localeCompare(b.name));
        allPlayers = data;
        players = [...data];
        populateLists();
        updateStats();
    }).fail(function () {
        // Fallback if JSON not found (demo mode)
        console.warn("players.json not found. Running in demo mode.");
    });

    function populateLists() {
        $("#sunList, #moonList, #starList").empty();
        let num = 1;
        players.forEach(player => {
            const listId = player.category === "Sun" ? "#sunList"
                : player.category === "Moon" ? "#moonList" : "#starList";
            const shouldShow = currentFilter === "all" || currentFilter === player.category;
            const li = $(`<li data-category="${player.category}" data-img="${player.img || ''}" data-name="${player.name}">
                <span class="player-num">${String(num).padStart(2, '0')}</span>
                <span class="player-list-name">${player.name}</span>
                <span class="player-actions">
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
       STATS UPDATE
    ============================== */
    function updateStats() {
        const total = allPlayers.length;
        const left = players.length;
        const sold = total - left - unsoldPlayers;
        $("#totalCount").text(total);
        $("#soldCount").text(sold);
        $("#leftCount").text(left);
    }

    function updateTeamDisplay() {
        // Hunters
        $("#budgetHunters").text(budgetHunters);
        $("#huntersBudgetInline").text(budgetHunters + "L");
        $("#huntersCount").text(huntersCount);
        $("#huntersSpent").text(huntersSpent + "L");
        const huntersPct = (budgetHunters / INITIAL_BUDGET) * 100;
        $("#huntersBudgetBar").css("width", huntersPct + "%");
        if (budgetHunters < 10) {
            $(".hunters-header").addClass("budget-low");
        } else {
            $(".hunters-header").removeClass("budget-low");
        }

        // Strikers
        $("#budgetStrikers").text(budgetStrikers);
        $("#strikersBudgetInline").text(budgetStrikers + "L");
        $("#strikersCount").text(strikersCount);
        $("#strikersSpent").text(strikersSpent + "L");
        const strikersPct = (budgetStrikers / INITIAL_BUDGET) * 100;
        $("#strikersBudgetBar").css("width", strikersPct + "%");
        if (budgetStrikers < 10) {
            $(".strikers-header").addClass("budget-low");
        } else {
            $(".strikers-header").removeClass("budget-low");
        }
    }

    /* ==============================
       SEARCH & FILTER
    ============================== */
    $("#searchPlayer").on("input", function () {
        const q = $(this).val().toLowerCase();
        $("#sunList li, #moonList li, #starList li").each(function () {
            const name = $(this).data("name").toLowerCase();
            const catMatch = currentFilter === "all" || $(this).data("category") === currentFilter;
            const nameMatch = name.includes(q);
            $(this).toggle(catMatch && nameMatch);
        });
    });

    $(".filter-btn").on("click", function () {
        $(".filter-btn").removeClass("active");
        $(this).addClass("active");
        currentFilter = $(this).data("filter");
        const q = $("#searchPlayer").val().toLowerCase();
        $("#sunList li, #moonList li, #starList li").each(function () {
            const catMatch = currentFilter === "all" || $(this).data("category") === currentFilter;
            const nameMatch = $(this).data("name").toLowerCase().includes(q);
            $(this).toggle(catMatch && nameMatch);
        });
    });

    /* ==============================
       PLAYER SELECTION
    ============================== */
    $("#sunList, #moonList, #starList").on("click", "li", function (e) {
        // Don't select if edit/delete button clicked
        if ($(e.target).hasClass("player-act-btn")) return;

        const playerName = $(this).data("name") || $(this).text().trim();
        const category = $(this).data("category");
        const img = $(this).data("img");

        // Highlight active
        $(".player-list li").removeClass("active-player");
        $(this).addClass("active-player");

        // Set player
        currentPlayer = { name: playerName, category: category, img: img, element: $(this) };
        showPlayerCard(currentPlayer);
        resetTimer();
        resetBidTracker();
    });

    /* ==============================
       EDIT PLAYER
    ============================== */
    $("#sunList, #moonList, #starList").on("click", ".edit-btn", function (e) {
        e.stopPropagation();
        const name = $(this).data("name");
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
        const newName = $("#editPlayerName").val().trim();
        const newImg = $("#editPlayerImg").val().trim();
        const newCat = $("#editPlayerCategory").val();
        if (!newName) { alert("Player name cannot be empty!"); return; }

        // Update in arrays
        [players, allPlayers].forEach(arr => {
            const idx = arr.findIndex(p => p.name === origName);
            if (idx !== -1) { arr[idx] = { name: newName, category: newCat, img: newImg }; }
        });

        // If currently selected player is the one being edited
        if (currentPlayer && currentPlayer.name === origName) {
            currentPlayer.name = newName;
            currentPlayer.category = newCat;
            currentPlayer.img = newImg;
            showPlayerCard(currentPlayer);
        }

        populateLists();
        updateStats();
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
            players = players.filter(p => p.name !== name);
            allPlayers = allPlayers.filter(p => p.name !== name);
            if (currentPlayer && currentPlayer.name === name) {
                clearInterval(timer);
                currentPlayer = null;
                $("#playerCard").hide();
                $("#noPlayerMsg").show();
                resetBidTracker();
            }
            populateLists();
            updateStats();
            showSoldFlash("🗑️ Deleted: " + name);
        });
    });

    function showPlayerCard(player) {
        $("#noPlayerMsg").hide();
        $("#playerCard").show();
        $("#playerName").text(player.name);
        $("#playerCategory").text(player.category + " Category");
        if (player.img) {
            $("#playerImage").attr("src", player.img).show();
        } else {
            $("#playerImage").attr("src", "https://via.placeholder.com/100x100/0d1e2e/00c8ff?text=" + player.name[0]).show();
        }

        // Category badge
        const colors = { Sun: "#f5a623", Moon: "#7eb8f7", Star: "#c084fc" };
        const icons = { Sun: "☀", Moon: "🌙", Star: "⭐" };
        const col = colors[player.category] || "#aaa";
        $("#playerCatBadge")
            .text(icons[player.category] + " " + player.category)
            .css({
                background: `rgba(${hexToRgb(col)},0.15)`,
                border: `1px solid rgba(${hexToRgb(col)},0.4)`,
                color: col,
                padding: "2px 10px",
                borderRadius: "20px",
                fontSize: "0.62rem",
                fontWeight: "700",
                letterSpacing: "1px"
            });

        // Pre-fill bid with base price
        if (!$("#customBid").val()) {
            $("#customBid").val(BASE_PRICE);
        }
        updateBidTracker();
    }

    function hexToRgb(hex) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `${r},${g},${b}`;
    }

    /* ==============================
       BID TRACKER
    ============================== */
    function resetBidTracker() {
        huntersBid = 0;
        strikersBid = 0;
        lastBidTeam = null;
        $("#huntersBidAmt").text("—");
        $("#strikersBidAmt").text("—");
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
            $("#huntersWinTag").show();
            $("#strikersWinTag").hide();
            $("#huntersBidBlock").addClass("bid-leading");
            $("#strikersBidBlock").removeClass("bid-leading");
            $("#currentBidOwner").text("🦅 Hunters Leading").show();
        } else if (lastBidTeam === "Strikers") {
            strikersBid = bidVal;
            $("#strikersBidAmt").text(bidVal + "L");
            $("#strikersWinTag").show();
            $("#huntersWinTag").hide();
            $("#strikersBidBlock").addClass("bid-leading");
            $("#huntersBidBlock").removeClass("bid-leading");
            $("#currentBidOwner").text("⚡ Strikers Leading").show();
        } else {
            $("#currentBidValue").text(bidVal + "L");
            $("#currentBidOwner").text("").hide();
        }
        $("#liveBidTracker").addClass("tracker-active");
    }

    // Update tracker on any bid input change
    $("#customBid").on("input", updateBidTracker);
    $(".bid-quick").on("click", function () { setTimeout(updateBidTracker, 0); });

    // Track which team placed last bid (via pick buttons hover/click intent)
    $("#huntersPickBtn").on("mouseenter", function () {
        if (!currentPlayer) return;
        lastBidTeam = "Hunters";
        updateBidTracker();
    });
    $("#strikersPickBtn").on("mouseenter", function () {
        if (!currentPlayer) return;
        lastBidTeam = "Strikers";
        updateBidTracker();
    });

    /* ==============================
       TIMER
    ============================== */
    function resetTimer() {
        clearInterval(timer);
        timeLeft = TIMER_MAX;
        updateTimerDisplay();
        startTimer();
    }

    function updateTimerDisplay() {
        $("#timer").text(timeLeft);
        // SVG ring
        const progress = timeLeft / TIMER_MAX;
        const offset = CIRCUMFERENCE * (1 - progress);
        $("#timerCircle").css("stroke-dashoffset", offset);

        // Color change as time runs low
        let color = "#00c8ff";
        if (timeLeft <= 5) color = "#e83e3e";
        else if (timeLeft <= 10) color = "#f5a623";
        $("#timerCircle").css("stroke", color).css("filter", `drop-shadow(0 0 6px ${color}88)`);
    }

    function startTimer() {
        timerRunning = true;
        timer = setInterval(() => {
            timeLeft--;
            updateTimerDisplay();
            if (timeLeft <= 0) {
                clearInterval(timer);
                timerRunning = false;
                // Auto-mark as skipped
                showSoldFlash("⏰ Time over! Player skipped.");
                addLog("⏭", currentPlayer ? currentPlayer.name : "?", "SKIPPED", "");
            }
        }, 1000);
    }

    $("#pauseBtn").click(function () {
        clearInterval(timer);
        timerRunning = false;
    });

    $("#resumeBtn").click(function () {
        if (!timerRunning && currentPlayer) startTimer();
    });

    $("#skipBtn").click(function () {
        if (!currentPlayer) return;
        clearInterval(timer);
        showConfirm(`Skip ${currentPlayer.name} without assigning?`, function () {
            addLog("⏭", currentPlayer.name, "SKIPPED", "");
            removeCurrentPlayer();
        });
    });

    /* ==============================
       QUICK BID BUTTONS
    ============================== */
    $(".bid-quick").on("click", function () {
        $(".bid-quick").removeClass("selected");
        $(this).addClass("selected");
        $("#customBid").val($(this).data("val"));
    });

    $("#customBid").on("input", function () {
        $(".bid-quick").removeClass("selected");
    });

    /* ==============================
       FIREWORKS
    ============================== */
    function showFireworks() {
        const colors = ["#ff0044", "#00ff99", "#ffdd00", "#00ccff", "#ff00ff", "#f5a623"];
        for (let i = 0; i < 40; i++) {
            setTimeout(() => {
                let particle = $("<div class='firework'></div>");
                $("#fireworks").append(particle);
                const color = colors[Math.floor(Math.random() * colors.length)];
                const startX = (Math.random() * window.innerWidth);
                const startY = (Math.random() * window.innerHeight * 0.6);
                particle.css({
                    "color": color,
                    "background-color": color,
                    "position": "fixed",
                    "left": startX + "px",
                    "top": startY + "px",
                    "width": "6px",
                    "height": "6px",
                });
                particle.animate({
                    left: startX + (Math.random() * 200 - 100) + "px",
                    top: startY + (Math.random() * 200 - 100) + "px",
                    opacity: 0,
                    width: "2px",
                    height: "2px"
                }, 700 + Math.random() * 400, function () { $(this).remove(); });
            }, i * 20);
        }
    }

    /* ==============================
       SOLD OVERLAY
    ============================== */
    function showSoldOverlay(playerName, price, teamName) {
        $("#overlayPlayerName").text(playerName);
        $("#overlayPrice").text(price + "L");
        $("#overlayTeam").text("→ " + teamName);
        $("#soldOverlay").show();
        showFireworks();
        setTimeout(() => {
            $("#soldOverlay").fadeOut(500);
        }, 2200);
    }

    function showSoldFlash(msg) {
        $("#soldFlash").text(msg).stop(true).css({ display: "flex", opacity: 1 }).animate({ opacity: 0 }, 2500, function () {
            $(this).hide();
        });
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
            budgetHunters -= bid;
            huntersSpent += bid;
            huntersCount++;
            addTeamPlayer("teamHunters", currentPlayer, bid, "hunters");

        } else if (team === "Strikers") {
            if (budgetStrikers < bid) { showSoldFlash("❌ Strikers: Budget insufficient!"); return; }
            budgetStrikers -= bid;
            strikersSpent += bid;
            strikersCount++;
            addTeamPlayer("teamStrikers", currentPlayer, bid, "strikers");
        }

        const teamLabel = team === "Hunters" ? "Hidayat_Hunters" : "Shan_Strikers";
        addLog(team === "Hunters" ? "🦅" : "⚡", currentPlayer.name, teamLabel, bid + "L");
        showSoldOverlay(currentPlayer.name, bid, teamLabel);

        updateTeamDisplay();
        removeCurrentPlayer();
    }

    function addTeamPlayer(listId, player, bid, team) {
        const catClass = `cat-${player.category.toLowerCase()}`;
        // Remove empty placeholder
        $(`#${listId} .team-empty`).remove();
        $(`#${listId}`).append(`
            <li class="team-player-item ${catClass}">
                <div>
                    <div class="item-name">${player.name}</div>
                    <div class="item-cat">${player.category}</div>
                </div>
                <div class="item-price">${bid}L</div>
            </li>
        `);
        // Scroll to bottom
        const el = document.getElementById(listId);
        el.scrollTop = el.scrollHeight;
    }

    function markUnsold() {
        if (!currentPlayer) return;
        unsoldPlayers++;
        addLog("🚫", currentPlayer.name, "UNSOLD", "");
        // Add to unsold list
        $("#unsoldList .team-empty").remove();
        $("#unsoldList").append(`
            <li class="team-player-item" style="border-left-color:#666">
                <div class="item-name">${currentPlayer.name}</div>
                <div class="item-cat">${currentPlayer.category}</div>
            </li>
        `);
        $("#unsoldCount").text(unsoldPlayers);
        showSoldFlash("🚫 " + currentPlayer.name + " went unsold.");
        removeCurrentPlayer();
    }

    function removeCurrentPlayer() {
        if (currentPlayer && currentPlayer.element) {
            currentPlayer.element.fadeOut(300, function () { $(this).remove(); });
        }
        players = players.filter(p => p.name !== (currentPlayer ? currentPlayer.name : ""));
        currentPlayer = null;
        clearInterval(timer);
        timeLeft = TIMER_MAX;
        timerRunning = false;
        updateTimerDisplay();
        $("#customBid").val("");
        $(".bid-quick").removeClass("selected");
        $("#playerCard").hide();
        $("#noPlayerMsg").show();
        resetBidTracker();
        updateStats();
    }

    $("#huntersPickBtn").click(() => assignPlayer("Hunters"));
    $("#strikersPickBtn").click(() => assignPlayer("Strikers"));
    $("#unsoldBtn").click(markUnsold);

    /* ==============================
       AUCTION LOG
    ============================== */
    function addLog(icon, name, team, price) {
        const now = new Date();
        const time = now.getHours().toString().padStart(2, "0") + ":" + now.getMinutes().toString().padStart(2, "0");
        const entry = { icon, name, team, price, time };
        auctionLog.push(entry);

        $("#auctionLog .log-empty").remove();
        const el = $(`
            <div class="log-entry">
                <span class="log-time">${time}</span>
                <span class="log-text"><b>${name}</b> → ${team}</span>
                ${price ? `<span class="log-price">${price}</span>` : ""}
            </div>
        `);
        $("#auctionLog").prepend(el);
    }

    $("#clearLogBtn").click(function () {
        showConfirm("Clear auction log?", function () {
            $("#auctionLog").html('<div class="log-empty">No transactions yet...</div>');
            auctionLog = [];
        });
    });

    /* ==============================
       ADD PLAYER MODAL
    ============================== */
    $("#addPlayerBtn").click(function () {
        const name = $("#newPlayerName").val().trim();
        const img = $("#newPlayerImg").val().trim();
        const cat = $("#newPlayerCategory").val();
        if (!name) { alert("Enter player name!"); return; }

        const player = { name, category: cat, img: img || "" };
        players.push(player);
        allPlayers.push(player);
        players.sort((a, b) => a.name.localeCompare(b.name));
        populateLists();
        updateStats();

        $("#newPlayerName, #newPlayerImg").val("");
        bootstrap.Modal.getInstance(document.getElementById("addPlayerModal")).hide();
    });

    /* ==============================
       RESET
    ============================== */
    $("#resetAuctionBtn").click(function () {
        showConfirm("Reset entire auction? All data will be lost.", function () {
            location.reload();
        });
    });

    /* ==============================
       EXPORT
    ============================== */
    $("#exportBtn").click(function () {
        let csv = "Player,Team,Category,Price\n";
        auctionLog.forEach(e => {
            if (e.price) csv += `${e.name},${e.team},${e.icon},${e.price}\n`;
        });
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "auction_results.csv";
        a.click();
        URL.revokeObjectURL(url);
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

    /* ==============================
       CLOSE SOLD OVERLAY ON CLICK
    ============================== */
    $("#soldOverlay").click(function () {
        $(this).fadeOut(300);
    });

    /* ==============================
       INIT
    ============================== */
    updateTeamDisplay();
});