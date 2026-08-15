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
   Free, no key required for light/personal use.
   https://docs.pokemontcg.io

   Note: this API is English-card data only —
   there's no language field to filter by.
   ============================================ */
const API_BASE = "https://api.pokemontcg.io/v2/cards";
const SETS_API = "https://api.pokemontcg.io/v2/sets";

const TYPES = ["Colorless","Darkness","Dragon","Fairy","Fighting","Fire","Grass","Lightning","Metal","Psychic","Water"];
const RARITIES = ["Common","Uncommon","Rare","Rare Holo","Rare Holo EX","Rare Holo GX","Rare Holo V","Rare Holo VMAX","Rare Ultra","Rare Secret","Rare Rainbow","Rare Shiny","Rare Shiny GX","Rare Shining","Rare BREAK","Rare ACE","Rare Prime","Rare Prism Star","Rare Holo Star","Rare Holo LV.X","Amazing Rare","LEGEND","Promo"];

let SETS = []; // populated once from the API, used to fill the Set dropdown

async function fetchSets(){
  try{
    const res = await fetch(`${SETS_API}?orderBy=releaseDate&pageSize=250`);
    if(!res.ok) throw new Error("API error " + res.status);
    const json = await res.json();
    return json.data || [];
  }catch(err){
    console.error("Couldn't fetch sets:", err);
    return [];
  }
}

async function fetchCardByNameAndSet(name, setId){
  try{
    const q = encodeURIComponent(`name:"${name}" set.id:${setId}`);
    const res = await fetch(`${API_BASE}?q=${q}&pageSize=1`);
    if(!res.ok) throw new Error("API error " + res.status);
    const json = await res.json();
    return (json.data && json.data[0]) || null;
  }catch(err){
    console.error("Couldn't fetch card:", name, err);
    return null;
  }
}

/* Builds a combined Lucene-style query from whichever filters are filled
   in. Any combination works — fill in just one field, or several at once. */
function buildSearchQuery({ name, setId, number, type, rarity }){
  const parts = [];
  if(name)   parts.push(`name:${name}*`);
  if(setId)  parts.push(`set.id:${setId}`);
  if(number) parts.push(`number:${number}`);
  if(type)   parts.push(`types:${type}`);
  if(rarity) parts.push(`rarity:"${rarity}"`);
  return parts.join(" ");
}

async function searchCards(filters){
  const query = buildSearchQuery(filters);
  if(!query) return [];
  try{
    const res = await fetch(`${API_BASE}?q=${encodeURIComponent(query)}&pageSize=20&orderBy=name`);
    if(!res.ok) throw new Error("API error " + res.status);
    const json = await res.json();
    return json.data || [];
  }catch(err){
    console.error("Search failed:", err);
    return [];
  }
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
    pocket.addEventListener("click", () => {
      editMode ? openSlotEditor(i) : openDetail(card);
    });
    grid.appendChild(pocket);
  });

  document.getElementById("binderTitle").textContent = page.title;
  document.getElementById("pageIndicator").textContent =
    `PAGE ${currentPage + 1} OF ${PAGES.length}`;
  document.getElementById("prevPage").disabled = currentPage === 0;
  document.getElementById("nextPage").disabled = currentPage === PAGES.length - 1;
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
  setSel.innerHTML = `<option value="">Any set</option>` +
    SETS.map(s => `<option value="${s.id}">${s.name} (${s.series})</option>`).join("");

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
    name:   document.getElementById("filterName").value.trim(),
    setId:  document.getElementById("filterSet").value,
    number: document.getElementById("filterNumber").value.trim(),
    type:   document.getElementById("filterType").value,
    rarity: document.getElementById("filterRarity").value,
  };
}

async function runSearch(){
  const resultsEl = document.getElementById("searchResults");
  const filters = currentFilters();

  if(!filters.name && !filters.setId && !filters.number && !filters.type && !filters.rarity){
    resultsEl.innerHTML = "";
    return;
  }

  resultsEl.innerHTML = `<div class="search-status">Searching…</div>`;
  const results = await searchCards(filters);

  if(!results.length){
    resultsEl.innerHTML = `<div class="search-status">No cards found — try loosening a filter.</div>`;
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
