import { mkdir, readFile, writeFile } from "node:fs/promises";

const TIME_ZONE = "America/Chicago";
const PHASE_MINUTES = 30;
const RAW_ASSET_BASE = "https://raw.githubusercontent.com/depthbomb/depthbomb/master/assets/time-of-day-phases";
const TEMPLATE_URL = new URL("../assets/time-of-day.template.svg", import.meta.url);
const PHASES_URL = new URL("../assets/time-of-day-phases/", import.meta.url);
const README_URL = new URL("../README.md", import.meta.url);
const README_PATTERN = /<!-- time-of-day:start -->[\s\S]*?<!-- time-of-day:end -->/;
const KEYFRAMES = Object.freeze([
  { minute: 0, top: "#080d2b", middle: "#20164d", bottom: "#4b3873" },
  { minute: 300, top: "#111536", middle: "#342452", bottom: "#72506f" },
  { minute: 360, top: "#4b4f90", middle: "#f28c5b", bottom: "#ffd08a" },
  { minute: 450, top: "#3094da", middle: "#86ccef", bottom: "#d9eff7" },
  { minute: 720, top: "#2388dd", middle: "#72c8f2", bottom: "#d6eff9" },
  { minute: 1020, top: "#2686d4", middle: "#77c4eb", bottom: "#dcecf1" },
  { minute: 1110, top: "#4a4d91", middle: "#f06b4f", bottom: "#ffbf72" },
  { minute: 1200, top: "#17153f", middle: "#49315f", bottom: "#8b526b" },
  { minute: 1260, top: "#080d2b", middle: "#20164d", bottom: "#4b3873" },
  { minute: 1440, top: "#080d2b", middle: "#20164d", bottom: "#4b3873" }
]);

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothstep(edgeStart, edgeEnd, value) {
  const progress = clamp((value - edgeStart) / (edgeEnd - edgeStart));

  return progress * progress * (3 - 2 * progress);
}

function parseHex(color) {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16)
  ];
}

function toHex(value) {
  return Math.round(value).toString(16).padStart(2, "0");
}

function blendColor(from, to, amount) {
  const fromRgb = parseHex(from);
  const toRgb = parseHex(to);
  const channels = fromRgb.map((value, index) => {
    return value + (toRgb[index] - value) * amount;
  });

  return `#${channels.map(toHex).join("")}`;
}

function formatNumber(value) {
  return value.toFixed(3).replace(/\.?0+$/, "");
}

function getDateArgument() {
  const argument = process.argv.find((value) => value.startsWith("--now="));

  if (!argument) {
    return new Date();
  }

  const date = new Date(argument.slice("--now=".length));

  if (Number.isNaN(date.getTime())) {
    throw new Error("--now must contain a valid ISO 8601 date and time.");
  }

  return date;
}

function getZonedTime(date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const entries = formatter.formatToParts(date)
    .filter(({ type }) => type !== "literal")
    .map(({ type, value }) => [type, value]);
  const parts = Object.fromEntries(entries);

  return {
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function findFramePair(minute) {
  for (let index = 0; index < KEYFRAMES.length - 1; index += 1) {
    const from = KEYFRAMES[index];
    const to = KEYFRAMES[index + 1];

    if (minute >= from.minute && minute <= to.minute) {
      return [from, to];
    }
  }

  return [KEYFRAMES[0], KEYFRAMES[1]];
}

function getSkyColors(minute) {
  const [from, to] = findFramePair(minute);
  const progress = (minute - from.minute) / (to.minute - from.minute);
  const eased = smoothstep(0, 1, progress);

  return {
    top: blendColor(from.top, to.top, eased),
    middle: blendColor(from.middle, to.middle, eased),
    bottom: blendColor(from.bottom, to.bottom, eased)
  };
}

function getDaylight(minute) {
  const sunriseFade = smoothstep(330, 390, minute);
  const sunsetFade = 1 - smoothstep(1110, 1170, minute);

  return sunriseFade * sunsetFade;
}

function getWarmTint(minute) {
  const sunriseDistance = Math.abs(minute - 360);
  const sunsetDistance = Math.abs(minute - 1110);
  const distance = Math.min(sunriseDistance, sunsetDistance);
  const strength = smoothstep(0, 1, clamp(1 - distance / 100));

  return strength * 0.48;
}

function getArchPosition(progress) {
  const normalized = clamp(progress);

  return {
    x: 45 + 660 * normalized,
    y: 155 - 120 * Math.sin(Math.PI * normalized)
  };
}

function getLoopOffset(minute, loopsPerDay) {
  const distance = minute / 1440 * 750 * loopsPerDay;

  return distance % 750;
}

function getTheme(minute) {
  if (minute < 330 || minute >= 1230) {
    return "night";
  }

  if (minute < 420) {
    return "sunrise";
  }

  if (minute < 1065) {
    return "day";
  }

  if (minute < 1170) {
    return "sunset";
  }

  return "twilight";
}

function buildStarField() {
  const starCount = 180;
  const maximumRadius = 520;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const stars = Array.from({ length: starCount }, (_, index) => {
    const radius = 24 + Math.sqrt((index + 0.5) / starCount) * maximumRadius;
    const angle = index * goldenAngle + Math.sin(index * 12.9898) * 0.18;
    const x = 375 + Math.cos(angle) * radius;
    const y = 95 + Math.sin(angle) * radius;
    const size = 0.55 + (index * 37 % 100) / 100 * 1.05;
    const opacity = 0.52 + (index * 53 % 100) / 100 * 0.43;

    return `        <circle cx="${formatNumber(x)}" cy="${formatNumber(y)}" r="${formatNumber(size)}" opacity="${formatNumber(opacity)}"/>`;
  });

  return stars.join("\n");
}

function replaceTokens(template, values) {
  const rendered = Object.entries(values).reduce((result, [name, value]) => {
    return result.replaceAll(`{{${name}}}`, String(value));
  }, template);
  const unresolved = rendered.match(/{{[A-Z_]+}}/g);

  if (unresolved) {
    throw new Error(`Unresolved SVG tokens: ${unresolved.join(", ")}`);
  }

  return rendered;
}

function buildSvg(template, minute) {
  const daylight = getDaylight(minute);
  const warmTint = getWarmTint(minute);
  const warmLighting = warmTint / 0.48;
  const sun = getArchPosition((minute - 360) / (1140 - 360));
  const moonMinute = minute >= 1140 ? minute : minute + 1440;
  const moon = getArchPosition((moonMinute - 1140) / 660);
  const colors = getSkyColors(minute);
  const hour = Math.floor(minute / 60);
  const phaseMinute = minute % 60;
  const time = `${String(hour).padStart(2, "0")}:${String(phaseMinute).padStart(2, "0")}`;
  const litHorizonTop = blendColor("#123127", "#66b84f", daylight);
  const litHorizonBottom = blendColor("#081c17", "#2f7a42", daylight);
  const litNearTerrain = blendColor("#061c12", "#16652e", daylight);
  const horizonTop = blendColor(litHorizonTop, "#7d8140", warmLighting * 0.18);
  const horizonBottom = blendColor(litHorizonBottom, "#52652d", warmLighting * 0.14);
  const nearTerrain = blendColor(litNearTerrain, "#355324", warmLighting * 0.12);

  return replaceTokens(template, {
    TIME: time,
    THEME: getTheme(minute),
    SKY_TOP: colors.top,
    SKY_MIDDLE: colors.middle,
    SKY_BOTTOM: colors.bottom,
    HORIZON_TOP: horizonTop,
    HORIZON_BOTTOM: horizonBottom,
    STARS_OPACITY: formatNumber(0.9 * (1 - daylight)),
    STAR_FIELD: buildStarField(),
    STAR_ROTATION: formatNumber(minute / 1440 * 360),
    SUN_X: formatNumber(sun.x),
    SUN_Y: formatNumber(sun.y),
    SUN_OPACITY: formatNumber(daylight),
    MOON_X: formatNumber(moon.x),
    MOON_Y: formatNumber(moon.y),
    MOON_OPACITY: formatNumber(1 - daylight),
    HAZE_OPACITY: formatNumber(0.25 + 0.47 * daylight),
    CLOUDS_OPACITY: formatNumber(0.25 + 0.37 * daylight),
    CLOUD_OFFSET_NEAR: formatNumber(getLoopOffset(minute, 1)),
    CLOUD_OFFSET_FAR: formatNumber(getLoopOffset(minute, 2)),
    NEAR_TERRAIN_COLOR: nearTerrain,
    NEAR_TERRAIN_OPACITY: formatNumber(0.86 + 0.1 * daylight),
    WARM_TINT: formatNumber(warmTint)
  });
}

function getPhaseName(minute) {
  const hour = Math.floor(minute / 60);
  const phaseMinute = minute % 60;

  return `${String(hour).padStart(2, "0")}${String(phaseMinute).padStart(2, "0")}`;
}

function buildReadmeBanner(phaseName) {
  return `<!-- time-of-day:start -->
<p align="center">
  <img src="${RAW_ASSET_BASE}/${phaseName}.svg" width="750" height="200" alt="Current sky in the America/Chicago timezone">
</p>
<!-- time-of-day:end -->`;
}

async function main() {
  const date = getDateArgument();
  const local = getZonedTime(date);
  const phaseMinute = Math.floor(local.minute / PHASE_MINUTES) * PHASE_MINUTES;
  const minute = local.hour * 60 + phaseMinute;
  const time = `${String(local.hour).padStart(2, "0")}:${String(phaseMinute).padStart(2, "0")}`;
  const template = await readFile(TEMPLATE_URL, "utf8");
  const readme = await readFile(README_URL, "utf8");
  const phases = Array.from({ length: 1440 / PHASE_MINUTES }, (_, index) => {
    return index * PHASE_MINUTES;
  });
  const banner = buildReadmeBanner(getPhaseName(minute));

  if (!README_PATTERN.test(readme)) {
    throw new Error("README time-of-day markers are missing.");
  }

  const updatedReadme = readme.replace(README_PATTERN, banner);

  await mkdir(PHASES_URL, { recursive: true });
  await Promise.all(phases.map((phase) => {
    const outputUrl = new URL(`${getPhaseName(phase)}.svg`, PHASES_URL);

    return writeFile(outputUrl, buildSvg(template, phase), "utf8");
  }));
  await writeFile(README_URL, updatedReadme, "utf8");

  console.log(`Generated ${phases.length} phases and selected ${time} ${TIME_ZONE}.`);
}

await main();
