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
  filters: {
    types:  new Set(),
    stages: new Set(),
  },
  sort: 'id',
};

// Cache for lazily-fetched TCG card data (species + moves)
const cardDataCache = new Map();

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

let loadedCount = 0;

function updateProgress() {
  loadedCount++;
  loadProgress.textContent     = `Catching Pokémon… ${loadedCount} / 100`;
  loadProgressFill.style.width = `${loadedCount}%`;
}

function normalizeMoves(rawMoves) {
  // Pick up to 2 level-up moves from the Red/Blue version group,
  // sorted by the level at which they are learned.
  const lvlUpMoves = rawMoves
    .filter(m => m.version_group_details.some(
      vg => vg.version_group.name === 'red-blue' &&
            vg.move_learn_method.name === 'level-up'
    ))
    .map(m => {
      const vgd = m.version_group_details.find(
        vg => vg.version_group.name === 'red-blue' &&
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

function normalizeApiResponse(raw) {
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
    stage:        EVOLUTION_STAGES[raw.id] || 1,
    levelUpMoves: normalizeMoves(raw.moves),
  };
}

async function fetchOnePokemon(id) {
  const res = await fetch(`${POKEAPI_BASE}/pokemon/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for id ${id}`);
  const data = await res.json();
  updateProgress();
  return normalizeApiResponse(data);
}

async function fetchAllPokemon() {
  const ids     = Array.from({ length: 100 }, (_, i) => i + 1);
  const results = await Promise.allSettled(ids.map(fetchOnePokemon));
  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value)
    .sort((a, b) => a.id - b.id);
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

  // Flavor text — prefer Red/Blue; fall back to any English entry
  const flavorEntry =
    speciesData?.flavor_text_entries?.find(
      e => e.language.name === 'en' && ['red', 'blue'].includes(e.version.name)
    ) ||
    speciesData?.flavor_text_entries?.find(e => e.language.name === 'en');
  const flavorText = flavorEntry?.flavor_text
    ?.replace(/[\f\n\r]/g, ' ').replace(/\s+/g, ' ').trim() || '';

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

// -----------------------------------------------------------------
// Speech synthesis
// -----------------------------------------------------------------

function speakPokemon(id) {
  if (!window.speechSynthesis) return;
  const phonetic = PHONETIC_PRONUNCIATIONS[id];
  const text     = phonetic ? toSpeakable(phonetic) : state.allPokemon.find(p => p.id === id)?.displayName || '';
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
  const phonetic    = PHONETIC_PRONUNCIATIONS[pokemon.id] || '';
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
  numLeft.textContent = `${padId(pokemon.id)}/100`;
  const numRight = document.createElement('span');
  numRight.textContent = 'Pokémon Red & Blue';
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

  // Reset
  document.getElementById('reset-filters').addEventListener('click', () => {
    state.filters.types.clear();
    state.filters.stages.clear();
    state.sort = 'id';
    document.querySelectorAll('.type-checkbox, .stage-checkbox')
      .forEach(cb => { cb.checked = false; });
    document.getElementById('sort-select').value = 'id';
    render();
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

  try {
    state.allPokemon = await fetchAllPokemon();
  } catch (err) {
    loadProgress.textContent = 'Error loading data. Please refresh.';
    console.error('Failed to fetch Pokémon:', err);
    return;
  }

  hideLoadingScreen();
  buildTypeFilters();
  render();
}

document.addEventListener('DOMContentLoaded', init);
