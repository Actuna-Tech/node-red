/**
 * Copyright OpenJS Foundation and other contributors, https://openjsf.org/
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/
/*
 * Modified by Actuna Sp. z o.o.:
 *   #63: new file - the case table of the limit that the JSON and urlencoded body parsers get from the `apiMaxLength`
 *   setting; shared by the editor-api tests (the Admin API parsers) and the tests of the "http in" node (its parsers),
 *   so that the two copies of the rule are held equal by one table
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

/**
 * The limit given to `bodyParser.json` and `bodyParser.urlencoded`:
 *
 *   limit = clamp(apiMaxLength || "5mb")
 *
 * where `clamp` gives the maximum string length of Node.js (`require("buffer").constants.MAX_STRING_LENGTH`) when the
 * size that the `bytes` module of `body-parser` reads from the value is larger, and the value unchanged otherwise
 * (also a value `bytes` cannot read: the parsers then treat it as they always did).
 *
 * Every case has:
 *   - `label`: a printable name for the title of a test
 *   - `given`: whether the `apiMaxLength` setting is present at all (`false`: the settings have no such key)
 *   - `value`: the value of the setting (when `given`)
 *   - `expected`: the limit the parsers must get; computed with the `bytes` module resolved from `body-parser` (the
 *     module the parsers use), so the table follows the rules of the pinned version
 *   - `group`: "default" (the default of 5 MB), "unchanged" (kept), "clamped" (replaced by the maximum string length),
 *     "unreadable" (`bytes` cannot read it; kept)
 *
 * The cases are checked against the rule of `bytes` for each value by the self-check of the consumers: see
 * `anchors` for the values whose result is known from the rule and does not depend on the version.
 */
const path = require("path");

const MAX = require("buffer").constants.MAX_STRING_LENGTH;
const DEFAULT_LIMIT = "5mb";
const bytes = require(require.resolve("bytes", { paths: [path.dirname(require.resolve("body-parser"))] }));

function label(value) {
    if (typeof value === "string") {
        return JSON.stringify(value.length > 40 ? value.substring(0, 20) + "..." + "(" + value.length + " characters)" : value);
    }
    if (typeof value === "object" && value !== null) {
        return "an object";
    }
    return typeof value + " " + String(value);
}

// The limit by the rule above
function expectedLimit(value) {
    const effective = value || DEFAULT_LIMIT;
    const size = bytes.parse(effective);
    return (typeof size === "number" && size > MAX) ? MAX : effective;
}

function groupOf(value) {
    if (!value) {
        return "default";
    }
    const size = bytes.parse(value);
    if (typeof size !== "number") {
        return "unreadable";
    }
    return size > MAX ? "clamped" : "unchanged";
}

// Objects are shared: the same reference goes into the settings and comes out as the limit
const EMPTY_OBJECT = {};

// [value] or [value, label]; the setting is present in all of them (the absent one is added below)
const entries = [
    // row 5.1: every falsy value: the default
    [undefined, "undefined given explicitly"], [null], [0], [""], [NaN],
    // row 5.2: sizes; whether one stays or is replaced follows from the rule (512mb is above the maximum string length)
    ["5mb"], ["512mb"], ["511mb"], [1048576], ["10kb"], ["+5mb"], ["1e9"],
    // row 5.3: sizes above the maximum string length
    ["1gb"], [1e9], [Infinity], ["+1gb"], ["600000000abc"], ["1 GB"], [" 600000000"], ["1gb "], ["1\tgb"], ["1.5pb"],
    [1e400, "number 1e400 (Infinity)"], ["1tb"], ["0.5gb"], [MAX + 1], [(MAX + 1) + "b"], [String(MAX + 1)],
    // row 5.4: what `bytes` cannot read, and sizes that are not above the maximum
    ["abc"], [EMPTY_OBJECT], [true], [10n], ["0x40000000"], [-1], [-Infinity], [MAX], [String(MAX)],
    // row 5.5: a very long text (more than 32 characters), the same rule
    ["1" + " ".repeat(40) + "gb"], ["5" + " ".repeat(40) + "mb"], ["9".repeat(40)], ["0".repeat(40)]
];

const cases = [{ label: "absent (the setting is not there)", given: false, value: undefined, expected: expectedLimit(undefined), group: "default" }]
    .concat(entries.map(function(entry) {
        return {
            label: entry.length > 1 ? entry[1] : label(entry[0]),
            given: true,
            value: entry[0],
            expected: expectedLimit(entry[0]),
            group: groupOf(entry[0])
        };
    }));

// Values whose result is known from the rule, whatever the version of `bytes`: the consumers assert them against the
// table, so a table that was computed wrongly does not make the tests pass
const anchors = {
    clamped: ["1gb", 1e9, Infinity, "+1gb", "600000000abc"],
    unchanged: ["5mb", "+5mb", "1e9", -1, -Infinity],
    default: [undefined, null, 0, "", NaN]
};

module.exports = {
    MAX: MAX,
    DEFAULT_LIMIT: DEFAULT_LIMIT,
    bytes: bytes,
    cases: cases,
    anchors: anchors,
    // the settings object for a case
    settingsFor: function(c) {
        return c.given ? { apiMaxLength: c.value } : {};
    }
};
