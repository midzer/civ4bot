import fs from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { createRestAPIClient } from "masto";
import configFile from "./config.json" with { type: "json" };

const masto = createRestAPIClient({
  url: configFile.api_url,
  accessToken: configFile.access_token,
});

function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function stripNamespace(obj) {
  if (Array.isArray(obj)) return obj.map(stripNamespace);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k.includes(":") ? k.split(":").pop() : k] = stripNamespace(v);
    }
    return out;
  }
  return obj;
}

function getText(node) {
  if (node == null) return "";
  if (typeof node === "string") return node.trim();
  return String(node).trim();
}

function firstButtonPath(buttonValue) {
  if (!buttonValue) return "";
  const parts = String(buttonValue).split(",").map(s => s.trim());
  return parts.find(Boolean) ?? "";
}

function normalizedButtonImage(buttonValue) {
  const firstPath = firstButtonPath(buttonValue);
  if (!firstPath) return "";
  const base = path.basename(firstPath, path.extname(firstPath));
  if (!base) return "";
  return `${base.toLowerCase().replace(/\s+/g, "_")}.png`;
}

function randomFrom(array) {
  return array[Math.floor(Math.random() * array.length)];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true,
});

const techInfosXml = fs.readFileSync("./CIV4TechInfos.xml", "utf8");
const civ4GameTextXml = fs.readFileSync("./CIV4GameTextInfos.xml", "utf8");
const technologiesXml = fs.readFileSync("./Technologies.xml", "utf8");
const civ4GameTextObjectsXml = fs.readFileSync("./CIV4GameTextInfos_Objects.xml", "utf8");
const techQuotesXml = fs.readFileSync("./TechnologyQuotes.xml", "utf8");
const audioScriptsXml = fs.readFileSync("./Audio2DScripts.xml", "utf8");
const audioDefinesXml = fs.readFileSync("./AudioDefines.xml", "utf8");

const techInfos = stripNamespace(parser.parse(techInfosXml));
const civ4GameText = stripNamespace(parser.parse(civ4GameTextXml));
const technologies = stripNamespace(parser.parse(technologiesXml));
const civ4GameTextObjects = stripNamespace(parser.parse(civ4GameTextObjectsXml));
const techQuotes = stripNamespace(parser.parse(techQuotesXml));
const audioScripts = stripNamespace(parser.parse(audioScriptsXml));
const audioDefines = stripNamespace(parser.parse(audioDefinesXml));

const techList = ensureArray(techInfos.Civ4TechInfos?.TechInfos?.TechInfo);
const primaryQuotes = ensureArray(civ4GameText.Civ4GameText?.TEXT);
const techNames = ensureArray(technologies.Civ4GameText?.TEXT);
const fallbackQuotes = ensureArray(techQuotes.Civ4GameText?.TEXT);
const fallbackNames = ensureArray(civ4GameTextObjects.Civ4GameText?.TEXT);
const scriptList = ensureArray(audioScripts.Script2DSounds?.Script2DSound);
const soundList = ensureArray(audioDefines.AudioDefines?.SoundDatas?.SoundData);

const quoteByTagPrimary = new Map(primaryQuotes.map(t => [getText(t.Tag), getText(t.English)]));
const quoteByTagFallback = new Map(fallbackQuotes.map(t => [getText(t.Tag), getText(t.English)]));
const techNameByTagPrimary = new Map(techNames.map(t => [getText(t.Tag), getText(t.English)]));
const techNameByTagFallback = new Map(fallbackNames.map(t => [getText(t.Tag), getText(t.English)]));
const scriptById = new Map(scriptList.map(s => [getText(s.ScriptID), s]));
const soundById = new Map(soundList.map(s => [getText(s.SoundID), s]));

const randomTech = randomFrom(techList);
if (!randomTech) process.exit(0);

const techTag = getText(randomTech.Description);
const techName = techNameByTagPrimary.get(techTag) ?? techNameByTagFallback.get(techTag) ?? techTag;
const quoteTag = getText(randomTech.Quote);
const buttonRaw = getText(randomTech.Button);
const soundScriptId = getText(randomTech.Sound);

const buttonPath = firstButtonPath(buttonRaw);
const imageFile = normalizedButtonImage(buttonRaw);
const imagePath = imageFile
  ? path.join("./", path.dirname(buttonPath || "."), imageFile).replace(/\\/g, "/")
  : "";

const quote = quoteByTagPrimary.get(quoteTag) ?? quoteByTagFallback.get(quoteTag) ?? "";
const script = scriptById.get(soundScriptId);
const soundId = script ? getText(script.SoundID) : "";
const soundData = soundById.get(soundId);
const audioFilename = soundData ? getText(soundData.Filename) : "";
const audioPath = audioFilename ? path.join("./Tech", audioFilename).replace(/\\/g, "/") : "";

if (!buttonPath || !quote || !soundScriptId || !script || !soundId || !soundData || !audioFilename) {
  process.exit(0);
}

const mediaIds = [
  (
    await masto.v2.media.create({
      file: new Blob([fs.readFileSync(imagePath)]),
      description: quote.slice(0, 420),
      ...(fs.existsSync(audioPath)
        ? { thumbnail: new Blob([fs.readFileSync(audioPath)]) }
        : {}),
    })
  ).id,
];

await masto.v1.statuses.create({
  status: `${techName}: ${quote}`,
  visibility: "public",
  mediaIds,
});
