/* =================================================================
   Pokédex App — app.js
   Fetches first 100 Pokémon from PokeAPI, renders interactive grid.
   Clicking a card opens a TCG-style detail modal with lazy-fetched
   species data, move details, and phonetic pronunciation.
   ================================================================= */

'use strict';

// -----------------------------------------------------------------
// Constants
// -----------------------------------------------------------------

const POKEAPI_BASE  = 'https://pokeapi.co/api/v2';
const ARTWORK_URL   = (id) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
const SPRITE_URL    = (id) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;

const MAX_STAT = 255;

const STAT_KEY_MAP = {
  'hp':               'hp',
  'attack':           'attack',
  'defense':          'defense',
  'special-attack':   'specialAttack',
  'special-defense':  'specialDefense',
  'speed':            'speed',
};

const STAT_DISPLAY = [
  { key: 'hp',           label: 'HP'  },
  { key: 'attack',       label: 'ATK' },
  { key: 'defense',      label: 'DEF' },
  { key: 'specialAttack',  label: 'SpA' },
  { key: 'specialDefense', label: 'SpD' },
  { key: 'speed',        label: 'SPD' },
];

const SORT_FUNCTIONS = {
  'id':        (a, b) => a.id - b.id,
  'name-asc':  (a, b) => a.name.localeCompare(b.name),
  'name-desc': (a, b) => b.name.localeCompare(a.name),
  'hp':        (a, b) => b.stats.hp        - a.stats.hp,
  'attack':    (a, b) => b.stats.attack    - a.stats.attack,
  'defense':   (a, b) => b.stats.defense   - a.stats.defense,
  'speed':     (a, b) => b.stats.speed     - a.stats.speed,
};

const STAGE_LABELS = { 1: 'Basic', 2: 'Stage 1', 3: 'Stage 2' };

// -----------------------------------------------------------------
// State
// -----------------------------------------------------------------

const state = {
  allPokemon:      [],
  filteredPokemon: [],
  battlePool:      [], // all gens, used exclusively by battle — populated after init
  filters: {
    types:       new Set(),
    stages:      new Set(),
    generations: new Set([1]),
  },
  sort: 'id',
};

// Cache for lazily-fetched TCG card data (species + moves)
const cardDataCache = new Map();

// Per-pokemon cache (avoids re-fetching when toggling generations)
const pokemonCache        = new Map(); // id → normalized pokemon
const evolutionStageCache = new Map(); // id → stage number (1|2|3)
const evolutionChainCache = new Map(); // chainId → raw chain JSON

// -----------------------------------------------------------------
// DOM refs
// -----------------------------------------------------------------

let grid, resultsCount, loadingScreen, loadProgress, loadProgressFill;
let cardModal, tcgCardInner, modalNavPrev, modalNavNext;

// Index into state.filteredPokemon for the currently open modal card
let currentModalIndex = -1;

// -----------------------------------------------------------------
// Data fetching — initial load
// -----------------------------------------------------------------

let loadedCount  = 0;
let totalToFetch = 0;

function updateProgress() {
  loadedCount++;
  loadProgress.textContent     = `Catching Pokémon… ${loadedCount} / ${totalToFetch}`;
  loadProgressFill.style.width = `${Math.min(100, (loadedCount / totalToFetch) * 100)}%`;
}

function normalizeMoves(rawMoves, genNum) {
  // Pick up to 2 level-up moves from the preferred version group for this gen,
  // sorted by the level at which they are learned.
  const preferred = VERSION_GROUPS_FOR_GEN[genNum] || ['red-blue'];
  const lvlUpMoves = rawMoves
    .filter(m => m.version_group_details.some(
      vg => preferred.includes(vg.version_group.name) &&
            vg.move_learn_method.name === 'level-up'
    ))
    .map(m => {
      const vgd = m.version_group_details.find(
        vg => preferred.includes(vg.version_group.name) &&
              vg.move_learn_method.name === 'level-up'
      );
      return { name: m.move.name, level: vgd.level_learned_at };
    })
    .sort((a, b) => a.level - b.level)
    .slice(0, 2);

  // Fallback: if no Red/Blue level-up moves found, take first 2 level-up moves from any version
  if (lvlUpMoves.length === 0) {
    return rawMoves
      .filter(m => m.version_group_details.some(
        vg => vg.move_learn_method.name === 'level-up'
      ))
      .map(m => {
        const vgd = m.version_group_details.find(
          vg => vg.move_learn_method.name === 'level-up'
        );
        return { name: m.move.name, level: vgd.level_learned_at };
      })
      .sort((a, b) => a.level - b.level)
      .slice(0, 2);
  }

  return lvlUpMoves;
}

function normalizeApiResponse(raw, genNum) {
  const stats = {};
  raw.stats.forEach(({ base_stat, stat }) => {
    const key = STAT_KEY_MAP[stat.name];
    if (key) stats[key] = base_stat;
  });

  const types = raw.types.map(t => t.type.name);

  const displayName = DISPLAY_NAME_OVERRIDES[raw.name]
    || raw.name
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

  return {
    id:           raw.id,
    name:         raw.name,
    displayName,
    imageUrl:     ARTWORK_URL(raw.id),
    fallbackUrl:  SPRITE_URL(raw.id),
    types,
    stats,
    height:       raw.height,   // decimetres
    weight:       raw.weight,   // hectograms
    gen:          genNum,
    // Gen 1 uses static table; other gens resolved asynchronously via evolution chain API
    stage:        genNum === 1 ? (EVOLUTION_STAGES[raw.id] || 1) : null,
    levelUpMoves: normalizeMoves(raw.moves, genNum),
  };
}

async function fetchOnePokemon(id) {
  if (pokemonCache.has(id)) {
    updateProgress();
    return pokemonCache.get(id);
  }
  const res = await fetch(`${POKEAPI_BASE}/pokemon/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for id ${id}`);
  const data = await res.json();
  const genNum = getGenForId(id);
  const normalized = normalizeApiResponse(data, genNum);
  pokemonCache.set(id, normalized);
  updateProgress();
  return normalized;
}

async function fetchGenerationPokemon(genNum) {
  const { start, end } = GENERATIONS[genNum];
  const ids = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  const results = await Promise.allSettled(ids.map(fetchOnePokemon));
  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);
}

async function fetchSelectedGenerations() {
  const gens = [...state.filters.generations].sort((a, b) => a - b);
  totalToFetch = gens.reduce((sum, g) => sum + (GENERATIONS[g].end - GENERATIONS[g].start + 1), 0);
  loadedCount = 0;
  const arrays = await Promise.all(gens.map(fetchGenerationPokemon));
  return arrays.flat().sort((a, b) => a.id - b.id);
}

// -----------------------------------------------------------------
// Evolution stage resolution (gens 2–9)
// -----------------------------------------------------------------

// Recursive DFS: caches every species ID in the chain at its stage depth
function walkChain(node, depth) {
  if (!node) return;
  const speciesId = Number(node.species.url.split('/').filter(Boolean).pop());
  evolutionStageCache.set(speciesId, depth);
  if (node.evolves_to?.length > 0) {
    node.evolves_to.forEach(child => walkChain(child, depth + 1));
  }
}

async function resolveEvolutionStage(id) {
  if (evolutionStageCache.has(id)) return evolutionStageCache.get(id);
  // Gen 1 static fallback
  if (EVOLUTION_STAGES[id] !== undefined) {
    evolutionStageCache.set(id, EVOLUTION_STAGES[id]);
    return EVOLUTION_STAGES[id];
  }
  try {
    const speciesRes = await fetch(`${POKEAPI_BASE}/pokemon-species/${id}`);
    if (!speciesRes.ok) throw new Error(`Species ${id} HTTP ${speciesRes.status}`);
    const speciesData = await speciesRes.json();
    const chainUrl = speciesData.evolution_chain?.url;
    if (!chainUrl) { evolutionStageCache.set(id, 1); return 1; }
    const chainId = Number(chainUrl.split('/').filter(Boolean).pop());
    if (!evolutionChainCache.has(chainId)) {
      const chainRes = await fetch(`${POKEAPI_BASE}/evolution-chain/${chainId}`);
      if (!chainRes.ok) throw new Error(`Chain ${chainId} HTTP ${chainRes.status}`);
      evolutionChainCache.set(chainId, await chainRes.json());
    }
    walkChain(evolutionChainCache.get(chainId).chain, 1);
    return evolutionStageCache.get(id) ?? 1;
  } catch (err) {
    console.warn(`Could not resolve evolution stage for #${id}:`, err);
    evolutionStageCache.set(id, 1);
    return 1;
  }
}

async function prefetchEvolutionStages(pokemonList) {
  const batchSize = 10;
  const unresolved = pokemonList.filter(p => p.stage === null);
  for (let i = 0; i < unresolved.length; i += batchSize) {
    const batch = unresolved.slice(i, i + batchSize);
    await Promise.allSettled(batch.map(p => resolveEvolutionStage(p.id)));
    batch.forEach(p => {
      const stage = evolutionStageCache.get(p.id) ?? 1;
      p.stage = stage;
      if (pokemonCache.has(p.id)) pokemonCache.get(p.id).stage = stage;
    });
  }
  if (unresolved.length > 0) render();
}

// -----------------------------------------------------------------
// Data fetching — lazy (per card)
// -----------------------------------------------------------------

async function fetchCardData(pokemon) {
  if (cardDataCache.has(pokemon.id)) return cardDataCache.get(pokemon.id);

  const fetches = [
    fetch(`${POKEAPI_BASE}/pokemon-species/${pokemon.id}`)
      .then(r => r.json()).catch(() => null),
    ...pokemon.levelUpMoves.map(m =>
      fetch(`${POKEAPI_BASE}/move/${m.name}`)
        .then(r => r.json()).catch(() => null)
    ),
  ];

  const [speciesData, ...moveDataArr] = await Promise.all(fetches);

  // Flavor text — prefer this gen's version; fall back to any English entry
  const genVersions = GENERATIONS[pokemon.gen]?.versions || ['red', 'blue'];
  const flavorEntry =
    speciesData?.flavor_text_entries?.find(
      e => e.language.name === 'en' && genVersions.includes(e.version.name)
    ) ||
    speciesData?.flavor_text_entries?.find(e => e.language.name === 'en');
  const flavorText = flavorEntry?.flavor_text
    ?.replace(/[\f\n\r]/g, ' ').replace(/\s+/g, ' ').trim() || '';

  // Piggyback evolution stage resolution for non-Gen-1 Pokémon
  if (pokemon.stage === null && speciesData?.evolution_chain?.url) {
    const chainId = Number(speciesData.evolution_chain.url.split('/').filter(Boolean).pop());
    if (!evolutionChainCache.has(chainId)) {
      try {
        const chainRes = await fetch(`${POKEAPI_BASE}/evolution-chain/${chainId}`);
        if (chainRes.ok) evolutionChainCache.set(chainId, await chainRes.json());
      } catch (_) { /* ignore */ }
    }
    if (evolutionChainCache.has(chainId)) {
      walkChain(evolutionChainCache.get(chainId).chain, 1);
    }
    const stage = evolutionStageCache.get(pokemon.id) ?? 1;
    pokemon.stage = stage;
    if (pokemonCache.has(pokemon.id)) pokemonCache.get(pokemon.id).stage = stage;
  }

  // Genus (e.g. "Seed Pokémon")
  const genus = speciesData?.genera
    ?.find(g => g.language.name === 'en')?.genus || '';

  // Move details
  const moves = pokemon.levelUpMoves.map((m, i) => {
    const md = moveDataArr[i];
    const rawName = m.name.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
    return {
      name:        rawName,
      power:       md?.power  ?? null,
      pp:          md?.pp     ?? null,
      type:        md?.type?.name || pokemon.types[0],
      shortEffect: md?.effect_entries?.find(e => e.language.name === 'en')?.short_effect
                   ?.replace(/\$effect_chance%/g, `${md?.effect_chance ?? ''}%`)
                   || '',
    };
  });

  const data = { flavorText, genus, moves };
  cardDataCache.set(pokemon.id, data);
  return data;
}

// -----------------------------------------------------------------
// Filter & Sort
// -----------------------------------------------------------------

function applyFiltersAndSort() {
  let result = [...state.allPokemon];

  if (state.filters.types.size > 0) {
    result = result.filter(p => p.types.some(t => state.filters.types.has(t)));
  }

  if (state.filters.stages.size > 0) {
    result = result.filter(p => state.filters.stages.has(p.stage));
  }

  result.sort(SORT_FUNCTIONS[state.sort] || SORT_FUNCTIONS['id']);
  state.filteredPokemon = result;
}

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

function padId(id) {
  return '#' + String(id).padStart(3, '0');
}

function typeColor(typeName) {
  return `var(--color-${typeName}, #6677aa)`;
}

function energyColor(typeName) {
  return ENERGY_COLORS[typeName] || ENERGY_COLORS.normal;
}

function fmtHeight(dm)  { return `${(dm / 10).toFixed(1)} m`; }
function fmtWeight(hg)  { return `${(hg / 10).toFixed(1)} kg`; }

// Convert "BUL-ba-sore" → "bul ba sore" for SpeechSynthesis
// (avoids TTS reading hyphens aloud and ALL-CAPS as acronyms)
function toSpeakable(phonetic) {
  return phonetic.toLowerCase().replace(/-/g, ' ');
}

// Derive a syllabic phonetic from a display name when no static entry exists.
// Splits at consonant+vowel boundaries (y treated as vowel), uppercases first syllable.
// e.g. "Chikorita" → "CHI-ko-ri-ta", "Meganium" → "ME-ga-ni-um"
function derivePhonetic(displayName) {
  const name = displayName.replace(/[^a-zA-Z]/g, '');
  const syllables = name.match(/[^aeiouy]*[aeiouy]+/gi) || [];
  const consumed  = syllables.reduce((n, s) => n + s.length, 0);
  if (consumed < name.length && syllables.length > 0) {
    syllables[syllables.length - 1] += name.slice(consumed);
  }
  if (syllables.length === 0) return displayName.toUpperCase();
  return syllables.map((s, i) => i === 0 ? s.toUpperCase() : s.toLowerCase()).join('-');
}

// -----------------------------------------------------------------
// Speech synthesis
// -----------------------------------------------------------------

function speakPokemon(id) {
  if (!window.speechSynthesis) return;
  const pokemon  = state.allPokemon.find(p => p.id === id);
  const phonetic = PHONETIC_PRONUNCIATIONS[id] || (pokemon ? derivePhonetic(pokemon.displayName) : '');
  const text     = phonetic ? toSpeakable(phonetic) : pokemon?.displayName || '';
  if (!text) return;
  window.speechSynthesis.cancel();
  const utt  = new SpeechSynthesisUtterance(text);
  utt.lang   = 'en-US';
  utt.rate   = 0.82;
  utt.pitch  = 1.0;
  window.speechSynthesis.speak(utt);
}

// -----------------------------------------------------------------
// Grid card builder
// -----------------------------------------------------------------

function buildCard(p) {
  const primaryType = p.types[0] || 'normal';
  const accent      = typeColor(primaryType);

  const article = document.createElement('article');
  article.className = 'pokemon-card';
  article.setAttribute('role', 'listitem');
  article.tabIndex = 0;
  article.dataset.id = p.id;
  article.style.setProperty('--card-accent', accent);
  article.setAttribute('aria-label', `${p.displayName} — press Enter to view full card`);

  // Card top
  const cardTop = document.createElement('div');
  cardTop.className = 'card-top';

  const numSpan = document.createElement('span');
  numSpan.className   = 'pokemon-number';
  numSpan.textContent = padId(p.id);
  numSpan.setAttribute('aria-label', `Pokédex number ${p.id}`);

  const img = document.createElement('img');
  img.src       = p.imageUrl;
  img.alt       = p.displayName;
  img.className = 'pokemon-image';
  img.loading   = 'lazy';
  img.width     = 96;
  img.height    = 96;
  img.addEventListener('error', () => {
    if (img.src !== p.fallbackUrl) img.src = p.fallbackUrl;
    else img.classList.add('img-error');
  });

  cardTop.appendChild(numSpan);
  cardTop.appendChild(img);

  // Card bottom
  const cardBottom = document.createElement('div');
  cardBottom.className = 'card-bottom';

  // Name button (TTS only — stops propagation so it doesn't open the modal)
  const nameBtn = document.createElement('button');
  nameBtn.className = 'pokemon-name';
  nameBtn.dataset.id = p.id;
  nameBtn.setAttribute('aria-label', `Pronounce ${p.displayName}`);
  nameBtn.setAttribute('title', 'Click to hear pronunciation');

  const nameText = document.createElement('span');
  nameText.textContent = p.displayName;

  const speakIcon = document.createElement('span');
  speakIcon.className   = 'speak-icon';
  speakIcon.textContent = '🔊';
  speakIcon.setAttribute('aria-hidden', 'true');

  nameBtn.appendChild(nameText);
  nameBtn.appendChild(speakIcon);

  // Type badges
  const typeBadges = document.createElement('div');
  typeBadges.className = 'type-badges';
  p.types.forEach(type => {
    const badge = document.createElement('span');
    badge.className        = 'type-badge';
    badge.textContent      = type;
    badge.style.background = typeColor(type);
    badge.setAttribute('aria-label', `${type} type`);
    typeBadges.appendChild(badge);
  });

  // HP stat bar
  const statRow = buildGridStatRow('HP', p.stats.hp, accent);

  cardBottom.appendChild(nameBtn);
  cardBottom.appendChild(typeBadges);
  cardBottom.appendChild(statRow);

  article.appendChild(cardTop);
  article.appendChild(cardBottom);

  return article;
}

function buildGridStatRow(label, value, accentColor) {
  const row = document.createElement('div');
  row.className = 'stat-row';

  const labelEl = document.createElement('span');
  labelEl.className   = 'stat-label';
  labelEl.textContent = label;
  labelEl.setAttribute('aria-hidden', 'true');

  const track = document.createElement('div');
  track.className = 'stat-track';

  const fill = document.createElement('div');
  fill.className        = 'stat-fill';
  fill.style.width      = `${Math.min(100, (value / MAX_STAT) * 100)}%`;
  fill.style.background = accentColor;
  track.appendChild(fill);

  const valueEl = document.createElement('span');
  valueEl.className   = 'stat-value';
  valueEl.textContent = value;
  valueEl.setAttribute('aria-label', `${label} ${value}`);

  row.appendChild(labelEl);
  row.appendChild(track);
  row.appendChild(valueEl);
  return row;
}

// -----------------------------------------------------------------
// Render grid
// -----------------------------------------------------------------

function render() {
  applyFiltersAndSort();

  const fragment = document.createDocumentFragment();

  if (state.filteredPokemon.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'no-results';
    empty.innerHTML = '<strong>No Pokémon found</strong>Try adjusting your filters.';
    fragment.appendChild(empty);
  } else {
    state.filteredPokemon.forEach(p => fragment.appendChild(buildCard(p)));
  }

  grid.innerHTML = '';
  grid.appendChild(fragment);
  resultsCount.textContent = state.filteredPokemon.length;
}

// -----------------------------------------------------------------
// TCG Card builder
// -----------------------------------------------------------------

function buildEnergyDot(typeName) {
  const dot = document.createElement('span');
  dot.className        = 'energy-dot';
  dot.style.background = energyColor(typeName);
  dot.setAttribute('aria-label', `${typeName} energy`);
  return dot;
}

function buildTcgSkeletonCard() {
  const card = document.createElement('div');
  card.className = 'tcg-card tcg-skeleton';
  card.style.setProperty('--tc-light', '#e8e8e8');
  card.style.setProperty('--tc-mid',   '#cccccc');
  card.style.setProperty('--tc-border','#999999');
  card.innerHTML = `
    <div class="skeleton-line" style="width:70%"></div>
    <div class="skeleton-block" style="height:158px;margin-bottom:8px"></div>
    <div class="skeleton-line" style="width:50%"></div>
    <div class="skeleton-line" style="width:80%"></div>
    <div class="skeleton-line" style="width:40%"></div>
  `;
  return card;
}

function buildTcgCard(pokemon, extraData) {
  const primaryType = pokemon.types[0] || 'normal';
  const colors      = TYPE_CARD_COLORS[primaryType] || TYPE_CARD_COLORS.normal;
  const phonetic    = PHONETIC_PRONUNCIATIONS[pokemon.id] || derivePhonetic(pokemon.displayName);
  const weakness    = TYPE_WEAKNESS[primaryType]  || null;
  const resistance  = TYPE_RESISTANCE[primaryType] || null;
  const retreatCost = TYPE_RETREAT_COST[primaryType] ?? 1;

  const card = document.createElement('div');
  card.className = 'tcg-card';
  card.style.setProperty('--tc-light',  colors.light);
  card.style.setProperty('--tc-mid',    colors.mid);
  card.style.setProperty('--tc-border', colors.border);
  card.style.setProperty('--tc-art-bg', colors.artBg);

  // ── Header ──────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'tcg-header';

  const stageBadge = document.createElement('span');
  stageBadge.className   = 'tcg-stage-badge';
  stageBadge.textContent = STAGE_LABELS[pokemon.stage] || 'Basic';

  const nameBtn = document.createElement('button');
  nameBtn.className = 'tcg-name-btn';
  nameBtn.dataset.id = pokemon.id;
  nameBtn.setAttribute('aria-label', `Pronounce ${pokemon.displayName}`);
  nameBtn.setAttribute('title', 'Click to hear pronunciation');

  const nameText = document.createElement('div');
  const nameSpan = document.createElement('span');
  nameSpan.textContent = pokemon.displayName;
  const phoneticSpan = document.createElement('span');
  phoneticSpan.className   = 'tcg-phonetic';
  phoneticSpan.textContent = phonetic;
  nameText.appendChild(nameSpan);
  nameText.appendChild(phoneticSpan);

  const speakIcon = document.createElement('span');
  speakIcon.className   = 'tcg-speak-icon';
  speakIcon.textContent = '🔊';
  speakIcon.setAttribute('aria-hidden', 'true');

  nameBtn.appendChild(nameText);
  nameBtn.appendChild(speakIcon);

  const hpBlock = document.createElement('div');
  hpBlock.className = 'tcg-hp-block';

  const hpLabel = document.createElement('span');
  hpLabel.className   = 'tcg-hp-label';
  hpLabel.textContent = 'HP';

  const hpValue = document.createElement('span');
  hpValue.className   = 'tcg-hp-value';
  hpValue.textContent = pokemon.stats.hp;

  const typeEnergyIcon = document.createElement('span');
  typeEnergyIcon.className        = 'tcg-type-energy';
  typeEnergyIcon.style.background = energyColor(primaryType);
  typeEnergyIcon.setAttribute('aria-label', `${primaryType} type`);

  hpBlock.appendChild(hpLabel);
  hpBlock.appendChild(hpValue);
  hpBlock.appendChild(typeEnergyIcon);

  header.appendChild(stageBadge);
  header.appendChild(nameBtn);
  header.appendChild(hpBlock);

  // ── Artwork ──────────────────────────────────────────────────────
  const artFrame = document.createElement('div');
  artFrame.className = 'tcg-artwork-frame';

  const artImg = document.createElement('img');
  artImg.src     = pokemon.imageUrl;
  artImg.alt     = pokemon.displayName;
  artImg.width   = 136;
  artImg.height  = 136;
  artImg.addEventListener('error', () => {
    if (artImg.src !== pokemon.fallbackUrl) artImg.src = pokemon.fallbackUrl;
  });

  artFrame.appendChild(artImg);

  // ── Species strip ────────────────────────────────────────────────
  const strip = document.createElement('div');
  strip.className = 'tcg-species-strip';

  const genusSp = document.createElement('span');
  genusSp.className   = 'tcg-genus';
  genusSp.textContent = extraData.genus || '—';

  const dimsSp = document.createElement('span');
  dimsSp.className   = 'tcg-dims';
  dimsSp.textContent = `Ht: ${fmtHeight(pokemon.height)} · Wt: ${fmtWeight(pokemon.weight)}`;

  const typeBadges = document.createElement('div');
  typeBadges.className = 'tcg-type-badges';
  pokemon.types.forEach(type => {
    const badge = document.createElement('span');
    badge.className        = 'tcg-type-badge';
    badge.textContent      = type;
    badge.style.background = typeColor(type);
    typeBadges.appendChild(badge);
  });

  strip.appendChild(genusSp);
  strip.appendChild(dimsSp);
  strip.appendChild(typeBadges);

  // ── Attacks ──────────────────────────────────────────────────────
  const attacksEl = document.createElement('div');
  attacksEl.className = 'tcg-attacks';

  if (extraData.moves.length === 0) {
    const noMove = document.createElement('div');
    noMove.className = 'tcg-attack';
    noMove.style.justifyContent = 'center';
    noMove.style.color = '#666';
    noMove.style.fontSize = '0.7rem';
    noMove.textContent = 'Move data unavailable';
    attacksEl.appendChild(noMove);
  } else {
    extraData.moves.forEach(move => {
      const atk = document.createElement('div');
      atk.className = 'tcg-attack';

      const cost = document.createElement('div');
      cost.className = 'tcg-attack-cost';
      // Show 1 energy dot of the move's type (simplified TCG cost)
      cost.appendChild(buildEnergyDot(move.type));

      const body = document.createElement('div');
      body.className = 'tcg-attack-body';

      const atkName = document.createElement('div');
      atkName.className   = 'tcg-attack-name';
      atkName.textContent = move.name;

      const atkEffect = document.createElement('div');
      atkEffect.className   = 'tcg-attack-effect';
      atkEffect.textContent = move.shortEffect || (move.power ? `Deals ${move.power} damage.` : 'No damage.');

      body.appendChild(atkName);
      body.appendChild(atkEffect);

      const dmg = document.createElement('div');
      dmg.className   = 'tcg-attack-damage';
      dmg.textContent = move.power != null ? String(move.power) : '—';

      atk.appendChild(cost);
      atk.appendChild(body);
      atk.appendChild(dmg);
      attacksEl.appendChild(atk);
    });
  }

  // ── Base Stats ───────────────────────────────────────────────────
  const statsSection = document.createElement('div');
  statsSection.className = 'tcg-stats-section';

  const statsTitle = document.createElement('div');
  statsTitle.className   = 'tcg-stats-title';
  statsTitle.textContent = 'Base Stats';
  statsSection.appendChild(statsTitle);

  STAT_DISPLAY.forEach(({ key, label }) => {
    const val  = pokemon.stats[key] ?? 0;
    const row  = document.createElement('div');
    row.className = 'tcg-stat-row';

    const lbl = document.createElement('span');
    lbl.className   = 'tcg-stat-label';
    lbl.textContent = label;

    const track = document.createElement('div');
    track.className = 'tcg-stat-track';
    const fill = document.createElement('div');
    fill.className      = 'tcg-stat-fill';
    fill.style.width    = `${Math.min(100, (val / MAX_STAT) * 100)}%`;
    fill.style.background = colors.border;
    track.appendChild(fill);

    const valEl = document.createElement('span');
    valEl.className   = 'tcg-stat-value';
    valEl.textContent = val;

    row.appendChild(lbl);
    row.appendChild(track);
    row.appendChild(valEl);
    statsSection.appendChild(row);
  });

  // ── Footer (weakness / resistance / retreat) ─────────────────────
  const footer = document.createElement('div');
  footer.className = 'tcg-footer';

  // Weakness
  const weakItem = document.createElement('div');
  weakItem.className = 'tcg-footer-item';
  const weakLabel = document.createElement('span');
  weakLabel.className   = 'tcg-footer-label';
  weakLabel.textContent = 'Weakness';
  weakItem.appendChild(weakLabel);
  if (weakness) {
    const dot = document.createElement('span');
    dot.className        = 'tcg-footer-dot';
    dot.style.background = energyColor(weakness);
    dot.setAttribute('title', weakness);
    const mod = document.createElement('span');
    mod.className   = 'tcg-footer-modifier';
    mod.textContent = '×2';
    weakItem.appendChild(dot);
    weakItem.appendChild(mod);
  } else {
    const none = document.createElement('span');
    none.className   = 'tcg-footer-modifier';
    none.textContent = '—';
    weakItem.appendChild(none);
  }

  // Resistance
  const resItem = document.createElement('div');
  resItem.className = 'tcg-footer-item';
  const resLabel = document.createElement('span');
  resLabel.className   = 'tcg-footer-label';
  resLabel.textContent = 'Resistance';
  resItem.appendChild(resLabel);
  if (resistance) {
    const dot = document.createElement('span');
    dot.className        = 'tcg-footer-dot';
    dot.style.background = energyColor(resistance);
    dot.setAttribute('title', resistance);
    const mod = document.createElement('span');
    mod.className   = 'tcg-footer-modifier';
    mod.textContent = '-30';
    resItem.appendChild(dot);
    resItem.appendChild(mod);
  } else {
    const none = document.createElement('span');
    none.className   = 'tcg-footer-modifier';
    none.textContent = '—';
    resItem.appendChild(none);
  }

  // Retreat cost
  const retItem = document.createElement('div');
  retItem.className = 'tcg-footer-item';
  const retLabel = document.createElement('span');
  retLabel.className   = 'tcg-footer-label';
  retLabel.textContent = 'Retreat';
  retItem.appendChild(retLabel);

  if (retreatCost === 0) {
    const none = document.createElement('span');
    none.className   = 'tcg-footer-modifier';
    none.textContent = 'Free';
    retItem.appendChild(none);
  } else {
    const dotsRow = document.createElement('div');
    dotsRow.style.display = 'flex';
    dotsRow.style.gap     = '2px';
    for (let i = 0; i < retreatCost; i++) {
      const dot = document.createElement('span');
      dot.className        = 'tcg-footer-dot';
      dot.style.background = energyColor('normal');
      dotsRow.appendChild(dot);
    }
    retItem.appendChild(dotsRow);
  }

  footer.appendChild(weakItem);
  footer.appendChild(resItem);
  footer.appendChild(retItem);

  // ── Flavor text ──────────────────────────────────────────────────
  const flavor = document.createElement('div');
  flavor.className   = 'tcg-flavor';
  flavor.textContent = extraData.flavorText || 'No Pokédex entry available.';

  // ── Card number ──────────────────────────────────────────────────
  const cardNum = document.createElement('div');
  cardNum.className = 'tcg-card-number';
  const numLeft = document.createElement('span');
  const genData      = GENERATIONS[pokemon.gen || getGenForId(pokemon.id)];
  const withinGenNum = pokemon.id - genData.start + 1;
  const genTotal     = genData.end - genData.start + 1;
  numLeft.textContent = `${padId(withinGenNum)}/${genTotal}`;
  const numRight = document.createElement('span');
  numRight.textContent = genData.gameLabel;
  cardNum.appendChild(numLeft);
  cardNum.appendChild(numRight);

  // ── Assemble ─────────────────────────────────────────────────────
  card.appendChild(header);
  card.appendChild(artFrame);
  card.appendChild(strip);
  card.appendChild(attacksEl);
  card.appendChild(statsSection);
  card.appendChild(footer);
  card.appendChild(flavor);
  card.appendChild(cardNum);

  return card;
}

// -----------------------------------------------------------------
// Modal open / close
// -----------------------------------------------------------------

function updateNavButtons() {
  modalNavPrev.disabled = currentModalIndex <= 0;
  modalNavNext.disabled = currentModalIndex >= state.filteredPokemon.length - 1;
}

function openModal(pokemon) {
  // Track position in the filtered list for arrow navigation
  currentModalIndex = state.filteredPokemon.findIndex(p => p.id === pokemon.id);

  // Show skeleton immediately
  tcgCardInner.innerHTML = '';
  tcgCardInner.appendChild(buildTcgSkeletonCard());

  cardModal.hidden = false;
  document.body.style.overflow = 'hidden';
  updateNavButtons();

  // Scroll card back to top on each navigation
  tcgCardInner.scrollTop = 0;

  // TTS for the pokemon name on open
  speakPokemon(pokemon.id);

  // Fetch extra data, then replace skeleton with real card
  fetchCardData(pokemon).then(extraData => {
    tcgCardInner.innerHTML = '';
    const card = buildTcgCard(pokemon, extraData);
    card.querySelector('.tcg-name-btn').addEventListener('click', e => {
      e.stopPropagation();
      speakPokemon(pokemon.id);
    });
    tcgCardInner.appendChild(card);
  }).catch(err => {
    console.error('Failed to load card data:', err);
    tcgCardInner.innerHTML = '';
    const card = buildTcgCard(pokemon, { flavorText: '', genus: '', moves: [] });
    card.querySelector('.tcg-name-btn').addEventListener('click', e => {
      e.stopPropagation();
      speakPokemon(pokemon.id);
    });
    tcgCardInner.appendChild(card);
  });
}

function navigateModal(delta) {
  const nextIndex = currentModalIndex + delta;
  if (nextIndex < 0 || nextIndex >= state.filteredPokemon.length) return;
  openModal(state.filteredPokemon[nextIndex]);
}

function closeModal() {
  cardModal.hidden = true;
  currentModalIndex = -1;
  document.body.style.overflow = '';
  window.speechSynthesis?.cancel();
}

// -----------------------------------------------------------------
// Generation helpers
// -----------------------------------------------------------------

function updateHeaderSubtitle() {
  const el = document.querySelector('.site-header .subtitle');
  if (!el) return;
  const selected = [...state.filters.generations].sort((a, b) => a - b);
  if (selected.length === 0) {
    el.textContent = 'No Generation Selected';
    return;
  }
  if (selected.length === 9) {
    el.textContent = 'All Generations · #001 – #1025';
    return;
  }
  const labels = selected.map(g => GENERATIONS[g].label).join(', ');
  if (selected.length === 1) {
    const g = GENERATIONS[selected[0]];
    el.textContent = `${labels} · #${String(g.start).padStart(3, '0')} – #${String(g.end).padStart(3, '0')}`;
  } else {
    el.textContent = labels;
  }
}

async function reloadForSelectedGenerations() {
  const hasUncached = [...state.filters.generations].some(gen => {
    const g = GENERATIONS[gen];
    for (let id = g.start; id <= g.end; id++) {
      if (!pokemonCache.has(id)) return true;
    }
    return false;
  });

  if (hasUncached) {
    loadingScreen.style.display = '';
    loadingScreen.classList.remove('fade-out');
    loadProgress.textContent = 'Catching Pokémon…';
    loadProgressFill.style.width = '0%';
  }

  try {
    state.allPokemon = await fetchSelectedGenerations();
  } catch (err) {
    console.error('Failed to fetch generation data:', err);
    return;
  }

  if (hasUncached) hideLoadingScreen();

  // Reset type filter (may differ across gens) but leave stage filter intact
  state.filters.types.clear();
  document.querySelectorAll('.type-checkbox').forEach(cb => { cb.checked = false; });

  updateHeaderSubtitle();
  buildTypeFilters();
  render();

  prefetchEvolutionStages(state.allPokemon);
}

// -----------------------------------------------------------------
// Type filter builder
// -----------------------------------------------------------------

function buildTypeFilters() {
  const types  = new Set();
  state.allPokemon.forEach(p => p.types.forEach(t => types.add(t)));
  const sorted = [...types].sort();

  const container = document.getElementById('type-filter-list');
  container.innerHTML = '';

  sorted.forEach(type => {
    const label = document.createElement('label');
    label.className = 'type-filter-label';

    const cb = document.createElement('input');
    cb.type      = 'checkbox';
    cb.className = 'type-checkbox';
    cb.value     = type;
    cb.setAttribute('aria-label', `Filter by ${type} type`);

    const pill = document.createElement('span');
    pill.className        = 'type-pill';
    pill.textContent      = type;
    pill.style.background = typeColor(type);

    label.appendChild(cb);
    label.appendChild(pill);
    container.appendChild(label);

    cb.addEventListener('change', () => {
      if (cb.checked) state.filters.types.add(type);
      else            state.filters.types.delete(type);
      render();
    });
  });
}

// -----------------------------------------------------------------
// Event wiring
// -----------------------------------------------------------------

function wireEvents() {
  // Sort
  document.getElementById('sort-select').addEventListener('change', e => {
    state.sort = e.target.value;
    render();
  });

  // Stage checkboxes
  document.querySelectorAll('.stage-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const val = Number(cb.value);
      if (cb.checked) state.filters.stages.add(val);
      else            state.filters.stages.delete(val);
      render();
    });
  });

  // Generation checkboxes
  document.querySelectorAll('.gen-checkbox').forEach(cb => {
    cb.addEventListener('change', async () => {
      const val = Number(cb.value);
      if (cb.checked) state.filters.generations.add(val);
      else            state.filters.generations.delete(val);
      // Prevent deselecting all generations
      if (state.filters.generations.size === 0) {
        cb.checked = true;
        state.filters.generations.add(val);
        return;
      }
      await reloadForSelectedGenerations();
    });
  });

  // Reset
  document.getElementById('reset-filters').addEventListener('click', async () => {
    state.filters.types.clear();
    state.filters.stages.clear();
    state.sort = 'id';
    document.querySelectorAll('.type-checkbox, .stage-checkbox')
      .forEach(cb => { cb.checked = false; });
    document.getElementById('sort-select').value = 'id';
    // Reset generation to Gen 1 only
    state.filters.generations.clear();
    state.filters.generations.add(1);
    document.querySelectorAll('.gen-checkbox')
      .forEach(cb => { cb.checked = cb.value === '1'; });
    await reloadForSelectedGenerations();
  });

  // Grid delegation — TTS on name button, modal on card body
  grid.addEventListener('click', e => {
    const nameBtn = e.target.closest('.pokemon-name');
    if (nameBtn) {
      e.stopPropagation();
      speakPokemon(Number(nameBtn.dataset.id));
      return;
    }
    const card = e.target.closest('.pokemon-card');
    if (card) {
      const id      = Number(card.dataset.id);
      const pokemon = state.allPokemon.find(p => p.id === id);
      if (pokemon) openModal(pokemon);
    }
  });

  grid.addEventListener('keydown', e => {
    // TTS on name button
    if (e.key === 'Enter' || e.key === ' ') {
      const nameBtn = e.target.closest('.pokemon-name');
      if (nameBtn) {
        e.preventDefault();
        e.stopPropagation();
        speakPokemon(Number(nameBtn.dataset.id));
        return;
      }
    }

    // Open modal on Enter/Space when a card itself is focused
    if (e.key === 'Enter' || e.key === ' ') {
      const card = e.target.closest('.pokemon-card');
      if (card && e.target === card) {
        e.preventDefault();
        const pokemon = state.allPokemon.find(p => p.id === Number(card.dataset.id));
        if (pokemon) openModal(pokemon);
        return;
      }
    }

    // Arrow-key navigation between cards
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const card = e.target.closest('.pokemon-card');
    if (!card) return;

    e.preventDefault();

    const cards = Array.from(grid.querySelectorAll('.pokemon-card'));
    const idx   = cards.indexOf(card);
    if (idx === -1) return;

    // Determine column count from rendered positions
    const firstTop = cards[0].getBoundingClientRect().top;
    let cols = 0;
    for (const c of cards) {
      if (Math.abs(c.getBoundingClientRect().top - firstTop) < 5) cols++;
      else break;
    }
    cols = Math.max(cols, 1);

    const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    const nextIdx = idx + delta;

    if (nextIdx >= 0 && nextIdx < cards.length) {
      cards[nextIdx].focus();
    }
  });

  // Modal close: backdrop, close button, Escape + arrow navigation
  document.getElementById('modal-backdrop').addEventListener('click', closeModal);
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  modalNavPrev.addEventListener('click', () => navigateModal(-1));
  modalNavNext.addEventListener('click', () => navigateModal(1));
  document.addEventListener('keydown', e => {
    if (cardModal.hidden) return;
    if (e.key === 'Escape')     { closeModal(); return; }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); navigateModal(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); navigateModal(1); }
  });

  // Mobile sidebar toggle
  const sidebar      = document.getElementById('sidebar');
  const toggleBtn    = document.getElementById('mobile-filter-toggle');
  const sidebarInner = document.getElementById('sidebar-inner');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const isOpen = sidebar.classList.toggle('open');
      toggleBtn.setAttribute('aria-expanded', String(isOpen));
      sidebarInner.style.display = isOpen ? 'block' : '';
    });
  }
}

// -----------------------------------------------------------------
// Loading screen
// -----------------------------------------------------------------

function hideLoadingScreen() {
  loadingScreen.classList.add('fade-out');
  loadingScreen.addEventListener('transitionend', () => {
    loadingScreen.style.display = 'none';
  }, { once: true });
}

// -----------------------------------------------------------------
// Init
// -----------------------------------------------------------------

async function init() {
  grid               = document.getElementById('pokemon-grid');
  resultsCount       = document.getElementById('results-count');
  loadingScreen      = document.getElementById('loading-screen');
  loadProgress       = document.getElementById('load-progress');
  loadProgressFill   = document.getElementById('loading-progress-fill');
  cardModal          = document.getElementById('card-modal');
  tcgCardInner       = document.getElementById('tcg-card-inner');
  modalNavPrev       = document.getElementById('modal-nav-prev');
  modalNavNext       = document.getElementById('modal-nav-next');

  wireEvents();
  initNavigation();
  updateHeaderSubtitle();

  try {
    state.allPokemon = await fetchSelectedGenerations();
  } catch (err) {
    loadProgress.textContent = 'Error loading data. Please refresh.';
    console.error('Failed to fetch Pokémon:', err);
    return;
  }

  hideLoadingScreen();
  buildTypeFilters();
  render();
  prefetchEvolutionStages(state.allPokemon);

  // Silently fetch all generations into the battle pool (background, no loading UI)
  fetchAllGensForBattle();
}

async function fetchAllGensForBattle() {
  const allGenNums = Object.keys(GENERATIONS).map(Number);
  const arrays = await Promise.all(allGenNums.map(async genNum => {
    const { start, end } = GENERATIONS[genNum];
    const ids = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    const results = await Promise.allSettled(ids.map(id => {
      if (pokemonCache.has(id)) return Promise.resolve(pokemonCache.get(id));
      return fetch(`${POKEAPI_BASE}/pokemon/${id}`)
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(data => {
          const p = normalizeApiResponse(data, genNum);
          pokemonCache.set(id, p);
          return p;
        });
    }));
    return results.filter(r => r.status === 'fulfilled').map(r => r.value);
  }));
  state.battlePool = arrays.flat();
  buildBattleFilters(); // rebuild type list now that full pool is available
}

document.addEventListener('DOMContentLoaded', init);

// =================================================================
// BATTLE PAGE
// =================================================================

const battleState = {
  leftPokemon:          null,
  rightPokemon:         null,
  isRunning:            false,
  phase:                'idle',  // 'idle' | 'revealing' | 'predicting' | 'battling' | 'result'
  userPrediction:       null,    // 'left' | 'right' | 'tie'
  winner:               null,    // 'left' | 'right' | 'tie'
  championSide:         null,    // side that carries over to next battle
  championCurrentStats: null,    // mutable stat copy for the champion; null = use base stats
};

// Streak counter — lives outside battleState so initBattlePage doesn't reset it
let correctStreak = 0;
const STREAK_GOAL = 10;

// Battle pool filters — default all-inclusive; rebuilt when battlePool is ready
const battleFilters = {
  generations: new Set(Object.keys(GENERATIONS).map(Number)),
  types:       new Set(), // populated after battlePool loads; empty = all types
};

function getFilteredBattlePool() {
  const base = state.battlePool.length ? state.battlePool : state.allPokemon;
  return base.filter(p => {
    const genOk  = battleFilters.generations.size === 0 || battleFilters.generations.has(p.gen);
    const typeOk = battleFilters.types.size === 0       || p.types.some(t => battleFilters.types.has(t));
    return genOk && typeOk;
  });
}

function buildBattleFilters() {
  // Generation pills
  const genList = document.getElementById('battle-filter-gen-list');
  if (genList && genList.childElementCount === 0) {
    Object.entries(GENERATIONS).forEach(([num, g]) => {
      const n = Number(num);
      const label = document.createElement('label');
      label.className = 'battle-gen-label';
      const cb = document.createElement('input');
      cb.type    = 'checkbox';
      cb.value   = num;
      cb.checked = true; // all gens on by default
      cb.addEventListener('change', () => {
        if (cb.checked) battleFilters.generations.add(n);
        else            battleFilters.generations.delete(n);
        updateBattlePoolCount();
      });
      const pill = document.createElement('span');
      pill.className   = 'battle-gen-pill';
      pill.textContent = g.label;
      label.appendChild(cb);
      label.appendChild(pill);
      genList.appendChild(label);
    });
  }

  // Type pills (built from battlePool; re-run each time pool may have changed)
  const typeList = document.getElementById('battle-filter-type-list');
  if (typeList) {
    typeList.innerHTML = '';
    const types = [...new Set((state.battlePool.length ? state.battlePool : state.allPokemon)
      .flatMap(p => p.types))].sort();
    // Reset type filter set to match "all included"
    battleFilters.types.clear();
    types.forEach(type => {
      const label = document.createElement('label');
      label.className = 'type-filter-label'; // reuse existing pill style
      const cb = document.createElement('input');
      cb.type      = 'checkbox';
      cb.className = 'type-checkbox';
      cb.value     = type;
      cb.checked   = true;
      cb.addEventListener('change', () => {
        // types set = explicit inclusion list; empty = all included
        if (cb.checked) {
          battleFilters.types.add(type);
          // If all types are now checked, go back to "all" mode (empty set)
          const total = typeList.querySelectorAll('input').length;
          if (battleFilters.types.size === total) battleFilters.types.clear();
        } else {
          // Unchecking one: if previously in "all" mode, switch to explicit inclusions
          if (battleFilters.types.size === 0) {
            // Add all types except this one
            typeList.querySelectorAll('input').forEach(i => {
              if (i.value !== type) battleFilters.types.add(i.value);
            });
          } else {
            battleFilters.types.delete(type);
          }
        }
        updateBattlePoolCount();
      });
      const pill = document.createElement('span');
      pill.className        = 'type-pill';
      pill.textContent      = type;
      pill.style.background = typeColor(type);
      label.appendChild(cb);
      label.appendChild(pill);
      typeList.appendChild(label);
    });
  }

  // Toggle open/close
  const toggle = document.getElementById('battle-filter-toggle');
  const panel  = document.getElementById('battle-filter-panel');
  if (toggle && !toggle._battleFilterWired) {
    toggle._battleFilterWired = true;
    toggle.addEventListener('click', () => {
      const open = panel.hidden === false;
      panel.hidden = open;
      toggle.setAttribute('aria-expanded', String(!open));
    });
  }

  // Reset button
  const resetBtn = document.getElementById('battle-filter-reset');
  if (resetBtn && !resetBtn._battleFilterWired) {
    resetBtn._battleFilterWired = true;
    resetBtn.addEventListener('click', () => {
      // Re-check all checkboxes
      document.querySelectorAll('#battle-filter-gen-list input').forEach(cb => { cb.checked = true; });
      document.querySelectorAll('#battle-filter-type-list input').forEach(cb => { cb.checked = true; });
      battleFilters.generations = new Set(Object.keys(GENERATIONS).map(Number));
      battleFilters.types.clear();
      updateBattlePoolCount();
    });
  }

  updateBattlePoolCount();
}

function updateBattlePoolCount() {
  const countEl = document.getElementById('battle-pool-count');
  if (!countEl) return;
  const n = getFilteredBattlePool().length;
  countEl.textContent = `${n} Pokémon in pool`;
}

// Audio
const startAudio   = new Audio('audio/start.mp3');
const revealAudio  = new Audio('audio/reveal.mp3');
const battleAudio  = new Audio('audio/battle.mp3');
const winnerAudio  = new Audio('audio/winner.mp3');
const defeatAudio  = new Audio('audio/defeat.mp3');
const victoryAudio = new Audio('audio/victory.mp3');
startAudio.loop  = true;
battleAudio.loop = true;

function stopAllAudio() {
  [startAudio, revealAudio, battleAudio, winnerAudio, defeatAudio, victoryAudio].forEach(a => {
    a.pause();
    a.currentTime = 0;
  });
}

function updateStreakDisplay() {
  const streakEl = document.getElementById('battle-streak');
  const countEl  = document.getElementById('battle-streak-count');
  if (!streakEl || !countEl) return;
  countEl.textContent = correctStreak;
  streakEl.hidden = false;
  // Trigger bump animation
  countEl.classList.remove('bumping');
  void countEl.offsetWidth; // reflow to restart animation
  countEl.classList.add('bumping');
  countEl.addEventListener('animationend', () => countEl.classList.remove('bumping'), { once: true });
}

// Per-type particle configuration
const PARTICLE_CONFIG = {
  fire:     { cls: 'battle-particle--rise',   color: '#FF6B00', size: [5, 11], count: 10 },
  grass:    { cls: 'battle-particle--rise',   color: '#3fa129', size: [4,  8], count: 8  },
  ghost:    { cls: 'battle-particle--rise',   color: '#9977EE', size: [7, 13], count: 8  },
  dark:     { cls: 'battle-particle--rise',   color: '#7755BB', size: [5,  9], count: 8  },
  flying:   { cls: 'battle-particle--rise',   color: '#81b9ef', size: [4,  8], count: 9  },
  bug:      { cls: 'battle-particle--rise',   color: '#91a119', size: [4,  7], count: 9  },
  water:    { cls: 'battle-particle--ripple', color: '#2980ef', size: [18,38], count: 5  },
  ice:      { cls: 'battle-particle--snow',   color: '#3dcef3', size: [4,  8], count: 10 },
  electric: { cls: 'battle-particle--spark',  color: '#fac000', size: [2,  5], count: 12 },
  psychic:  { cls: 'battle-particle--orbit',  color: '#ef4179', size: [7, 11], count: 8  },
  fairy:    { cls: 'battle-particle--orbit',  color: '#ef70ef', size: [5,  9], count: 8  },
  dragon:   { cls: 'battle-particle--orbit',  color: '#5060e1', size: [9, 15], count: 6  },
  poison:   { cls: 'battle-particle--bubble', color: '#9141cb', size: [7, 15], count: 8  },
  rock:     { cls: 'battle-particle--glow',   color: '#b0ab82', size: [9, 17], count: 6  },
  normal:   { cls: 'battle-particle--glow',   color: '#9fa19f', size: [9, 17], count: 6  },
  fighting: { cls: 'battle-particle--glow',   color: '#ff8000', size: [11,19], count: 6  },
  steel:    { cls: 'battle-particle--glow',   color: '#60a1b8', size: [9, 15], count: 6  },
  ground:   { cls: 'battle-particle--glow',   color: '#915121', size: [8, 14], count: 7  },
};

function bRand(min, max) { return min + Math.random() * (max - min); }

function createParticles(container, typeName) {
  container.innerHTML = '';
  const cfg = PARTICLE_CONFIG[typeName] || PARTICLE_CONFIG.normal;

  for (let i = 0; i < cfg.count; i++) {
    const el = document.createElement('div');
    el.className = `battle-particle ${cfg.cls}`;

    const size = bRand(cfg.size[0], cfg.size[1]);
    el.style.width    = `${size}px`;
    el.style.height   = `${size}px`;
    el.style.background = cfg.color;
    el.style.setProperty('--particle-color', cfg.color);
    el.style.setProperty('--delay', `${bRand(0, 1.3).toFixed(2)}s`);
    el.style.setProperty('--dur',   `${bRand(1.0, 2.3).toFixed(2)}s`);

    if (cfg.cls === 'battle-particle--orbit') {
      // Orbit particles originate from center and rotate around it
      el.style.left   = '50%';
      el.style.top    = '50%';
      el.style.setProperty('--radius', `${bRand(48, 85).toFixed(0)}px`);
    } else {
      // Spread particles around the pokemon image area
      const angle = bRand(0, 360);
      const dist  = bRand(20, 80);
      const dx    = Math.cos(angle * Math.PI / 180) * dist;
      const dy    = Math.sin(angle * Math.PI / 180) * dist;
      el.style.left = `calc(50% + ${dx.toFixed(0)}px)`;
      el.style.top  = `calc(50% + ${dy.toFixed(0)}px)`;
      el.style.setProperty('--dx', `${bRand(-38, 38).toFixed(0)}px`);
      el.style.setProperty('--dy', `${-bRand(55, 115).toFixed(0)}px`);
    }

    if (cfg.cls === 'battle-particle--spark') {
      el.style.width        = `${bRand(2, 4).toFixed(0)}px`;
      el.style.height       = `${bRand(8, 18).toFixed(0)}px`;
      el.style.borderRadius = '2px';
      el.style.setProperty('--rot', `${bRand(0, 360).toFixed(0)}deg`);
    }

    container.appendChild(el);
  }
}

function openPokeball(side) {
  const ball = document.getElementById(`pokeball-${side}`);
  const wrap = document.getElementById(`ball-${side}`);
  ball.classList.remove('pb-shaking');
  ball.classList.add('pb-open');
  wrap.classList.add('pb-flash');
  wrap.addEventListener('animationend', () => wrap.classList.remove('pb-flash'), { once: true });
}

function revealPokemon(side, pokemon) {
  const wrap   = document.getElementById(`ball-${side}`);
  const reveal = document.getElementById(`reveal-${side}`);
  const img    = document.getElementById(`img-${side}`);
  const nameEl = document.getElementById(`name-${side}`);
  const typesEl = document.getElementById(`types-${side}`);

  img.src = pokemon.imageUrl;
  img.alt = pokemon.displayName;
  img.addEventListener('error', () => {
    if (img.src !== pokemon.fallbackUrl) img.src = pokemon.fallbackUrl;
  }, { once: true });

  nameEl.textContent = pokemon.displayName;
  typesEl.innerHTML  = '';
  pokemon.types.forEach(type => {
    const badge = document.createElement('span');
    badge.className   = 'type-badge';
    badge.textContent = type;
    badge.style.background = typeColor(type);
    typesEl.appendChild(badge);
  });

  // Hide the ball, show the reveal container
  wrap.style.display = 'none';
  reveal.hidden = false;
  revealAudio.currentTime = 0;
  revealAudio.play().catch(() => {});

  // Apply ground quake effect for ground-type
  if (pokemon.types[0] === 'ground') {
    reveal.classList.add('effect-ground');
  }

  // Trigger CSS transitions next frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      img.classList.add('revealed');
      reveal.querySelector('.battle-pokemon-info').classList.add('revealed');
    });
  });
}

// Returns 'left' | 'right' | 'tie' based on effective stats (champions use worn-down stats)
function determineWinner(leftStats, rightStats) {
  const lTotal = Object.values(leftStats).reduce((a, b) => a + b, 0);
  const rTotal = Object.values(rightStats).reduce((a, b) => a + b, 0);
  if (lTotal > rTotal) return 'left';
  if (rTotal > lTotal) return 'right';
  return 'tie';
}

// Builds phonetic text for one pokemon using existing helpers
function pokemonPhonetic(pokemon) {
  const phonetic = PHONETIC_PRONUNCIATIONS[pokemon.id] || derivePhonetic(pokemon.displayName);
  return toSpeakable(phonetic);
}

// Announces "[left] versus [right]", calls onDone when finished (or after fallback delay)
function announceMatchup(left, right, onDone) {
  if (!window.speechSynthesis) {
    setTimeout(onDone, 1800);
    return;
  }
  window.speechSynthesis.cancel();
  const text = `${pokemonPhonetic(left)} versus ${pokemonPhonetic(right)}`;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang  = 'en-US';
  utterance.rate  = 0.82;
  utterance.pitch = 1.0;
  utterance.onend = onDone;
  // Fallback in case onend never fires (e.g. no voices loaded yet)
  const fallback = setTimeout(onDone, 5000);
  utterance.onend = () => { clearTimeout(fallback); onDone(); };
  window.speechSynthesis.speak(utterance);
}

// Shows prediction UI: question below arena, click pokemon to pick
function showPredictionUI() {
  battleState.phase = 'predicting';

  const predictEl   = document.getElementById('battle-predict');
  const arena       = document.getElementById('battle-arena');
  const revealLeft  = document.getElementById('reveal-left');
  const revealRight = document.getElementById('reveal-right');
  const combatLeft  = document.getElementById('battle-left');
  const combatRight = document.getElementById('battle-right');

  // Set type-color CSS var on each combatant for hover/selected outline
  combatLeft.style.setProperty('--pokemon-type-color',
    typeColor(battleState.leftPokemon.types[0]));
  combatRight.style.setProperty('--pokemon-type-color',
    typeColor(battleState.rightPokemon.types[0]));

  predictEl.hidden = false;
  arena.classList.add('predicting');

  function onPick(prediction) {
    if (battleState.phase !== 'predicting') return;
    battleState.userPrediction = prediction;

    arena.classList.remove('predicting');

    // Mark selected combatant with persistent outline
    combatLeft.classList.remove('predict-selected');
    combatRight.classList.remove('predict-selected');
    if (prediction === 'left')  combatLeft.classList.add('predict-selected');
    if (prediction === 'right') combatRight.classList.add('predict-selected');

    setTimeout(() => {
      predictEl.hidden = true;
      runBattleAnimation();
    }, 400);
  }

  revealLeft.onclick  = () => onPick('left');
  revealRight.onclick = () => onPick('right');
}

// 13-second battle animation sequence
function runBattleAnimation() {
  battleState.phase = 'battling';
  stopAllAudio();
  battleAudio.play().catch(() => {}); // start looping battle music

  // Winner determined by base stats — worn-down stats are for display only
  const winner = determineWinner(battleState.leftPokemon.stats, battleState.rightPokemon.stats);
  const isTie  = winner === 'tie';
  const loser  = isTie ? null : (winner === 'left' ? 'right' : 'left');

  const imgLeft  = document.getElementById('img-left');
  const imgRight = document.getElementById('img-right');
  const combatantLeft  = document.getElementById('battle-left');
  const combatantRight = document.getElementById('battle-right');

  // Both Pokémon start shaking
  imgLeft.classList.add('battling');
  imgRight.classList.add('battling');

  // Hit sequence: alternate every 1.2s for ~8 rounds
  // On a tie, hits alternate evenly; on a win, loser takes more hits
  const hitTimes = [400, 1600, 2800, 4000, 5200, 6400, 7600, 8800];
  hitTimes.forEach((t, i) => {
    setTimeout(() => {
      const hitSide = isTie
        ? (i % 2 === 0 ? 'left' : 'right')
        : (i % 2 === 0 ? loser : winner);
      const el = hitSide === 'left' ? combatantLeft : combatantRight;
      el.classList.add('taking-hit');
      el.addEventListener('animationend', () => el.classList.remove('taking-hit'), { once: true });
    }, t);
  });

  if (isTie) {
    // t=8s — both start weakening simultaneously
    setTimeout(() => {
      imgLeft.classList.add('weakening');
      imgRight.classList.add('weakening');
    }, 8000);

    // t=11.5s — both faint
    setTimeout(() => {
      imgLeft.classList.remove('battling', 'weakening');
      imgRight.classList.remove('battling', 'weakening');
      imgLeft.classList.add('fainted');
      imgRight.classList.add('fainted');
    }, 11500);
  } else {
    // t=8s — loser starts weakening
    setTimeout(() => {
      const loserImg = loser === 'left' ? imgLeft : imgRight;
      loserImg.classList.add('weakening');
    }, 8000);

    // t=11.5s — loser faints
    setTimeout(() => {
      const loserImg = loser === 'left' ? imgLeft : imgRight;
      loserImg.classList.remove('battling', 'weakening');
      loserImg.classList.add('fainted');
    }, 11500);

    // t=12.5s — winner celebrates
    setTimeout(() => {
      const winnerImg = winner === 'left' ? imgLeft : imgRight;
      winnerImg.style.color = typeColor(
        winner === 'left'
          ? battleState.leftPokemon.types[0]
          : battleState.rightPokemon.types[0]
      );
      winnerImg.classList.remove('battling');
      winnerImg.classList.add('won');
    }, 12500);
  }

  // t=13.5s — show results
  setTimeout(() => showBattleResult(winner), 13500);
}

function showBattleResult(winner) {
  battleState.phase  = 'result';
  battleState.winner = winner;

  // Capture the PREVIOUS champion side before overwriting — used to determine
  // which pokemon carried worn-down stats INTO this battle.
  const prevChampSide = battleState.championSide;
  battleState.championSide = winner === 'tie' ? null : winner;

  stopAllAudio();

  const left  = battleState.leftPokemon;
  const right = battleState.rightPokemon;

  // Effective stats going INTO this battle: previous champion uses worn-down stats; challenger uses base
  const effLeftStats  = (prevChampSide === 'left'  && battleState.championCurrentStats) ? battleState.championCurrentStats : left.stats;
  const effRightStats = (prevChampSide === 'right' && battleState.championCurrentStats) ? battleState.championCurrentStats : right.stats;
  const lTotal = Object.values(effLeftStats).reduce((a, b) => a + b, 0);
  const rTotal = Object.values(effRightStats).reduce((a, b) => a + b, 0);

  // Compute winner's remaining stats: subtract loser's effective stats from winner's effective stats, floor 0
  let remainingStats    = null;
  let winnerPreStats    = null;  // winner's effective stats going INTO this battle
  let loserEffStats     = null;  // loser's effective stats going INTO this battle
  if (winner !== 'tie') {
    const loserSide = winner === 'left' ? 'right' : 'left';
    // Winner's stats going into this battle (previous champion carries worn-down stats; challenger uses base)
    winnerPreStats = winner === prevChampSide && battleState.championCurrentStats
      ? battleState.championCurrentStats
      : (winner === 'left' ? left : right).stats;
    // Loser's effective stats (previous champion's worn-down stats; challenger uses base)
    loserEffStats = loserSide === prevChampSide && battleState.championCurrentStats
      ? battleState.championCurrentStats
      : (loserSide === 'left' ? left : right).stats;
    remainingStats = {};
    for (const key of Object.keys((winner === 'left' ? left : right).stats)) {
      remainingStats[key] = Math.max(0, (winnerPreStats[key] ?? 0) - (loserEffStats[key] ?? 0));
    }
    battleState.championCurrentStats = remainingStats;
  }

  const outcomeEl    = document.getElementById('battle-outcome');
  const predictionEl = document.getElementById('battle-outcome-prediction');
  const winnerEl     = document.getElementById('battle-outcome-winner');

  const predicted = battleState.userPrediction;
  // A tie can never be a correct prediction (no tie button); treat as wrong
  const correct   = winner !== 'tie' && predicted !== null && predicted === winner;

  if (winner === 'tie') {
    predictionEl.className   = 'battle-outcome-prediction battle-outcome-prediction--wrong';
    predictionEl.textContent = "It's a tie — streak ends!";
    winnerEl.textContent     = `Both had ${lTotal} total stats.`;
  } else {
    if (predicted !== null) {
      predictionEl.className   = `battle-outcome-prediction battle-outcome-prediction--${correct ? 'correct' : 'wrong'}`;
      predictionEl.textContent = correct ? 'You predicted correctly!' : 'Wrong prediction — better luck next time!';
    } else {
      predictionEl.textContent = '';
    }
    const winPokemon = winner === 'left' ? left : right;
    const winTotal   = winner === 'left' ? lTotal : rTotal;
    const losTotal   = winner === 'left' ? rTotal : lTotal;
    winnerEl.textContent = `${winPokemon.displayName} wins! (${winTotal} vs ${losTotal} total stats)`;
  }

  outcomeEl.hidden = false;

  if (correct) {
    // ── Correct prediction ──
    winnerAudio.play().catch(() => {});
    correctStreak++;
    updateStreakDisplay();

    if (correctStreak >= STREAK_GOAL) {
      // 10-in-a-row: show face-off + let winner audio & animation finish, THEN victory
      buildFaceOff(left, right, winner, remainingStats, winnerPreStats, loserEffStats);
      document.getElementById('battle-results').hidden = false;
      const goVictory = () => {
        stopAllAudio();
        victoryAudio.play().catch(() => {});
        showVictoryBanner();
      };
      const fallback = setTimeout(goVictory, 6000);
      winnerAudio.onended = () => { clearTimeout(fallback); goVictory(); };
      return;
    }

    // Normal win: show face-off + next/reset buttons
    buildFaceOff(left, right, winner, remainingStats, winnerPreStats, loserEffStats);
    document.getElementById('battle-results').hidden = false;
    document.getElementById('battle-next-btn').onclick  = startNextBattle;
    document.getElementById('battle-reset-btn').onclick = () => {
      window.speechSynthesis && window.speechSynthesis.cancel();
      stopAllAudio();
      correctStreak = 0;
      document.getElementById('battle-streak').hidden = true;
      document.getElementById('battle-results').hidden = true;
      document.getElementById('battle-outcome').hidden = true;
      document.getElementById('battle-arena').hidden   = true;
      document.getElementById('battle-vs').hidden      = true;
      initBattlePage();
    };

  } else {
    // ── Wrong prediction (or no prediction) ──
    defeatAudio.play().catch(() => {});
    correctStreak = 0;

    // Auto-reset to start view after defeat audio (or 3s fallback)
    const resetAfterDefeat = () => {
      window.speechSynthesis && window.speechSynthesis.cancel();
      stopAllAudio();
      document.getElementById('battle-streak').hidden = true;
      document.getElementById('battle-outcome').hidden = true;
      document.getElementById('battle-arena').hidden   = true;
      document.getElementById('battle-vs').hidden      = true;
      initBattlePage();
    };

    const fallback = setTimeout(resetAfterDefeat, 3500);
    defeatAudio.onended = () => { clearTimeout(fallback); resetAfterDefeat(); };
  }
}

function showVictoryBanner() {
  // Hide everything except the victory overlay
  document.getElementById('battle-arena').hidden   = true;
  document.getElementById('battle-vs').hidden      = true;
  document.getElementById('battle-outcome').hidden = true;
  document.getElementById('battle-results').hidden = true;
  document.getElementById('battle-predict').hidden = true;

  const victoryEl = document.getElementById('battle-victory');
  victoryEl.hidden = false;

  // Spawn falling star particles
  const starsEl = document.querySelector('.battle-victory-stars');
  starsEl.innerHTML = '';
  const starChars = ['★', '✦', '✧', '⭐', '✨'];
  for (let i = 0; i < 28; i++) {
    const s = document.createElement('span');
    s.className   = 'victory-star';
    s.textContent = starChars[Math.floor(Math.random() * starChars.length)];
    s.style.left  = `${Math.random() * 100}%`;
    s.style.color = `hsl(${40 + Math.random() * 30}, 100%, ${60 + Math.random() * 20}%)`;
    s.style.setProperty('--delay', `${(Math.random() * 3).toFixed(2)}s`);
    s.style.setProperty('--dur',   `${(2.5 + Math.random() * 2).toFixed(2)}s`);
    starsEl.appendChild(s);
  }

  // Wire Play Again
  document.getElementById('battle-victory-btn').onclick = () => {
    window.speechSynthesis && window.speechSynthesis.cancel();
    stopAllAudio();
    correctStreak = 0;
    victoryEl.hidden = true;
    document.getElementById('battle-streak').hidden = true;
    initBattlePage();
  };
}

// winnerSide:    'left' | 'right' | 'tie'
// remainingStats: post-battle stats for winner (null for tie)
// winnerPreStats: winner's effective stats going INTO the battle (may be worn-down from prior wins)
// loserEffStats:  loser's effective stats going INTO the battle (may be worn-down if they were champ)
function buildFaceOff(left, right, winnerSide, remainingStats, winnerPreStats, loserEffStats) {
  const grid    = document.getElementById('faceoff-grid');
  const verdict = document.getElementById('battle-verdict');
  grid.innerHTML = '';

  const winner = winnerSide || 'tie';

  // Effective stats going into this battle — fall back to base stats if not provided
  const lPreStats = (winner === 'left'  ? winnerPreStats : loserEffStats) ?? left.stats;
  const rPreStats = (winner === 'right' ? winnerPreStats : loserEffStats) ?? right.stats;

  STAT_DISPLAY.forEach(({ key, label }) => {
    const lEff = lPreStats[key] ?? left.stats[key]  ?? 0;
    const rEff = rPreStats[key] ?? right.stats[key] ?? 0;

    // Display values: winner shows post-battle remaining; loser shows effective going in
    const lValDisplay = (winner === 'left'  && remainingStats) ? remainingStats[key] : lEff;
    const rValDisplay = (winner === 'right' && remainingStats) ? remainingStats[key] : rEff;

    // Highlight whichever side had the higher effective stat going in
    const lWins = lEff > rEff;
    const rWins = rEff > lEff;

    const row = document.createElement('div');
    row.className = 'faceoff-row';

    // ── Left side ──
    const leftSide = document.createElement('div');
    leftSide.className = 'faceoff-bar-left';

    const lValEl = document.createElement('span');
    lValEl.className = `faceoff-val${lWins ? ' faceoff-val--winner' : ''}`;
    if (winner === 'left' && remainingStats) {
      // Show "remaining /pre-battle-effective"
      lValEl.innerHTML = `<span class="faceoff-remaining">${lValDisplay}</span><span class="faceoff-original"> /${lEff}</span>`;
    } else {
      lValEl.textContent = lEff;
    }

    const lTrack = document.createElement('div');
    lTrack.className = 'faceoff-bar-track';
    const lFill = document.createElement('div');
    lFill.className        = `faceoff-bar-fill${lWins ? ' faceoff-bar-fill--winner' : ''}`;
    lFill.style.width      = '0%';
    lFill.style.background = typeColor(left.types[0]);
    lFill.style.color      = typeColor(left.types[0]);
    lTrack.appendChild(lFill);
    leftSide.appendChild(lValEl);
    leftSide.appendChild(lTrack);

    // ── Label ──
    const labelEl = document.createElement('div');
    labelEl.className   = 'faceoff-stat-label';
    labelEl.textContent = label;

    // ── Right side ──
    const rightSide = document.createElement('div');
    rightSide.className = 'faceoff-bar-right';

    const rTrack = document.createElement('div');
    rTrack.className = 'faceoff-bar-track';
    const rFill = document.createElement('div');
    rFill.className        = `faceoff-bar-fill${rWins ? ' faceoff-bar-fill--winner' : ''}`;
    rFill.style.width      = '0%';
    rFill.style.background = typeColor(right.types[0]);
    rFill.style.color      = typeColor(right.types[0]);
    rTrack.appendChild(rFill);

    const rValEl = document.createElement('span');
    rValEl.className = `faceoff-val${rWins ? ' faceoff-val--winner' : ''}`;
    if (winner === 'right' && remainingStats) {
      rValEl.innerHTML = `<span class="faceoff-remaining">${rValDisplay}</span><span class="faceoff-original"> /${rEff}</span>`;
    } else {
      rValEl.textContent = rEff;
    }

    rightSide.appendChild(rTrack);
    rightSide.appendChild(rValEl);

    row.appendChild(leftSide);
    row.appendChild(labelEl);
    row.appendChild(rightSide);
    grid.appendChild(row);

    // Animate bars based on display values
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        lFill.style.width = `${Math.min(100, (lValDisplay / MAX_STAT) * 100)}%`;
        rFill.style.width = `${Math.min(100, (rValDisplay / MAX_STAT) * 100)}%`;
      });
    });
  });

  // Verdict: use effective pre-battle totals so numbers match what was displayed
  const lEffTotal = Object.values(lPreStats).reduce((a, b) => a + b, 0);
  const rEffTotal = Object.values(rPreStats).reduce((a, b) => a + b, 0);
  if (winner === 'left') {
    const remaining = remainingStats ? Object.values(remainingStats).reduce((a, b) => a + b, 0) : lEffTotal;
    verdict.className   = 'battle-verdict battle-verdict--left';
    verdict.textContent = `${left.displayName}: ${remaining}/${lEffTotal} remaining  ·  ${right.displayName}: ${rEffTotal} pts`;
  } else if (winner === 'right') {
    const remaining = remainingStats ? Object.values(remainingStats).reduce((a, b) => a + b, 0) : rEffTotal;
    verdict.className   = 'battle-verdict battle-verdict--right';
    verdict.textContent = `${right.displayName}: ${remaining}/${rEffTotal} remaining  ·  ${left.displayName}: ${lEffTotal} pts`;
  } else {
    verdict.className   = 'battle-verdict battle-verdict--tie';
    verdict.textContent = `Tied at ${lEffTotal} total stats each.`;
  }
}

function startNextBattle() {
  if (battleState.phase !== 'result') return;
  window.speechSynthesis && window.speechSynthesis.cancel();

  const championSide   = battleState.championSide;
  const challengerSide = championSide === 'left' ? 'right' : 'left';

  // Pick a new challenger that isn't the current champion
  const champion = battleState[`${championSide}Pokemon`];
  const pool = getFilteredBattlePool().filter(p => p.id !== champion.id);
  const newChallenger = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : champion; // fallback: same pokemon if pool too small


  // Update state
  battleState[`${challengerSide}Pokemon`] = newChallenger;
  battleState.phase          = 'revealing';
  battleState.userPrediction = null;
  battleState.winner         = null;
  battleState.isRunning      = true;

  // Hide result panels and prediction UI
  document.getElementById('battle-results').hidden = true;
  document.getElementById('battle-outcome').hidden = true;
  document.getElementById('battle-predict').hidden = true;
  document.getElementById('battle-vs').hidden      = true;
  document.getElementById('battle-arena').classList.remove('predicting');

  // Clear prediction selection on both sides
  ['left', 'right'].forEach(s => {
    document.getElementById(`battle-${s}`).classList.remove('predict-selected');
  });

  // Update labels
  document.querySelector(`#battle-${championSide} .battle-label`).textContent   = 'Champion';
  document.querySelector(`#battle-${challengerSide} .battle-label`).textContent = 'Challenger';

  // Reset champion's animation state (remove battle classes, keep image)
  const champImg = document.getElementById(`img-${championSide}`);
  champImg.classList.remove('won', 'battling', 'weakening', 'fainted');
  champImg.style.color = '';

  // Reset challenger side fully
  const challengerReveal = document.getElementById(`reveal-${challengerSide}`);
  const challengerWrap   = document.getElementById(`ball-${challengerSide}`);
  const challengerBall   = document.getElementById(`pokeball-${challengerSide}`);

  // Fade out old reveal, then swap in pokeball
  challengerReveal.style.transition = 'opacity 0.3s ease';
  challengerReveal.style.opacity    = '0';
  setTimeout(() => {
    // Reset reveal container
    challengerReveal.hidden       = true;
    challengerReveal.style.opacity = '';
    challengerReveal.style.transition = '';
    challengerReveal.classList.remove('effect-ground');
    const oldImg = document.getElementById(`img-${challengerSide}`);
    oldImg.classList.remove('revealed', 'battling', 'weakening', 'fainted', 'won');
    oldImg.style.color = '';
    oldImg.src = '';
    document.getElementById(`name-${challengerSide}`).textContent = '';
    document.getElementById(`types-${challengerSide}`).innerHTML  = '';
    document.getElementById(`particles-${challengerSide}`).innerHTML = '';
    challengerReveal.querySelector('.battle-pokemon-info').classList.remove('revealed');

    // Show pokeball
    challengerWrap.style.display = '';
    challengerBall.className     = 'battle-pokeball pb-appeared';

    // Mini reveal sequence
    setTimeout(() => {
      challengerBall.classList.add('pb-shaking');
    }, 200);
    setTimeout(() => {
      openPokeball(challengerSide);
    }, 1100);
    setTimeout(() => {
      revealPokemon(challengerSide, newChallenger);
      createParticles(
        document.getElementById(`particles-${challengerSide}`),
        newChallenger.types[0]
      );
    }, 1600);
    setTimeout(() => {
      // Also refresh champion particles
      createParticles(
        document.getElementById(`particles-${championSide}`),
        champion.types[0]
      );
      document.getElementById('battle-vs').hidden = false;
      announceMatchup(
        battleState.leftPokemon,
        battleState.rightPokemon,
        showPredictionUI
      );
    }, 2200);
  }, 350);
}

function startBattle() {
  if (battleState.isRunning) return;
  if (state.allPokemon.length < 2) return;
  startAudio.pause();
  startAudio.currentTime = 0;
  battleState.isRunning = true;
  battleState.phase     = 'revealing';

  // Show streak counter (initialises at current value so it persists between battles)
  updateStreakDisplay();

  // Pick two unique random Pokémon from the filtered pool
  const pool = getFilteredBattlePool();
  if (pool.length < 2) {
    alert('Not enough Pokémon match your filters. Please broaden your selection.');
    battleState.isRunning = false;
    battleState.phase     = 'idle';
    startAudio.play().catch(() => {});
    return;
  }
  const idxA = Math.floor(Math.random() * pool.length);
  let   idxB = Math.floor(Math.random() * pool.length);
  while (idxB === idxA) idxB = Math.floor(Math.random() * pool.length);

  battleState.leftPokemon  = pool[idxA];
  battleState.rightPokemon = pool[idxB];

  // t=0 — Fade out start panel (position:absolute via CSS so arena isn't pushed down)
  const startEl = document.getElementById('battle-start');
  startEl.classList.add('fading-out');
  // Hide from flow immediately; the CSS absolute-positions it during the fade
  startEl.addEventListener('animationend', () => { startEl.hidden = true; }, { once: true });

  // t=300ms — Show arena + pokeballs appear
  setTimeout(() => {
    document.getElementById('battle-arena').hidden = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById('pokeball-left').classList.add('pb-appeared');
        document.getElementById('pokeball-right').classList.add('pb-appeared');
      });
    });
  }, 300);

  // t=650ms — Shake
  setTimeout(() => {
    document.getElementById('pokeball-left').classList.add('pb-shaking');
    document.getElementById('pokeball-right').classList.add('pb-shaking');
  }, 650);

  // t=1550ms — Open pokeballs
  setTimeout(() => openPokeball('left'),  1550);
  setTimeout(() => openPokeball('right'), 1550);

  // t=2050ms — Reveal Pokémon
  setTimeout(() => revealPokemon('left',  battleState.leftPokemon),  2050);
  setTimeout(() => revealPokemon('right', battleState.rightPokemon), 2050);

  // t=2600ms — Particles
  setTimeout(() => {
    createParticles(document.getElementById('particles-left'),  battleState.leftPokemon.types[0]);
    createParticles(document.getElementById('particles-right'), battleState.rightPokemon.types[0]);
  }, 2600);

  // t=3000ms — VS badge + announcement → prediction UI
  setTimeout(() => {
    document.getElementById('battle-vs').hidden = false;
    announceMatchup(battleState.leftPokemon, battleState.rightPokemon, showPredictionUI);
  }, 3000);
}

function initBattlePage() {
  window.speechSynthesis && window.speechSynthesis.cancel();
  stopAllAudio();
  startAudio.play().catch(() => {});

  const startEl   = document.getElementById('battle-start');
  const arena     = document.getElementById('battle-arena');
  const vsEl      = document.getElementById('battle-vs');
  const resultsEl = document.getElementById('battle-results');
  const predictEl   = document.getElementById('battle-predict');
  const outcomeEl  = document.getElementById('battle-outcome');
  const victoryEl  = document.getElementById('battle-victory');

  startEl.hidden   = false;
  startEl.classList.remove('fading-out');
  buildBattleFilters();
  arena.hidden     = true;
  arena.classList.remove('predicting');
  vsEl.hidden      = true;
  resultsEl.hidden = true;
  predictEl.hidden = true;
  outcomeEl.hidden = true;
  if (victoryEl) victoryEl.hidden = true;

  ['left', 'right'].forEach(side => {
    const ball   = document.getElementById(`pokeball-${side}`);
    const wrap   = document.getElementById(`ball-${side}`);
    const reveal = document.getElementById(`reveal-${side}`);
    const img    = document.getElementById(`img-${side}`);

    ball.className      = 'battle-pokeball';
    wrap.style.display  = '';
    reveal.hidden       = true;
    reveal.classList.remove('effect-ground');
    reveal.onclick      = null;
    img.classList.remove('revealed', 'battling', 'weakening', 'fainted', 'won');
    img.style.color     = '';
    img.src             = '';
    document.getElementById(`name-${side}`).textContent = '';
    document.getElementById(`types-${side}`).innerHTML  = '';
    document.getElementById(`particles-${side}`).innerHTML = '';
    reveal.querySelector('.battle-pokemon-info').classList.remove('revealed');

    // Reset combatant prediction state
    const combatant = document.getElementById(`battle-${side}`);
    combatant.classList.remove('predict-selected');
    combatant.style.removeProperty('--pokemon-type-color');

    // Reset combatant label
    const labelEl = combatant.querySelector('.battle-label');
    if (labelEl) labelEl.textContent = side === 'left' ? 'Your Pokémon' : 'Opponent';
  });

  // Reset state
  battleState.leftPokemon          = null;
  battleState.rightPokemon         = null;
  battleState.isRunning            = false;
  battleState.phase                = 'idle';
  battleState.userPrediction       = null;
  battleState.winner               = null;
  battleState.championSide         = null;
  battleState.championCurrentStats = null;

  // Replace start button to clear stale listeners
  const oldBtn = document.getElementById('battle-start-btn');
  const newBtn = oldBtn.cloneNode(true);
  oldBtn.parentNode.replaceChild(newBtn, oldBtn);
  newBtn.addEventListener('click', startBattle);
}

function initNavigation() {
  const appShell      = document.querySelector('.app-shell');
  const battleSection = document.getElementById('battle-section');
  const tabs          = document.querySelectorAll('.nav-tab');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.toggle('nav-tab--active', t === tab));
      if (tab.dataset.view === 'battle') {
        appShell.hidden      = true;
        battleSection.hidden = false;
        initBattlePage();
      } else {
        // Leaving battle — stop audio and reset streak
        stopAllAudio();
        window.speechSynthesis && window.speechSynthesis.cancel();
        correctStreak = 0;
        battleSection.hidden = true;
        appShell.hidden      = false;
      }
    });
  });
}
