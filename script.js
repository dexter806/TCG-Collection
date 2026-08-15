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
   ============================================ */
const API_BASE = "https://api.pokemontcg.io/v2/cards";

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

async function searchCards(term){
  if(!term.trim()) return [];
  try{
    const q = encodeURIComponent(`name:${term}*`);
    const res = await fetch(`${API_BASE}?q=${q}&pageSize=16&orderBy=name`);
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
   RENDERING
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

  document.getElementById("searchInput").value = "";
  document.getElementById("searchResults").innerHTML = "";
  document.getElementById("slotEditor").classList.add("visible");
  document.getElementById("searchInput").focus();
}

function closeSlotEditor(){
  document.getElementById("slotEditor").classList.remove("visible");
  editingSlotIndex = null;
}

async function runSearch(term){
  const resultsEl = document.getElementById("searchResults");
  if(!term.trim()){
    resultsEl.innerHTML = "";
    return;
  }
  resultsEl.innerHTML = `<div class="search-status">Searching…</div>`;
  const results = await searchCards(term);

  if(!results.length){
    resultsEl.innerHTML = `<div class="search-status">No cards found.</div>`;
    return;
  }

  resultsEl.innerHTML = "";
  results.forEach(card => {
    const item = document.createElement("div");
    item.className = "search-result";
    item.innerHTML = `
      <img src="${card.images.small}" alt="${card.name}">
      <span>${card.name} <em>${card.set.name}</em></span>
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

document.getElementById("searchInput").addEventListener("input", (e) => {
  clearTimeout(searchDebounce);
  const term = e.target.value;
  searchDebounce = setTimeout(() => runSearch(term), 400);
});

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
  const saved = loadState();
  PAGES = saved && saved.length ? saved : await buildDemoPages();
  if(!saved) saveState();
  renderPage();
})();
