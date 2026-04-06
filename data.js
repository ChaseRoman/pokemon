// Evolution stage for Pokémon IDs 1–100
// 1 = Basic (no pre-evolution), 2 = Stage 1, 3 = Stage 2 (final in 3-stage line)
const EVOLUTION_STAGES = {
  1:  1, // Bulbasaur
  2:  2, // Ivysaur
  3:  3, // Venusaur
  4:  1, // Charmander
  5:  2, // Charmeleon
  6:  3, // Charizard
  7:  1, // Squirtle
  8:  2, // Wartortle
  9:  3, // Blastoise
  10: 1, // Caterpie
  11: 2, // Metapod
  12: 3, // Butterfree
  13: 1, // Weedle
  14: 2, // Kakuna
  15: 3, // Beedrill
  16: 1, // Pidgey
  17: 2, // Pidgeotto
  18: 3, // Pidgeot
  19: 1, // Rattata
  20: 2, // Raticate
  21: 1, // Spearow
  22: 2, // Fearow
  23: 1, // Ekans
  24: 2, // Arbok
  25: 1, // Pikachu
  26: 2, // Raichu
  27: 1, // Sandshrew
  28: 2, // Sandslash
  29: 1, // Nidoran♀
  30: 2, // Nidorina
  31: 3, // Nidoqueen
  32: 1, // Nidoran♂
  33: 2, // Nidorino
  34: 3, // Nidoking
  35: 1, // Clefairy
  36: 2, // Clefable
  37: 1, // Vulpix
  38: 2, // Ninetales
  39: 1, // Jigglypuff
  40: 2, // Wigglytuff
  41: 1, // Zubat
  42: 2, // Golbat
  43: 1, // Oddish
  44: 2, // Gloom
  45: 3, // Vileplume
  46: 1, // Paras
  47: 2, // Parasect
  48: 1, // Venonat
  49: 2, // Venomoth
  50: 1, // Diglett
  51: 2, // Dugtrio
  52: 1, // Meowth
  53: 2, // Persian
  54: 1, // Psyduck
  55: 2, // Golduck
  56: 1, // Mankey
  57: 2, // Primeape
  58: 1, // Growlithe
  59: 2, // Arcanine
  60: 1, // Poliwag
  61: 2, // Poliwhirl
  62: 3, // Poliwrath
  63: 1, // Abra
  64: 2, // Kadabra
  65: 3, // Alakazam
  66: 1, // Machop
  67: 2, // Machoke
  68: 3, // Machamp
  69: 1, // Bellsprout
  70: 2, // Weepinbell
  71: 3, // Victreebel
  72: 1, // Tentacool
  73: 2, // Tentacruel
  74: 1, // Geodude
  75: 2, // Graveler
  76: 3, // Golem
  77: 1, // Ponyta
  78: 2, // Rapidash
  79: 1, // Slowpoke
  80: 2, // Slowbro
  81: 1, // Magnemite
  82: 2, // Magneton
  83: 1, // Farfetch'd (no evolution)
  84: 1, // Doduo
  85: 2, // Dodrio
  86: 1, // Seel
  87: 2, // Dewgong
  88: 1, // Grimer
  89: 2, // Muk
  90: 1, // Shellder
  91: 2, // Cloyster
  92: 1, // Gastly
  93: 2, // Haunter
  94: 3, // Gengar
  95: 1, // Onix (no Gen 1 evolution)
  96: 1, // Drowzee
  97: 2, // Hypno
  98: 1, // Krabby
  99: 2, // Kingler
  100: 1, // Voltorb
};

// Display name overrides for Pokémon with special characters or formatting
const DISPLAY_NAME_OVERRIDES = {
  'nidoran-f':  'Nidoran♀',
  'nidoran-m':  'Nidoran♂',
  'farfetchd':  "Farfetch'd",
};

// Phonetic pronunciations sourced from Serebii.net Kanto Pokémon Pronunciation Guide
// Displayed on the TCG card as a visual guide; also fed (lowercased, hyphens→spaces)
// to SpeechSynthesisUtterance for accurate audio playback.
const PHONETIC_PRONUNCIATIONS = {
  1:   'BULL-buh-sohr',
  2:   'EYE-vee-sohr',
  3:   'VEE-nu-sohr',
  4:   'CHAR-man-der',
  5:   'char-MEEL-yuhn',
  6:   'CHAR-zard',
  7:   'SKWUR-tull',
  8:   'WOR-tor-tull',
  9:   'BLAST-ois',
  10:  'CAT-ur-pee',
  11:  'MET-uh-pod',
  12:  'BUT-er-free',
  13:  'WEE-dull',
  14:  'kah-KOO-na',
  15:  'BEE-drill',
  16:  'PID-gee',
  17:  'PID-gee-OH-toe',
  18:  'PID-gee-ot',
  19:  'ruh-TA-tuh',
  20:  'RAT-ih-kate',
  21:  'SPEER-oh',
  22:  'FEER-oh',
  23:  'ECK-ins',
  24:  'AR-bahk',
  25:  'PEE-ka-choo',
  26:  'RYE-choo',
  27:  'SAND-shroo',
  28:  'SAND-slash',
  29:  'NEE-doh-ran',
  30:  'NEE-doh-REE-nuh',
  31:  'NEE-doh-kween',
  32:  'NEE-doh-ran',
  33:  'NEE-doh-REE-no',
  34:  'NEE-doh-king',
  35:  'cleh-FAIR-ee',
  36:  'cleh-FAY-bull',
  37:  'VULL-piks',
  38:  'NINE-tales',
  39:  'JIG-lee-puff',
  40:  'WIG-lee-tuff',
  41:  'ZOO-bat',
  42:  'GOHL-bat',
  43:  'ODD-ish',
  44:  'GLOOM',
  45:  'VILE-ploom',
  46:  'PAIR-is',
  47:  'PARA-sekt',
  48:  'VEH-no-nat',
  49:  'VEH-no-moth',
  50:  'DIG-lit',
  51:  'dug-TREE-oh',
  52:  'mee-OWTH',
  53:  'PURR-zhin',
  54:  'SYE-duck',
  55:  'GOHL-duck',
  56:  'MANK-ee',
  57:  'PRIME-ape',
  58:  'GROWL-ith',
  59:  'AR-kuh-nine',
  60:  'PAHL-ee-wag',
  61:  'PAHL-ee-wurl',
  62:  'PAHL-ee-rath',
  63:  'AB-ruh',
  64:  'kuh-DAB-ruh',
  65:  'AL-uh-kuh-ZAM',
  66:  'muh-CHOP',
  67:  'muh-CHOKE',
  68:  'muh-CHAMP',
  69:  'BELL-sprout',
  70:  'WEEP-in-bell',
  71:  'VICK-tree-bell',
  72:  'TEN-tuh-kool',
  73:  'TEN-tuh-krool',
  74:  'JEE-oh-dood',
  75:  'GRAV-uh-lurr',
  76:  'GOHL-um',
  77:  'POH-nee-tah',
  78:  'RAP-ih-dash',
  79:  'SLOH-poke',
  80:  'SLOH-bro',
  81:  'MAG-nuh-mite',
  82:  'MAG-nuh-tahn',
  83:  'FAR-fetcht',
  84:  'doh-DOO-oh',
  85:  'doh-DREE-oh',
  86:  'SEEL',
  87:  'DOO-gahng',
  88:  'GRIME-er',
  89:  'MUK',
  90:  'SHELL-dur',
  91:  'CLOY-stur',
  92:  'GAS-lee',
  93:  'HAHN-tur',
  94:  'GENG-gar',
  95:  'AHN-iks',
  96:  'DROW-zee',
  97:  'HIP-noh',
  98:  'KRA-bee',
  99:  'KING-ler',
  100: 'VOHL-torb',
};

// TCG card visual theme per primary type
const TYPE_CARD_COLORS = {
  fire:     { light: '#FFE8D4', mid: '#FF9055', border: '#CC4400', artBg: 'linear-gradient(135deg,#FF7722,#CC3300)' },
  water:    { light: '#D4EAFF', mid: '#5599EE', border: '#1A5499', artBg: 'linear-gradient(135deg,#3377CC,#1A5499)' },
  grass:    { light: '#D4FFD4', mid: '#55BB55', border: '#2E7D32', artBg: 'linear-gradient(135deg,#3A9140,#1E5C22)' },
  electric: { light: '#FFFCE0', mid: '#FFE055', border: '#CC8800', artBg: 'linear-gradient(135deg,#FFCC00,#FF9900)' },
  psychic:  { light: '#FFD4EA', mid: '#FF77BB', border: '#CC2266', artBg: 'linear-gradient(135deg,#EE4499,#AA1166)' },
  fighting: { light: '#FFE0D4', mid: '#CC6655', border: '#8B2020', artBg: 'linear-gradient(135deg,#AA4433,#661111)' },
  poison:   { light: '#EED4FF', mid: '#AA66CC', border: '#6C3483', artBg: 'linear-gradient(135deg,#8833AA,#551177)' },
  ground:   { light: '#FFF0D4', mid: '#DDB077', border: '#8B6914', artBg: 'linear-gradient(135deg,#AA8844,#775522)' },
  flying:   { light: '#E0EEFF', mid: '#99CCEE', border: '#4488BB', artBg: 'linear-gradient(135deg,#6699CC,#3366AA)' },
  bug:      { light: '#EEFFD4', mid: '#99CC55', border: '#4A7C00', artBg: 'linear-gradient(135deg,#66AA22,#336600)' },
  rock:     { light: '#EEE8D4', mid: '#AA9980', border: '#5A4A33', artBg: 'linear-gradient(135deg,#7A6044,#4A3A24)' },
  ghost:    { light: '#E8D4FF', mid: '#9977EE', border: '#4B0082', artBg: 'linear-gradient(135deg,#6644AA,#331166)' },
  ice:      { light: '#D4FFFF', mid: '#88CCDD', border: '#4477AA', artBg: 'linear-gradient(135deg,#66AACC,#3377AA)' },
  normal:   { light: '#EEEEDD', mid: '#BBBBAA', border: '#807860', artBg: 'linear-gradient(135deg,#A09878,#706858)' },
  dragon:   { light: '#D4D4FF', mid: '#8877EE', border: '#4444AA', artBg: 'linear-gradient(135deg,#6655BB,#3322AA)' },
  dark:     { light: '#D4D4D8', mid: '#888880', border: '#3A3A3A', artBg: 'linear-gradient(135deg,#555550,#222220)' },
  steel:    { light: '#DDEEFF', mid: '#9ABACC', border: '#556677', artBg: 'linear-gradient(135deg,#778899,#445566)' },
  fairy:    { light: '#FFD4EE', mid: '#FFAACC', border: '#CC6699', artBg: 'linear-gradient(135deg,#EE88BB,#BB5588)' },
};

// TCG energy circle color per type
const ENERGY_COLORS = {
  fire:     '#FF6B00',
  water:    '#2266AA',
  grass:    '#3A9140',
  electric: '#FFAA00',
  psychic:  '#EE4488',
  fighting: '#AA3333',
  poison:   '#8833AA',
  ground:   '#AA8833',
  flying:   '#6699CC',
  bug:      '#669922',
  rock:     '#7A6044',
  ghost:    '#6644AA',
  ice:      '#66AACC',
  normal:   '#A09878',
  dragon:   '#5060E1',
  dark:     '#4A3A4A',
  steel:    '#778899',
  fairy:    '#EE88BB',
};

// TCG-style weakness (primary type that deals double damage to this type)
const TYPE_WEAKNESS = {
  normal:   'fighting',
  fire:     'water',
  water:    'grass',
  grass:    'fire',
  electric: 'ground',
  ice:      'fire',
  fighting: 'psychic',
  poison:   'ground',
  ground:   'water',
  flying:   'electric',
  psychic:  'bug',
  bug:      'fire',
  rock:     'water',
  ghost:    'ghost',
  dragon:   'ice',
  dark:     'fighting',
  steel:    'fire',
  fairy:    'steel',
};

// TCG-style resistance (type this resists, or null)
const TYPE_RESISTANCE = {
  normal:   null,
  fire:     'grass',
  water:    'fire',
  grass:    'water',
  electric: 'flying',
  ice:      null,
  fighting: 'bug',
  poison:   'grass',
  ground:   'electric',
  flying:   'grass',
  psychic:  'fighting',
  bug:      'grass',
  rock:     'flying',
  ghost:    'fighting',
  dragon:   null,
  dark:     'psychic',
  steel:    'grass',
  fairy:    'fighting',
};

// Number of colorless energy circles needed to retreat (TCG mechanic)
const TYPE_RETREAT_COST = {
  normal:   1,
  fire:     2,
  water:    1,
  grass:    1,
  electric: 1,
  ice:      2,
  fighting: 1,
  poison:   2,
  ground:   3,
  flying:   0,
  psychic:  1,
  bug:      1,
  rock:     3,
  ghost:    1,
  dragon:   3,
  dark:     2,
  steel:    3,
  fairy:    1,
};
