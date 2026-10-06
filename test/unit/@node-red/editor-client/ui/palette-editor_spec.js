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
 *   #34: a failed install, update, remove or enable of a module shows the module name and the message of the server escaped
 *   #37 (review): the module version, the catalog name and the catalog filter are text, the links and the
 *   Review buttons take only http and https addresses, the handlers of enable and disable are driven
 *   #37: the confirmations and the progress message show the module name escaped; a failed enable or disable of a
 *   module names the action (enable / disable) and the module; a failed upload shows the file name escaped
 *   #63: a relative address of the catalog gives no documentation link and no Review button
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const cheerio = require("cheerio");

const NR_TEST_UTILS = require("nr-test-utils");
const sinon = require("sinon");
const catalog = require("../helpers/catalog");
const { createJQuery } = require("../helpers/jquery");

const errorsModulePath = NR_TEST_UTILS.resolve("@node-red/editor-client/src/js/ui/common/errors.js");
const paletteEditorModulePath = NR_TEST_UTILS.resolve("@node-red/editor-client/src/js/ui/palette-editor.js");

describe("editor-client/ui/palette-editor (#34)", function() {
    const INJECTION = catalog.INJECTION;
    let editor;
    let notifier;
    let requests;
    let jq;
    let savedGlobals;

    // the specs restore the globals they set: what was there before the suite is there after it
    const globalsBefore = {};
    before(function() {
        ["RED", "$", "window"].forEach(key => { globalsBefore[key] = global[key]; });
    });
    after(function() {
        ["RED", "$", "window"].forEach(function(key) {
            should(global[key]).equal(globalsBefore[key], "global." + key + " leaked out of the palette-editor spec");
        });
    });

    function lastNotification() {
        return notifier.notifications[notifier.notifications.length - 1];
    }

    function button(notification, className) {
        return notification.options.buttons.find(b => b.class && b.class.indexOf(className) !== -1);
    }

    function errorResponse(message) {
        return { status: 400, responseJSON: { message } };
    }

    beforeEach(function() {
        savedGlobals = { RED: global.RED, $: global.$, window: global.window };
        notifier = catalog.createNotifier();
        global.RED = {
            _: catalog.translate,
            notify: notifier.notify,
            palette: {},
            settings: { get: (key, def) => def },
            utils: { addSpinnerOverlay: () => ({ remove() {}, appendTo() {} }) },
            eventLog: { startEvent() {} },
            actions: { invoke() {} },
            popover: { tooltip() {}, create() {} },
            events: { on() {} }
        };
        jq = createJQuery();
        requests = jq.record.requests;
        global.$ = jq;
        global.window = {};
        delete require.cache[errorsModulePath];
        delete require.cache[paletteEditorModulePath];
        require(errorsModulePath);
        editor = require(paletteEditorModulePath);
    });

    afterEach(function() {
        delete require.cache[errorsModulePath];
        delete require.cache[paletteEditorModulePath];
        Object.keys(savedGlobals).forEach(function(key) {
            if (savedGlobals[key] === undefined) {
                delete global[key];
            } else {
                global[key] = savedGlobals[key];
            }
        });
    });

    it("is loaded as RED.palette.editor", function() {
        RED.palette.editor.should.have.property("install").which.is.a.Function();
        editor.install.should.equal(RED.palette.editor.install);
    });

    describe("moduleFailedMessage", function() {
        it("escapes the module and the message, and keeps the HTML of the catalog text", function() {
            editor.moduleFailedMessage("palette.editor.errors.enableFailed", "mod\"ule", INJECTION).should.equal(
                "<p>Failed to enable: mod&quot;ule</p><p>&lt;img src=x onerror=alert(1)&gt;</p><p>Check the log for more information</p>");
        });

        it("covers the failures of enable, disable, install, update and remove", function() {
            ["enable", "disable", "install", "update", "remove"].forEach(function(action) {
                const html = editor.moduleFailedMessage("palette.editor.errors." + action + "Failed", INJECTION, INJECTION);
                catalog.assertNoMarkup(html);
                html.should.containEql("<p>Failed to " + action + ": &lt;img");
            });
        });
    });

    describe("install", function() {
        function confirmInstall(entry) {
            editor.install(entry, {}, function() {});
            const confirm = lastNotification();
            button(confirm, "red-ui-palette-module-install-confirm-button-install").click();
        }

        it("shows the message of a failed install as text", function() {
            confirmInstall({ id: "node-red-contrib-x", version: "1.0.0" });
            requests.should.have.length(1);
            requests[0].failWith(errorResponse("npm failed: " + INJECTION));
            const n = lastNotification();
            n.msg.should.equal("<p>Failed to install: node-red-contrib-x</p><p>npm failed: &lt;img src=x onerror=alert(1)&gt;</p><p>Check the log for more information</p>");
            catalog.assertNoMarkup(n.msg);
            n.options.type.should.equal("error");
        });

        it("shows the module name as text", function() {
            confirmInstall({ id: INJECTION, version: "1.0.0" });
            requests[0].failWith(errorResponse("fail"));
            lastNotification().msg.should.containEql("Failed to install: &lt;img src=x onerror=alert(1)&gt;</p>");
            catalog.assertNoMarkup(lastNotification().msg);
        });
    });

    describe("remove", function() {
        it("shows the message of a failed remove as text", function() {
            editor.remove({ name: "node-red-contrib-x" }, {}, function() {});
            button(lastNotification(), "red-ui-palette-module-install-confirm-button-remove").click();
            requests.should.have.length(1);
            requests[0].failWith(errorResponse(INJECTION));
            const n = lastNotification();
            n.msg.should.equal("<p>Failed to remove: node-red-contrib-x</p><p>&lt;img src=x onerror=alert(1)&gt;</p><p>Check the log for more information</p>");
            catalog.assertNoMarkup(n.msg);
        });
    });

    describe("update", function() {
        it("shows the message of a failed update as text", function() {
            editor.nodeEntries["node-red-contrib-x"] = { info: { version: "1.0.0" } };
            editor.update({ name: "node-red-contrib-x" }, "2.0.0", undefined, {}, function() {});
            button(lastNotification(), "red-ui-palette-module-install-confirm-button-update").click();
            requests.should.have.length(1);
            requests[0].failWith(errorResponse(INJECTION));
            const n = lastNotification();
            n.msg.should.equal("<p>Failed to update: node-red-contrib-x</p><p>&lt;img src=x onerror=alert(1)&gt;</p><p>Check the log for more information</p>");
            catalog.assertNoMarkup(n.msg);
        });
    });

    describe("autoInstallModules", function() {
        it("shows the message of a failed install as text", function() {
            editor.autoInstallModules({ "node-red-contrib-x": "1.0.0" });
            requests.should.have.length(1);
            requests[0].failWith(errorResponse(INJECTION));
            const n = lastNotification();
            n.msg.should.equal("<p>Failed to install: node-red-contrib-x</p><p>&lt;img src=x onerror=alert(1)&gt;</p><p>Check the log for more information</p>");
            catalog.assertNoMarkup(n.msg);
        });
    });

    describe("the confirmations and the progress message show the module name as text (#37)", function() {
        function assertNameAsText(html) {
            catalog.assertNoMarkup(html);
            catalog.assertNoElement(html, "img");
            html.should.containEql("&lt;img src=x onerror=alert(1)&gt;");
        }

        it("install", function() {
            editor.install({ id: INJECTION, version: "1.0.0" }, {}, function() {});
            assertNameAsText(lastNotification().msg);
            lastNotification().msg.should.startWith("<p>Installing '&lt;img");
        });

        it("update", function() {
            editor.nodeEntries[INJECTION] = { info: { version: "1.0.0" } };
            editor.update({ name: INJECTION }, "2.0.0", undefined, {}, function() {});
            assertNameAsText(lastNotification().msg);
        });

        it("remove", function() {
            editor.remove({ name: INJECTION }, {}, function() {});
            assertNameAsText(lastNotification().msg);
        });

        it("the name with quotes stays in the quotes of the text", function() {
            editor.remove({ name: "a\"b'c" }, {}, function() {});
            lastNotification().msg.should.startWith("<p>Removing 'a&quot;b&#39;c'</p>");
        });

        it("the progress message of the automatic install", function() {
            editor.autoInstallModules({ [INJECTION]: "1.0.0" });
            const n = notifier.notifications[0];
            n.msg.should.startWith("<p>Module installation in progress: &lt;img src=x onerror=alert(1)&gt;</p>");
            // the only element <img> is the spinner of the message
            const images = cheerio.load(n.msg)("img");
            images.length.should.equal(1);
            images.attr("src").should.equal("red/images/spin.svg");
            n.msg.should.not.containEql("onerror=alert(1)>");
        });
    });

    describe("a failed enable or disable of a module (#37)", function() {
        it("names the action: enable for true, disable for false (it was always \"install\")", function() {
            editor.stateChangeFailedMessage(true, "node-red-contrib-x", "no").should.startWith("<p>Failed to enable: node-red-contrib-x</p>");
            editor.stateChangeFailedMessage(false, "node-red-contrib-x", "no").should.startWith("<p>Failed to disable: node-red-contrib-x</p>");
        });

        it("shows the module and the message as text", function() {
            editor.notifyStateChangeFailed(true, INJECTION, errorResponse(INJECTION));
            const n = lastNotification();
            n.msg.should.equal("<p>Failed to enable: &lt;img src=x onerror=alert(1)&gt;</p><p>&lt;img src=x onerror=alert(1)&gt;</p><p>Check the log for more information</p>");
            catalog.assertNoElement(n.msg, "img");
        });

        it("shows nothing when the change succeeded or the answer has no JSON body", function() {
            editor.notifyStateChangeFailed(false, "m", undefined);
            editor.notifyStateChangeFailed(false, "m", { status: 502 });
            notifier.notifications.should.have.length(0);
        });
    });

    describe("a failed upload of a module file (#37)", function() {
        it("shows the file name and the message of the server as text", function() {
            editor.notifyUploadFailed(INJECTION + ".tgz", "error", errorResponse(INJECTION));
            const n = lastNotification();
            n.msg.should.equal("<p>Failed to install: &lt;img src=x onerror=alert(1)&gt;.tgz</p><p>&lt;img src=x onerror=alert(1)&gt;</p><p>Check the log for more information</p>");
            catalog.assertNoElement(n.msg, "img");
            n.options.type.should.equal("error");
        });

        it("shows the status text of the request when the server sent no JSON", function() {
            editor.notifyUploadFailed("x.tgz", "timeout <b>", { status: 0 });
            lastNotification().msg.should.containEql("<p>timeout &lt;b&gt;</p>");
        });
    });

    describe("driven through init: the lists of the palette (#37)", function() {
        let clock;
        let nodeList;
        let packageList;
        let popovers;
        let nodeSets;
        let windowOpen;

        function install() {
            popovers = [];
            nodeSets = {};
            windowOpen = sinon.spy();
            global.window = { open: windowOpen };
            Object.assign(RED, {
                settings: { get: (key, def) => def, theme: () => ["https://one.example/catalogue.json", "https://two.example/catalogue.json"] },
                utils: {
                    addSpinnerOverlay: () => ({ remove() {}, appendTo() {} }),
                    parseModuleList: list => list,
                    checkModuleAllowed: () => true
                },
                tabs: { create: () => ({ addTab() {}, activateTab() {}, resize() {} }) },
                userSettings: { add() {}, show() {} },
                statusBar: { add() {}, show() {}, hide() {} },
                actions: { add() {}, invoke() {} },
                events: { on() {}, emit() {} },
                popover: { tooltip() {}, create(options) { popovers.push(options); return { open() {}, close() {} }; } },
                nodes: {
                    getType: () => undefined,
                    registry: {
                        getNodeSet: id => nodeSets[id],
                        getNodeSetForType: () => undefined,
                        getModule: () => undefined
                    }
                },
                plugins: { getPlugin: () => undefined }
            });
        }

        function catalogModule(overrides) {
            return Object.assign({
                id: "node-red-contrib-x", name: "node-red-contrib-x", version: "1.0.0", description: "d",
                url: "https://example.org/x", updated_at: "2026-01-01T00:00:00.000Z", pkg_url: "https://example.org/x.tgz"
            }, overrides);
        }

        function sinksAfter(count) {
            return jq.record.htmlSinks.slice(count).map(s => s.html);
        }

        function assertNoRawInjection(sinks) {
            sinks.forEach(function(html) {
                html.should.not.containEql("onerror");
                html.should.not.containEql("<img src=x");
            });
        }

        beforeEach(function() {
            clock = sinon.useFakeTimers();
            install();
            jq.documents["https://one.example/catalogue.json"] = { name: INJECTION, modules: [catalogModule({ version: INJECTION })] };
            jq.documents["https://two.example/catalogue.json"] = { name: "two", modules: [] };
            editor.init();
            nodeList = jq.record.editableLists[0];
            packageList = jq.record.editableLists[1];
        });

        afterEach(function() {
            clock.restore();
        });

        it("builds the two lists of the palette", function() {
            should.exist(nodeList);
            should.exist(packageList);
            nodeList.addItem.should.be.a.Function();
            packageList.addItem.should.be.a.Function();
        });

        describe("the install tab (the module comes from the remote catalog)", function() {
            function addItem(module) {
                const before = jq.record.htmlSinks.length;
                const container = jq("<li>");
                packageList.addItem(container, 0, { info: module });
                return { container, sinks: sinksAfter(before) };
            }

            function catalogModuleOfCatalog(index) {
                return jq.documents[index === 0 ? "https://one.example/catalogue.json" : "https://two.example/catalogue.json"].modules[0];
            }

            it("takes the catalog (two catalogs, so the name of the catalog is shown) with the module from it", function() {
                const module = catalogModuleOfCatalog(0);
                module.catalog.should.have.property("name", INJECTION);
            });

            it("the version and the name of the catalog are text: nothing of them is parsed as HTML", function() {
                const module = catalogModuleOfCatalog(0);
                const texts = jq.record.texts.length;
                const result = addItem(module);
                assertNoRawInjection(result.sinks);
                const set = jq.record.texts.slice(texts);
                set.should.containEql(" " + INJECTION);     // the version
                set.filter(t => t === " " + INJECTION).length.should.equal(2); // the version and the name of the catalog
            });

            it("the name and the version with quotes and ampersands stay as they are, as text", function() {
                const module = catalogModuleOfCatalog(0);
                module.version = "1\"'&<b>";
                const texts = jq.record.texts.length;
                addItem(module);
                jq.record.texts.slice(texts).should.containEql(" 1\"'&<b>");
            });

            it("a module with the address javascript: has no link", function() {
                const module = catalogModuleOfCatalog(0);
                module.url = "javascript:alert(1)";
                const elements = jq.record.elements.length;
                addItem(module);
                const links = jq.record.elements.slice(elements).filter(e => e.state.attrs.href !== undefined && /palette-module-link/.test(e.state.source));
                links.should.have.length(0);
            });

            it("#63 B1-AC-1: a module with a relative address has no link, also when the address of the editor is known", function() {
                global.window.location = { href: "https://editor.example/red/" };
                ["docs/x", "/x", "?q=1", "#a", "//example.org/x"].forEach(function(url) {
                    const module = catalogModuleOfCatalog(0);
                    module.url = url;
                    const elements = jq.record.elements.length;
                    addItem(module);
                    const links = jq.record.elements.slice(elements).filter(e => /palette-module-link/.test(e.state.source));
                    links.should.have.length(0, url);
                });
            });

            it("a module with an https address has the link, that opens without access to the editor", function() {
                const module = catalogModuleOfCatalog(0);
                const elements = jq.record.elements.length;
                addItem(module);
                const links = jq.record.elements.slice(elements).filter(e => /palette-module-link/.test(e.state.source));
                links.should.have.length(1);
                links[0].state.attrs.href.should.equal("https://example.org/x");
                links[0].state.source.should.containEql('rel="noopener"');
            });

            it("the hint of a conflict shows the module that conflicts as text", function() {
                RED.nodes.registry.getNodeSetForType = () => ({ module: INJECTION });
                const module = catalogModuleOfCatalog(0);
                module.types = ["some-type"];
                addItem(module);
                const hints = popovers.filter(p => typeof p.content === "string");
                hints.should.have.length(1);
                catalog.assertNoElement(hints[0].content, "img");
                hints[0].content.should.containEql("<code>&lt;img src=x onerror=alert(1)&gt;</code>");
            });
        });

        describe("the filter of the catalogs", function() {
            it("the name of a catalog is the text of its option, not HTML", function() {
                const texts = jq.record.texts.length;
                const sinks = jq.record.htmlSinks.length;
                editor.updateCatalogFilter([{ name: INJECTION }, { name: "two" }]);
                assertNoRawInjection(sinksAfter(sinks));
                jq.record.texts.slice(texts).should.containEql(INJECTION);
            });

            it("the option is made with the name as the value and as the text", function() {
                const option = editor.catalogOption({ name: "a\"b" });
                option.state.attrs.value.should.equal("a\"b");
                option.state.texts.should.eql(["a\"b"]);
            });
        });

        describe("the version of a module that is updated but not running yet", function() {
            it("shows both versions as text", function() {
                const span = jq("<span>");
                const sinks = jq.record.htmlSinks.length;
                editor.renderPendingVersion(span, INJECTION, INJECTION);
                assertNoRawInjection(sinksAfter(sinks));
                span.state.texts.should.eql([INJECTION + " "]);
                jq.record.texts.should.containEql(" " + INJECTION);
            });
        });

        describe("the nodes tab: enable and disable (the click handlers of the real list)", function() {
            let object;
            let container;

            function addModule(nodeSet) {
                object = {
                    info: { name: "node-red-contrib-x", version: "1.0.0", local: true, nodeSet: nodeSet },
                    setUseCount: { set1: 0 },
                    totalUseCount: 0
                };
                container = jq("<li>");
                nodeList.addItem(container, 0, object);
                clock.reset(); // the refresh of the module that addItem asked for is not what is tested
            }

            function answerWithError(message) {
                const request = jq.record.requests[jq.record.requests.length - 1];
                request.failWith(errorResponse(message));
                clock.tick(1000); // the result is shown after the shortest time of the spinner
            }

            const SET = { id: "node-red-contrib-x/set1", name: "set1", types: ["x-type"], enabled: true };

            it("a failed enable of a disabled module says \"enable\" and names the module", function() {
                addModule({ set1: SET });
                container.addClass("disabled");
                object.elements.enableButton.click();
                const request = jq.record.requests[0];
                request.options.url.should.equal("nodes/node-red-contrib-x");
                JSON.parse(request.options.data).should.eql({ enabled: true });
                answerWithError("no <b>way</b>");
                const n = lastNotification();
                n.msg.should.equal("<p>Failed to enable: node-red-contrib-x</p><p>no &lt;b&gt;way&lt;/b&gt;</p><p>Check the log for more information</p>");
                n.options.should.equal("error");
            });

            it("a failed disable of an enabled module says \"disable\" and names the module", function() {
                addModule({ set1: SET });
                object.elements.enableButton.click();
                JSON.parse(jq.record.requests[0].options.data).should.eql({ enabled: false });
                answerWithError("no");
                lastNotification().msg.should.startWith("<p>Failed to disable: node-red-contrib-x</p>");
                lastNotification().options.should.equal("error");
            });

            it("a failed change of a node set names the set (its id) and the action", function() {
                nodeSets[SET.id] = { enabled: true };
                addModule({ set1: SET });
                object.elements.setButton.click();
                should.exist(object.elements.sets.set1);
                object.elements.sets.set1.enableButton.click();
                jq.record.requests[0].options.url.should.equal("nodes/node-red-contrib-x/set1");
                answerWithError(INJECTION);
                const n = lastNotification();
                n.msg.should.equal("<p>Failed to disable: node-red-contrib-x/set1</p><p>&lt;img src=x onerror=alert(1)&gt;</p><p>Check the log for more information</p>");
                catalog.assertNoElement(n.msg, "img");
                n.options.should.equal("error");
            });

            it("a failed enable of a disabled node set says \"enable\"", function() {
                nodeSets[SET.id] = { enabled: false };
                addModule({ set1: Object.assign({}, SET, { enabled: false }) });
                object.elements.setButton.click();
                object.elements.sets.set1.enableButton.click();
                answerWithError("no");
                lastNotification().msg.should.startWith("<p>Failed to enable: node-red-contrib-x/set1</p>");
            });

            it("a change that succeeded shows nothing", function() {
                addModule({ set1: SET });
                object.elements.enableButton.click();
                jq.record.requests[0].succeed();
                clock.tick(1000);
                notifier.notifications.should.have.length(0);
            });
        });
    });

    describe("the Review button and the links (#37)", function() {
        beforeEach(function() {
            global.window = { open: sinon.spy() };
        });

        it("a button is made only for an http or https address", function() {
            should.not.exist(editor.reviewButton("javascript:alert(1)", "x"));
            should.not.exist(editor.reviewButton("data:text/html,<img src=x onerror=alert(1)>", "x"));
            should.not.exist(editor.reviewButton("vbscript:x", "x"));
            should.not.exist(editor.reviewButton(undefined, "x"));
            should.not.exist(editor.reviewButton("", "x"));
            should.not.exist(editor.reviewButton("not an address", "x"));
            should.exist(editor.reviewButton("https://example.org/a", "x"));
            should.exist(editor.reviewButton("http://example.org/a", "x"));
        });

        it("#63 B1-AC-1: no button is made for a relative address, also when the address of the editor is known", function() {
            global.window.location = { href: "https://editor.example/red/" };
            ["docs/x", "/x", "?q=1", "#a", "//example.org/x"].forEach(function(url) {
                should(editor.reviewButton(url, "x")).equal(null, url);
            });
            delete global.window.location;
            should(editor.reviewButton("docs/x", "x")).equal(null);
        });

        it("#63 B1-AC-1: the install confirmation of a module with a relative address has no Review button", function() {
            global.window.location = { href: "https://editor.example/red/" };
            editor.install({ id: "m", version: "1.0.0", url: "docs/x" }, {}, function() {});
            lastNotification().options.buttons.map(b => b.text).should.eql(["Cancel", "Install"]);
        });

        it("opens the address in a new window without access to the editor", function() {
            const review = editor.reviewButton("https://example.org/a b", "red-class");
            review.class.should.equal("red-class");
            review.text.should.equal("Open node information");
            review.click();
            window.open.calledOnce.should.be.true();
            window.open.firstCall.args.should.eql(["https://example.org/a%20b", "_blank", "noopener"]);
        });

        it("the install confirmation has the button only for a safe address", function() {
            editor.install({ id: "m", version: "1.0.0", url: "javascript:alert(1)" }, {}, function() {});
            lastNotification().options.buttons.map(b => b.text).should.eql(["Cancel", "Install"]);
            editor.install({ id: "m", version: "1.0.0", url: "https://example.org/m" }, {}, function() {});
            lastNotification().options.buttons.map(b => b.text).should.eql(["Cancel", "Open node information", "Install"]);
        });

        it("the update confirmation of a major version has the button only for a safe address", function() {
            editor.nodeEntries["m"] = { info: { version: "1.0.0" } };
            editor.update({ name: "m", url: "javascript:alert(1)" }, "2.0.0", undefined, {}, function() {});
            lastNotification().options.buttons.map(b => b.text).should.eql(["Cancel", "Update"]);
            editor.update({ name: "m", url: "https://example.org/m" }, "2.0.0", undefined, {}, function() {});
            lastNotification().options.buttons.map(b => b.text).should.eql(["Cancel", "Open node information", "Update"]);
        });
    });

    describe("the conflict hint (#37)", function() {
        it("shows the module as text and keeps the HTML of the catalog", function() {
            const html = editor.conflictTipMessage(INJECTION);
            catalog.assertNoElement(html, "img");
            html.should.containEql("<code>&lt;img src=x onerror=alert(1)&gt;</code>");
            html.should.startWith("<p>This module cannot be installed");
        });
    });
});
