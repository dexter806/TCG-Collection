/* ============================================
   DATA MODEL
   PAGES is an array of pages. Each page has 9
   slots (a real 9-pocket binder page). A slot is
   either null (empty pocket) or a full card object
   from the Pokémon TCG API. Slots can be filled in
   ANY order — gaps are normal, exactly like a real
   binder page you're still building out.

   Everything is saved to localStorage so your binder
   persists between visits. First-ever visit seeds a
   small demo page so it's not just blank.
   ============================================ */

const STORAGE_KEY = "pokemon-binder-state";

const DEMO_PAGES = [
  {
    title: "KANTO · GEN 1",
    lookups: [
      { name: "Charizard", setId: "base1" },
      null,
      { name: "Blastoise", setId: "base1" },
      null,
      { name: "Venusaur", setId: "base1" },
      null,
      { name: "Pikachu", setId: "base1" },
      null,
      { name: "Mewtwo", setId: "base1" },
    ]
  },
];

let PAGES = [];
let currentPage = 0;
let editMode = false;
let editingSlotIndex = null; // which pocket the slot editor is currently open for

/* ============================================
   POKÉMON TCG API
   Free, no key required — but unauthenticated
   requests share a low, strict rate limit (30/min,
   1000/day), which is easy to hit once a page is
   making several calls on load. If the Set dropdown
   ever comes up empty, this is almost always why.

   Optional: grab a free key at https://dev.pokemontcg.io
   and paste it in below — it raises the limit to
   20,000/day. Totally fine to leave blank; things
   just get more reliable with a key in place.

   Note: this API is English-card data only —
   there's no language field to filter by.
   ============================================ */
const API_KEY = ""; // paste a free key here if you want higher rate limits
const API_BASE = "https://api.pokemontcg.io/v2/cards";
const SETS_API = "https://api.pokemontcg.io/v2/sets";

const TYPES = ["Colorless","Darkness","Dragon","Fairy","Fighting","Fire","Grass","Lightning","Metal","Psychic","Water"];
const RARITIES = ["Common","Uncommon","Rare","Rare Holo","Rare Holo EX","Rare Holo GX","Rare Holo V","Rare Holo VMAX","Rare Ultra","Rare Secret","Rare Rainbow","Rare Shiny","Rare Shiny GX","Rare Shining","Rare BREAK","Rare ACE","Rare Prime","Rare Prism Star","Rare Holo Star","Rare Holo LV.X","Amazing Rare","LEGEND","Promo"];

let SETS = []; // populated once from the API, used to fill the Set dropdown

/* Shared fetch helper — adds the API key if one's set, and retries once
   on failure (covers transient network hiccups / brief rate-limit blips). */
async function apiFetch(url, attempt = 1){
  try{
    const headers = API_KEY ? { "X-Api-Key": API_KEY } : {};
    const res = await fetch(url, { headers });
    if(!res.ok) throw new Error("API error " + res.status);
    return await res.json();
  }catch(err){
    if(attempt < 2){
      await new Promise(r => setTimeout(r, 700));
      return apiFetch(url, attempt + 1);
    }
    console.error("API request failed after retry:", url, err);
    return null;
  }
}

async function fetchSets(){
  const json = await apiFetch(`${SETS_API}?orderBy=releaseDate&pageSize=250`);
  return json ? (json.data || []) : null; // null = totally failed, distinct from "zero results"
}

async function fetchCardByNameAndSet(name, setId){
  const q = encodeURIComponent(`name:"${name}" set.id:${setId}`);
  const json = await apiFetch(`${API_BASE}?q=${q}&pageSize=1`);
  return (json && json.data && json.data[0]) || null;
}

/* Cards today are printed like "169/142" — the part after the slash is
   the SET's total card count, not part of the card's own number. Rather
   than just discarding it, use it: sets almost always have a unique
   total, so we can auto-detect which exact set you mean from it —
   without you having to also pick it from the Set dropdown. */
function parseNumberInput(raw){
  if(!raw) return { number: "", total: null };
  const [num, total] = raw.split("/").map(s => s.trim());
  return { number: num || "", total: total || null };
}

function findSetsByTotal(total){
  const n = parseInt(total, 10);
  if(Number.isNaN(n)) return [];
  return SETS.filter(s => s.printedTotal === n || s.total === n);
}

/* Builds a combined Lucene-style query from whichever filters are filled
   in. Any combination works — fill in just one field, or several at once. */
function buildSearchQuery({ name, setId, numberInput, type, rarity }){
  const parts = [];
  if(name) parts.push(`name:${name}*`);

  const { number, total } = parseNumberInput(numberInput);

  // An explicit Set dropdown choice always wins. Otherwise, if a "/total"
  // was typed, try to auto-detect the exact set from it.
  let effectiveSetId = setId;
  if(!effectiveSetId && total && SETS){
    const matches = findSetsByTotal(total);
    if(matches.length === 1){
      effectiveSetId = matches[0].id;
    } else if(matches.length > 1){
      parts.push(`(${matches.map(s => `set.id:${s.id}`).join(" OR ")})`);
    }
  }
  if(effectiveSetId) parts.push(`set.id:${effectiveSetId}`);

  if(number){
    // The dataset isn't perfectly consistent about zero-padding card
    // numbers (some sets store "017", others "17") — try a couple of
    // reasonable variants rather than failing on an exact mismatch.
    const unpadded = String(parseInt(number, 10));
    const padded3 = number.padStart(3, "0");
    const variants = [...new Set([number, unpadded, padded3])];
    parts.push(variants.length > 1
      ? `(${variants.map(v => `number:${v}`).join(" OR ")})`
      : `number:${number}`
    );
  }

  if(type)   parts.push(`types:${type}`);
  if(rarity) parts.push(`rarity:"${rarity}"`);
  return parts.join(" ");
}

async function searchCards(filters){
  const query = buildSearchQuery(filters);
  if(!query) return [];
  const json = await apiFetch(`${API_BASE}?q=${encodeURIComponent(query)}&pageSize=20&orderBy=name`);
  return json ? (json.data || []) : [];
}

function isHolo(card){
  return /holo/i.test(card.rarity || "");
}

/* ============================================
   PERSISTENCE
   ============================================ */
function saveState(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(PAGES));
  }catch(err){
    console.error("Couldn't save binder:", err);
  }
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch(err){
    return null;
  }
}

async function buildDemoPages(){
  const pages = [];
  for(const demoPage of DEMO_PAGES){
    const slots = await Promise.all(
      demoPage.lookups.map(l => l ? fetchCardByNameAndSet(l.name, l.setId) : Promise.resolve(null))
    );
    pages.push({ title: demoPage.title, slots });
  }
  return pages;
}

/* ============================================
   RENDERING — BINDER
   ============================================ */
function renderPage(){
  const grid = document.getElementById("pocketGrid");
  const page = PAGES[currentPage];
  grid.innerHTML = "";

  page.slots.forEach((card, i) => {
    const pocket = document.createElement("div");

    if(!card){
      pocket.className = "pocket empty" + (editMode ? " editable" : "");
      if(editMode){
        pocket.innerHTML = `<span class="pocket-plus">+</span>`;
        pocket.addEventListener("click", () => openSlotEditor(i));
      }
      grid.appendChild(pocket);
      return;
    }

    pocket.className = "pocket filled" + (isHolo(card) ? " holo" : "") + (editMode ? " editable" : "");
    pocket.innerHTML = `<img src="${card.images.small}" alt="${card.name}">`;

    if(editMode){
      attachDragHandlers(pocket, i);
    } else {
      pocket.addEventListener("click", () => openDetail(card));
    }

    grid.appendChild(pocket);
  });

  document.getElementById("binderTitle").textContent = page.title;
  document.getElementById("pageIndicator").textContent =
    `PAGE ${currentPage + 1} OF ${PAGES.length}`;
  document.getElementById("prevPage").disabled = currentPage === 0;
  document.getElementById("nextPage").disabled = currentPage === PAGES.length - 1;
}

/* ============================================
   DRAG TO REARRANGE
   Works with mouse, touch, and pen via the Pointer
   Events API. A small movement threshold tells a
   real drag apart from a simple tap — a tap still
   opens the slot editor like before; a drag swaps
   (or moves, if the target was empty) the two cards.
   ============================================ */
const DRAG_THRESHOLD = 6; // px of movement before it counts as a drag, not a tap

function attachDragHandlers(pocketEl, index){
  pocketEl.style.touchAction = "none"; // stop touch-drag from scrolling the page

  pocketEl.addEventListener("pointerdown", (downEvent) => {
    const startX = downEvent.clientX;
    const startY = downEvent.clientY;
    let moved = false;
    let ghost = null;

    function onMove(moveEvent){
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      if(!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD){
        moved = true;
        const img = pocketEl.querySelector("img");
        ghost = document.createElement("img");
        ghost.src = img.src;
        ghost.className = "drag-ghost";
        document.body.appendChild(ghost);
        pocketEl.classList.add("dragging");
      }

      if(moved){
        ghost.style.left = `${moveEvent.clientX}px`;
        ghost.style.top = `${moveEvent.clientY}px`;

        document.querySelectorAll(".pocket.drop-target").forEach(p => p.classList.remove("drop-target"));
        const under = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
        const targetPocket = under && under.closest(".pocket");
        if(targetPocket && targetPocket !== pocketEl) targetPocket.classList.add("drop-target");
      }
    }

    function onUp(upEvent){
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.querySelectorAll(".pocket.drop-target").forEach(p => p.classList.remove("drop-target"));
      pocketEl.classList.remove("dragging");

      if(!moved){
        openSlotEditor(index); // it was just a tap
        return;
      }

      if(ghost) ghost.remove();

      const under = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
      const targetPocket = under && under.closest(".pocket");
      if(targetPocket){
        const grid = document.getElementById("pocketGrid");
        const targetIndex = Array.from(grid.children).indexOf(targetPocket);
        if(targetIndex >= 0 && targetIndex !== index){
          const slots = PAGES[currentPage].slots;
          [slots[index], slots[targetIndex]] = [slots[targetIndex], slots[index]];
          saveState();
          renderPage();
        }
      }
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });
}

function openDetail(card){
  document.getElementById("detailImg").src = card.images.large;
  document.getElementById("detailImg").alt = card.name;
  document.getElementById("detailName").textContent = card.name;
  const num = card.number && card.set.printedTotal
    ? `${card.number}/${card.set.printedTotal}`
    : card.number || "";
  document.getElementById("detailSet").textContent =
    [card.set.name, num].filter(Boolean).join(" · ");
  document.getElementById("cardDetail").classList.add("visible");
}

function closeDetail(){
  document.getElementById("cardDetail").classList.remove("visible");
}

/* ============================================
   SLOT EDITOR — search & place, or remove
   ============================================ */
let searchDebounce = null;

function populateFilterDropdowns(){
  const setSel = document.getElementById("filterSet");
  if(SETS === null){
    setSel.innerHTML = `<option value="">Couldn't load sets — click to retry</option>`;
    setSel.onclick = async (e) => {
      if(setSel.selectedIndex !== 0) return; // only retry from the error state itself
      setSel.innerHTML = `<option value="">Loading sets…</option>`;
      SETS = await fetchSets();
      populateFilterDropdowns();
    };
  } else {
    setSel.onclick = null;
    setSel.innerHTML = `<option value="">Any set</option>` +
      SETS.map(s => `<option value="${s.id}">${s.name} (${s.series})</option>`).join("");
  }

  const typeSel = document.getElementById("filterType");
  typeSel.innerHTML = `<option value="">Any type</option>` +
    TYPES.map(t => `<option value="${t}">${t}</option>`).join("");

  const raritySel = document.getElementById("filterRarity");
  raritySel.innerHTML = `<option value="">Any rarity</option>` +
    RARITIES.map(r => `<option value="${r}">${r}</option>`).join("");
}

function openSlotEditor(slotIndex){
  editingSlotIndex = slotIndex;
  const card = PAGES[currentPage].slots[slotIndex];

  const currentWrap = document.getElementById("editorCurrent");
  if(card){
    currentWrap.innerHTML = `
      <img src="${card.images.small}" alt="${card.name}">
      <div>
        <div class="editor-current-name">${card.name}</div>
        <button class="editor-remove-btn" id="removeCardBtn">Remove from slot</button>
      </div>
    `;
    currentWrap.style.display = "flex";
    document.getElementById("removeCardBtn").addEventListener("click", () => {
      PAGES[currentPage].slots[slotIndex] = null;
      saveState();
      renderPage();
      closeSlotEditor();
    });
  } else {
    currentWrap.style.display = "none";
    currentWrap.innerHTML = "";
  }

  document.getElementById("filterName").value = "";
  document.getElementById("filterSet").value = "";
  document.getElementById("filterNumber").value = "";
  document.getElementById("filterType").value = "";
  document.getElementById("filterRarity").value = "";
  document.getElementById("searchResults").innerHTML = "";
  document.getElementById("slotEditor").classList.add("visible");
  document.getElementById("filterName").focus();
}

function closeSlotEditor(){
  document.getElementById("slotEditor").classList.remove("visible");
  editingSlotIndex = null;
}

function currentFilters(){
  return {
    name:        document.getElementById("filterName").value.trim(),
    setId:       document.getElementById("filterSet").value,
    numberInput: document.getElementById("filterNumber").value.trim(),
    type:        document.getElementById("filterType").value,
    rarity:      document.getElementById("filterRarity").value,
  };
}

async function runSearch(){
  const resultsEl = document.getElementById("searchResults");
  const filters = currentFilters();

  if(!filters.name && !filters.setId && !filters.numberInput && !filters.type && !filters.rarity){
    resultsEl.innerHTML = "";
    return;
  }

  resultsEl.innerHTML = `<div class="search-status">Searching…</div>`;
  const results = await searchCards(filters);

  if(!results.length){
    resultsEl.innerHTML = `<div class="search-status">No cards found. If this is a very new set, it may not be indexed yet — try searching by just the name, or double-check the set/number.</div>`;
    return;
  }

  resultsEl.innerHTML = "";
  results.forEach(card => {
    const item = document.createElement("div");
    item.className = "search-result";
    item.innerHTML = `
      <img src="${card.images.small}" alt="${card.name}">
      <span>${card.name} <em>${card.set.name} &middot; ${card.rarity || "—"}</em></span>
    `;
    item.addEventListener("click", () => {
      PAGES[currentPage].slots[editingSlotIndex] = card;
      saveState();
      renderPage();
      closeSlotEditor();
    });
    resultsEl.appendChild(item);
  });
}

function triggerDebouncedSearch(){
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(runSearch, 400);
}

/* ============================================
   PAGE MANAGEMENT
   ============================================ */
function addNewPage(){
  PAGES.push({
    title: PAGES[0]?.title || "NEW PAGE",
    slots: [null, null, null, null, null, null, null, null, null]
  });
  saveState();
  currentPage = PAGES.length - 1;
  renderPage();
}

/* ============================================
   EVENTS
   ============================================ */
document.getElementById("prevPage").addEventListener("click", () => {
  if(currentPage > 0){ currentPage--; renderPage(); }
});
document.getElementById("nextPage").addEventListener("click", () => {
  if(currentPage < PAGES.length - 1){ currentPage++; renderPage(); }
});

document.getElementById("closeDetail").addEventListener("click", closeDetail);
document.getElementById("cardDetail").addEventListener("click", (e) => {
  if(e.target.id === "cardDetail") closeDetail();
});

document.getElementById("editToggle").addEventListener("click", () => {
  editMode = !editMode;
  document.getElementById("editToggle").classList.toggle("active", editMode);
  document.getElementById("addPageBtn").style.display = editMode ? "inline-flex" : "none";
  renderPage();
});

document.getElementById("addPageBtn").addEventListener("click", addNewPage);

document.getElementById("closeSlotEditor").addEventListener("click", closeSlotEditor);
document.getElementById("slotEditor").addEventListener("click", (e) => {
  if(e.target.id === "slotEditor") closeSlotEditor();
});

document.getElementById("filterName").addEventListener("input", triggerDebouncedSearch);
document.getElementById("filterNumber").addEventListener("input", triggerDebouncedSearch);
document.getElementById("filterSet").addEventListener("change", runSearch);
document.getElementById("filterType").addEventListener("change", runSearch);
document.getElementById("filterRarity").addEventListener("change", runSearch);

document.addEventListener("keydown", (e) => {
  if(e.key !== "Escape") return;
  closeDetail();
  closeSlotEditor();
});

/* ============================================
   INIT
   ============================================ */
(async function init(){
  document.getElementById("pageIndicator").textContent = "LOADING…";

  const [saved, sets] = await Promise.all([
    Promise.resolve(loadState()),
    fetchSets(),
  ]);
  SETS = sets;
  populateFilterDropdowns();

  PAGES = saved && saved.length ? saved : await buildDemoPages();
  if(!saved) saveState();
  renderPage();
})();
