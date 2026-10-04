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
 *   #34: the real en-US catalog as RED._ and a recorder of RED.notify for the unit tests of the editor
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const fs = require("fs");

const NR_TEST_UTILS = require("nr-test-utils");

const enUS = JSON.parse(fs.readFileSync(NR_TEST_UTILS.resolve("@node-red/editor-client/locales/en-US/editor.json")));

/** The text a hostile server (or user) could send: an element with an event handler. */
const INJECTION = "<img src=x onerror=alert(1)>";

/**
 * RED._ with the real en-US catalog: a missing key fails the test, the parameters are interpolated
 * (as i18next does with the editor's `__name__` placeholders).
 */
function translate(key, params) {
    let value = enUS;
    key.split(".").forEach(function(part) {
        if (value === undefined || value === null || !Object.prototype.hasOwnProperty.call(value, part)) {
            throw new Error("missing translation key " + key);
        }
        value = value[part];
    });
    return String(value).replace(/__([^_\s]+?)__/g, function(match, name) {
        return params && params[name] !== undefined ? params[name] : match;
    });
}

/** RED.notify that records the notifications; the returned object can be closed and updated. */
function createNotifier() {
    const notifications = [];
    function notify(msg, options) {
        const n = {
            msg,
            options,
            closed: false,
            close() { n.closed = true; },
            update(newMsg, newOptions) { n.msg = newMsg; n.options = newOptions; }
        };
        notifications.push(n);
        return n;
    }
    return { notify, notifications };
}

/** No markup of the injection may survive in a message that is inserted as HTML. */
function assertNoMarkup(msg) {
    msg.should.not.containEql("<img");
    msg.should.not.containEql("<script");
    msg.should.not.containEql("onerror=alert(1)>");
}

module.exports = { translate, createNotifier, assertNoMarkup, INJECTION };
