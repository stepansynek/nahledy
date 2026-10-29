// Everything here is fictional: NORIK is a made-up brand for a redesign pitch.
// Classic script (not a module) so the page also works opened straight from disk.
const NORIK = {};

NORIK.MODELS = {
  krok: {
    name: "Krok", type: "Městský hatchback", vat: true, paint: "ryzak",
    tags: ["mesto", "rodina"],
    line: "Malé auto do města a na dojíždění.",
    specs: [["Kufr", "352 l"], ["Spotřeba", "4,9 l/100 km"], ["Délka", "4,00 m"]],
    base: 349900,
    engines: [
      { id: "b67", name: "1.0 benzin, 67 kW, manuál", price: 0 },
      { id: "lpg", name: "1.0 benzin + LPG, 74 kW, manuál", price: 18000 },
    ],
    trims: { start: 0, komfort: 29000, plus: 58000 },
  },
  klus: {
    name: "Klus", type: "Kombi", vat: true, paint: "hnedak",
    tags: ["rodina", "prace"],
    line: "Rodinné kombi, do kterého se vejde kočárek i kola.",
    specs: [["Kufr", "610 l"], ["Spotřeba LPG", "7,4 l/100 km"], ["Délka", "4,55 m"]],
    base: 419900,
    engines: [
      { id: "lpg", name: "1.0 benzin + LPG, 74 kW, manuál", price: 0 },
      { id: "b96a", name: "1.5 benzin, 96 kW, automat", price: 46000 },
    ],
    trims: { start: 0, komfort: 30000, plus: 62000 },
  },
  cval: {
    name: "Cval", type: "SUV", vat: true, paint: "grosak",
    tags: ["rodina"],
    line: "SUV na chatu, do kopců a na horší cesty.",
    specs: [["Světlá výška", "20 cm"], ["Kufr", "512 l"], ["Přívěs", "až 1 500 kg"]],
    base: 529900,
    engines: [
      { id: "b110", name: "1.5 benzin, 110 kW, manuál", price: 0 },
      { id: "b110x", name: "1.5 benzin, 110 kW, 4×4, manuál", price: 60000 },
    ],
    trims: { start: 0, komfort: 35000, plus: 70000 },
  },
  tah: {
    name: "Tah", type: "Dodávka", vat: false, paint: "belous",
    tags: ["prace"],
    line: "Dodávka pro řemeslo, rozvoz a stavbu.",
    specs: [["Ložný prostor", "3,3 m³"], ["Užitečná hmotnost", "800 kg"], ["Europalety", "2"]],
    base: 419900,
    engines: [
      { id: "d75", name: "1.5 diesel, 75 kW, manuál", price: 0 },
      { id: "d96", name: "1.5 diesel, 96 kW, manuál", price: 28000 },
    ],
    trims: { start: 0, komfort: 24000, plus: 48000 },
  },
};

NORIK.TRIMS = {
  start: { name: "Start", wheel: "kryt", text: "Klimatizace, rádio s Bluetooth, tempomat, šest airbagů, ocelová kola 16″ s kryty." },
  komfort: { name: "Komfort", wheel: "alu16", text: "Navíc 8″ displej s Android Auto a Apple CarPlay, couvací kamera, vyhřívaná sedadla, litá kola 16″." },
  plus: { name: "Plus", wheel: "alu17", text: "Navíc automatická klimatizace, LED světlomety, odemykání bez klíče, litá kola 17″." },
};

// paints are named after horse coats
NORIK.PAINTS = {
  grosak: { name: "Grošák", kind: "šedá metalíza", hex: "#8b8e92", price: 14900 },
  belous: { name: "Bělouš", kind: "bílá", hex: "#ecebe7", price: 0 },
  vranik: { name: "Vraník", kind: "černá metalíza", hex: "#1b1c1f", price: 14900 },
  ryzak: { name: "Ryzák", kind: "měděná metalíza", hex: "#9a4422", price: 14900 },
  hnedak: { name: "Hnědák", kind: "hnědá metalíza", hex: "#5a3a27", price: 14900 },
  plavak: { name: "Plavák", kind: "písková", hex: "#c6b089", price: 0 },
};

NORIK.EXTRAS = [
  { id: "tazne", name: "Odnímatelné tažné zařízení", price: 14900 },
  { id: "zimni", name: "Sada zimních kol na discích", price: 21900 },
  { id: "koberce", name: "Gumové koberce a vana do kufru", price: 2490, not: ["tah"] },
  { id: "regal", name: "Regál do nákladového prostoru", price: 18900, only: ["tah"] },
];

// Cval Komfort or Plus: winter wheels free until the end of the year
NORIK.OFFER = { model: "cval", trims: ["komfort", "plus"], extra: "zimni", until: "31. 12. 2026" };

NORIK.FINANCE = { down: 0.3, months: 60, rate: 0.069 };

// [name, area, lat, lon, services]
NORIK.DEALERS = [
  ["Praha-Chodov", "Praha 4", 50.031, 14.491, "Prodej a servis"],
  ["Praha-Zličín", "Praha 5", 50.054, 14.290, "Prodej a servis"],
  ["Praha-Letňany", "Praha 18", 50.135, 14.515, "Prodej a servis"],
  ["Brno-Ivanovice", "Brno-sever", 49.240, 16.585, "Prodej a servis"],
  ["Brno-Heršpice", "Brno-jih", 49.168, 16.592, "Servis"],
  ["Ostrava", "Ostrava-Hrabová", 49.775, 18.262, "Prodej a servis"],
  ["Plzeň", "Plzeň-Borská pole", 49.722, 13.348, "Prodej a servis"],
  ["Liberec", "Liberec-Vratislavice", 50.743, 15.083, "Prodej a servis"],
  ["Olomouc", "Olomouc-Holice", 49.580, 17.290, "Prodej a servis"],
  ["České Budějovice", "České Budějovice 2", 48.975, 14.474, "Prodej a servis"],
  ["Hradec Králové", "Hradec Králové-Kukleny", 50.209, 15.810, "Prodej a servis"],
  ["Ústí nad Labem", "Ústí nad Labem-Trmice", 50.646, 13.995, "Prodej a servis"],
  ["Pardubice", "Pardubice-Polabiny", 50.050, 15.760, "Prodej a servis"],
  ["Zlín", "Zlín-Malenovice", 49.210, 17.600, "Prodej a servis"],
  ["Jihlava", "Jihlava-Pávov", 49.425, 15.590, "Prodej a servis"],
  ["Karlovy Vary", "Karlovy Vary-Dvory", 50.225, 12.835, "Prodej a servis"],
  ["Kladno", "Kladno-Kročehlavy", 50.137, 14.090, "Servis"],
  ["Most", "Most", 50.503, 13.636, "Servis"],
  ["Opava", "Opava-Kateřinky", 49.947, 17.920, "Prodej a servis"],
  ["Frýdek-Místek", "Frýdek-Místek", 49.683, 18.350, "Servis"],
  ["Mladá Boleslav", "Mladá Boleslav", 50.411, 14.906, "Prodej a servis"],
  ["Prostějov", "Prostějov", 49.472, 17.111, "Servis"],
  ["Třebíč", "Třebíč", 49.215, 15.882, "Servis"],
  ["Tábor", "Tábor-Čápova Pole", 49.414, 14.658, "Prodej a servis"],
  ["Znojmo", "Znojmo", 48.856, 16.049, "Prodej a servis"],
  ["Příbram", "Příbram", 49.690, 14.010, "Servis"],
  ["Cheb", "Cheb", 50.080, 12.374, "Servis"],
  ["Trutnov", "Trutnov", 50.561, 15.913, "Prodej a servis"],
  ["Kolín", "Kolín", 50.028, 15.200, "Servis"],
  ["Písek", "Písek", 49.309, 14.148, "Servis"],
  ["Šumperk", "Šumperk", 49.965, 16.971, "Prodej a servis"],
  ["Vsetín", "Vsetín", 49.339, 17.996, "Servis"],
  ["Havlíčkův Brod", "Havlíčkův Brod", 49.607, 15.581, "Servis"],
  ["Klatovy", "Klatovy", 49.395, 13.295, "Prodej a servis"],
  ["Uherské Hradiště", "Staré Město", 49.075, 17.433, "Prodej a servis"],
  ["Svitavy", "Svitavy", 49.756, 16.469, "Servis"],
  ["Náchod", "Náchod", 50.416, 16.163, "Servis"],
  ["Břeclav", "Břeclav", 48.759, 16.882, "Servis"],
  ["Česká Lípa", "Česká Lípa", 50.686, 14.538, "Servis"],
  ["Strakonice", "Strakonice", 49.261, 13.902, "Servis"],
  ["Žďár nad Sázavou", "Žďár nad Sázavou", 49.563, 15.939, "Servis"],
  ["Nový Jičín", "Nový Jičín", 49.594, 18.010, "Servis"],
];

// towns a visitor can search from: [name, lat, lon]
NORIK.TOWNS = [
  ["Praha", 50.083, 14.421], ["Brno", 49.195, 16.608], ["Ostrava", 49.820, 18.262], ["Plzeň", 49.738, 13.373],
  ["Liberec", 50.767, 15.056], ["Olomouc", 49.594, 17.251], ["České Budějovice", 48.975, 14.474],
  ["Hradec Králové", 50.209, 15.833], ["Ústí nad Labem", 50.661, 14.032], ["Pardubice", 50.034, 15.781],
  ["Zlín", 49.226, 17.667], ["Havířov", 49.780, 18.430], ["Kladno", 50.147, 14.103], ["Most", 50.503, 13.636],
  ["Opava", 49.938, 17.903], ["Frýdek-Místek", 49.683, 18.350], ["Karviná", 49.854, 18.543],
  ["Jihlava", 49.396, 15.591], ["Teplice", 50.640, 13.825], ["Děčín", 50.773, 14.196],
  ["Karlovy Vary", 50.231, 12.871], ["Jablonec nad Nisou", 50.724, 15.171], ["Mladá Boleslav", 50.411, 14.906],
  ["Prostějov", 49.472, 17.111], ["Přerov", 49.455, 17.451], ["Česká Lípa", 50.686, 14.538],
  ["Třebíč", 49.215, 15.882], ["Třinec", 49.678, 18.672], ["Tábor", 49.414, 14.658], ["Znojmo", 48.856, 16.049],
  ["Příbram", 49.690, 14.010], ["Cheb", 50.080, 12.374], ["Kolín", 50.028, 15.200], ["Trutnov", 50.561, 15.913],
  ["Písek", 49.309, 14.148], ["Kroměříž", 49.298, 17.393], ["Orlová", 49.845, 18.430], ["Vsetín", 49.339, 17.996],
  ["Šumperk", 49.965, 16.971], ["Uherské Hradiště", 49.070, 17.460], ["Břeclav", 48.759, 16.882],
  ["Hodonín", 48.849, 17.132], ["Český Těšín", 49.746, 18.626], ["Litoměřice", 50.534, 14.132],
  ["Havlíčkův Brod", 49.607, 15.581], ["Nový Jičín", 49.594, 18.010], ["Chomutov", 50.460, 13.418],
  ["Krnov", 50.090, 17.704], ["Valašské Meziříčí", 49.472, 17.971], ["Kopřivnice", 49.599, 18.145],
  ["Strakonice", 49.261, 13.902], ["Klatovy", 49.395, 13.295], ["Žďár nad Sázavou", 49.563, 15.939],
  ["Kutná Hora", 49.948, 15.268], ["Beroun", 49.964, 14.072], ["Benešov", 49.782, 14.687],
  ["Mělník", 50.350, 14.474], ["Nymburk", 50.186, 15.042], ["Rakovník", 50.104, 13.733],
  ["Vyškov", 49.278, 16.999], ["Blansko", 49.363, 16.644], ["Kyjov", 49.010, 17.122],
  ["Prachatice", 49.013, 13.997], ["Český Krumlov", 48.811, 14.315], ["Jindřichův Hradec", 49.144, 15.003],
  ["Pelhřimov", 49.431, 15.223], ["Domažlice", 49.440, 12.930], ["Tachov", 49.795, 12.633],
  ["Rokycany", 49.743, 13.595], ["Sokolov", 50.181, 12.640], ["Louny", 50.357, 13.797], ["Žatec", 50.327, 13.546],
  ["Kadaň", 50.376, 13.271], ["Semily", 50.602, 15.335], ["Turnov", 50.587, 15.157], ["Jičín", 50.437, 15.352],
  ["Náchod", 50.416, 16.163], ["Rychnov nad Kněžnou", 50.163, 16.275], ["Ústí nad Orlicí", 49.974, 16.394],
  ["Chrudim", 49.951, 15.795], ["Svitavy", 49.756, 16.469], ["Litomyšl", 49.871, 16.313],
  ["Jeseník", 50.229, 17.205], ["Bruntál", 49.988, 17.465], ["Hranice", 49.548, 17.735],
  ["Uherský Brod", 49.025, 17.647], ["Rožnov pod Radhoštěm", 49.458, 18.143], ["Boskovice", 49.488, 16.660],
  ["Mikulov", 48.806, 16.638], ["Velké Meziříčí", 49.355, 16.012], ["Humpolec", 49.541, 15.359],
  ["Sušice", 49.231, 13.520], ["Vimperk", 49.053, 13.783], ["Milevsko", 49.451, 14.360],
  ["Říčany", 49.992, 14.654], ["Poděbrady", 50.142, 15.119], ["Čáslav", 49.911, 15.390],
  ["Vrchlabí", 50.627, 15.609], ["Dvůr Králové nad Labem", 50.432, 15.814], ["Lanškroun", 49.912, 16.612],
  ["Zábřeh", 49.883, 16.872], ["Bohumín", 49.904, 18.358], ["Hlučín", 49.898, 18.192],
  ["Roudnice nad Labem", 50.425, 14.261], ["Brandýs nad Labem", 50.187, 14.663], ["Sedlčany", 49.660, 14.427],
];
