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
 *   #34: the message of a git error of the server shown in a notification is escaped (version control)
 *   #37: the file name in the confirmation of a revert is escaped; notifyGitError moved to RED.errors
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");

const NR_TEST_UTILS = require("nr-test-utils");
const catalog = require("../../helpers/catalog");

const errorsModulePath = NR_TEST_UTILS.resolve("@node-red/editor-client/src/js/ui/common/errors.js");
const versionControlModulePath = NR_TEST_UTILS.resolve("@node-red/editor-client/src/js/ui/projects/tab-versionControl.js");

describe("editor-client/ui/projects/tab-versionControl (#34)", function() {
    const INJECTION = catalog.INJECTION;
    let versionControl;
    let notifier;
    let savedGlobals;

    beforeEach(function() {
        savedGlobals = { RED: global.RED, $: global.$ };
        notifier = catalog.createNotifier();
        global.RED = { _: catalog.translate, notify: notifier.notify, sidebar: {} };
        global.$ = function() { return {}; };
        delete require.cache[errorsModulePath];
        delete require.cache[versionControlModulePath];
        require(errorsModulePath);
        versionControl = require(versionControlModulePath);
    });

    afterEach(function() {
        delete require.cache[errorsModulePath];
        delete require.cache[versionControlModulePath];
        Object.keys(savedGlobals).forEach(function(key) {
            if (savedGlobals[key] === undefined) {
                delete global[key];
            } else {
                global[key] = savedGlobals[key];
            }
        });
    });

    describe("revertConfirmMessage (#37)", function() {
        it("shows the file name as text", function() {
            const html = versionControl.revertConfirmMessage("flows/" + INJECTION + ".json");
            html.should.equal("Are you sure you want to revert the changes to 'flows/&lt;img src=x onerror=alert(1)&gt;.json'? This cannot be undone.");
            catalog.assertNoMarkup(html);
            catalog.assertNoElement(html, "img");
        });

        it("keeps a normal file name and escapes the quotes", function() {
            versionControl.revertConfirmMessage("flows.json").should.containEql("'flows.json'");
            versionControl.revertConfirmMessage("a\"b'c").should.containEql("'a&quot;b&#39;c'");
        });
    });

    describe("notifyConnectionFailed (pull)", function() {
        it("shows the catalog text and the message of the error as text", function() {
            versionControl.notifyConnectionFailed({ code: "git_connection_failed", message: INJECTION });
            notifier.notifications.should.have.length(1);
            const n = notifier.notifications[0];
            n.msg.should.equal("Could not connect to remote repository: &lt;img src=x onerror=alert(1)&gt;");
            catalog.assertNoMarkup(n.msg);
            n.options.should.equal("warning");
        });

        it("does not show \"[object Object]\" for the error object of the server", function() {
            versionControl.notifyConnectionFailed({ code: "git_connection_failed", message: "no route" });
            notifier.notifications[0].msg.should.equal("Could not connect to remote repository: no route");
        });
    });
});
