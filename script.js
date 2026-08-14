/* ============================================
   DATA
   Each page is 9 slots (a real 9-pocket binder
   page). A slot is either null (empty pocket) or
   a card lookup { name, setId, holo }. Slots can
   be filled in ANY order — leaving gaps is normal,
   exactly like a real binder page you're still
   building out.
   ============================================ */

const PAGES = [
  {
    title: "KANTO · GEN 1",
    slots: [
      { name: "Charizard", setId: "base1", holo: true },
      null,
      { name: "Blastoise", setId: "base1", holo: true },
      null,
      { name: "Venusaur", setId: "base1", holo: true },
      null,
      { name: "Pikachu", setId: "base1", holo: false },
      null,
      { name: "Mewtwo", setId: "base1", holo: true },
    ]
  },
  {
    title: "KANTO · GEN 1",
    slots: [null, null, null, null, null, null, null, null, null]
  },
];

/* ============================================
   POKÉMON TCG API
   Free, no key required for light/personal use.
   https://docs.pokemontcg.io
   ============================================ */
const API_BASE = "https://api.pokemontcg.io/v2/cards";
const cardCache = {}; // "name|setId" -> resolved card data (or null if not found)

async function fetchCard(name, setId){
  const key = `${name}|${setId}`;
  if(key in cardCache) return cardCache[key];

  try{
    const q = encodeURIComponent(`name:"${name}" set.id:${setId}`);
    const res = await fetch(`${API_BASE}?q=${q}&pageSize=1`);
    if(!res.ok) throw new Error("API error " + res.status);
    const json = await res.json();
    const card = (json.data && json.data[0]) || null;
    cardCache[key] = card;
    return card;
  }catch(err){
    console.error("Couldn't fetch card:", name, err);
    cardCache[key] = null;
    return null;
  }
}

/* Resolves every named slot on every page into real card data up front,
   so page navigation afterward is instant with no loading flicker. */
async function preloadAllCards(){
  const lookups = [];
  PAGES.forEach(page => {
    page.slots.forEach(slot => {
      if(slot) lookups.push(fetchCard(slot.name, slot.setId));
    });
  });
  await Promise.all(lookups);
}

/* ============================================
   RENDERING
   ============================================ */
let currentPage = 0;

function renderPage(){
  const grid = document.getElementById("pocketGrid");
  const page = PAGES[currentPage];
  grid.innerHTML = "";

  page.slots.forEach(slot => {
    const pocket = document.createElement("div");

    if(!slot){
      pocket.className = "pocket empty";
      grid.appendChild(pocket);
      return;
    }

    const card = cardCache[`${slot.name}|${slot.setId}`];
    if(!card){
      // lookup failed — treat as empty rather than showing a broken image
      pocket.className = "pocket empty";
      grid.appendChild(pocket);
      return;
    }

    pocket.className = "pocket filled" + (slot.holo ? " holo" : "");
    pocket.innerHTML = `<img src="${card.images.small}" alt="${card.name}">`;
    pocket.addEventListener("click", () => openDetail(card));
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
document.addEventListener("keydown", (e) => {
  if(e.key === "Escape") closeDetail();
});

/* ============================================
   INIT
   ============================================ */
(async function init(){
  document.getElementById("pageIndicator").textContent = "LOADING…";
  await preloadAllCards();
  renderPage();
})();
