/**
 * Copyright JS Foundation and other contributors, http://js.foundation
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
 *   user menu: tests for the username rendered as text and the user details refreshed after re-login
 *   #37: the stand-in of RED.utils.sanitize escapes the quotes like the real one
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const sinon = require("sinon");

const NR_TEST_UTILS = require("nr-test-utils");

const userModulePath = NR_TEST_UTILS.resolve("@node-red/editor-client/src/js/user.js");

const MALICIOUS_NAME = "<img src=x onerror=alert(1)>";
const ESCAPED_NAME = "&lt;img src=x onerror=alert(1)&gt;";

/**
 * Minimal chainable jQuery stand-in: every method returns the same wrapper,
 * so DOM building code runs without a DOM. Event handlers registered with
 * `.on(evt, fn)` are recorded per selector so tests can trigger them, and
 * `$.ajax` calls are recorded so tests can resolve them.
 */
function createJQueryMock() {
    const handlers = {};
    const ajaxCalls = [];
    function wrap(selector) {
        const target = function() {};
        const proxy = new Proxy(target, {
            get: function(t, prop) {
                if (prop === "then") {
                    return undefined;
                }
                if (prop === Symbol.toPrimitive) {
                    return function() { return ""; };
                }
                if (prop === "on") {
                    return function(evt, fn) {
                        const key = selector + " " + evt;
                        handlers[key] = handlers[key] || [];
                        handlers[key].push(fn);
                        return proxy;
                    };
                }
                return function() { return proxy; };
            }
        });
        return proxy;
    }
    const $ = function(selector) {
        return wrap(typeof selector === "string" ? selector : "[object]");
    };
    $.ajax = function(opts) {
        const call = { opts: opts, done: [], fail: [], always: [] };
        ajaxCalls.push(call);
        const deferred = {
            done: function(fn) { call.done.push(fn); return deferred; },
            fail: function(fn) { call.fail.push(fn); return deferred; },
            always: function(fn) { call.always.push(fn); return deferred; }
        };
        return deferred;
    };
    return { $: $, handlers: handlers, ajaxCalls: ajaxCalls };
}

describe("editor-client/user", function() {
    let jq;
    let mockRED;
    let menuItems;

    beforeEach(function() {
        jq = createJQueryMock();
        global.$ = jq.$;
        menuItems = [];
        mockRED = {
            _: function(key, opts) {
                return key + (opts ? JSON.stringify(opts) : "");
            },
            settings: {
                user: { username: "fred" },
                editorTheme: {},
                get: sinon.stub().returns(null),
                set: sinon.stub(),
                remove: sinon.stub(),
                load: sinon.stub(),
                refreshSettings: sinon.stub()
            },
            menu: {
                init: sinon.stub(),
                addItem: function(id, opts) {
                    menuItems.push(opts);
                }
            },
            utils: {
                // Same implementation as RED.utils.sanitize (ui/utils.js, #37: the quotes too)
                sanitize: function(m) {
                    return m.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
                }
            },
            notify: sinon.stub(),
            events: { emit: sinon.stub() },
            keyboard: { enable: sinon.stub(), disable: sinon.stub() }
        };
        global.RED = mockRED;
        delete require.cache[userModulePath];
        require(userModulePath);
    });

    afterEach(function() {
        sinon.restore();
        delete global.RED;
        delete global.$;
        delete require.cache[userModulePath];
    });

    function findItem(id) {
        return menuItems.filter(function(item) { return item.id === id; }).pop();
    }

    describe("user menu", function() {
        it("renders the username as text, not HTML", function() {
            mockRED.settings.user = { username: MALICIOUS_NAME };
            RED.user.init();
            const item = findItem("usermenu-item-username");
            should.exist(item);
            item.label.should.not.containEql("<img");
            item.label.should.equal("<b>" + ESCAPED_NAME + "</b>");
        });

        it("renders a plain username unchanged", function() {
            mockRED.settings.user = { username: "fred" };
            RED.user.init();
            findItem("usermenu-item-username").label.should.equal("<b>fred</b>");
        });

        it("renders a user without username as before", function() {
            mockRED.settings.user = { email: "fred@example.com" };
            RED.user.init();
            findItem("usermenu-item-username").label.should.equal("<b>undefined</b>");
        });

        it("escapes the username in the logged-in notification", function() {
            mockRED.settings.user = { anonymous: true };
            RED.user.init();
            const loginItem = findItem("usermenu-item-login");
            should.exist(loginItem);
            sinon.stub(RED.user, "login").callsFake(function(opts, done) { done(); });
            mockRED.settings.load.callsFake(function(done) {
                mockRED.settings.user = { username: MALICIOUS_NAME };
                done();
            });
            loginItem.onselect();
            mockRED.notify.calledOnce.should.be.true();
            const message = mockRED.notify.firstCall.args[0];
            message.should.not.containEql("<img");
            message.should.containEql(ESCAPED_NAME);
            // The event still carries the raw username
            mockRED.events.emit.calledWith("login", MALICIOUS_NAME).should.be.true();
        });
    });

    describe("login after session expiry", function() {
        function loginWithCredentials(opts, done) {
            RED.user.login(opts, done);
            const loginRequest = jq.ajaxCalls[0];
            loginRequest.opts.url.should.equal("auth/login");
            loginRequest.opts.success({
                type: "credentials",
                prompts: [{ id: "username", type: "text", label: "user.username" }]
            });
            const submit = jq.handlers["#node-dialog-login-fields submit"];
            should.exist(submit);
            submit[0]({ preventDefault: function() {} });
            const tokenRequest = jq.ajaxCalls[1];
            tokenRequest.opts.url.should.equal("auth/token");
            tokenRequest.done.forEach(function(fn) {
                fn({ access_token: "new-token" });
            });
        }

        it("refreshes RED.settings.user before rebuilding the user menu", function() {
            mockRED.settings.user = { username: "fred" };
            mockRED.settings.refreshSettings.callsFake(function(done) {
                mockRED.settings.user = { username: "barney" };
                done(null, {});
            });
            const done = sinon.spy();
            loginWithCredentials({ updateMenu: true }, done);

            mockRED.settings.set.calledWith("auth-tokens", { access_token: "new-token" }).should.be.true();
            mockRED.settings.refreshSettings.calledOnce.should.be.true();
            RED.settings.user.username.should.equal("barney");
            findItem("usermenu-item-username").label.should.equal("<b>barney</b>");
            done.calledOnce.should.be.true();
        });

        it("does not wait for the settings refresh to complete the login", function() {
            const done = sinon.spy();
            // refreshSettings never calls back (e.g. request still pending)
            loginWithCredentials({ updateMenu: true }, done);
            mockRED.settings.refreshSettings.calledOnce.should.be.true();
            done.calledOnce.should.be.true();
        });

        it("does not refresh settings for a login without updateMenu", function() {
            const done = sinon.spy();
            loginWithCredentials({}, done);
            mockRED.settings.refreshSettings.called.should.be.false();
            menuItems.should.have.length(0);
            done.calledOnce.should.be.true();
        });
    });
});
