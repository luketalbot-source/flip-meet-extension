// Node unit tests for the pure logic in content.js (detection, time math,
// poll building). content.js is a browser content script wrapped in an IIFE
// that exports its pure helpers via module.exports when running under Node.
// We stub the one global it touches at load time (document.addEventListener)
// so requiring it doesn't throw.
//
// Run: node test/logic.test.js

global.document = { addEventListener() {} };

const path = require("path");
const {
  detect,
  parseTimeArg,
  buildTimeLine,
  buildPollText,
  MACROS
} = require(path.join("..", "content.js"));

let failures = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.error(`✗ ${label}\n    expected ${e}\n    got      ${a}`);
  } else {
    console.log(`✓ ${label}`);
  }
}
function ok(cond, label) {
  if (!cond) {
    failures++;
    console.error(`✗ ${label}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

// ---- detection ----------------------------------------------------------
eq(detect("/meet"), { kind: "standalone", name: "meet", arg: "" }, "/meet exact");
eq(detect("  /meet  "), { kind: "standalone", name: "meet", arg: "" }, "/meet trimmed");
ok(detect("/meeting") === null, "/meeting does NOT fire");
ok(detect("let's /meet") === null, "prefix text + /meet does NOT fire (preserves v1 behaviour)");
eq(detect("/help"), { kind: "standalone", name: "help", arg: "" }, "/help");
eq(detect("/consent"), { kind: "standalone", name: "consent", arg: "" }, "/consent");
eq(detect("/time"), { kind: "standalone", name: "time", arg: "" }, "/time bare");
eq(detect("/time 3pm"), { kind: "standalone", name: "time", arg: "3pm" }, "/time with arg (paste case)");
eq(detect("/poll Lunch?"), { kind: "standalone", name: "poll", arg: "Lunch?" }, "/poll with arg");
eq(detect("/flip"), { kind: "standalone", name: "flip", arg: "" }, "/flip");

// macros (trailing)
eq(detect("/shrug"), { kind: "macro", name: "shrug", prefix: "" }, "/shrug bare");
eq(detect("oh well /shrug"), { kind: "macro", name: "shrug", prefix: "oh well" }, "/shrug trailing keeps prefix");
eq(detect("/tableflip"), { kind: "macro", name: "tableflip", prefix: "" }, "/tableflip");
ok(detect("/notacommand") === null, "unknown slash word does NOT fire");

// ---- time parsing -------------------------------------------------------
eq(parseTimeArg("3pm"), { hasTime: true, hour: 15, minute: 0, sourceTz: null }, "3pm -> 15:00");
eq(parseTimeArg("3:30pm"), { hasTime: true, hour: 15, minute: 30, sourceTz: null }, "3:30pm");
eq(parseTimeArg("15:00"), { hasTime: true, hour: 15, minute: 0, sourceTz: null }, "24h 15:00");
eq(parseTimeArg("12am"), { hasTime: true, hour: 0, minute: 0, sourceTz: null }, "12am -> 00:00");
eq(parseTimeArg("12pm"), { hasTime: true, hour: 12, minute: 0, sourceTz: null }, "12pm -> noon");
eq(parseTimeArg("9am ET").sourceTz, "America/New_York", "trailing zone alias ET");
eq(parseTimeArg("9am ET").hour, 9, "9am ET hour");
eq(parseTimeArg("").hasTime, false, "empty arg -> no time");
eq(parseTimeArg("banana").hasTime, false, "garbage -> no time");
eq(parseTimeArg("25:00").hasTime, false, "invalid hour rejected");

// ---- time conversion (DST-aware via Intl) -------------------------------
// 3pm Berlin in mid-summer (CEST, UTC+2). New York is EDT (UTC-4): 9am.
// London BST (UTC+1): 2pm. Singapore (UTC+8): 9pm. SF PDT (UTC-7): 6am.
const summerNoonUTC = Date.UTC(2026, 6, 15, 12, 0, 0); // 15 Jul 2026, 12:00 UTC
const line = buildTimeLine(
  { hasTime: true, hour: 15, minute: 0, sourceTz: "Europe/Berlin" },
  summerNoonUTC
);
console.log("    summer /time 3pm Berlin =>", line);
ok(/Berlin/.test(line) && /New York/.test(line), "time line names zones");
ok(line.includes("3:00 PM Berlin"), "3pm shows as 3:00 PM Berlin");
ok(line.includes("9:00 AM New York"), "3pm Berlin (CEST) = 9:00 AM New York (EDT)");
ok(line.includes("2:00 PM London"), "3pm Berlin = 2:00 PM London (BST)");
ok(line.includes("9:00 PM Singapore"), "3pm Berlin = 9:00 PM Singapore");
ok(line.includes("6:00 AM San Francisco"), "3pm Berlin = 6:00 AM San Francisco (PDT)");

// Winter check: 3pm Berlin (CET, UTC+1) -> New York EST (UTC-5) = 9am.
const winterNoonUTC = Date.UTC(2026, 0, 15, 12, 0, 0); // 15 Jan 2026
const wline = buildTimeLine(
  { hasTime: true, hour: 15, minute: 0, sourceTz: "Europe/Berlin" },
  winterNoonUTC
);
console.log("    winter /time 3pm Berlin =>", wline);
ok(wline.includes("9:00 AM New York"), "winter: 3pm Berlin (CET) = 9:00 AM New York (EST)");

// DST transition days (regression for the spring-forward bug). On the
// changeover day, a valid wall time within an hour of the transition must
// still round-trip to itself in the source zone.
// Berlin spring-forward: 29 Mar 2026, 02:00 -> 03:00. 1:30 AM is valid (CET).
const berlinSpring = buildTimeLine(
  { hasTime: true, hour: 1, minute: 30, sourceTz: "Europe/Berlin" },
  Date.UTC(2026, 2, 29, 10, 0, 0)
);
console.log("    1:30 Berlin spring-forward day =>", berlinSpring);
ok(berlinSpring.includes("1:30 AM Berlin"), "DST: 1:30 AM Berlin on spring-forward day is not shifted");

// New York spring-forward: 8 Mar 2026, 02:00 -> 03:00. 1:30 AM valid (EST).
const nySpring = buildTimeLine(
  { hasTime: true, hour: 1, minute: 30, sourceTz: "America/New_York" },
  Date.UTC(2026, 2, 8, 17, 0, 0)
);
console.log("    1:30 New York spring-forward day =>", nySpring);
ok(nySpring.includes("1:30 AM New York"), "DST: 1:30 AM New York on spring-forward day is not shifted");

// Berlin fall-back: 25 Oct 2026, 03:00 -> 02:00. 2:30 AM is ambiguous but
// must still display as 2:30 AM Berlin (the typed time), not shift.
const berlinFall = buildTimeLine(
  { hasTime: true, hour: 2, minute: 30, sourceTz: "Europe/Berlin" },
  Date.UTC(2026, 9, 25, 10, 0, 0)
);
console.log("    2:30 Berlin fall-back day =>", berlinFall);
ok(berlinFall.includes("2:30 AM Berlin"), "DST: 2:30 AM Berlin on fall-back day displays the typed time");

// Day-rollover marker: 11pm Berlin -> Singapore is next day (+1).
const dayLine = buildTimeLine(
  { hasTime: true, hour: 23, minute: 0, sourceTz: "Europe/Berlin" },
  summerNoonUTC
);
console.log("    11pm Berlin =>", dayLine);
ok(dayLine.includes("Singapore (+1)"), "11pm Berlin rolls Singapore to next day (+1)");

// ---- poll building ------------------------------------------------------
eq(
  buildPollText("Lunch where?", ["Thai", "Sushi", "", "Burgers"]),
  "📊 Lunch where?\n\n1️⃣ Thai\n2️⃣ Sushi\n3️⃣ Burgers",
  "poll skips empty options and numbers sequentially"
);

console.log(
  failures === 0
    ? "\nAll tests passed."
    : `\n${failures} test(s) FAILED.`
);
process.exit(failures === 0 ? 0 : 1);
