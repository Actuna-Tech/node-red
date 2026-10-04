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
 *   #34: the message and the code of a server error shown in a notification are escaped (projects)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const sinon = require("sinon");

const NR_TEST_UTILS = require("nr-test-utils");
const catalog = require("../../helpers/catalog");

const errorsModulePath = NR_TEST_UTILS.resolve("@node-red/editor-client/src/js/ui/common/errors.js");
const projectsModulePath = NR_TEST_UTILS.resolve("@node-red/editor-client/src/js/ui/projects/projects.js");

describe("editor-client/ui/projects/projects (#34)", function() {
    const INJECTION = catalog.INJECTION;
    let projects;
    let notifier;
    let savedGlobals;

    beforeEach(function() {
        savedGlobals = { RED: global.RED, $: global.$ };
        sinon.stub(console, "log"); // reportUnexpectedError logs the error
        notifier = catalog.createNotifier();
        global.RED = { _: catalog.translate, notify: notifier.notify };
        global.$ = function() { return {}; };
        delete require.cache[errorsModulePath];
        delete require.cache[projectsModulePath];
        require(errorsModulePath);
        projects = require(projectsModulePath);
    });

    afterEach(function() {
        sinon.restore();
        delete require.cache[errorsModulePath];
        delete require.cache[projectsModulePath];
        Object.keys(savedGlobals).forEach(function(key) {
            if (savedGlobals[key] === undefined) {
                delete global[key];
            } else {
                global[key] = savedGlobals[key];
            }
        });
    });

    describe("reportUnexpectedError", function() {
        it("shows the message and the code of the error as text", function() {
            projects.reportUnexpectedError({ code: INJECTION, message: INJECTION });
            notifier.notifications.should.have.length(1);
            const n = notifier.notifications[0];
            n.msg.should.equal("<p>An unexpected error occurred:</p><p>&lt;img src=x onerror=alert(1)&gt;</p>" +
                "<small>code: &lt;img src=x onerror=alert(1)&gt;</small>");
            catalog.assertNoMarkup(n.msg);
            n.options.type.should.equal("error");
        });

        it("escapes quotes and the ampersand", function() {
            projects.reportUnexpectedError({ code: "c\"'", message: "a & \"b\"" });
            notifier.notifications[0].msg.should.containEql("<p>a &amp; &quot;b&quot;</p>");
            notifier.notifications[0].msg.should.containEql("code: c&quot;&#39;</small>");
        });

        it("shows an empty text for a missing message or code", function() {
            projects.reportUnexpectedError({});
            notifier.notifications[0].msg.should.equal("<p>An unexpected error occurred:</p><p></p><small>code: </small>");
        });

        it("keeps the catalog text of a missing git user", function() {
            projects.reportUnexpectedError({ code: "git_missing_user", message: INJECTION });
            notifier.notifications[0].msg.should.equal("<p>Your Git client is not configured with a username/email.</p>");
        });
    });

    describe("notifyGitError (git_connection_failed, git_not_a_repository, git_repository_not_found)", function() {
        it("shows the message of the server as text", function() {
            projects.notifyGitError({ code: "git_connection_failed", message: INJECTION });
            notifier.notifications.should.have.length(1);
            notifier.notifications[0].msg.should.equal("&lt;img src=x onerror=alert(1)&gt;");
            notifier.notifications[0].options.should.equal("error");
        });
    });
});
